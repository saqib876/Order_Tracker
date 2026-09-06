import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsAppText, matchQna, getGreetingMessage } from '@/lib/whatsapp'
import { normalizeForMatch } from '@/lib/textNormalize'
import { detectManualReason, MANUAL_REASON_REPLY, MANUAL_REASON_LABEL } from '@/lib/intents'
import {
  looksLikeOrderQuery,
  extractOrderNumber,
  extractConfirmationNumber,
  mentionsOrderNumber,
  extractPhone,
  isNumericOnlyMessage,
  extractTrackingCandidate,
  phoneVariants,
} from '@/lib/messageParse'

export const dynamic = 'force-dynamic'

const trackingUrl = (id: string) => `https://postex.pk/tracking?cn=${id}`
const WEBSITE_TRACKING_LINK = 'https://myzan.net/pages/track-your-order'
const MIN_WORKING_DAYS = 10
const MAX_WORKING_DAYS = 15

// 4-step model jo customer ko dikhta hai (WhatsApp message ke liye) -
// underlying Supabase 'status' column abhi bhi 6 values rakh sakta hai
// (website ka apna progress bar isi purane 6-step data pe chalta rahega,
// hum sirf WhatsApp ke message ke liye inhe group kar rahe hain)
const WA_STEP: Record<string, number> = {
  in_process: 1,
  packed: 1,
  ready_to_ship: 1,
  printing_done: 2,
  shipped: 3,
  delivered: 4,
}

const WA_STATUS_LABEL: Record<string, string> = {
  in_process: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  packed: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  ready_to_ship: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  printing_done: 'Order ki printing mukammal ho chuki hai',
  shipped: 'Aap ka order dispatch ho chuka hai aur raaste mein hai',
  delivered: 'Aap ka order deliver ho chuka hai',
}

// Server UTC mein chalta hai (Vercel default), lekin customer/website Pakistan
// time use karta hai. Intl API se seedha Asia/Karachi ki calendar date nikalte
// hain - ye guaranteed sahi rahega chahe server kisi bhi timezone mein chale,
// aur date exactly Pakistan midnight (raat 12 baje) pe hi change hogi.
function toPakistanDateOnly(d: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(d)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)
  return new Date(y, m - 1, day) // midnight, calendar-only date
}

function pakistanNow(): Date {
  return toPakistanDateOnly(new Date())
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

function progressBar(step: number, total = 4): string {
  return '🟩'.repeat(step) + '⬜'.repeat(total - step)
}

// N working days (Mon-Sat, Sunday off) aage badhata hai - hamesha Pakistan
// calendar date se normalize karke shuru karta hai
function addWorkingDays(start: Date, days: number): Date {
  const result = toPakistanDateOnly(start)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    if (result.getDay() !== 0) added++ // 0 = Sunday
  }
  return result
}

// Do dates ke beech kitne working days (Mon-Sat) hain - dono ko Pakistan
// calendar date mein normalize karke compare karta hai
function workingDaysBetween(from: Date, to: Date): number {
  const start = toPakistanDateOnly(from)
  const end = toPakistanDateOnly(to)
  if (end <= start) return 0
  let count = 0
  const cur = new Date(start)
  while (cur < end) {
    cur.setDate(cur.getDate() + 1)
    if (cur.getDay() !== 0) count++
  }
  return count
}

