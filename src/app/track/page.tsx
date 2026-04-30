'use client'

import { useState } from 'react'

type OrderStatus = 'in_process' | 'shipped' | 'delivered'

const STATUS_LABEL: Record<OrderStatus, string> = {
  in_process: 'Making in Progress',
  shipped:    'Shipped',
  delivered:  'Delivered',
}

interface TrackingResult {
  order: {
    orderNumber: string
    customerName: string | null
    status: OrderStatus
    trackingId: string | null
    postexUrl: string | null
    lineItems: { name: string; quantity: number }[]
    createdAt: string
    updatedAt: string
    shippedAt: string | null
  }
  history: { status: OrderStatus; note: string | null; changed_at: string }[]
}

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

function calcCountdown(order: TrackingResult['order']) {
  const today = todayStr()

  if (order.status === 'in_process') {
    const confirmed = new Date(order.createdAt); confirmed.setHours(0, 0, 0, 0)
    const maxD = new Date(confirmed); maxD.setDate(confirmed.getDate() + 10)
    const minD = new Date(confirmed); minD.setDate(confirmed.getDate() + 7)
    const passed = daysBetween(order.createdAt, today)
    const daysLeft = Math.max(1, 10 - passed)
    const prog = Math.min(95, Math.round((passed / 10) * 100))
    return {
      daysLeft, prog,
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
    const daysLeft = Math.max(1, 3 - passed)
    const prog = Math.min(95, Math.round((passed / 3) * 100))
    return {
      daysLeft, prog,
      startFmt: fmtFull(shipped),
      maxDate: fmtFull(deadlineD),
      estRange: '',
      shippedMode: true,
    }
  }

  return null
}

async function fetchPostEx(trackingId: string): Promise<{ ok: boolean; data?: any }> {
  try {
    const res = await fetch(`https://api.postex.pk/services/integration/api/order/v3/track-order?trackingNumber=${trackingId}`, {
      headers: { 'token': process.env.NEXT_PUBLIC_POSTEX_TOKEN || '' },
    })
    if (!res.ok) return { ok: false }
    const json = await res.json()
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

function buildTimeline(order: TrackingResult['order'], history: TrackingResult['history']) {
  const isDelivered = order.status === 'delivered'
  const isShipped   = order.status === 'shipped'

  const historyTime = (s: string) => {
    const entry = history.find(h => h.status === s)
    return entry ? fmtDateTime(entry.changed_at) : 'Completed'
  }

  if (isDelivered) {
    return [
      { dot: 'green', label: 'Delivered',            sub: historyTime('delivered'),                    tag: null },
      { dot: 'green', label: 'Shipped',               sub: `Tracking ID: ${order.trackingId}`,         tag: null },
      { dot: 'green', label: 'Making in Progress',    sub: 'Completed',                                tag: null },
      { dot: 'green', label: 'Order Confirmed',       sub: fmtDate(order.createdAt),                   tag: null },
    ]
  }
  if (isShipped) {
    return [
      { dot: 'amber', label: 'Shipped',               sub: `Tracking ID: ${order.trackingId}`,         tag: 'current' },
      { dot: 'green', label: 'Making in Progress',    sub: 'Completed',                                tag: null },
      { dot: 'green', label: 'Order Confirmed',       sub: fmtDate(order.createdAt),                   tag: null },
    ]
  }
  return [
    { dot: 'blue',  label: 'Making in Progress',      sub: 'In progress',                              tag: 'current' },
    { dot: 'green', label: 'Order Confirmed',          sub: fmtDate(order.createdAt),                   tag: null },
  ]
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow-y:auto}
:root{--blue:#0A85D1;--card:#f8f9fa;--border:#e5e5e5;--bg:#ffffff;--text:#111111;--muted:#666}
.wrap{background:var(--bg);min-height:100vh;padding:24px 0 60px;font-family:'DM Sans',sans-serif;overflow-y:auto;-webkit-overflow-scrolling:touch}
.inner{max-width:480px;margin:0 auto;padding:0 20px}
.header{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.logo{background:var(--blue);color:#fff;font-family:'Syne',sans-serif;font-weight:800;font-size:12px;letter-spacing:2px;padding:5px 11px;border-radius:6px}
.app-sub{font-size:11px;color:#999;letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tab{flex:1;padding:9px;font-size:13px;font-weight:700;cursor:pointer;border-radius:8px;color:#555;background:#f0f0f0;border:1px solid #ddd;font-family:'DM Sans',sans-serif;transition:all .2s}
.tab.active{background:var(--blue);color:#fff;border-color:var(--blue)}
.search-row{display:flex;gap:8px;margin-bottom:20px}
.search-row input{flex:1;background:#fff;border:1.5px solid #ddd;border-radius:8px;padding:10px 14px;color:#111;font-family:'DM Sans',sans-serif;font-size:14px;outline:none;transition:border .2s;font-weight:500}
.search-row input::placeholder{color:#bbb}
.search-row input:focus{border-color:var(--blue)}
.search-btn{background:var(--blue);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:700;transition:background .2s;white-space:nowrap}
.search-btn:hover{background:#0972b8}
.search-btn:disabled{background:#90c4e8;cursor:not-allowed}
.hero{background:var(--blue);border:1px solid #0972b8;border-radius:14px;padding:24px;margin-bottom:8px}
.hero-order{font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;font-family:'Syne',sans-serif;font-weight:700;margin-bottom:6px}
.hero-name{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#fff;margin-bottom:14px}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.badge{font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px}
.badge-white{background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3)}
.badge-date{background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.8);border:1px solid rgba(255,255,255,0.2)}
.badge-delivered{background:#052e16;color:#4ade80;border:1px solid #16a34a55}
.badge-shipped{background:#1a0f00;color:#f59e0b;border:1px solid #f59e0b44}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.info-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:15px}
.info-label{font-size:11px;color:var(--muted);letter-spacing:.5px;margin-bottom:5px;font-weight:600}
.info-value{font-size:15px;font-weight:800;color:var(--text);font-family:'Syne',sans-serif}
.info-value.sm{color:#555;font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif}
.note-card{background:#e8f4fd;border:1px solid #b3d9f5;border-radius:12px;padding:14px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start}
.note-dot{width:8px;height:8px;background:var(--blue);border-radius:50%;flex-shrink:0;margin-top:5px}
.note-title{font-size:13px;font-weight:800;color:#111;margin-bottom:4px;font-family:'Syne',sans-serif}
.note-text{font-size:12px;color:#555;line-height:1.6;font-weight:500}
.countdown-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:8px}
.cd-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.cd-label{font-size:11px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:700}
.cd-badge{font-size:13px;font-weight:700;color:#fff;background:var(--blue);padding:4px 12px;border-radius:6px}
.cd-badge.amber{background:#1a0f00;color:#f59e0b;border:1px solid #f59e0b40}
.pbar{height:5px;background:#dde8f0;border-radius:3px;margin-bottom:12px;overflow:hidden}
.pfill{height:100%;background:var(--blue);border-radius:3px}
.cd-dates{display:flex;justify-content:space-between}
.cd-dates span{font-size:12px;color:var(--muted);font-weight:500}
.cd-dates .right{color:#111;font-weight:700}
.postex-wrap{background:var(--card);border:1px solid var(--border);border-radius:14px;margin-bottom:8px;overflow:hidden}
.postex-head{padding:14px 18px;border-bottom:1px solid var(--border)}
.postex-head-label{font-size:11px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:700}
.tid-row{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
.tid-label{font-size:12px;color:var(--muted);margin-bottom:3px;font-weight:600}
.tid-value{font-size:16px;font-weight:800;color:#111;font-family:'Syne',sans-serif;letter-spacing:1px}
.postex-status-area{padding:16px 18px}
.ps-loading{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);font-weight:500}
.ps-dot{width:8px;height:8px;border-radius:50%;background:var(--blue);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.ps-row{display:flex;align-items:flex-start;gap:14px;margin-bottom:12px}
.ps-row:last-child{margin-bottom:0}
.ps-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px}
.ps-icon.active{background:#0A85D122;border:1px solid #0A85D166}
.ps-icon.done{background:#0A85D115;border:1px solid #0A85D140}
.ps-icon.pending{background:#eee;border:1px solid var(--border)}
.ps-info{flex:1;padding-top:4px}
.ps-name{font-size:14px;font-weight:700;color:#111;margin-bottom:2px;font-family:'Syne',sans-serif;display:flex;align-items:center;gap:8px}
.ps-time{font-size:12px;color:var(--muted);font-weight:500}
.ps-current-tag{font-size:10px;color:var(--blue);background:#0A85D115;padding:2px 7px;border-radius:4px;border:1px solid #0A85D140;font-weight:700}
.postex-link{display:block;padding:12px 18px;border-top:1px solid var(--border);font-size:13px;color:var(--blue);text-decoration:none;text-align:center;font-weight:700;transition:background .2s}
.postex-link:hover{background:#e8f4fd}
.section-label{font-size:10px;color:#999;letter-spacing:2px;text-transform:uppercase;margin:14px 0 8px;padding-left:2px;font-weight:700}
.tl-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:8px}
.tl-item{display:flex;gap:14px;position:relative;padding-bottom:18px}
.tl-item:last-child{padding-bottom:0}
.tl-line{position:absolute;left:6px;top:18px;bottom:0;width:1.5px;background:#ddd}
.dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;margin-top:3px;position:relative;z-index:1}
.dot-blue{background:var(--blue)}
.dot-amber{background:#f59e0b}
.dot-green{background:#22c55e}
.tl-status-text{font-size:14px;font-weight:800;color:#111;margin-bottom:3px;font-family:'Syne',sans-serif;display:flex;align-items:center;gap:8px}
.tl-time{font-size:12px;color:var(--muted);font-weight:500}
.tl-tag{font-size:10px;color:var(--blue);background:#0A85D115;padding:2px 7px;border-radius:4px;letter-spacing:.5px;border:1px solid #0A85D140;font-weight:700}
.tl-tag-amber{font-size:10px;color:#f59e0b;background:#f59e0b15;padding:2px 7px;border-radius:4px;letter-spacing:.5px;border:1px solid #f59e0b40;font-weight:700}
.items-card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:8px}
.items-header{padding:12px 18px 10px;border-bottom:1px solid var(--border);font-size:10px;color:#999;letter-spacing:2px;text-transform:uppercase;font-weight:700}
.item-row{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border)}
.item-row:last-child{border-bottom:none}
.item-name{font-size:14px;color:#111;font-weight:600}
.item-qty{font-size:12px;color:var(--blue);background:#e8f4fd;padding:3px 10px;border-radius:6px;font-weight:700;border:1px solid #b3d9f5}
.empty{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:32px;text-align:center;color:var(--muted);font-size:14px;font-weight:500}
.empty span{display:block;font-size:12px;color:#aaa;margin-top:6px}
.error-box{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;color:#dc2626;font-size:13px;margin-bottom:16px;font-weight:600}
`

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

export default function TrackPage() {
  const [tab, setTab] = useState<'order' | 'phone'>('order')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrackingResult | null>(null)
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

      if ((data.order.status === 'shipped' || data.order.status === 'delivered') && data.order.trackingId) {
        setPostexEvents(null)
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

  function renderResult() {
    if (!result) return null
    const o = result.order
    const isDelivered = o.status === 'delivered'
    const isShipped   = o.status === 'shipped'
    const isInProcess = o.status === 'in_process'

    const label = STATUS_LABEL[o.status] ?? o.status
    const cd = calcCountdown(o)

    const heroBadgeClass = isDelivered ? 'badge badge-delivered' : isShipped ? 'badge badge-shipped' : 'badge badge-white'

    const estCard = isDelivered
      ? <div className="info-card"><div className="info-label">Delivered on</div><div className="info-value" style={{ color: '#22c55e' }}>{fmtDate(o.updatedAt)}</div></div>
      : <div className="info-card"><div className="info-label">Est. Delivery</div><div className="info-value sm">{cd ? cd.estRange || `By ${cd.maxDate}` : '—'}</div></div>

    const noteBlock = isInProcess && (
      <div className="note-card">
        <div className="note-dot" />
        <div>
          <div className="note-title">Crafting your order</div>
          <div className="note-text">We're carefully making your custom order. We'll notify you once it ships.</div>
        </div>
      </div>
    )

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

    const timeline = buildTimeline(o, result.history)
    const tlItems = timeline.map((item, i) => (
      <div key={i} className="tl-item" style={i === timeline.length - 1 ? { paddingBottom: 0 } : {}}>
        {i < timeline.length - 1 && <div className="tl-line" />}
        <div className={`dot dot-${item.dot}`} />
        <div>
          <div className="tl-status-text">
            {item.label}
            {item.tag === 'current' && !isShipped && <span className="tl-tag">current</span>}
            {item.tag === 'current' && isShipped && <span className="tl-tag-amber">current</span>}
          </div>
          <div className="tl-time">{item.sub}</div>
        </div>
      </div>
    ))

    const itemsHTML = (o.lineItems || []).map((item, i) => (
      <div key={i} className="item-row">
        <span className="item-name">{item.name}</span>
        <span className="item-qty">x{item.quantity}</span>
      </div>
    ))

    return (
      <>
        <div className="hero">
          <div className="hero-order">Order #{o.orderNumber}</div>
          <div className="hero-name">{o.customerName || 'Your Order'}</div>
          <div className="badges">
            <span className={heroBadgeClass}>{label}</span>
            <span className="badge badge-date">{fmtDate(o.createdAt)}</span>
          </div>
        </div>

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

        <div className="section-label">Status History</div>
        <div className="tl-card">{tlItems}</div>

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
          <div className="header">
            <div className="logo">MYZAN</div>
            <span className="app-sub">Order Tracker</span>
          </div>

          <div className="tabs">
            <button className={`tab${tab === 'order' ? ' active' : ''}`} onClick={() => switchTab('order')}>Order Number</button>
            <button className={`tab${tab === 'phone' ? ' active' : ''}`} onClick={() => switchTab('phone')}>Phone Number</button>
          </div>

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

          {error && <div className="error-box">{error}</div>}

          <div id="result">{renderResult()}</div>
        </div>
      </div>
    </>
  )
}
