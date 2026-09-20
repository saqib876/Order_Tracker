import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsAppText, matchQna, getGreetingMessage } from '@/lib/whatsapp'
import { MANUAL_REASON_REPLY, MANUAL_REASON_LABEL } from '@/lib/intents'
import { noteForCourierStage, noteToWhatsAppText } from '@/lib/courierNotes'
import { phoneVariants, extractIncomingText } from '@/lib/messageParse'
import { planReply } from '@/lib/replyPlan'

export const dynamic = 'force-dynamic'

const trackingUrl = (id: string) => `https://postex.pk/tracking?cn=${id}`
const WEBSITE_TRACKING_LINK = 'https://myzan.net/pages/track-your-order'
const MIN_WORKING_DAYS = 10
const MAX_WORKING_DAYS = 15

// Ek hi order ki tracking isi customer ko is waqt ke andar dobara nahi jati
const TRACKING_REPEAT_HOURS = Number(process.env.TRACKING_REPEAT_HOURS) || 24
// Model available hai ya nahi — is ke jawab ki pehli line
const AVAILABLE_LINE = '*Yes Available*'
// Bot ne order number maanga ho to itni der tak us ke jawab ka intezaar
const ASK_STATE_HOURS = 24

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
  cancelled: 0,
}

const WA_STATUS_LABEL: Record<string, string> = {
  in_process: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  packed: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  ready_to_ship: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  printing_done: 'Order ki printing mukammal ho chuki hai',
  shipped: 'Aap ka order dispatch ho chuka hai aur raaste mein hai',
  delivered: 'Aap ka order deliver ho chuka hai',
  cancelled: 'Aap ka order cancel ho chuka hai',
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
  const step = WA_STEP[status] ?? 1
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

  // Cancel ho chuke order par delivery ka koi hisaab kitaab nahi banta.
  if (status === 'cancelled') {
    lines.push('')
    lines.push('❌ Ye order cancel ho chuka hai. Agar aap ko koi ghalat fehmi lagti hai to hamein message kar dein.')
    return lines.join('\n')
  }

  const hasTracking = Boolean(order.tracking_id)

  // Courier ki live update ab SAB SE PEHLE nikalte hain, taake wo progress bar
  // ke foran neeche aa sake — customer ki nazar sab se pehle wahin parti hai.
  const latest = hasTracking ? await fetchLatestCourierRaw(order.tracking_id) : null
  const stage = latest ? classifyCourierStage(latest.label) : null

  if (latest) {
    lines.push('')
    lines.push(`📍 Latest Courier Update: ${latest.label} (${latest.time})`)
  }

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

    if (status === 'delivered' || stage === 'delivered') {
      lines.push('')
      lines.push('✅ Aapka order deliver ho chuka hai. Shopping ke liye shukriya!')
    } else if (stage === 'returning') {
      // MOVED TO ORIGIN / REACHED AT ORIGIN / OUT FOR RETURN SUBMISSION /
      // RETURNED SUBMITTED — sab par ek hi tafseeli note jata hai.
      lines.push('')
      lines.push(noteToWhatsAppText(noteForCourierStage('returning', order.tracking_id)))
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

      // In do stages mein customer ko khud rider/courier se raabta karna hai,
      // is liye Remaining ke baad poora Note bhi jata hai.
      if (stage === 'undelivered' || stage === 'contacting') {
        lines.push('')
        lines.push(noteToWhatsAppText(noteForCourierStage(stage, order.tracking_id)))
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
  const incoming = extractIncomingText(message)
  if (!incoming) {
    // delivery/read receipts, reactions waghera — in par kuch nahi karna
    return NextResponse.json({ ok: true })
  }

  const from: string = message.from // already "923001234567" format
  const text = incoming.text.trim()

  // ── Tasveer / video bina caption ke ─────────────────────────────────────
  // Parhne ko kuch nahi — order ka screenshot bhi ho sakta hai, design bhi.
  // Pehle aise message bilkul nazarandaz ho jate the; ab kam se kam greeting
  // chali jati hai (agar 24 ghante mein nahi gayi) taake customer ko jawab mile.
  if (!text) {
    await maybeSendGreeting(from)
    return NextResponse.json({ ok: true })
  }

  const { data: state } = await supabaseAdmin
    .from('wa_conversation_state')
    .select('*')
    .eq('phone', from)
    .maybeSingle()

  const clearState = () =>
    supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)

  const askedBefore = isFreshAskState(state)
  const plan = planReply(text, { alreadyAskedForNumber: askedBefore })
  const { confirmationNumber, orderNumber, phoneInText, trackingCandidate, manualReason } = plan

  // ── 0) Greeting — sirf naye kharidar ko ──────────────────────────────────
  // Greeting "how to place your order" hai. Jo customer apne maujooda order
  // ki baat kar raha hai (order number, "I have ordered", cancel, address)
  // use ye bhejna bemaani hai — pehle "ORDER #48134" par bhi pehle greeting
  // jati thi, phir tracking.
  if (!plan.skipGreeting) await maybeSendGreeting(from)

  // ── 0b) "Mere model ka cover mil jayega?" ────────────────────────────────
  // Duniya ka koi bhi mobile ya laptop model ho, Urdu/English/Roman — jawab
  // ek hi hai: haan available hai, aur order aise place karein. DONO baatein
  // EK hi message mein jati hain, do alag messages nahi.
  //
  // Ye order-status se pehle hai: "Samsung A54 ka cover mil jayega" mein
  // "mil jayega" ki wajah se bot pehle "apna order number bhejein" bhej
  // deta tha.
  if (plan.modelAvailability) {
    const orderGuide = await getGreetingMessage()
    await clearState()
    await sendWhatsAppText(from, orderGuide ? `${AVAILABLE_LINE}\n\n${orderGuide}` : AVAILABLE_LINE)
    // Greeting isi message mein ja chuki — alag se dobara na jaye
    await markGreeted(from)
    console.log(`[wa] model availability — ${from}`)
    return NextResponse.json({ ok: true })
  }

  // ── 1) Cancel / address / design / phone change / shikayat ───────────────
  // Ye cheezein bot ko khud nahi karni chahiye. Holding reply bhejte hain aur
  // message ko manual review queue mein daal dete hain.
  if (manualReason) {
    const contextOrder = await findOrder({
      confirmationNumber,
      orderNumber: plan.readNumbers ? orderNumber : null,
      phoneInText,
      trackingCandidate: null,
      senderPhone: from,
    })

    // Ek customer aksar ek hi baat kai dafa likhta hai ("I want to cancel",
    // phir "Please cancel my order", phir "For cancelling"). Isi number ki
    // isi wajah ki pending row mojood ho to nayi nahi banti — usi mein naya
    // message jur jata hai aur ginti barh jati hai.
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
    orderNumber: plan.readNumbers ? orderNumber : null,
    phoneInText: plan.readNumbers ? phoneInText : null,
    trackingCandidate: plan.readNumbers ? trackingCandidate : null,
  })

  if (order) {
    await clearState()

    // Yahi order isi customer ko abhi abhi bheja ja chuka hai — wahi lamba
    // message dobara nahi. Doosra order number bheje to jawab jata hai.
    if (await trackingRecentlySent(from, order.order_number)) {
      console.log(`[wa] tracking #${order.order_number} pehle ja chuki — ${from} ko dobara nahi`)
      return NextResponse.json({ ok: true })
    }

    await sendWhatsAppText(from, await buildStatusReply(order))
    await markTrackingSent(from, order.order_number)
    return NextResponse.json({ ok: true })
  }

  // Number diya tha lekin koi order nahi mila — batana zaroori hai, warna
  // customer intezaar karta reh jayega.
  if (confirmationNumber || (plan.readNumbers && (orderNumber || phoneInText))) {
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
  // "No", "Ok", "Thanks" jaise jawab Q&A mein nahi jate — pehle akela "No"
  // number-change wala lamba jawab le aata tha.
  const qnaAnswer = plan.noQuestion ? null : await matchQna(text)
  if (qnaAnswer) {
    if (state) await clearState()
    await sendWhatsAppText(from, qnaAnswer)
    return NextResponse.json({ ok: true })
  }

  // ── 4) Order ka sawaal lagta hai lekin number nahi diya ───────────────────
  // Sirf EK dafa maangte hain. Pehle bot "intezaar" mein chala jata tha aur
  // us ke baad HAR message ("Hi", "camera protection...") par wahi maangta
  // rehta tha.
  if (plan.mayAskForNumber) {
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
  // Jaan boojh kar koi reply nahi jata. Agar bot number maang chuka hai to
  // wo intezaar barqarar rehta hai (baad mein number aaye to pehchana jaye),
  // warna saaf kar dete hain.
  if (state && !askedBefore) await clearState()

  // "Ok / No / Thanks" rozana ki Excel mein faltu bheer banate — sirf asal
  // sawaal log hote hain.
  if (!plan.noQuestion) {
    await supabaseAdmin.from('unmatched_messages').insert({ phone: from, message_text: text })
  }

  return NextResponse.json({ ok: true })
}

/**
 * Bot ne order number maanga tha, aur wo abhi taza hai (24 ghante ke andar)?
 * Purana intezaar hamesha ke liye nahi chalna chahiye.
 */
function isFreshAskState(state: any): boolean {
  if (!state || state.state !== 'awaiting_order_info') return false
  const at = state.updated_at ? new Date(state.updated_at).getTime() : 0
  return Date.now() - at < ASK_STATE_HOURS * 3600 * 1000
}

/**
 * Isi customer ko yahi order haal hi mein (TRACKING_REPEAT_HOURS ke andar)
 * bheja ja chuka hai?
 *
 * Table na bani ho to false — yani purana rawaiya (har dafa bhejo) chalta
 * rehta hai, bot tootta nahi.
 */
async function trackingRecentlySent(phone: string, orderNumber: string | number): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('wa_tracking_sent')
    .select('sent_at')
    .eq('phone', phone)
    .eq('order_number', String(orderNumber))
    .maybeSingle()

  if (error) {
    console.warn('[wa] wa_tracking_sent parh nahi saka:', error.message)
    return false
  }
  if (!data || !data.sent_at) return false
  return Date.now() - new Date(data.sent_at).getTime() < TRACKING_REPEAT_HOURS * 3600 * 1000
}

async function markTrackingSent(phone: string, orderNumber: string | number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('wa_tracking_sent')
    .upsert({ phone, order_number: String(orderNumber), sent_at: new Date().toISOString() })
  if (error) console.warn('[wa] wa_tracking_sent likh nahi saka:', error.message)
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
  await markGreeted(phone)
}

/** Greeting ja chuki — chahe akeli, chahe kisi aur jawab ke andar. */
async function markGreeted(phone: string): Promise<void> {
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

