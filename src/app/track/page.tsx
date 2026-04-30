'use client'

import { useState } from 'react'

// ─── Status config ────────────────────────────────────────────────────────────
// in_process = order confirmed, making/printing in progress
// shipped     = trackingId is set, parcel handed to PostEx
// delivered   = delivered
type OrderStatus = 'in_process' | 'shipped' | 'delivered'

const STATUS_LABEL: Record<OrderStatus, string> = {
  in_process: 'Making in Progress',
  shipped:    'Shipped',
  delivered:  'Delivered',
}

// ─── API shape ────────────────────────────────────────────────────────────────
interface TrackingResult {
  order: {
    orderNumber: string
    customerName: string | null
    status: OrderStatus
    trackingId: string | null
    postexUrl: string | null
    lineItems: { name: string; quantity: number }[]
    createdAt: string   // order confirmed / placed date
    updatedAt: string
    shippedAt: string | null  // when status became 'shipped' — for countdown
  }
  history: { status: OrderStatus; note: string | null; changed_at: string }[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysBetween(a: string, b: string) {
  const d1 = new Date(a); d1.setHours(0, 0, 0, 0)
  const d2 = new Date(b); d2.setHours(0, 0, 0, 0)
  return Math.floor((d2.getTime() - d1.getTime()) / 86400000)
}

function todayStr() {
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return t.toISOString().slice(0, 10)
}

function fmtShort(d: Date) {
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
}
function fmtFull(d: Date) {
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-PK', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Countdown logic (identical to v8, just uses new field names) ─────────────
// in_process: 10-day window from confirmedAt (createdAt)
// shipped:     3-day window from shippedAt — never goes negative
function calcCountdown(order: TrackingResult['order']) {
  const today = todayStr()

  if (order.status === 'in_process') {
    const confirmed = new Date(order.createdAt); confirmed.setHours(0, 0, 0, 0)
    const maxD = new Date(confirmed); maxD.setDate(confirmed.getDate() + 10)
    const minD = new Date(confirmed); minD.setDate(confirmed.getDate() + 7)
    const passed = daysBetween(order.createdAt, today)
    const daysLeft = Math.max(1, 10 - passed)           // never goes below 1
    const prog = Math.min(95, Math.round((passed / 10) * 100))
    return {
      daysLeft,
      prog,
      startFmt: fmtFull(confirmed),
      maxDate: fmtFull(maxD),
      estRange: `${fmtShort(minD)} – ${fmtFull(maxD)}`,
      shippedMode: false,
    }
  }

  if (order.status === 'shipped' && order.shippedAt) {
    const shipped = new Date(order.shippedAt); shipped.setHours(0, 0, 0, 0)
    const deadlineD = new Date(shipped); deadlineD.setDate(shipped.getDate() + 3)
    const passed = daysBetween(order.shippedAt, today)
    const daysLeft = Math.max(1, 3 - passed)            // never goes negative
    const prog = Math.min(95, Math.round((passed / 3) * 100))
    return {
      daysLeft,
      prog,
      startFmt: fmtFull(shipped),
      maxDate: fmtFull(deadlineD),
      estRange: '',
      shippedMode: true,
    }
  }

  return null
}

// ─── PostEx live fetch ────────────────────────────────────────────────────────
async function fetchPostEx(trackingId: string): Promise<{ ok: boolean; data?: any }> {
  try {
    const res = await fetch(`https://api.postex.pk/services/integration/api/order/v3/track-order?trackingNumber=${trackingId}`, {
      headers: { 'token': process.env.NEXT_PUBLIC_POSTEX_TOKEN || '' },
    })
    if (!res.ok) return { ok: false }
    const json = await res.json()
    // PostEx returns statusCode 200 and an array of tracking events
    if (json?.statusCode === 200 && json?.dist?.length) {
      const events = json.dist.map((ev: any, i: number) => ({
        label: ev.orderStatus || ev.status,
        time: ev.dateTime || ev.date || '',
        state: i === 0 ? 'active' : 'done',
      }))
      return { ok: true, data: { events } }
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}

// ─── Status timeline builder ──────────────────────────────────────────────────
// Uses the history array from the API so timestamps are real
function buildTimeline(order: TrackingResult['order'], history: TrackingResult['history']) {
  const isDelivered = order.status === 'delivered'
  const isShipped   = order.status === 'shipped'

  // Helper: find changed_at for a status from history
  const historyTime = (s: string) => {
    const entry = history.find(h => h.status === s)
    return entry ? fmtDateTime(entry.changed_at) : 'Completed'
  }

  if (isDelivered) {
    return [
      { dot: 'green', label: 'Delivered',            sub: historyTime('delivered'),                         tag: null },
      { dot: 'green', label: 'Shipped',               sub: `Tracking ID: ${order.trackingId}`,              tag: null },
      { dot: 'green', label: 'Making in Progress',    sub: 'Completed',                                     tag: null },
      { dot: 'green', label: 'Order Confirmed',       sub: fmtDate(order.createdAt),                        tag: null },
    ]
  }
  if (isShipped) {
    return [
      { dot: 'amber', label: 'Shipped',               sub: `Tracking ID: ${order.trackingId}`,              tag: 'current' },
      { dot: 'green', label: 'Making in Progress',    sub: 'Completed',                                     tag: null },
      { dot: 'green', label: 'Order Confirmed',       sub: fmtDate(order.createdAt),                        tag: null },
    ]
  }
  // in_process
  return [
    { dot: 'red',   label: 'Making in Progress',      sub: 'In progress',                                   tag: 'current' },
    { dot: 'green', label: 'Order Confirmed',          sub: fmtDate(order.createdAt),                        tag: null },
  ]
}

// ─── Styles (kept identical to v8) ───────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--red:#C41230;--card:#1a1a1a;--border:#2a2a2a;--bg:#f5f5f5;--text:#f0f0f0;--muted:#888}
.wrap{background:var(--bg);min-height:100vh;padding:24px 0 48px;font-family:'DM Sans',sans-serif}
.inner{max-width:480px;margin:0 auto;padding:0 20px}
.header{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.logo{background:var(--red);color:#fff;font-family:'Syne',sans-serif;font-weight:800;font-size:12px;letter-spacing:2px;padding:5px 11px;border-radius:6px}
.app-sub{font-size:11px;color:#999;letter-spacing:1.5px;text-transform:uppercase;font-weight:500}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tab{flex:1;padding:9px;font-size:13px;font-weight:600;cursor:pointer;border-radius:8px;color:#999;background:#e8e8e8;border:1px solid #ddd;font-family:'DM Sans',sans-serif;transition:all .2s}
.tab.active{background:#111;color:#fff;border-color:#111}
.search-row{display:flex;gap:8px;margin-bottom:20px}
.search-row input{flex:1;background:#fff;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;color:#111;font-family:'DM Sans',sans-serif;font-size:14px;outline:none;transition:border .2s}
.search-row input::placeholder{color:#bbb}
.search-row input:focus{border-color:#aaa}
.search-btn{background:#111;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:700;transition:background .2s;white-space:nowrap}
.search-btn:hover{background:#333}
.search-btn:disabled{background:#555;cursor:not-allowed}
.hero{background:#111;border:1px solid #222;border-radius:14px;padding:24px;margin-bottom:8px}
.hero-order{font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;font-family:'Syne',sans-serif;font-weight:600;margin-bottom:6px}
.hero-name{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#fff;margin-bottom:14px}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.badge{font-size:12px;font-weight:600;padding:5px 12px;border-radius:20px}
.badge-white{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2)}
.badge-date{background:rgba(255,255,255,.05);color:#888;border:1px solid rgba(255,255,255,.1)}
.badge-delivered{background:#052e16;color:#4ade80;border:1px solid #16a34a55}
.badge-shipped{background:#1a0f00;color:#f59e0b;border:1px solid #f59e0b44}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.info-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:15px}
.info-label{font-size:11px;color:var(--muted);letter-spacing:.5px;margin-bottom:5px;font-weight:500}
.info-value{font-size:15px;font-weight:700;color:var(--text);font-family:'Syne',sans-serif}
.info-value.sm{color:var(--muted);font-size:12px;font-weight:500;font-family:'DM Sans',sans-serif}
.note-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start}
.note-dot{width:8px;height:8px;background:var(--red);border-radius:50%;flex-shrink:0;margin-top:5px}
.note-title{font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;font-family:'Syne',sans-serif}
.note-text{font-size:12px;color:var(--muted);line-height:1.6}
.countdown-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:8px}
.cd-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.cd-label{font-size:11px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.cd-badge{font-size:13px;font-weight:700;color:#fff;background:#333;padding:4px 12px;border-radius:6px}
.cd-badge.amber{background:#1a0f00;color:#f59e0b;border:1px solid #f59e0b40}
.pbar{height:4px;background:#2a2a2a;border-radius:2px;margin-bottom:12px;overflow:hidden}
.pfill{height:100%;background:#fff;border-radius:2px}
.cd-dates{display:flex;justify-content:space-between}
.cd-dates span{font-size:12px;color:var(--muted)}
.cd-dates .right{color:#ddd;font-weight:600}
.postex-wrap{background:var(--card);border:1px solid var(--border);border-radius:14px;margin-bottom:8px;overflow:hidden}
.postex-head{padding:14px 18px;border-bottom:1px solid var(--border)}
.postex-head-label{font-size:11px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.tid-row{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
.tid-label{font-size:12px;color:var(--muted);margin-bottom:3px}
.tid-value{font-size:16px;font-weight:700;color:#fff;font-family:'Syne',sans-serif;letter-spacing:1px}
.postex-status-area{padding:16px 18px}
.ps-loading{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)}
.ps-dot{width:8px;height:8px;border-radius:50%;background:var(--red);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.ps-row{display:flex;align-items:flex-start;gap:14px;margin-bottom:12px}
.ps-row:last-child{margin-bottom:0}
.ps-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px}
.ps-icon.active{background:#C4123022;border:1px solid #C4123066}
.ps-icon.done{background:#C4123015;border:1px solid #C4123040}
.ps-icon.pending{background:#2a2a2a;border:1px solid var(--border)}
.ps-info{flex:1;padding-top:4px}
.ps-name{font-size:14px;font-weight:600;color:var(--text);margin-bottom:2px;font-family:'Syne',sans-serif;display:flex;align-items:center;gap:8px}
.ps-time{font-size:12px;color:var(--muted)}
.ps-current-tag{font-size:10px;color:var(--red);background:#C4123015;padding:2px 7px;border-radius:4px;border:1px solid #C4123040;font-weight:600}
.postex-link{display:block;padding:12px 18px;border-top:1px solid var(--border);font-size:13px;color:var(--muted);text-decoration:none;text-align:center;font-weight:500;transition:background .2s}
.postex-link:hover{background:#222;color:#fff}
.section-label{font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;margin:14px 0 8px;padding-left:2px;font-weight:600}
.tl-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:8px}
.tl-item{display:flex;gap:14px;position:relative;padding-bottom:18px}
.tl-item:last-child{padding-bottom:0}
.tl-line{position:absolute;left:6px;top:18px;bottom:0;width:1.5px;background:var(--border)}
.dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;margin-top:3px;position:relative;z-index:1}
.dot-red{background:var(--red)}
.dot-amber{background:#f59e0b}
.dot-green{background:#22c55e}
.tl-status-text{font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px;font-family:'Syne',sans-serif;display:flex;align-items:center;gap:8px}
.tl-time{font-size:12px;color:var(--muted)}
.tl-tag{font-size:10px;color:var(--red);background:#C4123015;padding:2px 7px;border-radius:4px;letter-spacing:.5px;border:1px solid #C4123040;font-weight:600}
.tl-tag-amber{font-size:10px;color:#f59e0b;background:#f59e0b15;padding:2px 7px;border-radius:4px;letter-spacing:.5px;border:1px solid #f59e0b40;font-weight:600}
.items-card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:8px}
.items-header{padding:12px 18px 10px;border-bottom:1px solid var(--border);font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;font-weight:600}
.item-row{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border)}
.item-row:last-child{border-bottom:none}
.item-name{font-size:14px;color:var(--text);font-weight:500}
.item-qty{font-size:12px;color:var(--muted);background:#2a2a2a;padding:3px 10px;border-radius:6px;font-weight:600;border:1px solid var(--border)}
.empty{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:32px;text-align:center;color:var(--muted);font-size:14px}
.empty span{display:block;font-size:12px;color:#555;margin-top:6px}
.error-box{background:#1a0505;border:1px solid #C4123040;border-radius:10px;padding:12px 16px;color:#f87171;font-size:13px;margin-bottom:16px}
`

// ─── PostEx events renderer ───────────────────────────────────────────────────
function PostExEvents({ events }: { events: any[] | null }) {
  const icons = ['🚚', '📦', '✅']
  if (!events) {
    return <div className="ps-loading"><div className="ps-dot" />Fetching live status…</div>
  }
  if (events.length === 0) {
    return <div style={{ fontSize: 13, color: '#888' }}>Status not available yet.</div>
  }
  return (
    <>
      {events.map((ev, i) => {
        const cls = ev.state === 'active' ? 'ps-icon active' : ev.state === 'done' ? 'ps-icon done' : 'ps-icon pending'
        return (
          <div key={i} className="ps-row">
            <div className={cls}>{icons[i] || '📍'}</div>
            <div className="ps-info">
              <div className="ps-name">
                {ev.label}
                {ev.state === 'active' && <span className="ps-current-tag">NOW</span>}
              </div>
              <div className="ps-time">{ev.time}</div>
            </div>
          </div>
        )
      })}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TrackPage() {
  const [tab, setTab] = useState<'order' | 'phone'>('order')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrackingResult | null>(null)
  // PostEx events: null = loading, [] = not found, array = events
  const [postexEvents, setPostexEvents] = useState<any[] | null | undefined>(undefined)

  async function handleTrack() {
    if (!query.trim()) { setError('Please enter your ' + (tab === 'order' ? 'order number.' : 'phone number.')); return }
    setLoading(true); setError(''); setResult(null); setPostexEvents(undefined)

    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tab === 'order' ? { orderNumber: query.trim() } : { phone: query.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Order not found.'); return }
      setResult(data)

      // Fetch PostEx live tracking if shipped or delivered
      if ((data.order.status === 'shipped' || data.order.status === 'delivered') && data.order.trackingId) {
        setPostexEvents(null) // null = loading spinner
        const px = await fetchPostEx(data.order.trackingId)
        setPostexEvents(px.ok ? px.data.events : [])
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function switchTab(t: 'order' | 'phone') {
    setTab(t); setQuery(''); setError(''); setResult(null); setPostexEvents(undefined)
  }

  // ── Render result ────────────────────────────────────────────────────────────
  function renderResult() {
    if (!result) return null
    const o = result.order
    const isDelivered = o.status === 'delivered'
    const isShipped   = o.status === 'shipped'
    const isInProcess = o.status === 'in_process'

    const label = STATUS_LABEL[o.status] ?? o.status
    const cd = calcCountdown(o)

    const heroBadgeClass = isDelivered ? 'badge badge-delivered' : isShipped ? 'badge badge-shipped' : 'badge badge-white'

    // Info grid: Confirmed + Est. Delivery / Delivered on
    const estCard = isDelivered
      ? <div className="info-card"><div className="info-label">Delivered on</div><div className="info-value" style={{ color: '#22c55e' }}>{fmtDate(o.updatedAt)}</div></div>
      : <div className="info-card"><div className="info-label">Est. Delivery</div><div className="info-value sm">{cd ? cd.estRange || `By ${cd.maxDate}` : '—'}</div></div>

    // Note card for in_process
    const noteBlock = isInProcess && (
      <div className="note-card">
        <div className="note-dot" />
        <div>
          <div className="note-title">Crafting your order</div>
          <div className="note-text">We're carefully making your custom order. We'll notify you once it ships.</div>
        </div>
      </div>
    )

    // Countdown / Delivery window
    const countdownBlock = cd && !isDelivered && (
      <div className="countdown-card">
        <div className="cd-top">
          <span className="cd-label">{isShipped ? 'Delivery Window' : 'Delivery Countdown'}</span>
          <span className={`cd-badge${isShipped ? ' amber' : ''}`}>
            {isShipped
              ? (cd.daysLeft === 1 ? 'Arriving soon' : `${cd.daysLeft} days to deliver`)
              : `${cd.daysLeft} day${cd.daysLeft === 1 ? '' : 's'} left`}
          </span>
        </div>
        <div className="pbar"><div className="pfill" style={{ width: `${cd.prog}%` }} /></div>
        <div className="cd-dates">
          <span>{isShipped ? `Shipped ${cd.startFmt}` : `Confirmed ${cd.startFmt}`}</span>
          <span className="right">By {cd.maxDate}</span>
        </div>
      </div>
    )

    // PostEx block (shown when shipped or delivered and trackingId exists)
    const postexBlock = (isShipped || isDelivered) && o.trackingId && (
      <div className="postex-wrap">
        <div className="postex-head"><span className="postex-head-label">PostEx Live Tracking</span></div>
        <div className="tid-row">
          <div>
            <div className="tid-label">Tracking ID</div>
            <div className="tid-value">{o.trackingId}</div>
          </div>
        </div>
        <div className="postex-status-area">
          <PostExEvents events={postexEvents === undefined ? null : postexEvents} />
        </div>
        <a className="postex-link" href={o.postexUrl || `https://postex.pk/tracking/${o.trackingId}`} target="_blank" rel="noopener noreferrer">
          Open on PostEx website →
        </a>
      </div>
    )

    // Status history timeline
    const timeline = buildTimeline(o, result.history)
    const tlItems = timeline.map((item, i) => (
      <div key={i} className="tl-item" style={i === timeline.length - 1 ? { paddingBottom: 0 } : {}}>
        {i < timeline.length - 1 && <div className="tl-line" />}
        <div className={`dot dot-${item.dot}`} />
        <div>
          <div className="tl-status-text">
            {item.label}
            {item.tag === 'current' && <span className="tl-tag">current</span>}
            {item.tag === 'current' && isShipped && <span className="tl-tag-amber">current</span>}
          </div>
          <div className="tl-time">{item.sub}</div>
        </div>
      </div>
    ))

    // Items
    const itemsHTML = (o.lineItems || []).map((item, i) => (
      <div key={i} className="item-row">
        <span className="item-name">{item.name}</span>
        <span className="item-qty">x{item.quantity}</span>
      </div>
    ))

    return (
      <>
        {/* Hero */}
        <div className="hero">
          <div className="hero-order">Order #{o.orderNumber}</div>
          <div className="hero-name">{o.customerName || 'Your Order'}</div>
          <div className="badges">
            <span className={heroBadgeClass}>{label}</span>
            <span className="badge badge-date">{fmtDate(o.createdAt)}</span>
          </div>
        </div>

        {/* Info grid */}
        <div className="info-grid">
          <div className="info-card">
            <div className="info-label">Confirmed</div>
            <div className="info-value">{fmtDate(o.createdAt)}</div>
          </div>
          {estCard}
        </div>

        {noteBlock}
        {countdownBlock}
        {postexBlock}

        {/* Timeline */}
        <div className="section-label">Status History</div>
        <div className="tl-card">{tlItems}</div>

        {/* Items */}
        {itemsHTML.length > 0 && (
          <>
            <div className="section-label">Items</div>
            <div className="items-card">
              <div className="items-header">Products</div>
              {itemsHTML}
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <>
      <style>{css}</style>
      <div className="wrap">
        <div className="inner">
          {/* Header */}
          <div className="header">
            <div className="logo">Kovrrr</div>
            <span className="app-sub">Order Tracker</span>
          </div>

          {/* Tabs */}
          <div className="tabs">
            <button className={`tab${tab === 'order' ? ' active' : ''}`} onClick={() => switchTab('order')}>Order Number</button>
            <button className={`tab${tab === 'phone' ? ' active' : ''}`} onClick={() => switchTab('phone')}>Phone Number</button>
          </div>

          {/* Search */}
          <div className="search-row">
            <input
              type={tab === 'phone' ? 'tel' : 'text'}
              placeholder={tab === 'order' ? 'Enter order number e.g. 2087' : 'Enter phone e.g. 03001234567'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleTrack()}
            />
            <button className="search-btn" onClick={handleTrack} disabled={loading}>
              {loading ? 'Searching…' : 'Track →'}
            </button>
          </div>

          {/* Error */}
          {error && <div className="error-box">{error}</div>}

          {/* Result */}
          <div id="result">{renderResult()}</div>
        </div>
      </div>
    </>
  )
}