function prettyCourier(raw?: string): string {
  const t = (raw || '').trim()
  if (!t) return ''
  const letters = t.replace(/[^A-Za-z]/g, '')
  const isAllCaps = letters.length > 0 && letters === letters.toUpperCase()
  if (!isAllCaps) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function fmtCourierTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type CourierStage =
  | 'delivered' | 'out_for_delivery' | 'near' | 'in_transit'
  | 'booked' | 'undelivered' | 'contacting' | 'returning'

function classifyCourierStage(label: string): CourierStage {
  const l = (label || '').toLowerCase()
  if (l.includes('undelivered')) return 'undelivered'
  if (l.includes('delivered')) return 'delivered'
  if (l.includes('contacting consignee')) return 'contacting'
  if (
    l.includes('moved to origin') || l.includes('reached at origin') ||
    l.includes('out for return') || l.includes('returned submitted') || l.includes('return submission')
  ) return 'returning'
  if (l.includes('out for delivery')) return 'out_for_delivery'
  if (l.includes('reached at dest')) return 'near'
  if (l.includes('moved to dest') || l.includes('en-route') || l.includes('en route')) return 'in_transit'
  return 'booked'
}

function daysForCourierStage(stage: CourierStage): number {
  switch (stage) {
    case 'out_for_delivery': return 0
    case 'near': return 1
    case 'in_transit': return 2
    case 'undelivered': return 1
    case 'contacting': return 1
    default: return 3
  }
}

// Call Courier ki live tracking API - koi auth token nahi chahiye
async function fetchLatestCourierRaw(trackingId: string): Promise<{ label: string; time: string } | null> {
  try {
    const res = await fetch(`http://cod.callcourier.com.pk/api/CallCourier/GetTackingHistory?cn=${trackingId}`)
    if (!res.ok) return null
    const json = await res.json()
    if (!Array.isArray(json) || json.length === 0) return null

    const sorted = [...json].sort(
      (a: any, b: any) => new Date(b.TransactionDate).getTime() - new Date(a.TransactionDate).getTime()
    )
    const latest = sorted[0]
    const label = prettyCourier(latest.ProcessDescForPortal || latest.OperationDesc)
    if (!label) return null
    return { label, time: fmtCourierTime(latest.TransactionDate) }
  } catch {
    return null
  }
}

async function buildStatusReply(order: any): Promise<string> {
  const status = (order.status || '').toLowerCase()
  const step = WA_STEP[status] || 1
  const label = WA_STATUS_LABEL[status] || `Status: ${order.status}`
  const orderDate = new Date(order.shopify_created_at || order.created_at)

  const lines = [
    `📦 *Order #${order.order_number} Update*`,
    '',
    `Order Confirm Date: ${formatDate(orderDate)}`,
    '',
    `Status: ${label} (Step ${step}/4)`,
    progressBar(step),
  ]

  const hasTracking = Boolean(order.tracking_id)

  if (!hasTracking) {
    // Tracking add hone se PEHLE - website jaisa hi: order date + 10/15 calendar din
    const orderDatePK = toPakistanDateOnly(orderDate)
    const minDate = new Date(orderDatePK); minDate.setDate(orderDatePK.getDate() + MIN_WORKING_DAYS)
    const maxDate = new Date(orderDatePK); maxDate.setDate(orderDatePK.getDate() + MAX_WORKING_DAYS)
    const passed = workingDaysBetween(orderDate, pakistanNow())
    const daysLeft = Math.max(1, MAX_WORKING_DAYS - passed)

    lines.push('')
    lines.push(`📅 Total Delivery Time: ${MIN_WORKING_DAYS} to ${MAX_WORKING_DAYS} Working Days (Monday to Saturday)`)
    lines.push('')
    lines.push(`📅 Expected Delivery Date: ${formatDate(minDate)} to ${formatDate(maxDate)}`)
    lines.push('')
    lines.push(`⏳ Remaining: ${daysLeft} working day(s)`)
    lines.push('')
    lines.push(`🔗 Live tracking dekhein: ${WEBSITE_TRACKING_LINK}`)
  } else {
    // Tracking add ho chuki hai - live courier status se date adjust karte hain
    lines.push('')
    lines.push(`🚚 Tracking Number: ${order.tracking_id}`)
    lines.push(`🔗 Track here: ${trackingUrl(order.tracking_id)}`)

    const latest = await fetchLatestCourierRaw(order.tracking_id)
    const stage = latest ? classifyCourierStage(latest.label) : null

    if (latest) {
      lines.push('')
      lines.push(`📍 Latest Update: ${latest.label} (${latest.time})`)
    }

    if (status === 'delivered' || stage === 'delivered') {
      lines.push('')
      lines.push('✅ Aapka order deliver ho chuka hai. Shopping ke liye shukriya!')
    } else if (stage === 'returning') {
      lines.push('')
      lines.push('⚠️ Aapka order courier ki taraf se return ho raha hai. Hum jald aap se raabta karenge.')
    } else {
      let expectedDate: Date

      if (stage) {
        // Live courier status ke hisaab se estimate
        expectedDate = addWorkingDays(pakistanNow(), daysForCourierStage(stage))
      } else {
        // Live data na mile to purana fallback: shipped date + 3 working days
        const { data: h } = await supabaseAdmin
          .from('order_status_history')
          .select('changed_at')
          .eq('order_id', order.id)
          .eq('status', 'shipped')
          .order('changed_at', { ascending: true })
          .limit(1)
          .single()
        expectedDate = h?.changed_at ? addWorkingDays(new Date(h.changed_at), 3) : addWorkingDays(pakistanNow(), 3)
      }

      const remaining = workingDaysBetween(pakistanNow(), expectedDate)
      lines.push('')
      lines.push(`📅 Expected Delivery Date: ${remaining === 0 ? 'Aaj (Today)' : formatDate(expectedDate)}`)
      if (remaining > 0) {
        lines.push('')
        lines.push(`⏳ Remaining: ${remaining} working day(s)`)
      }
    }
  }

  return lines.join('\n')
}

// Meta webhook verification (ek dafa, jab tum Webhook URL configure karte ho)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Incoming messages
export async function POST(req: NextRequest) {
  const payload = await req.json()

  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
  if (!message || message.type !== 'text') {
    // status updates (delivered/read receipts) ya non-text messages - ignore
    return NextResponse.json({ ok: true })
  }

  const from: string = message.from // already "923001234567" format
  const text: string = message.text.body

  const { data: state } = await supabaseAdmin
    .from('wa_conversation_state')
    .select('*')
    .eq('phone', from)
    .maybeSingle()

  const clearState = () =>
    supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)

  // ── 0) Greeting sab se pehle ──────────────────────────────────────────────
  // Naya customer ho ya 24 ghante baad wapas aaya ho — us ko sab se pehle
  // aap ka greeting message jata hai, chahe us ne kuch bhi poocha ho. Us ke
  // baad neeche wali logic us ke asal sawaal ka jawab dhoondti hai.
  await maybeSendGreeting(from)

  const confirmationNumber = extractConfirmationNumber(text)
  const orderNumber = extractOrderNumber(text)
  const phoneInText = extractPhone(text)
  const trackingCandidate = extractTrackingCandidate(text)

  // Kya ye message waqai order ke baare mein hai?
  //
  // YE GUARD AHEM HAI. Pehle har message mein se koi bhi 3-6 digit ka number
  // uthhaya jata tha, chahe wo price ho ("1400 ka hai?") ya mobile model.
  // Us se do masle the:
  //   1. Price poochne wale ko "order number galat hai" ka jawab milta tha
  //   2. Agar wo number sach mein kisi ka order number nikla, to KISI AUR
  //      customer ka status/tracking is ajnabi ko chala jata tha
  const orderish =
    looksLikeOrderQuery(text) ||
    isNumericOnlyMessage(text) ||
    mentionsOrderNumber(text) ||
    // Apna mobile number bhejne ki aam tor par ek hi wajah hoti hai — order
    // dhoondwana. Warna "03001234567 / yhi no ha" jaisa message Q&A mein
    // chala jata tha aur customer ko bilkul be-rabt jawab milta tha.
    phoneInText !== null ||
    state?.state === 'awaiting_order_info'

  // ── 1) Cancel / address / design / phone change ───────────────────────────
  // Ye chaar cheezein bot ko khud nahi karni chahiye. Holding reply bhejte
  // hain aur message ko manual review queue mein daal dete hain.
  const manualReason = detectManualReason(text)
  if (manualReason) {
    const contextOrder = await findOrder({
      confirmationNumber,
      orderNumber: orderish ? orderNumber : null,
      phoneInText,
      trackingCandidate: null,
      senderPhone: from,
    })

    // Ek customer aksar ek hi baat kai dafa likhta hai ("I want to cancel",
    // phir "Please cancel my order", phir "For cancelling"). Pehle har
    // message ki alag row banti thi, jis se ek hi customer ke 3-4 card
    // list mein aa jate the aur ek ko "Ho gaya" karne par baqi wahin
    // reh jate the — lagta tha ke hata hi nahi.
    //
    // Ab: isi number ki isi wajah ki pending row mojood ho to nayi nahi
    // banti — usi mein naya message jur jata hai aur ginti barh jati hai.
    const { data: pehleSeMojood } = await supabaseAdmin
      .from('manual_review_queue')
      .select('id, message_text, message_count')
      .eq('phone', from)
      .eq('reason', manualReason)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const abhi = new Date().toISOString()

    if (pehleSeMojood) {
      const badlav: Record<string, any> = {
        message_text: `${pehleSeMojood.message_text}\n— ${text}`,
        message_count: (Number(pehleSeMojood.message_count) || 1) + 1,
        last_message_at: abhi,
      }
      // Order ab mila ho to bhar dete hain; na mile to purana jyun ka tyun
      if (contextOrder) badlav.order_number = contextOrder.order_number

      await supabaseAdmin.from('manual_review_queue').update(badlav).eq('id', pehleSeMojood.id)
    } else {
      await supabaseAdmin.from('manual_review_queue').insert({
        phone: from,
        message_text: text,
        reason: manualReason,
        order_number: contextOrder ? contextOrder.order_number : null,
        message_count: 1,
        last_message_at: abhi,
      })
    }

    // Q&A mein is topic ka apna jawab ho to wo behtar hai
    const qnaAnswer = await matchQna(text)
    await clearState()
    await sendWhatsAppText(from, qnaAnswer || MANUAL_REASON_REPLY[manualReason])

    console.log(
      `[wa] manual review: ${MANUAL_REASON_LABEL[manualReason]} — ${from}` +
        (contextOrder ? ` (order ${contextOrder.order_number})` : '')
    )
    return NextResponse.json({ ok: true })
  }

  // ── 2) Live tracking — teeno tareeqon se ──────────────────────────────────
  // Confirmation number, order number, ya mobile number — jo bhi mile, us se
  // order dhoond kar live status bhej dete hain.
  const order = await findOrder({
    confirmationNumber,
    orderNumber: orderish ? orderNumber : null,
    phoneInText: orderish ? phoneInText : null,
    trackingCandidate: orderish ? trackingCandidate : null,
  })

  if (order) {
    await clearState()
    await sendWhatsAppText(from, await buildStatusReply(order))
    return NextResponse.json({ ok: true })
  }

  // Number diya tha lekin koi order nahi mila — batana zaroori hai, warna
  // customer intezaar karta reh jayega.
  if (confirmationNumber || (orderish && (orderNumber || phoneInText))) {
    await clearState()
    await sendWhatsAppText(
      from,
      [
        'Is Number Se Koi Order Nahi Mil Raha. Please Apna Correct ',
        '',
        'Order Number (Jaise 40981), ',
        'Confirmation Number (Jaise #N8FNNZAKE) ',
        'Ya Jis Mobile Number Se Order Kiya Tha Wo Bhej Dein — Main Again Check Karti Hun.',
      ].join('\n')
    )
    return NextResponse.json({ ok: true })
  }

  // ── 3) Q&A — poora sawaal padh kar word-score matching ────────────────────
  const qnaAnswer = await matchQna(text)
  if (qnaAnswer) {
    if (state) await clearState()
    await sendWhatsAppText(from, qnaAnswer)
    return NextResponse.json({ ok: true })
  }

  // ── 4) Order ka sawaal lagta hai lekin number nahi diya ───────────────────
  if (orderish) {
    await supabaseAdmin
      .from('wa_conversation_state')
      .upsert({ phone: from, state: 'awaiting_order_info', updated_at: new Date().toISOString() })
    await sendWhatsAppText(
      from,
      [
        'Please Apna ',
        '',
        'Order Number (Jaise 40981), ',
        'Confirmation Number (Jaise #N8FNNZAKE) ',
        'Ya Jis Mobile Number Se Order Kiya Tha Wo Bhej Dein — Main Abhi Check Karti Hun.',
      ].join('\n')
    )
    return NextResponse.json({ ok: true })
  }

  // ── 5) Kuch match nahi hua — BOT KHAMOSH RAHEGA ───────────────────────────
  // Jaan boojh kar koi reply nahi jata. Customer ko greeting mil chuki hai;
  // agar us ka sawaal humare data se match nahi hua to bot andaza lagane ke
  // bajaye chup rehta hai aur us ke agle message ka intezaar karta hai.
  // Message yahan log ho jata hai taake rozana ki Excel mein aa sake.
  if (state) await clearState()
  await supabaseAdmin.from('unmatched_messages').insert({ phone: from, message_text: text })

  return NextResponse.json({ ok: true })
}

