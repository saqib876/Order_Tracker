import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsAppText, matchQna } from '@/lib/whatsapp'

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

// Customer ke message ko clean karta hai (punctuation hata ke) taake matching
// zyada reliable ho - "order?" aur "order" dono ek jaisa treat ho
function cleanText(t: string): string {
  return t.toLowerCase().replace(/[?!.,;:'"()]/g, '').replace(/\s+/g, ' ').trim()
}

// Customer apne order ko "order", "parcel", "cover", "case" - kisi bhi naam se
// bula sakta hai (khaas kar jab specific product ka zikar kare, jaise "mera
// cover kab milega"). Templates aur nouns ka combination banate hain taake
// har noun ke sath automatically saare relevant phrases match ho jayein.
// Har template tumhare diye asal sawaalon (English + Roman Urdu) se liya gaya hai.
const ORDER_NOUNS = ['order', 'orders', 'parcel', 'parcels', 'cover', 'covers', 'case', 'cases']

const NOUN_TEMPLATES = [
  // English (tumhare diye sawaalon se)
  'when will i receive my {n}', 'when will my {n} arrive',
  'expected delivery date for my {n}', 'how long will it take for my {n}',
  'where is my {n} right now', 'update on my {n} status',
  'has my {n} been shipped', 'tracking status of my {n}',
  'is my {n} out for delivery', 'why is my {n} delayed',
  "why hasn't my {n} arrived", 'delay in my {n} delivery',
  'track my {n}', 'where is my {n}', 'when will my {n}',
  // Roman Urdu (tumhare diye sawaalon se)
  'mera {n} kab tak milega', 'mera {n} kab aayega', '{n} kab tak deliver hoga',
  '{n} aane mein kitna time', 'mera {n} kahan tak pohncha',
  'mera {n} dispatch hua', 'mera {n} tracking update', 'mera {n} kab ship hoga',
  'tracking id mil sakti hai {n}', '{n} abhi tak nahi mila', 'kab milega mera {n}',
  'mera {n} kab tak punchay', '{n} kab tak', '{n} kahan', '{n} status', '{n} delayed',
]

const NOUN_BASED_KEYWORDS = NOUN_TEMPLATES.flatMap((tpl) =>
  ORDER_NOUNS.map((n) => tpl.replace('{n}', n))
)

// Urdu script mein log aam tor par sirf "آرڈر" (order) aur "پارسل" (parcel)
// hi likhte hain (cover/case Roman letters mein likhte hain, Urdu script mein nahi)
const URDU_NOUNS = ['آرڈر', 'پارسل']
const URDU_TEMPLATES = [
  'میرا {u} کب تک ملے گا', 'میرا {u} کب تک پہنچے گا', '{u} کب ڈلیور ہوگا',
  'میرے {u} کی موجودہ لوکیشن', 'میرا {u} ڈسپیچ', 'میرے {u} کی ٹریکنگ آئی ڈی',
  'میرا {u} کہاں تک پہنچا', 'میرا {u} ابھی تک کیوں نہیں ملا', 'میرا {u} ملنے میں کتنے دن',
]
const URDU_NOUN_KEYWORDS = URDU_TEMPLATES.flatMap((tpl) =>
  URDU_NOUNS.map((u) => tpl.replace('{u}', u))
)

const ORDER_KEYWORDS = [
  ...NOUN_BASED_KEYWORDS,
  ...URDU_NOUN_KEYWORDS,
  // Noun-agnostic (koi bhi cheez ho, ye phrases apne aap match ho jate hain)
  'track', 'mila', 'mla', 'status', 'tracking', 'kb mlyga', 'kab milega',
  // English - delivery timing (noun-agnostic)
  'when can i expect my delivery', 'expected delivery date',
  'how long will it take', 'delivery date',
  // English - status/location (noun-agnostic)
  'been shipped', 'tracking status', 'out for delivery',
  // English - delay (noun-agnostic)
  "hasn't arrived", 'has not arrived', 'any delay',
  // Roman Urdu - delivery timing (noun-agnostic)
  'kab tak milega', 'kab deliver', 'delivery kab tak milegi', 'kitna time',
  'kab tak aayega', 'kab tak punchay', 'kab tak pohnchega', 'kitne din lagenge',
  // Roman Urdu - status/location (noun-agnostic)
  'dispatch hua', 'tracking update', 'kab ship', 'tracking id mil',
  // Roman Urdu - delay (noun-agnostic)
  'abhi tak nahi mila',
  // Urdu script - noun-agnostic
  'ڈلیوری میں کتنا وقت', 'ڈلیوری میں کوئی تاخیر', 'تاخیر', 'مزید لگیں گے',
]

function looksLikeOrderQuery(text: string) {
  const t = cleanText(text)
  return ORDER_KEYWORDS.some((k) => t.includes(cleanText(k)))
}

function extractOrderNumber(text: string) {
  // Standalone 3-6 digit number only - won't match a chunk embedded inside a longer phone number
  const m = text.match(/(?<!\d)#?(\d{3,6})(?!\d)/)
  return m ? m[1] : null
}

// Customer number kisi bhi format mein bhej sakta hai:
// +92 307 4942009, 0307-494-2009, (0092) 307.4942009, 92/307/4942009 waghera.
// Ye function har format se digits nikaal ke standard "92XXXXXXXXXX" banata hai.
function normalizeExtractedPhone(digits: string): string | null {
  if (digits.length === 14 && digits.startsWith('0092')) return '92' + digits.slice(4)
  if (digits.length === 11 && digits.startsWith('0')) return '92' + digits.slice(1)
  if (digits.length === 12 && digits.startsWith('92')) return digits
  return null
}

function extractPhone(text: string): string | null {
  // Phone-jaisa dikhne wala koi bhi block dhoondo: digits + spaces/dashes/dots/
  // slashes/commas/parentheses/plus - phir usme se digits nikaal ke length/prefix check karo
  const candidates = text.match(/[+()0-9][+()0-9.,\-/\s]{7,}[0-9)]/g)
  if (!candidates) return null
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '')
    const normalized = normalizeExtractedPhone(digits)
    if (normalized) return normalized
  }
  return null
}

