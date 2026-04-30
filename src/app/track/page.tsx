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

// in_process: 10–15 day window, never goes negative (min 1)
// shipped: 3-day window from shippedAt, never goes negative
function calcCountdown(order: TrackingResult['order']) {
  const today = todayStr()

if (order.status !== 'shipped' && order.status !== 'delivered') {
    const confirmed = new Date(order.createdAt); confirmed.setHours(0, 0, 0, 0)
    const minD = new Date(confirmed); minD.setDate(confirmed.getDate() + 10)
    const maxD = new Date(confirmed); maxD.setDate(confirmed.getDate() + 15)
    const passed = daysBetween(order.createdAt, today)
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
    const res = await fetch(
      `https://api.postex.pk/services/integration/api/order/v3/track-order?trackingNumber=${trackingId}`,
      { headers: { token: process.env.NEXT_PUBLIC_POSTEX_TOKEN || '' } }
    )
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
html,body{height:100%;overflow-y:auto}
:root{
  --blue:#0A85D1;--blue-dk:#0872b3;--blue-lt:#e8f4fd;--blue-mid:#b3d9f5;
  --green:#16a34a;--green-lt:#dcfce7;
  --amber:#d97706;--amber-lt:#fef3c7;
  --red:#dc2626;--red-lt:#fee2e2;
  --text:#0f172a;--text2:#475569;--text3:#94a3b8;
  --border:#e2e8f0;--surface:#f8fafc;--white:#ffffff;
  --font:'Plus Jakarta Sans',sans-serif;
}
.page{background:#eef5ff;min-height:100vh;font-family:var(--font);padding-bottom:80px;-webkit-overflow-scrolling:touch}

/* topbar */
.topbar{background:var(--white);border-bottom:1px solid var(--border);padding:0 20px;height:54px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.logo{background:var(--blue);color:#fff;font-weight:800;font-size:11px;letter-spacing:2px;padding:5px 10px;border-radius:6px}
.topbar-sub{font-size:12px;color:var(--text3);font-weight:600;letter-spacing:1px;text-transform:uppercase}

/* layout */
.container{max-width:580px;margin:0 auto;padding:28px 16px 0}

/* search card */
.search-card{background:var(--white);border:1px solid var(--border);border-radius:20px;padding:24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.search-title{font-size:20px;font-weight:800;color:var(--text);margin-bottom:3px}
.search-sub{font-size:13px;color:var(--text3);font-weight:500;margin-bottom:18px}
.tabs{display:flex;background:var(--surface);border-radius:10px;padding:4px;margin-bottom:14px;border:1px solid var(--border)}
.tab{flex:1;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;border-radius:7px;color:var(--text2);background:transparent;border:none;font-family:var(--font);transition:all .18s}
.tab.active{background:var(--blue);color:#fff;box-shadow:0 2px 8px rgba(10,133,209,.25)}
.input-row{display:flex;gap:10px}
.input-row input{flex:1;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;padding:11px 16px;color:var(--text);font-family:var(--font);font-size:14px;font-weight:600;outline:none;transition:border .2s,box-shadow .2s}
.input-row input::placeholder{color:var(--text3);font-weight:500}
.input-row input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(10,133,209,.1)}
.track-btn{background:var(--blue);color:#fff;border:none;padding:11px 22px;border-radius:10px;font-size:14px;font-family:var(--font);cursor:pointer;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(10,133,209,.3);transition:background .2s,transform .1s}
.track-btn:hover{background:var(--blue-dk)}
.track-btn:active{transform:scale(.98)}
.track-btn:disabled{background:#90c4e8;cursor:not-allowed;box-shadow:none}
.err{background:var(--red-lt);border:1px solid #fecaca;border-radius:10px;padding:12px 16px;color:var(--red);font-size:13px;margin-top:14px;font-weight:600}

/* hero */
.hero{background:linear-gradient(135deg,#0A85D1 0%,#0565a8 100%);border-radius:20px;padding:26px 24px;margin-bottom:12px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-50px;right:-50px;width:180px;height:180px;background:rgba(255,255,255,.07);border-radius:50%}
.hero::after{content:'';position:absolute;bottom:-70px;left:-30px;width:220px;height:220px;background:rgba(255,255,255,.04);border-radius:50%}
.hero-no{font-size:11px;color:rgba(255,255,255,.65);letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:8px;position:relative;z-index:1}
.hero-name{font-size:27px;font-weight:800;color:#fff;margin-bottom:16px;position:relative;z-index:1;line-height:1.2}
.hero-badges{display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}
.hb{font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px}
.hb-status{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.3)}
.hb-delivered{background:#052e16;color:#4ade80;border:1px solid #16a34a55}
.hb-shipped{background:#1a0f00;color:#f59e0b;border:1px solid #f59e0b44}
.hb-date{background:rgba(255,255,255,.1);color:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.15)}

/* info tiles */
.info-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.tile{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:16px 18px}
.tile-lbl{font-size:10px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:6px}
.tile-val{font-size:16px;font-weight:800;color:var(--text)}
.tile-val.sm{font-size:13px;font-weight:600;color:var(--text2)}
.tile-val.green{color:var(--green)}

/* note */
.note{background:var(--blue-lt);border:1px solid var(--blue-mid);border-radius:14px;padding:16px 18px;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start}
.note-icon{width:38px;height:38px;background:var(--blue);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.note-title{font-size:14px;font-weight:800;color:var(--text);margin-bottom:3px}
.note-body{font-size:12px;color:var(--text2);line-height:1.6;font-weight:500}

/* countdown */
.cd-card{background:var(--white);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:12px}
.cd-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}
.cd-lbl{font-size:10px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:4px}
.cd-num{font-size:36px;font-weight:800;color:var(--blue);line-height:1}
.cd-unit{font-size:12px;color:var(--text3);font-weight:600;margin-top:2px}
.cd-pill{background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue-mid);font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;white-space:nowrap;max-width:160px;text-align:right}
.cd-pill.amber{background:var(--amber-lt);color:var(--amber);border-color:#fde68a}
.pbar{background:#deeaf5;border-radius:99px;height:8px;overflow:hidden;margin-bottom:10px}
.pfill{height:100%;background:linear-gradient(90deg,#0A85D1,#38b6ff);border-radius:99px;transition:width .8s ease}
.cd-dates{display:flex;justify-content:space-between}
.cd-dates span{font-size:12px;color:var(--text3);font-weight:500}
.cd-dates .cd-end{color:var(--text);font-weight:700}

/* section label */
.sec-lbl{font-size:11px;color:var(--text3);letter-spacing:2px;text-transform:uppercase;font-weight:700;margin:20px 0 10px 2px}

/* postex */
.px-card{background:var(--white);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:12px}
.px-head{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.px-head-lbl{font-size:11px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;font-weight:700}
.px-tid{background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue-mid);font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:.5px}
.px-body{padding:16px 20px}
.px-loading{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text3);font-weight:500}
.px-dot{width:8px;height:8px;border-radius:50%;background:var(--blue);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.px-item{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)}
.px-item:last-child{border-bottom:none}
.px-ico{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.px-ico.active{background:#0A85D115;border:1px solid #0A85D140}
.px-ico.done{background:var(--green-lt);border:1px solid #bbf7d0}
.px-ico.pending{background:var(--surface);border:1px solid var(--border)}
.px-label{font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap}
.px-now{font-size:10px;color:var(--blue);background:var(--blue-lt);padding:2px 8px;border-radius:4px;border:1px solid var(--blue-mid);font-weight:700}
.px-time{font-size:12px;color:var(--text3);font-weight:500}
.px-link{display:block;padding:13px 20px;border-top:1px solid var(--border);font-size:13px;color:var(--blue);text-decoration:none;text-align:center;font-weight:700;transition:background .2s}
.px-link:hover{background:var(--blue-lt)}

/* timeline */
.tl-card{background:var(--white);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:12px}
.tl-item{display:flex;gap:16px;position:relative;padding-bottom:20px}
.tl-item:last-child{padding-bottom:0}
.tl-line{position:absolute;left:7px;top:20px;bottom:0;width:2px;background:linear-gradient(to bottom,#e2e8f0,transparent)}
.tl-dot{width:16px;height:16px;border-radius:50%;flex-shrink:0;margin-top:3px;position:relative;z-index:1}
.tl-dot.blue{background:var(--blue);box-shadow:0 0 0 3px var(--white),0 0 0 5px var(--blue-mid)}
.tl-dot.amber{background:var(--amber);box-shadow:0 0 0 3px var(--white),0 0 0 5px #fde68a}
.tl-dot.green{background:var(--green);box-shadow:0 0 0 3px var(--white),0 0 0 5px #bbf7d0}
.tl-label{font-size:14px;font-weight:800;color:var(--text);display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap}
.tl-tag{font-size:10px;color:var(--blue);background:var(--blue-lt);padding:2px 8px;border-radius:4px;border:1px solid var(--blue-mid);font-weight:700}
.tl-tag-amber{font-size:10px;color:var(--amber);background:var(--amber-lt);padding:2px 8px;border-radius:4px;border:1px solid #fde68a;font-weight:700}
.tl-sub{font-size:12px;color:var(--text3);font-weight:500}

/* items */
.items-card{background:var(--white);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:12px}
.items-head{padding:13px 20px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text3);letter-spacing:2px;text-transform:uppercase;font-weight:700}
.item-row{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--border)}
.item-row:last-child{border-bottom:none}
.item-name{font-size:14px;color:var(--text);font-weight:600}
.item-qty{font-size:12px;color:var(--blue);background:var(--blue-lt);padding:4px 12px;border-radius:20px;font-weight:700;border:1px solid var(--blue-mid)}
`

function PostExEvents({ events }: { events: any[] | null }) {
  const icons = ['🚚', '📦', '✅', '📍']
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
              {ev.state === 'active' && <span className="px-now">NOW</span>}
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
  const [postexEvents, setPostexEvents] = useState<any[] | null | undefined>(undefined)

  async function handleTrack() {
    if (!query.trim()) {
      setError('Please enter your ' + (tab === 'order' ? 'order number.' : 'phone number.'))
      return
    }
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
    const isShipped = o.status === 'shipped'
    const isInProcess = o.status === 'in_process'
    const label = STATUS_LABEL[o.status] ?? o.status
    const cd = calcCountdown(o)
    const timeline = buildTimeline(o, result.history)

    const heroBadge = isDelivered ? 'hb hb-delivered' : isShipped ? 'hb hb-shipped' : 'hb hb-status'

    return (
      <>
        {/* Hero */}
        <div className="hero">
          <div className="hero-no">Order #{o.orderNumber}</div>
          <div className="hero-name">{o.customerName || 'Your Order'}</div>
          <div className="hero-badges">
            <span className={heroBadge}>{label}</span>
            <span className="hb hb-date">{fmtDate(o.createdAt)}</span>
          </div>
        </div>

        {/* Info tiles */}
        <div className="info-row">
          <div className="tile">
            <div className="tile-lbl">Ordered On</div>
            <div className="tile-val">{fmtDate(o.createdAt)}</div>
          </div>
          {isDelivered ? (
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

        {/* Note */}
        {isInProcess && (
          <div className="note">
            <div className="note-icon">🎨</div>
            <div>
              <div className="note-title">Crafting your order</div>
              <div className="note-body">We're carefully making your custom order. You'll be notified as soon as it ships.</div>
            </div>
          </div>
        )}

        {/* Countdown */}
        {cd && !isDelivered && (
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

        {/* PostEx live tracking */}
        {(isShipped || isDelivered) && o.trackingId && (
          <>
            <div className="sec-lbl">Live Courier Tracking</div>
            <div className="px-card">
              <div className="px-head">
                <span className="px-head-lbl">PostEx Status</span>
                <span className="px-tid">{o.trackingId}</span>
              </div>
              <div className="px-body">
                <PostExEvents events={postexEvents === undefined ? null : postexEvents} />
              </div>
              <a
                className="px-link"
                href={o.postexUrl || `https://postex.pk/tracking/${o.trackingId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Track on PostEx website →
              </a>
            </div>
          </>
        )}

        {/* Status history */}
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

        {/* Items */}
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
          <div className="logo">MYZANN</div>
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