/**
 * Naye customer ko (ya 24 ghante baad wapas aane wale ko) aap ka greeting
 * message bhejta hai. Jo greeting Excel ki "Salaam / Greeting" row mein hai,
 * wahi jati hai — wo row khali ho to kuch nahi jata.
 */
async function maybeSendGreeting(phone: string): Promise<void> {
  const cooldownHours = Number(process.env.GREETING_COOLDOWN_HOURS) || 24
  const cutoff = new Date(Date.now() - cooldownHours * 3600 * 1000).toISOString()

  const { data: seen, error } = await supabaseAdmin
    .from('wa_greeted')
    .select('greeted_at')
    .eq('phone', phone)
    .maybeSingle()

  if (error) {
    // Table abhi banayi nahi gayi — greeting chhod kar aage badh jao
    console.warn('[wa] wa_greeted parh nahi saka:', error.message)
    return
  }

  // Pehle hi bhej chuke hain (cooldown ke andar)
  if (seen && seen.greeted_at && String(seen.greeted_at) > cutoff) return

  const greeting = await getGreetingMessage()
  if (!greeting) return // aap ne greeting likhi hi nahi

  await sendWhatsAppText(phone, greeting)
  await supabaseAdmin
    .from('wa_greeted')
    .upsert({ phone, greeted_at: new Date().toISOString() })
}

/**
 * Order dhoondta hai — confirmation number, order number, mobile number aur
 * courier tracking number, in mein se jo bhi mile us se.
 *
 * Mobile number database mein purane orders par kisi bhi shakal mein mehfooz
 * ho sakta hai (92xxx / 0xxx / xxx), is liye teeno shaklon se dhoondte hain.
 */
async function findOrder(opts: {
  confirmationNumber: string | null
  orderNumber: string | null
  phoneInText: string | null
  trackingCandidate: string | null
  senderPhone?: string
}): Promise<any | null> {
  const { confirmationNumber, orderNumber, phoneInText, trackingCandidate, senderPhone } = opts

  if (confirmationNumber) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .ilike('confirmation_number', confirmationNumber)
      .maybeSingle()
    if (data) return data
  }

  if (orderNumber) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('order_number', orderNumber)
      .maybeSingle()
    if (data) return data
  }

  for (const phone of [phoneInText, senderPhone]) {
    if (!phone) continue
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .in('customer_phone', phoneVariants(phone))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data
  }

  if (trackingCandidate) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('tracking_id', trackingCandidate)
      .maybeSingle()
    if (data) return data
  }

  return null
}

