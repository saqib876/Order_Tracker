import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizePhone } from '@/lib/shopify'
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

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function progressBar(step: number, total = 4): string {
  return '🟩'.repeat(step) + '⬜'.repeat(total - step)
}

// N working days (Mon-Sat, Sunday off) aage badhata hai kisi date se
function addWorkingDays(start: Date, days: number): Date {
  const result = new Date(start)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    if (result.getDay() !== 0) added++ // 0 = Sunday
  }
  return result
}

// Do dates ke beech kitne working days (Mon-Sat) hain
function workingDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0
  let count = 0
  const cur = new Date(from)
  while (cur < to) {
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
    `Status: ${label} (Step ${step}/4)`,
    progressBar(step),
    '',
  ]

  const hasTracking = Boolean(order.tracking_id)

  if (!hasTracking) {
    // Tracking add hone se PEHLE - fixed 10-15 working-day window, order date se calculate
    const minDate = addWorkingDays(orderDate, MIN_WORKING_DAYS)
    const maxDate = addWorkingDays(orderDate, MAX_WORKING_DAYS)
    const today = new Date()
    const remainingMin = workingDaysBetween(today, minDate)
    const remainingMax = workingDaysBetween(today, maxDate)

    lines.push(`📅 Total Delivery Time: ${MIN_WORKING_DAYS} to ${MAX_WORKING_DAYS} Working Days (Monday to Saturday)`)
    lines.push(`📅 Expected Delivery Date: ${formatDate(minDate)} to ${formatDate(maxDate)}`)
    lines.push(`⏳ Remaining: ${remainingMin} to ${remainingMax} working days`)
    lines.push('')
    lines.push(`🔗 Live tracking dekhein: ${WEBSITE_TRACKING_LINK}`)
  } else {
    // Tracking add ho chuki hai - live courier status se date adjust karte hain
    lines.push(`🚚 Tracking Number: ${order.tracking_id}`)
    lines.push(`🔗 Track here: ${trackingUrl(order.tracking_id)}`)

    const latest = await fetchLatestCourierRaw(order.tracking_id)
    const stage = latest ? classifyCourierStage(latest.label) : null

    if (latest) {
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
        expectedDate = addWorkingDays(new Date(), daysForCourierStage(stage))
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
        expectedDate = h?.changed_at ? addWorkingDays(new Date(h.changed_at), 3) : addWorkingDays(new Date(), 3)
      }

      const remaining = workingDaysBetween(new Date(), expectedDate)
      lines.push('')
      lines.push(`📅 Expected Delivery Date: ${remaining === 0 ? 'Aaj (Today)' : formatDate(expectedDate)}`)
      if (remaining > 0) lines.push(`⏳ Remaining: ${remaining} working day(s)`)
    }
  }

  return lines.join('\n')
}

const ORDER_KEYWORDS = ['order', 'track', 'mila', 'mla', 'status', 'tracking', 'kb mlyga', 'kab milega', 'kahan']

function looksLikeOrderQuery(text: string) {
  const t = text.toLowerCase()
  return ORDER_KEYWORDS.some((k) => t.includes(k))
}

function extractOrderNumber(text: string) {
  // Standalone 3-6 digit number only - won't match a chunk embedded inside a longer phone number
  const m = text.match(/(?<!\d)#?(\d{3,6})(?!\d)/)
  return m ? m[1] : null
}

function isNumericOnlyMessage(text: string) {
  return /^[+]?[\d\s-]{4,15}$/.test(text.trim())
}

function extractPhone(text: string) {
  const m = text.match(/(\+?\d[\d\s-]{8,14}\d)/)
  return m ? m[1] : null
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
  const hasOrderIntent = looksLikeOrderQuery(text) || isNumericOnlyMessage(text)

  if (hasOrderIntent) {
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
      const normalized = normalizePhone(phoneInText)
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('*')
        .eq('customer_phone', normalized)
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

    // Order-intent hai lekin number/phone nahi mila - maango aur state save karo
    await supabaseAdmin
      .from('wa_conversation_state')
      .upsert({ phone: from, state: 'awaiting_order_info', updated_at: new Date().toISOString() })
    await sendWhatsAppText(
      from,
      'Please apna order number ya jis number se order kiya tha wo bhej dein, main abhi check karta hun.'
    )
    return NextResponse.json({ ok: true })
  }

  // Order-flow mein nahi hain (na keyword na number) - purani "waiting" state ho to hata do,
  // taake bot atka na rahe aur agle unrelated messages ko bhi order-query na samjhe
  if (state) {
    await supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)
  }

  // Pre-defined Q&A
  const answer = await matchQna(text)
  if (answer) {
    await sendWhatsAppText(from, answer)
    return NextResponse.json({ ok: true })
  }

  // Kuch bhi match nahi hua - khud se reply NAHI karta, sirf log kar deta hai
  // taake tum manually reply kar sako (WhatsApp Manager mein ye already unread dikhega
  // kyunke koi reply nahi gaya).
  await supabaseAdmin.from('unmatched_messages').insert({ phone: from, message_text: text })

  return NextResponse.json({ ok: true })
}
