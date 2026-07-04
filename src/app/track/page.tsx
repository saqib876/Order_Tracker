'use client'

import { useState } from 'react'

type OrderStatus = 'in_process' | 'shipped' | 'delivered'

const STATUS_LABEL: Record<OrderStatus, string> = {
  in_process: 'Making in Progress',
  shipped: 'Shipped',
  delivered: 'Delivered',
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

function workingDaysBetween(a: string, b: string) {
  const start = new Date(a); start.setHours(0, 0, 0, 0)
  const end = new Date(b); end.setHours(0, 0, 0, 0)
  let count = 0
  const cur = new Date(start)
  while (cur < end) {
    cur.setDate(cur.getDate() + 1)
    if (cur.getDay() !== 0) count++
  }
  return count
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
function fmtCCDate(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PK', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Returns true if the latest courier event contains "deliver"
function isCourierDelivered(events: any[] | null | undefined): boolean {
  if (!events || events.length === 0) return false
  const label: string = (events[0]?.label || '').toLowerCase()
  return label.includes('deliver')
}

function calcCountdown(order: TrackingResult['order'], courierDone: boolean) {
  // Hide countdown if DB says delivered OR courier API says delivered
  if (order.status === 'delivered' || courierDone) return null

  const today = todayStr()
  if (order.status !== 'shipped') {
    const confirmed = new Date(order.createdAt); confirmed.setHours(0, 0, 0, 0)
    const minD = new Date(confirmed); minD.setDate(confirmed.getDate() + 10)
    const maxD = new Date(confirmed); maxD.setDate(confirmed.getDate() + 15)
    const passed = workingDaysBetween(order.createdAt, today)
    const daysLeft = Math.max(1, 15 - passed)
    const prog = Math.min(95, Math.round((passed / 15) * 100))
    return {
      daysLeft, prog,
      startFmt: fmtFull(confirmed),
      maxDate: fmtFull(maxD),
      estRange: `${fmtShort(minD)} – ${fmtShort(maxD)}`,
      shippedMode: false,
    }
  }

  if (order.status === 'shipped' && order.shippedAt) {
    const shipped = new Date(order.shippedAt); shipped.setHours(0, 0, 0, 0)
    const deadlineD = new Date(shipped); deadlineD.setDate(shipped.getDate() + 3)
    const passed = workingDaysBetween(order.shippedAt, today)
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

async function fetchCallCourier(trackingId: string): Promise<{ ok: boolean; data?: any }> {
  try {
    const res = await fetch(
      `http://cod.callcourier.com.pk/api/CallCourier/GetTackingHistory?cn=${trackingId}`
    )
    if (!res.ok) return { ok: false }
    const json = await res.json()
    if (!Array.isArray(json) || json.length === 0) return { ok: false }

    const sorted = [...json].sort(
      (a, b) => new Date(b.TransactionDate).getTime() - new Date(a.TransactionDate).getTime()
    )

    const events = sorted.map((ev: any, i: number) => ({
      label: ev.ProcessDescForPortal || ev.OperationDesc || 'Update',
      time: fmtCCDate(ev.TransactionDate),
      state: i === 0 ? 'active' : 'done',
    }))

    return { ok: true, data: { events } }
  } catch {
    return { ok: false }
  }
}

function buildTimeline(order: TrackingResult['order'], history: TrackingResult['history']) {
  const isDelivered = order.status === 'delivered'
  const isShipped = order.status === 'shipped'
  const historyTime = (s: string) => {
    const entry = history.find(h => h.status === s)
    return entry ? fmtDateTime(entry.changed_at) : 'Completed'
  }
  if (isDelivered) {
    return [
      { dot: 'green', label: 'Delivered', sub: historyTime('delivered'), tag: null },
      { dot: 'green', label: 'Shipped', sub: `Tracking ID: ${order.trackingId}`, tag: null },
      { dot: 'green', label: 'Making in Progress', sub: 'Completed', tag: null },
      { dot: 'green', label: 'Order Confirmed', sub: fmtDate(order.createdAt), tag: null },
    ]
  }
  if (isShipped) {
    return [
      { dot: 'amber', label: 'Shipped', sub: `Tracking ID: ${order.trackingId}`, tag: 'current' },
      { dot: 'green', label: 'Making in Progress', sub: 'Completed', tag: null },
      { dot: 'green', label: 'Order Confirmed', sub: fmtDate(order.createdAt), tag: null },
    ]
  }
  return [
    { dot: 'blue', label: 'Making in Progress', sub: 'In progress', tag: 'current' },
    { dot: 'green', label: 'Order Confirmed', sub: fmtDate(order.createdAt), tag: null },
  ]
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:auto;overflow:hidden;background:#fafafa;}

:root{
  --blue:#0A85D1;
  --blue-dk:#0872b3;
  --blue-lt:#e8f4fd;
  --blue-mid:#b3d9f5;
  --dark:#111111;
  --gray-deep:#444444;
  --gray-muted:#888888;
  --border-light:#e2e8f0;
  --bg-clean:#fafafa;
  --white:#ffffff;
  --font:'Plus Jakarta Sans',sans-serif;
  
  --green-status:#16a34a;
  --green-bg:#dcfce7;
}

/* Page base with clean tone */
.page{background:var(--bg-clean);min-height:100vh;font-family:var(--font);padding-bottom:30px;}

.topbar{display:none;} 

/* Main content wrapper */
.container{max-width:580px;margin:0 auto;padding:24px 16px 0}

/* Elegant Header & Search */
.search-card{background:transparent;border:none;padding:10px 0;margin-bottom:20px;}
.search-title{font-size:26px;font-weight:700;color:var(--dark);letter-spacing:-0.5px;margin-bottom:6px}
.search-sub{font-size:13px;color:var(--gray-deep);font-weight:400;margin-bottom:20px;letter-spacing:0.2px}

/* Clean Minimalist Tabs */
.tabs{display:flex;background:#edf2f7;border-radius:20px;padding:3px;margin-bottom:16px;}
.tab{flex:1;padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer;border-radius:18px;color:var(--gray-deep);background:transparent;border:none;font-family:var(--font);transition:all .2s ease;letter-spacing:0.3px}
.tab.active{background:var(--blue);color:var(--white);box-shadow:0 2px 8px rgba(10,133,209,.2)}

/* Premium Inputs and Solid Blue Button */
.input-row{display:flex;gap:12px}
.input-row input{flex:1;background:var(--white);border:1px solid var(--border-light);border-radius:24px;padding:12px 20px;color:var(--dark);font-family:var(--font);font-size:14px;font-weight:500;outline:none;transition:all .2s}
.input-row input::placeholder{color:var(--gray-muted);font-weight:400}
.input-row input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(10,133,209,.08)}

.track-btn{background:var(--blue);color:var(--white);border:none;padding:12px 26px;border-radius:24px;font-size:13px;font-family:var(--font);cursor:pointer;font-weight:600;letter-spacing:0.5px;transition:all .2s;white-space:nowrap}
.track-btn:hover{background:var(--blue-dk);transform:translateY(-1px)}
.track-btn:active{transform:translateY(0)}
.err{background:#fee2e2;border:1px solid #fca5a5;border-radius:16px;padding:12px 16px;color:#b91c1c;font-size:13px;margin-top:14px;font-weight:500}

/* Premium Solid Main Status Card in Blue */
.hero{background:var(--blue);border-radius:20px;padding:24px;margin-bottom:16px;}
.hero-no{font-size:10px;color:rgba(255,255,255,.7);letter-spacing:1.5px;text-transform:uppercase;font-weight:600;margin-bottom:6px;}
.hero-name{font-size:24px;font-weight:700;color:var(--white);margin-bottom:16px;letter-spacing:-0.3px}
.hero-badges{display:flex;gap:8px;flex-wrap:wrap;}
.hb{font-size:11px;font-weight:600;padding:6px 14px;border-radius:20px;letter-spacing:0.2px}
.hb-status{background:rgba(255,255,255,.15);color:var(--white);border:1px solid rgba(255,255,255,.1)}
.hb-delivered{background:var(--white);color:var(--blue);font-weight:700}
.hb-shipped{background:rgba(255,255,255,.9);color:var(--dark);font-weight:700}
.hb-date{background:rgba(0,0,0,.1);color:rgba(255,255,255,.85);border:none}

/* Modern Clean Info Tiles */
.info-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.tile{background:var(--white);border:1px solid var(--border-light);border-radius:16px;padding:16px}
.tile-lbl{font-size:9px;color:var(--gray-muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:600;margin-bottom:6px}
.tile-val{font-size:16px;font-weight:700;color:var(--dark);letter-spacing:-0.2px}
.tile-val.sm{font-size:13px;font-weight:500;color:var(--gray-deep)}
.tile-val.green{color:var(--green-status)}

/* Aesthetic Alert/Note */
.note{background:var(--blue-lt);border:1px solid var(--blue-mid);border-radius:16px;padding:14px 16px;margin-bottom:16px;display:flex;gap:12px;align-items:center}
.note-icon{width:28px;height:28px;background:var(--blue);color:var(--white);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.note-title{font-size:13px;font-weight:700;color:var(--dark);margin-bottom:1px}
.note-body{font-size:12px;color:var(--gray-deep);font-weight:400;line-height:1.4}

/* Clean Countdown Style */
.cd-card{background:var(--white);border:1px solid var(--border-light);border-radius:16px;padding:16px;margin-bottom:16px}
.cd-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.cd-lbl{font-size:9px;color:var(--gray-muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.cd-num{font-size:30px;font-weight:700;color:var(--dark);line-height:1;letter-spacing:-0.5px}
.cd-unit{font-size:11px;color:var(--gray-muted);font-weight:500;margin-top:2px}
.cd-pill{background:var(--blue-lt);color:var(--blue);font-size:11px;font-weight:600;padding:4px 12px;border-radius:20px;}
.pbar{background:#edf2f7;border-radius:99px;height:4px;overflow:hidden;margin-bottom:12px}
.pfill{height:100%;background:var(--blue);border-radius:99px;}
.cd-dates{display:flex;justify-content:space-between}
.cd-dates span{font-size:11px;color:var(--gray-muted);font-weight:400}
.cd-dates .cd-end{color:var(--dark);font-weight:600}

.sec-lbl{font-size:10px;color:var(--gray-muted);letter-spacing:2px;text-transform:uppercase;font-weight:600;margin:20px 0 10px 4px}

/* Courier & Timeline Sections without heavy boxing */
.px-card{background:var(--white);border:1px solid var(--border-light);border-radius:16px;overflow:hidden;margin-bottom:16px}
.px-head{padding:14px 16px;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center}
.px-head-lbl{font-size:10px;color:var(--gray-muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.px-tid{background:var(--blue-lt);color:var(--blue);font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
.px-body{padding:12px 16px}
.px-item{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-light)}
.px-item:last-child{border-bottom:none}
.px-ico{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.px-ico.active{background:var(--blue-lt);color:var(--blue)}
.px-ico.done{background:var(--green-bg);color:var(--green-status)}
.px-ico.pending{background:#fafafa;color:var(--gray-muted);border:1px solid var(--border-light)}
.px-label{font-size:13px;font-weight:600;color:var(--dark)}
.px-time{font-size:11px;color:var(--gray-muted);font-weight:400}
.px-link{display:block;padding:12px;background:transparent;width:100%;border:none;border-top:1px solid var(--border-light);font-size:12px;color:var(--blue);text-align:center;font-weight:600;letter-spacing:0.3px;cursor:pointer;transition:background 0.2s;}
.px-link:hover{background:var(--blue-lt)}

/* Beautiful Elegant Timeline */
.tl-card{background:var(--white);border:1px solid var(--border-light);border-radius:16px;padding:20px;margin-bottom:16px}
.tl-item{display:flex;gap:16px;position:relative;padding-bottom:20px}
.tl-item:last-child{padding-bottom:0}
.tl-line{position:absolute;left:4px;top:16px;bottom:0;width:1px;background:var(--border-light)}
.tl-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:5px;position:relative;z-index:1;background:var(--border-light)}
.tl-dot.blue{background:var(--blue);box-shadow:0 0 0 4px var(--white),0 0 0 6px var(--blue-mid)}
.tl-dot.amber{background:var(--dark);box-shadow:0 0 0 4px var(--white),0 0 0 5px #e2e8f0}
.tl-dot.green{background:var(--green-status);box-shadow:0 0 0 4px var(--white),0 0 0 5px var(--green-bg)}
.tl-label{font-size:13px;font-weight:600;color:var(--dark);margin-bottom:2px}
.tl-tag{font-size:9px;color:var(--blue);background:var(--blue-lt);padding:2px 6px;border-radius:4px;font-weight:600}
.tl-sub{font-size:11px;color:var(--gray-muted);font-weight:400}

/* Items Summary List */
.items-card{background:var(--white);border:1px solid var(--border-light);border-radius:16px;overflow:hidden;margin-bottom:16px}
.items-head{padding:14px 16px;border-bottom:1px solid var(--border-light);font-size:10px;color:var(--gray-muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.item-row{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-light)}
.item-row:last-child{border-bottom:none}
.item-name{font-size:13px;color:var(--dark);font-weight:500}
.item-qty{font-size:11px;color:var(--blue);background:var(--blue-lt);padding:3px 9px;border-radius:12px;font-weight:600}
`

function CourierEvents({ events }: { events: any[] | null }) {
  const icons = ['🚚', '📦', '🏢', '➡️', '✅', '📍', '🔄', '↩️', '📋', '🏠', '🎯']
  if (!events) {
    return <div className="px-loading"><div className="px-dot" />Fetching live courier status…</div>
  }
  if (events.length === 0) {
    return <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>Tracking info not available yet.</div>
  }
  return (
    <>
      {events.map((ev, i) => (
        <div key={i} className="px-item">
          <div className={`px-ico ${ev.state}`}>{icons[i] || '📍'}</div>
          <div>
            <div className="px-label">
              {ev.label}
              {ev.state === 'active' && <span className="px-now">LATEST</span>}
            </div>
            <div className="px-time">{ev.time}</div>
          </div>
        </div>
      ))}
    </>
  )
}

export default function TrackPage() {
  const [tab, setTab] = useState<'order' | 'phone'>('order')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrackingResult | null>(null)
  const [courierEvents, setCourierEvents] = useState<any[] | null | undefined>(undefined)

  async function handleTrack() {
    if (!query.trim()) {
      setError('Please enter your ' + (tab === 'order' ? 'order number.' : 'phone number.'))
      return
    }
    setLoading(true); setError(''); setResult(null); setCourierEvents(undefined)
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
        setCourierEvents(null)
        const cc = await fetchCallCourier(data.order.trackingId)
        setCourierEvents(cc.ok ? cc.data.events : [])
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function switchTab(t: 'order' | 'phone') {
    setTab(t); setQuery(''); setError(''); setResult(null); setCourierEvents(undefined)
  }

  function renderResult() {
    if (!result) return null
    const o = result.order
    const isDelivered = o.status === 'delivered'
    const isShipped = o.status === 'shipped'
    const isInProcess = o.status === 'in_process'
    const label = STATUS_LABEL[o.status] ?? o.status

    // True if courier API latest event says "delivered" (even if DB is still 'shipped')
    const courierDone = isCourierDelivered(courierEvents)

    const cd = calcCountdown(o, courierDone)
    const timeline = buildTimeline(o, result.history)
    const heroBadge = isDelivered ? 'hb hb-delivered' : isShipped ? 'hb hb-shipped' : 'hb hb-status'

    return (
      <>
        <div className="hero">
          <div className="hero-no">Order #{o.orderNumber}</div>
          <div className="hero-name">{o.customerName || 'Your Order'}</div>
          <div className="hero-badges">
            <span className={heroBadge}>{label}</span>
            <span className="hb hb-date">{fmtDate(o.createdAt)}</span>
          </div>
        </div>

        <div className="info-row">
          <div className="tile">
            <div className="tile-lbl">Ordered On</div>
            <div className="tile-val">{fmtDate(o.createdAt)}</div>
          </div>
          {isDelivered || courierDone ? (
            <div className="tile">
              <div className="tile-lbl">Delivered On</div>
              <div className="tile-val green">{fmtDate(o.updatedAt)}</div>
            </div>
          ) : (
            <div className="tile">
              <div className="tile-lbl">Est. Delivery</div>
              <div className={`tile-val${cd ? ' sm' : ''}`}>
                {cd ? cd.estRange : '10 – 15 days after confirmation'}
              </div>
            </div>
          )}
        </div>

        {isInProcess && (
          <div className="note">
            <div className="note-icon">🎨</div>
            <div>
              <div className="note-title">Crafting your order</div>
              <div className="note-body">We're carefully making your custom order. You'll be notified as soon as it ships.</div>
            </div>
          </div>
        )}

        {/* Countdown hidden if DB delivered OR courier says delivered */}
        {cd && !isDelivered && !courierDone && (
          <div className="cd-card">
            <div className="cd-top">
              <div>
                <div className="cd-lbl">{isShipped ? 'Delivery Window' : 'Delivery Countdown'}</div>
                <div className="cd-num">{cd.daysLeft}</div>
                <div className="cd-unit">day{cd.daysLeft === 1 ? '' : 's'} remaining</div>
              </div>
              <div className={`cd-pill${isShipped ? ' amber' : ''}`}>
                {isShipped
                  ? cd.daysLeft === 1 ? 'Arriving soon' : `Est. ${cd.daysLeft} days`
                  : cd.estRange || `By ${cd.maxDate}`}
              </div>
            </div>
            <div className="pbar"><div className="pfill" style={{ width: `${cd.prog}%` }} /></div>
            <div className="cd-dates">
              <span>{isShipped ? `Shipped ${cd.startFmt}` : `Confirmed ${cd.startFmt}`}</span>
              <span className="cd-end">By {cd.maxDate}</span>
            </div>
          </div>
        )}

        {(isShipped || isDelivered) && o.trackingId && (
          <>
            <div className="sec-lbl">Live Courier Tracking</div>
            <div className="px-card">
              <div className="px-head">
                <span className="px-head-lbl">Call Courier Status</span>
                <span className="px-tid">{o.trackingId}</span>
              </div>
              <div className="px-body">
                <CourierEvents events={courierEvents === undefined ? null : courierEvents} />
              </div>
              <button
                className="px-link"
                onClick={() => {
                  if (o.trackingId) {
                    navigator.clipboard.writeText(o.trackingId).catch(() => {})
                  }
                  window.open(`https://callcourier.com.pk/tracking/?tc=${o.trackingId}`, '_blank')
                }}
              >
                Track on Call Courier website → (CN copied ✓)
              </button>
            </div>
          </>
        )}

        <div className="sec-lbl">Status History</div>
        <div className="tl-card">
          {timeline.map((item, i) => (
            <div key={i} className="tl-item" style={i === timeline.length - 1 ? { paddingBottom: 0 } : {}}>
              {i < timeline.length - 1 && <div className="tl-line" />}
              <div className={`tl-dot ${item.dot}`} />
              <div>
                <div className="tl-label">
                  {item.label}
                  {item.tag === 'current' && !isShipped && <span className="tl-tag">current</span>}
                  {item.tag === 'current' && isShipped && <span className="tl-tag-amber">current</span>}
                </div>
                <div className="tl-sub">{item.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {(o.lineItems || []).length > 0 && (
          <>
            <div className="sec-lbl">Items</div>
            <div className="items-card">
              <div className="items-head">Products in this order</div>
              {o.lineItems.map((item, i) => (
                <div key={i} className="item-row">
                  <span className="item-name">{item.name}</span>
                  <span className="item-qty">×{item.quantity}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <>
      <style>{css}</style>
      <div className="page">
        <div className="topbar">
          <div className="logo">MYZAN</div>
          <span className="topbar-sub">Order Tracker</span>
        </div>
        <div className="container">
          <div className="search-card">
            <div className="search-title">Track your order</div>
            <div className="search-sub">Enter your order number or phone to get live updates</div>
            <div className="tabs">
              <button className={`tab${tab === 'order' ? ' active' : ''}`} onClick={() => switchTab('order')}>Order Number</button>
              <button className={`tab${tab === 'phone' ? ' active' : ''}`} onClick={() => switchTab('phone')}>Phone Number</button>
            </div>
            <div className="input-row">
              <input
                type={tab === 'phone' ? 'tel' : 'text'}
                placeholder={tab === 'order' ? 'e.g. 2087' : 'e.g. 03001234567'}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTrack()}
              />
              <button className="track-btn" onClick={handleTrack} disabled={loading}>
                {loading ? 'Searching…' : 'Track →'}
              </button>
            </div>
            {error && <div className="err">{error}</div>}
          </div>
          {renderResult()}
        </div>
      </div>
    </>
  )
}
