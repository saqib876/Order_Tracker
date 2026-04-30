import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPostExTrackingUrl } from '@/lib/postex'
import { normalizePhone } from '@/lib/shopify'
 
export const dynamic = 'force-dynamic'
 
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { orderNumber, phone } = body
 
  if (!orderNumber && !phone) {
    return NextResponse.json(
      { error: 'Please provide order number or phone number.' },
      { status: 400 }
    )
  }
 
  let order: any = null
  let error: any = null
 
  if (orderNumber) {
    const result = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('order_number', String(orderNumber).replace('#', ''))
      .single()
    order = result.data
    error = result.error
  } else {
    const result = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('customer_phone', normalizePhone(phone))
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    order = result.data
    error = result.error
  }
 
  if (error || !order) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  }
 
  const { data: history } = await supabaseAdmin
    .from('order_status_history')
    .select('status, note, changed_at')
    .eq('order_id', order.id)
    .order('changed_at', { ascending: true })
 
  // Find the timestamp when order was first marked as shipped
  // This is used for the delivery countdown window
  const shippedEntry = history?.find((h: any) => h.status === 'shipped')
 
  const postexUrl = order.tracking_id
    ? getPostExTrackingUrl(order.tracking_id)
    : null
 
  return NextResponse.json({
    order: {
      orderNumber: order.order_number,
      customerName: order.customer_name,
      status: order.status,
      trackingId: order.tracking_id,
      postexUrl,
      lineItems: order.line_items,
      createdAt: order.shopify_created_at || order.created_at,
      updatedAt: order.updated_at,
      // shippedAt: when the order transitioned to 'shipped' — used for 3-day delivery countdown
      shippedAt: shippedEntry?.changed_at ?? null,
    },
    history: history || [],
  })
}
