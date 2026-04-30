import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyShopifyWebhook, normalizePhone } from '@/lib/shopify'
import { SHOPIFY_TAG_TO_STATUS } from '@/types'
import type { ShopifyWebhookOrder, OrderStatus } from '@/types'

// Next.js needs the raw body for HMAC verification — disable body parsing
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── 1. Read raw body for HMAC check ────────────────────────
  const rawBody = await req.text()
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || ''
  const topic = req.headers.get('x-shopify-topic') || ''

  // ── 2. Verify the request is from Shopify ──────────────────
  const isValid = await verifyShopifyWebhook(rawBody, hmacHeader)
  if (!isValid) {
    console.warn('[webhook] Invalid HMAC — rejected')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 3. Parse the payload ───────────────────────────────────
  let payload: ShopifyWebhookOrder
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log(`[webhook] Received: ${topic} — Order ${payload.name}`)

  // ── 4. Map Shopify tags to our status ──────────────────────
  const tags = payload.tags
    .split(',')
    .map((t) => t.trim().toLowerCase())

  let detectedStatus: OrderStatus = 'in_process'
  for (const tag of tags) {
    if (SHOPIFY_TAG_TO_STATUS[tag]) {
      detectedStatus = SHOPIFY_TAG_TO_STATUS[tag]
      break
    }
  }

  // ── 5. Extract PostEx tracking ID ─────────────────────────
  // We look in: fulfillments[0].tracking_number OR note_attributes with name "tracking_id"
  let trackingId: string | null =
    payload.fulfillments?.[0]?.tracking_number || null

  const trackingAttr = payload.note_attributes?.find(
    (a) => a.name.toLowerCase() === 'tracking_id' || a.name.toLowerCase() === 'postex_tracking'
  )
  if (trackingAttr?.value) trackingId = trackingAttr.value

  if (trackingId) detectedStatus = 'shipped'

  // ── 6. Build line items snapshot ──────────────────────────
  const lineItems = payload.line_items.map((li) => ({
    name: li.name,
    quantity: li.quantity,
    variant_title: li.variant_title,
  }))

  // ── 7. Upsert order into Supabase ─────────────────────────
  const orderData = {
    shopify_order_id: String(payload.id),
    order_number: String(payload.order_number),
    customer_email: payload.customer?.email || payload.email || null,
    customer_phone: (() => {
      const raw =
        payload.customer?.phone ||
        payload.billing_address?.phone ||
        payload.shipping_address?.phone ||
        payload.phone ||
        null
      return raw ? normalizePhone(raw) : null
    })(),
    customer_name: payload.customer
      ? `${payload.customer.first_name} ${payload.customer.last_name}`.trim()
      : null,
    status: detectedStatus,
    tracking_id: trackingId,
    line_items: lineItems,
    shopify_created_at: payload.created_at,
  }

  const { data: existingOrder, error: fetchError } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('shopify_order_id', String(payload.id))
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('[webhook] DB fetch error:', fetchError)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const { data: upserted, error: upsertError } = await supabaseAdmin
    .from('orders')
    .upsert(orderData, { onConflict: 'shopify_order_id' })
    .select()
    .single()

  if (upsertError) {
    console.error('[webhook] DB upsert error:', upsertError)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // ── 8. Log status change to history ───────────────────────
  const statusChanged = !existingOrder || existingOrder.status !== detectedStatus
  if (statusChanged && upserted) {
    await supabaseAdmin.from('order_status_history').insert({
      order_id: upserted.id,
      status: detectedStatus,
      note: `Webhook: ${topic}`,
    })
  }

  console.log(`[webhook] Order ${payload.name} upserted — status: ${detectedStatus}`)
  return NextResponse.json({ ok: true })
}
