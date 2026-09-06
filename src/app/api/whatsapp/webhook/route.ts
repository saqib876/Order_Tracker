import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsAppText, matchQna } from '@/lib/whatsapp'
import { normalizeForMatch } from '@/lib/textNormalize'
import { detectManualReason, MANUAL_REASON_REPLY, MANUAL_REASON_LABEL } from '@/lib/intents'
import {
  looksLikeOrderQuery,
  extractOrderNumber,
  extractConfirmationNumber,
  mentionsOrderNumber,
  isGreetingOnly,
  extractPhone,
  isNumericOnlyMessage,
  extractTrackingCandidate,
} from '@/lib/messageParse'

export const dynamic = 'force-dynamic'

const trackingUrl = (id: string) => `https://postex.pk/tracking?cn=${id}`
const WEBSITE_TRACKING_LINK = 'https://myzan.net/pages/track-your-order'
const MIN_WORKING_DAYS = 10
const MAX_WORKING_DAYS = 15

// Jab customer sirf salaam kare — pehle bot bilkul chup reh jata tha
// (8 din mein 265 aise messages the jinka koi jawab nahi gaya).
const WELCOME_MESSAGE = [
  'Assalam-o-Alaikum! Myzan Mobile Cases mein khush aamdeed 🙌',
  '',
  'Main aap ki kaise madad kar sakta hun?',
  '',
  '• *Order tracking* — apna order number, confirmation number (jaise #N8FNNZAKE) ya jis number se order kiya tha wo bhej dein',
  '• *Koi aur sawaal* — bas likh dein, main jawab dene ki koshish karunga',
].join('\n')

// Jab kuch bhi samajh na aaye. Pehle bot khamosh reh jata tha, jis se
// customer ko lagta tha ke message parha hi nahi gaya.
const FALLBACK_MESSAGE = [
  'Aap ka message mil gaya hai — shukriya! 🙏',
  '',
  'Ye sawaal main khud se hal nahi kar pa raha, humari team thori dair mein aap ko khud jawab degi.',
  '',
  `Agar order ke baare mein poochh rahe hain to apna *order number* ya *confirmation number* bhej dein, main foran status bata dunga. Live tracking: ${WEBSITE_TRACKING_LINK}`,
].join('\n')

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
    const contextOrder = await findOrderForContext({
      confirmationNumber,
      orderNumber: orderish ? orderNumber : null,
      phoneInText,
      senderPhone: from,
    })

    await supabaseAdmin.from('manual_review_queue').insert({
      phone: from,
      message_text: text,
      reason: manualReason,
      order_number: contextOrder?.order_number || null,
    })

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

  // ── 2) Shopify confirmation number ────────────────────────────────────────
  // Ye alphanumeric hai (N8FNNZAKE) is liye bilkul be-shuba hai — koi guard
  // ki zarurat nahi, price ya model number kabhi is shakal ka nahi hota.
  if (confirmationNumber) {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .ilike('confirmation_number', confirmationNumber)
      .maybeSingle()

    if (order) {
      await clearState()
      await sendWhatsAppText(from, await buildStatusReply(order))
      return NextResponse.json({ ok: true })
    }
    // Na mila to aage badhte hain — shayad order number bhi sath likha ho
  }

  // ── 3) Order number (sirf jab message order ke baare mein lage) ───────────
  if (orderNumber && orderish) {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('order_number', orderNumber)
      .maybeSingle()

    await clearState()
    await sendWhatsAppText(
      from,
      order
        ? await buildStatusReply(order)
        : 'Ye order number system mein nahi mil raha, please dobara check karke bhejein. Aap confirmation number (jaise #N8FNNZAKE) bhi bhej sakte hain.'
    )
    return NextResponse.json({ ok: true })
  }

  // ── 4) Phone number ───────────────────────────────────────────────────────
  if (phoneInText && orderish) {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('customer_phone', phoneInText)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    await clearState()
    await sendWhatsAppText(
      from,
      order ? await buildStatusReply(order) : 'Is number se koi order nahi mila, please order number bhejein.'
    )
    return NextResponse.json({ ok: true })
  }

  // ── 5) Courier tracking number ────────────────────────────────────────────
  if (trackingCandidate && orderish) {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('tracking_id', trackingCandidate)
      .maybeSingle()

    if (order) {
      await clearState()
      await sendWhatsAppText(from, await buildStatusReply(order))
      return NextResponse.json({ ok: true })
    }
    // Match nahi mila to chup chaap aage badh jate hain
  }

  // ── 6) Q&A — poora sawaal padh kar word-score matching ────────────────────
  const qnaAnswer = await matchQna(text)
  if (qnaAnswer) {
    if (state) await clearState()
    await sendWhatsAppText(from, qnaAnswer)
    return NextResponse.json({ ok: true })
  }

  // ── 7) Sirf salaam ────────────────────────────────────────────────────────
  if (isGreetingOnly(text)) {
    if (state) await clearState()
    await sendWhatsAppText(from, WELCOME_MESSAGE)
    return NextResponse.json({ ok: true })
  }

  // ── 8) Order se related lag raha hai lekin number nahi diya ───────────────
  if (orderish) {
    await supabaseAdmin
      .from('wa_conversation_state')
      .upsert({ phone: from, state: 'awaiting_order_info', updated_at: new Date().toISOString() })
    await sendWhatsAppText(
      from,
      'Please apna *order number*, *confirmation number* (jaise #N8FNNZAKE) ya jis mobile number se order kiya tha wo bhej dein — main abhi check karta hun.'
    )
    return NextResponse.json({ ok: true })
  }

  // ── 9) Kuch bhi match nahi hua ────────────────────────────────────────────
  // Pehle bot yahan BILKUL chup reh jata tha. Ab polite fallback bhejta hai,
  // aur message ko log karta hai taake wo Excel export mein aa jaye.
  if (state) await clearState()
  await supabaseAdmin.from('unmatched_messages').insert({ phone: from, message_text: text })
  await sendWhatsAppText(from, FALLBACK_MESSAGE)

  return NextResponse.json({ ok: true })
}

/**
 * Manual review ke liye order dhoondta hai — sirf context ke liye, taake
 * queue mein order number bhi dikh jaye. Kuch na mile to null.
 */
async function findOrderForContext(opts: {
  confirmationNumber: string | null
  orderNumber: string | null
  phoneInText: string | null
  senderPhone: string
}): Promise<{ order_number: string } | null> {
  const { confirmationNumber, orderNumber, phoneInText, senderPhone } = opts

  if (confirmationNumber) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('order_number')
      .ilike('confirmation_number', confirmationNumber)
      .maybeSingle()
    if (data) return data
  }

  if (orderNumber) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('order_number')
      .eq('order_number', orderNumber)
      .maybeSingle()
    if (data) return data
  }

  for (const phone of [phoneInText, senderPhone]) {
    if (!phone) continue
    const { data } = await supabaseAdmin
      .from('orders')
      .select('order_number')
      .eq('customer_phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data
  }

  return null
}
