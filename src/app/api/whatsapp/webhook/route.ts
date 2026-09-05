import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsAppText, matchQna } from '@/lib/whatsapp'
import { normalizeForMatch } from '@/lib/textNormalize'
import { detectManualReason, MANUAL_REASON_REPLY, MANUAL_REASON_LABEL } from '@/lib/intents'

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

// Customer ke message ko clean karta hai (punctuation hata ke) taake matching
// zyada reliable ho - "order?" aur "order" dono ek jaisa treat ho
// (Roman Urdu spelling, typos, English grammar normalization - sab
// src/lib/textNormalize.ts mein hai, taake Q&A matching bhi wahi use kar sake)

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
  'mera {n} kab tak punchay', '{n} kab tak', '{n} kahan', '{n} status', '{n} delayed', '{n} kab',
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
  'milega', 'aayega', 'lagega', 'pohoncha', // normalize hone ke baad canonical safety-net
  // Roman Urdu - status/location (noun-agnostic)
  'dispatch hua', 'tracking update', 'kab ship', 'tracking id mil',
  // Roman Urdu - delay (noun-agnostic)
  'abhi tak nahi mila',
  // Urdu script - noun-agnostic
  'ڈلیوری میں کتنا وقت', 'ڈلیوری میں کوئی تاخیر', 'تاخیر', 'مزید لگیں گے',
]

// Har template ko ek dafa normalize kar lete hain (module load par) - taake
// runtime par har message ke liye baar baar normalize na karna pade
const ORDER_KEYWORDS_NORMALIZED = ORDER_KEYWORDS.map((k) => normalizeForMatch(k)).filter(Boolean)

function looksLikeOrderQuery(text: string) {
  const t = normalizeForMatch(text)
  return ORDER_KEYWORDS_NORMALIZED.some((k) => t.includes(k))
}

function extractOrderNumber(text: string) {
  // Standalone 3-6 digit number only - won't match a chunk embedded inside a longer phone number
  const m = text.match(/(?<!\d)#?(\d{3,6})(?!\d)/)
  return m ? m[1] : null
}

// ── Shopify confirmation number ────────────────────────────────────────────
// Order place karte waqt customer ko yehi milta hai (order number nahi):
//   "Confirmation #N8FNNZAKE was generated for this order."
// Hamesha 9 characters, sirf A-Z aur 0-9. 8 din mein 45 log ye bhej chuke
// hain aur bot inhe bilkul nahi pehchanta tha.
//
// Kam se kam ek digit lazmi rakhi hai, warna "SEPTEMBER" jaise 9 harf wale
// aam lafz bhi confirmation number samjhe jane lagte.
function extractConfirmationNumber(text: string): string | null {
  const candidates = text.match(/#?\b[A-Za-z0-9]{9}\b/g)
  if (!candidates) return null

  for (const raw of candidates) {
    const code = raw.replace('#', '').toUpperCase()
    if (code.length !== 9) continue
    if (!/[0-9]/.test(code)) continue // digit ke bina nahi
    if (!/[A-Z]/.test(code)) continue // sirf digits ho to wo order/tracking number hai
    return code
  }
  return null
}

// Message mein saaf saaf order number ka zikr hai?
// (isse "1400 ka hai?" jaise price wale sawaal order-lookup mein nahi jate)
function mentionsOrderNumber(text: string): boolean {
  return (
    /\border\s*(no|number|num|#)/i.test(text) ||
    /\bconfirmation\b/i.test(text) ||
    /#\s*\d{3,6}\b/.test(text)
  )
}

// ── Sirf salaam / hello — koi asal sawaal nahi ─────────────────────────────
// Log salaam ki dozens spellings likhte hain (Assalamualaikum, Aslam o alikum,
// Asssalam o alaikum, AsslamuAlaikum, A.o.a ...). Har spelling list karne ke
// bajaye pehle dohre harf squeeze karte hain ("asssalaam" -> "asalam") aur
// phir chand prefixes se milate hain.
function squeezeRepeats(w: string): string {
  return w.replace(/(.)\1+/g, '$1')
}

// Ye prefixes khud bhi squeezed shakal mein hain
const GREETING_PREFIXES = [
  'salam', 'asalam', 'aslam', 'asalm', 'aslm', 'aoa',
  'helo', 'halo', 'hi', 'hy', 'hey', 'hlo', 'hlw',
  'walikum', 'walaikum', 'alikum', 'alaikum',
]

// Ye lafz akele salaam nahi bante, lekin salaam ke sath aa sakte hain
const GREETING_FILLER = new Set([
  'bhai', 'bhaii', 'sir', 'ji', 'g', 'o', 'u', 'wa', 'myzan', 'team', 'a',
])

function isGreetingWord(word: string): boolean {
  const w = squeezeRepeats(word)
  return GREETING_PREFIXES.some((p) => w.startsWith(p))
}

function isGreetingOnly(text: string): boolean {
  const t = normalizeForMatch(text)
  if (!t || t.length > 40) return false

  const words = t.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 5) return false

  // Kam se kam ek asal greeting lazmi hai, baqi sab filler ho sakte hain.
  let greetings = 0
  for (const w of words) {
    if (isGreetingWord(w)) {
      greetings++
    } else if (!GREETING_FILLER.has(w)) {
      return false
    }
  }
  return greetings > 0
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

// Agar customer order/phone ki jagah PostEx/Call Courier ka tracking number
// paste kar de (jo unhe courier SMS se mila ho) - wo 10-15 digit ka number
// hota hai jo phone-pattern se match nahi karta. Ise bhi ek fallback lookup
// ke tor pe try karte hain.
function extractTrackingCandidate(text: string): string | null {
  const candidates = text.match(/[0-9][0-9.,\-/\s]{8,}[0-9]/g)
  if (!candidates) return null
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length <= 15 && !normalizeExtractedPhone(digits)) {
      return digits
    }
  }
  return null
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