function isNumericOnlyMessage(text: string) {
  // Customer sirf apna number/order-number hi bhej de, kisi bhi separator format mein
  return /^[+()0-9][+()0-9.,\-/\s]{1,20}[0-9)]$/.test(text.trim())
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

  const orderNumber = extractOrderNumber(text)
  const phoneInText = extractPhone(text)

  // 1) Order number ya phone number mila - seedha unambiguous lookup, sabse pehli priority
  if (orderNumber) {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('order_number', orderNumber)
      .maybeSingle()

    await supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)
    await sendWhatsAppText(
      from,
      order ? await buildStatusReply(order) : 'Ye order number system mein nahi mil raha, please dobara check karke bhejein.'
    )
    return NextResponse.json({ ok: true })
  }

  if (phoneInText) {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('customer_phone', phoneInText)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    await supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)
    await sendWhatsAppText(
      from,
      order ? await buildStatusReply(order) : 'Is number se koi order nahi mila, please order number bhejein.'
    )
    return NextResponse.json({ ok: true })
  }

  // 2) Koi number nahi mila - Q&A pehle check karo. Isse "order kaise karun" jaisi
  //    cheezein apna specific Q&A jawab paati hain, generic "order" keyword se
  //    order-lookup flow hijack nahi hota.
  const qnaAnswer = await matchQna(text)
  if (qnaAnswer) {
    if (state) await supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)
    await sendWhatsAppText(from, qnaAnswer)
    return NextResponse.json({ ok: true })
  }

  // 3) Q&A mein match nahi mila - agar order/tracking se related lag raha hai to number maango
  if (looksLikeOrderQuery(text) || isNumericOnlyMessage(text)) {
    await supabaseAdmin
      .from('wa_conversation_state')
      .upsert({ phone: from, state: 'awaiting_order_info', updated_at: new Date().toISOString() })
    await sendWhatsAppText(
      from,
      'Please Apna Order Number Ya Jis Mobile/ Phone Number Se Order Kiya Tha Wo Bhej Dein,Main Abhi Check Karta Hun.'
    )
    return NextResponse.json({ ok: true })
  }

  // 4) Kuch bhi match nahi hua - khud se reply NAHI karta, sirf log kar deta hai
  // taake tum manually reply kar sako (WhatsApp Manager mein ye already unread dikhega
  // kyunke koi reply nahi gaya).
  if (state) await supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)
  await supabaseAdmin.from('unmatched_messages').insert({ phone: from, message_text: text })

  return NextResponse.json({ ok: true })
}
