import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizePhone } from '@/lib/shopify'
import { sendWhatsAppText, matchQna } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const DELIVERY_WINDOW_DAYS = 3
const trackingUrl = (id: string) => `https://postex.pk/tracking?cn=${id}`

const STATUS_MESSAGES: Record<string, string> = {
  in_process: 'Aap ka order abhi taiyar ho raha hai (Step 1/6 - In Process).',
  printing_done: 'Aap ke design ki printing mukammal ho chuki hai (Step 2/6 - Printing Done).',
  packed: 'Aap ka order pack ho chuka hai (Step 3/6 - Packed).',
  ready_to_ship: 'Aap ka order dispatch ke liye taiyar hai (Step 4/6 - Ready to Ship).',
  shipped: 'Aap ka order dispatch ho chuka hai aur raaste mein hai (Step 5/6 - Shipped).',
  delivered: 'Aap ka order deliver ho chuka hai (Step 6/6 - Delivered).',
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

async function buildStatusReply(order: any): Promise<string> {
  const status = (order.status || '').toLowerCase()
  const friendly = STATUS_MESSAGES[status] || `Order ka status: ${order.status}`
  const lines = [`Order #${order.order_number}: ${friendly}`]

  if (order.tracking_id) {
    lines.push(`Tracking link: ${trackingUrl(order.tracking_id)}`)
  }

  if (status === 'shipped') {
    const { data: h } = await supabaseAdmin
      .from('order_status_history')
      .select('changed_at')
      .eq('order_id', order.id)
      .eq('status', 'shipped')
      .order('changed_at', { ascending: true })
      .limit(1)
      .single()

    if (h?.changed_at) {
      const daysElapsed = Math.floor((Date.now() - new Date(h.changed_at).getTime()) / 86400000)
      const remaining = Math.max(0, DELIVERY_WINDOW_DAYS - daysElapsed)
      lines.push(
        remaining > 0
          ? `Estimated delivery: ~${remaining} din mein.`
          : `Delivery window cross ho chuki hai, agar abhi tak nahi mila to hum turant check karte hain.`
      )
    }
  } else if (status === 'in_process') {
    lines.push('Dispatch hote hi tracking number bhej diya jayega.')
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
