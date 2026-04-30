 // ── Order status values ──────────────────────────────────────
export type OrderStatus =
  | 'in_process'
  | 'printing_done'
  | 'packed'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivered'

// ── Human-readable labels + colours + UI step ────────────────
export const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; step: number }
> = {
  in_process: {
    label: 'In Process',
    color: '#6366f1',
    step: 1,
  },
  printing_done: {
    label: 'Printing Done',
    color: '#8b5cf6',
    step: 2,
  },
  packed: {
    label: 'Packed',
    color: '#f59e0b',
    step: 3,
  },
  ready_to_ship: {
    label: 'Ready to Ship',
    color: '#3b82f6',
    step: 4,
  },
  shipped: {
    label: 'Shipped',
    color: '#10b981',
    step: 5,
  },
  delivered: {
    label: 'Delivered',
    color: '#22c55e',
    step: 6,
  },
}

// ── Shopify tag → internal status mapping (ROBUST) ───────────
export const SHOPIFY_TAG_TO_STATUS: Record<string, OrderStatus> = {
  'in process': 'in_process',
  'in_process': 'in_process',

  'printing done': 'printing_done',
  'printing_done': 'printing_done',
  'printing-done': 'printing_done',

  'packed': 'packed',

  'ready to ship': 'ready_to_ship',
  'ready_to_ship': 'ready_to_ship',
  'ready-to-ship': 'ready_to_ship',

  'shipped': 'shipped',
  'delivered': 'delivered',
}

// ── Database row types ───────────────────────────────────────
export interface Order {
  id: string
  shopify_order_id: string
  order_number: string // FIXED (was number before)

  customer_email: string | null
  customer_phone: string | null
  customer_phone_raw?: string | null

  customer_name: string | null

  status: OrderStatus
  tracking_id: string | null

  line_items: LineItem[]

  shopify_created_at: string | null

  last_status_at?: string | null

  created_at: string
  updated_at: string
}

export interface LineItem {
  name: string
  quantity: number
  variant_title?: string | null
}

// ── Status history (timeline system) ─────────────────────────
export interface OrderStatusHistory {
  id: string
  order_id: string
  status: OrderStatus
  note: string | null
  changed_at: string
}

// ── Shopify webhook payload ──────────────────────────────────
export interface ShopifyWebhookOrder {
  id: number
  order_number: number
  name: string

  email: string
  phone: string | null

  tags: string
  note: string | null

  note_attributes: { name: string; value: string }[]

  line_items: {
    name: string
    quantity: number
    variant_title: string | null
  }[]

  customer: {
    first_name: string
    last_name: string
    email: string
    phone: string | null
  } | null

  shipping_address?: {
    phone: string | null
  } | null

  billing_address?: {
    phone: string | null
  } | null

  fulfillments: {
    tracking_number: string | null
    tracking_numbers: string[]
    status: string
  }[]

  created_at: string
  updated_at: string
}

// ── PostEx API response ───────────────────────────────────────
export interface PostExTrackingResponse {
  statusCode: number
  statusMessage: string
  dist: {
    trackingNumber: string
    orderStatus: string
    orderStatusCode: string
    lastActivity: string
    trackingHistory?: {
      date: string
      time: string
      location: string
      description: string
    }[]
  } | null
}

// ── Helper (safe label getter) ───────────────────────────────
export const getStatusLabel = (status: OrderStatus) =>
  STATUS_CONFIG[status]?.label || status