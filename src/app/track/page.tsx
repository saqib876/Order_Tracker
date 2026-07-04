'use client'

import { useState, useEffect, useRef } from 'react'

type OrderStatus = 'in_process' | 'shipped' | 'delivered'

const STATUS_LABEL: Record<OrderStatus, string> = {
  in_process: 'Making in progress',
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

/* ---------- date / working-day helpers ---------- */
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
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function fmtCCDate(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PK', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function isCourierDelivered(events: any[] | null | undefined): boolean {
  if (!events || events.length === 0) return false
  const label: string = (events[0]?.label || '').toLowerCase()
  return label.includes('deliver')
}

function calcCountdown(order: TrackingResult['order'], courierDone: boolean) {
  if (order.status === 'delivered' || courierDone) return null
  const today = todayStr()

  if (order.status !== 'shipped') {
    const confirmed = new Date(order.createdAt); confirmed.setHours(0, 0, 0, 0)
    const minD = new Date(confirmed); minD.setDate(confirmed.getDate() + 10)
    const maxD = new Date(confirmed); maxD.setDate(confirmed.getDate() + 15)
    const passed = workingDaysBetween(order.createdAt, today)
    const daysLeft = Math.max(1, 15 - passed)
    const prog = Math.min(95, Math.max(6, Math.round((passed / 15) * 100)))
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
    const prog = Math.min(95, Math.max(10, Math.round((passed / 3) * 100)))
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

/* ---------- stepper stages ---------- */
function buildStages(order: TrackingResult['order'], history: TrackingResult['history'], courierDone: boolean) {
  const done = courierDone || order.status === 'delivered'
  const shipped = done || order.status === 'shipped'
  const timeOf = (s: OrderStatus) => {
    const e = history.find(h => h.status === s)
    return e ? fmtDateTime(e.changed_at) : ''
  }
  return [
    { label: 'Confirmed', sub: fmtDate(order.createdAt), state: 'done' as const },
    { label: 'Making', sub: shipped ? 'Completed' : 'In progress',
      state: shipped ? 'done' : 'current' as const },
    { label: 'Shipped', sub: order.trackingId ? `CN ${order.trackingId}` : timeOf('shipped') || '—',
      state: done ? 'done' : shipped ? 'current' : 'pending' as const },
    { label: 'Delivered', sub: done ? (timeOf('delivered') || 'Completed') : 'Pending',
      state: done ? 'done' : 'pending' as const },
  ]
}

/* ---------- styles ---------- */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#0B1120; --ink2:#141C2E; --ink3:#1E2A44;
  --canvas:#EDF1F8; --card:#FFFFFF; --line:#E4E9F2;
  --txt:#0B1120; --txt2:#5A6B85; --txt3:#93A0B8;
  --acc:#4F46E5; --acc2:#06B6D4; --violet:#7C3AED;
  --grn:#10B981; --grn-l:#DCFCE7; --amb:#F59E0B; --amb-l:#FEF3C7;
  --red:#EF4444; --red-l:#FEE2E2;
  --disp:'Space Grotesk',sans-serif; --body:'Inter',sans-serif;
}
html,body{background:var(--canvas)}
.app{font-family:var(--body);color:var(--txt);background:var(--canvas);display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}

/* top bar */
.bar{height:56px;display:flex;align-items:center;gap:12px;padding:0 20px;background:rgba(255,255,255,.72);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.brand{font-family:var(--disp);font-weight:700;font-size:15px;letter-spacing:.5px;color:var(--ink)}
.brand b{background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.bar-sub{font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--txt3)}
.bar-right{margin-left:auto;font-family:var(--disp);font-size:13px;font-weight:600;color:var(--txt2);background:#fff;border:1px solid var(--line);padding:5px 12px;border-radius:99px}

/* ===== SEARCH STAGE ===== */
.stage{min-height:440px;display:flex;align-items:center;justify-content:center;padding:40px 16px}
.search{width:100%;max-width:440px;text-align:center}
.eyebrow{font-family:var(--disp);font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--acc);margin-bottom:14px}
.search h1{font-family:var(--disp);font-size:34px;font-weight:700;line-height:1.1;letter-spacing:-.5px;margin-bottom:10px}
.search p{font-size:14px;color:var(--txt2);line-height:1.55;margin-bottom:26px}
.seg{display:flex;background:#fff;border:1px solid var(--line);border-radius:12px;padding:4px;margin-bottom:12px;box-shadow:0 1px 2px rgba(11,17,32,.04)}
.seg button{flex:1;border:none;background:transparent;font-family:var(--body);font-size:13px;font-weight:600;color:var(--txt2);padding:9px;border-radius:8px;cursor:pointer;transition:.2s}
.seg button.on{background:var(--ink);color:#fff}
.field{display:flex;gap:9px}
.field input{flex:1;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:13px 16px;font-family:var(--body);font-size:15px;font-weight:500;color:var(--txt);outline:none;transition:.2s}
.field input::placeholder{color:var(--txt3);font-weight:400}
.field input:focus{border-color:var(--acc);box-shadow:0 0 0 4px rgba(79,70,229,.12)}
.go{border:none;background:var(--ink);color:#fff;font-family:var(--body);font-weight:600;font-size:14px;padding:0 22px;border-radius:12px;cursor:pointer;white-space:nowrap;transition:.15s}
.go:hover{background:#000}
.go:active{transform:scale(.97)}
.go:disabled{opacity:.5;cursor:not-allowed}
.trust{display:flex;gap:18px;justify-content:center;margin-top:22px}
.trust span{font-size:11.5px;color:var(--txt3);font-weight:500;display:flex;align-items:center;gap:5px}
.trust b{color:var(--grn)}
.alert{background:var(--red-l);border:1px solid #fecaca;color:#b91c1c;font-size:13px;font-weight:600;padding:11px 14px;border-radius:10px;margin-top:14px;text-align:left}

/* ===== DASHBOARD ===== */
.dash{padding:18px 18px 28px;display:grid;grid-template-columns:340px 1fr;gap:14px;max-width:1080px;margin:0 auto;width:100%;align-items:start}

/* summary panel (dark, signature) */
.sum{background:linear-gradient(160deg,var(--ink) 0%,var(--ink2) 60%,var(--ink3) 100%);border-radius:20px;padding:22px;color:#fff;position:relative;overflow:hidden}
.sum::after{content:'';position:absolute;top:-60px;right:-60px;width:200px;height:200px;background:radial-gradient(circle,rgba(79,70,229,.35),transparent 70%)}
.sum-top{position:relative;z-index:1;margin-bottom:20px}
.sum-no{font-family:var(--disp);font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:6px}
.sum-name{font-family:var(--disp);font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-.3px;margin-bottom:12px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:5px 12px;border-radius:99px}
.pill.blue{background:rgba(79,70,229,.25);color:#c7d2fe;border:1px solid rgba(129,140,248,.4)}
.pill.amber{background:rgba(245,158,11,.16);color:#fcd34d;border:1px solid rgba(245,158,11,.35)}
.pill.green{background:rgba(16,185,129,.16);color:#6ee7b7;border:1px solid rgba(16,185,129,.35)}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px currentColor;opacity:.9}

/* ring */
.ring-wrap{position:relative;z-index:1;display:flex;align-items:center;gap:18px;padding:18px 0;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08)}
.ring{position:relative;width:96px;height:96px;flex-shrink:0}
.ring svg{transform:rotate(-90deg)}
.ring-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-num{font-family:var(--disp);font-size:30px;font-weight:700;line-height:1}
.ring-unit{font-size:9px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.5);margin-top:2px}
.ring-info .rl{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:600;margin-bottom:4px}
.ring-info .rv{font-family:var(--disp);font-size:15px;font-weight:600}
.ring-info .rs{font-size:12px;color:rgba(255,255,255,.6);margin-top:8px;line-height:1.4}
.done-badge{width:96px;height:96px;flex-shrink:0;border-radius:50%;background:rgba(16,185,129,.14);border:1px solid rgba(16,185,129,.4);display:flex;align-items:center;justify-content:center;font-size:40px}

/* items inside summary */
.sum-items{position:relative;z-index:1;margin-top:18px}
.sum-items .il{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:600;margin-bottom:10px}
.iline{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.iline:last-child{border-bottom:none}
.iname{font-size:13px;font-weight:500;color:rgba(255,255,255,.9);line-height:1.3}
.iqty{font-family:var(--disp);font-size:12px;font-weight:600;color:#c7d2fe;background:rgba(79,70,229,.2);border:1px solid rgba(129,140,248,.3);padding:2px 9px;border-radius:99px;flex-shrink:0}

/* right column */
.col{display:flex;flex-direction:column;gap:14px;min-width:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden}
.card-h{display:flex;align-items:center;justify-content:space-between;padding:15px 20px;border-bottom:1px solid var(--line)}
.card-h .t{font-family:var(--disp);font-size:13px;font-weight:600;letter-spacing:.3px}
.live-tag{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--grn)}
.live-tag i{width:7px;height:7px;border-radius:50%;background:var(--grn);animation:blink 1.4s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
.cn{font-family:var(--disp);font-size:12px;font-weight:600;color:var(--acc);background:#eef0ff;border:1px solid #dfe1ff;padding:4px 11px;border-radius:99px}

/* stepper (horizontal) */
.step{display:flex;padding:20px 20px 18px}
.st{flex:1;position:relative;text-align:center;min-width:0}
.st::before{content:'';position:absolute;top:9px;left:-50%;width:100%;height:2px;background:var(--line);z-index:0}
.st:first-child::before{display:none}
.st.done::before,.st.current::before{background:linear-gradient(90deg,var(--acc),var(--acc2))}
.st .d{position:relative;z-index:1;width:20px;height:20px;border-radius:50%;margin:0 auto 9px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff}
.st.done .d{background:var(--acc);border-color:var(--acc)}
.st.current .d{background:#fff;border-color:var(--acc);box-shadow:0 0 0 4px rgba(79,70,229,.15)}
.st.current .d::after{content:'';width:8px;height:8px;border-radius:50%;background:var(--acc)}
.st .sl{font-size:12.5px;font-weight:600;color:var(--txt);margin-bottom:2px}
.st.pending .sl{color:var(--txt3)}
.st .ss{font-size:10.5px;color:var(--txt3);line-height:1.3;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* courier events (scroll panel) */
.events{padding:6px 20px 8px;max-height:300px;overflow-y:auto}
.ev{display:flex;gap:13px;padding:11px 0;border-bottom:1px solid var(--line)}
.ev:last-child{border-bottom:none}
.ev-dot{width:30px;height:30px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px}
.ev-dot.active{background:#eef0ff;border:1px solid #dfe1ff}
.ev-dot.done{background:#f1f5f9;border:1px solid var(--line)}
.ev-l{font-size:13px;font-weight:600;color:var(--txt);display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.35}
.ev-now{font-size:9px;font-weight:700;letter-spacing:.5px;color:var(--acc);background:#eef0ff;border:1px solid #dfe1ff;padding:1px 7px;border-radius:5px}
.ev-t{font-size:11.5px;color:var(--txt3);margin-top:2px}
.ev-load{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--txt3);padding:14px 0}
.ev-load i{width:8px;height:8px;border-radius:50%;background:var(--acc);animation:blink 1s infinite}
.ev-empty{font-size:13px;color:var(--txt3);padding:14px 0}
.track-link{display:block;width:100%;border:none;border-top:1px solid var(--line);background:transparent;font-family:var(--body);font-size:13px;font-weight:600;color:var(--acc);padding:13px;text-align:center;cursor:pointer;transition:.2s}
.track-link:hover{background:#f7f8ff}

/* making note */
.mnote{display:flex;gap:13px;align-items:center;padding:16px 20px;background:linear-gradient(100deg,#eef0ff,#f0fdff);border:1px solid #e0e7ff;border-radius:20px}
.mnote .mi{width:40px;height:40px;flex-shrink:0;border-radius:12px;background:#fff;border:1px solid #e0e7ff;display:flex;align-items:center;justify-content:center;font-size:20px}
.mnote .mt{font-size:13.5px;font-weight:700;margin-bottom:2px}
.mnote .mb{font-size:12px;color:var(--txt2);line-height:1.45}

.reset{background:transparent;border:none;color:var(--txt3);font-family:var(--body);font-size:12px;font-weight:600;cursor:pointer;padding:4px 8px;border-radius:8px}
.reset:hover{color:var(--txt);background:#fff}

/* ===== responsive ===== */
@media(max-width:860px){
  .dash{grid-template-columns:1fr;padding:14px;gap:12px}
  .sum{padding:20px}
  .events{max-height:230px}
  .search h1{font-size:28px}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

/* ---------- courier events sub-view ---------- */
function CourierEvents({ events }: { events: any[] | null }) {
  const icons = ['🚚', '📦', '🏢', '➡️', '✅', '📍', '🔄', '↩️', '📋', '🏠', '🎯']
  if (!events) return <div className="ev-load"><i />Fetching live courier status…</div>
  if (events.length === 0) return <div className="ev-empty">Tracking info not available yet.</div>
  return (
    <>
      {events.map((ev, i) => (
        <div key={i} className="ev">
          <div className={`ev-dot ${ev.state}`}>{icons[i] || '📍'}</div>
          <div style={{ minWidth: 0 }}>
            <div className="ev-l">{ev.label}{ev.state === 'active' && <span className="ev-now">LATEST</span>}</div>
            <div className="ev-t">{ev.time}</div>
          </div>
        </div>
      ))}
    </>
  )
}

/* ---------- circular ring ---------- */
function Ring({ prog, days }: { prog: number; days: number }) {
  const r = 42, c = 2 * Math.PI * r
  const off = c * (1 - prog / 100)
  return (
    <div className="ring">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4F46E5" />
            <stop offset="1" stopColor="#06B6D4" />
          </linearGradient>
        </defs>
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="7" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="url(#rg)" strokeWidth="7"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset .9s ease' }} />
      </svg>
      <div className="ring-mid">
        <div className="ring-num">{days}</div>
        <div className="ring-unit">day{days === 1 ? '' : 's'} left</div>
      </div>
    </div>
  )
}

export default function TrackPage() {
  const [tab, setTab] = useState<'order' | 'phone'>('order')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrackingResult | null>(null)
  const [courierEvents, setCourierEvents] = useState<any[] | null | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)

  /* auto-resize the parent iframe (Shopify listens for {type:'resize', height}).
     Only fires when the height genuinely changes, so it can never feed back into itself. */
  const lastH = useRef(0)
  useEffect(() => {
    const send = () => {
      const el = rootRef.current
      if (!el) return
      const h = Math.ceil(el.getBoundingClientRect().height) + 16
      if (Math.abs(h - lastH.current) < 4) return   // ignore sub-pixel / no change → no loop
      lastH.current = h
      try { window.parent?.postMessage({ type: 'resize', height: h }, '*') } catch {}
    }
    send()
    const ro = new ResizeObserver(() => window.requestAnimationFrame(send))
    if (rootRef.current) ro.observe(rootRef.current)
    window.addEventListener('load', send)
    const t = setTimeout(send, 500)
    return () => { ro.disconnect(); window.removeEventListener('load', send); clearTimeout(t) }
  }, [result, courierEvents, error, loading, tab])

  async function handleTrack() {
    if (!query.trim()) {
      setError('Enter your ' + (tab === 'order' ? 'order number to continue.' : 'phone number to continue.'))
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
      if (!res.ok) { setError(data.error || 'We couldn’t find that order. Check the number and try again.'); return }
      setResult(data)
      if ((data.order.status === 'shipped' || data.order.status === 'delivered') && data.order.trackingId) {
        setCourierEvents(null)
        const cc = await fetchCallCourier(data.order.trackingId)
        setCourierEvents(cc.ok ? cc.data.events : [])
      }
    } catch {
      setError('Network error. Please try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  function switchTab(t: 'order' | 'phone') {
    setTab(t); setQuery(''); setError('')
  }
  function reset() {
    setResult(null); setCourierEvents(undefined); setQuery(''); setError('')
  }

  const o = result?.order
  const courierDone = isCourierDelivered(courierEvents)
  const cd = o ? calcCountdown(o, courierDone) : null
  const delivered = o ? (o.status === 'delivered' || courierDone) : false
  const shipped = o?.status === 'shipped'
  const inProcess = o?.status === 'in_process'
  const pillCls = delivered ? 'green' : shipped ? 'amber' : 'blue'
  const stages = o ? buildStages(o, result!.history, courierDone) : []

  return (
    <div className="app" ref={rootRef}>
      <style>{css}</style>

      <div className="bar">
        <span className="brand">MY<b>ZAN</b></span>
        <span className="bar-sub">Order Tracker</span>
        {o && <span className="bar-right">#{o.orderNumber}</span>}
      </div>

      {/* ---------- SEARCH ---------- */}
      {!result && (
        <div className="stage">
          <div className="search">
            <div className="eyebrow">Live order status</div>
            <h1>Track your order</h1>
            <p>Enter your order number or phone number to see the real-time status, delivery window, and courier updates — all on one screen.</p>

            <div className="seg">
              <button className={tab === 'order' ? 'on' : ''} onClick={() => switchTab('order')}>Order number</button>
              <button className={tab === 'phone' ? 'on' : ''} onClick={() => switchTab('phone')}>Phone number</button>
            </div>
            <div className="field">
              <input
                type={tab === 'phone' ? 'tel' : 'text'}
                placeholder={tab === 'order' ? 'e.g. 2087' : 'e.g. 03001234567'}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTrack()}
                autoFocus
              />
              <button className="go" onClick={handleTrack} disabled={loading}>
                {loading ? 'Searching…' : 'Track'}
              </button>
            </div>
            {error && <div className="alert">{error}</div>}
            <div className="trust">
              <span><b>●</b> Real-time courier feed</span>
              <span><b>●</b> No account needed</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------- DASHBOARD ---------- */}
      {o && (
        <div className="dash">
          {/* LEFT — summary */}
          <div className="sum">
            <div className="sum-top">
              <div className="sum-no">Order #{o.orderNumber}</div>
              <div className="sum-name">{o.customerName || 'Your order'}</div>
              <span className={`pill ${pillCls}`}><i />{delivered ? 'Delivered' : STATUS_LABEL[o.status]}</span>
            </div>

            <div className="ring-wrap">
              {delivered ? (
                <>
                  <div className="done-badge">✓</div>
                  <div className="ring-info">
                    <div className="rl">Delivered on</div>
                    <div className="rv">{fmtDate(o.updatedAt)}</div>
                    <div className="rs">Thanks for shopping with Myzan.</div>
                  </div>
                </>
              ) : cd ? (
                <>
                  <Ring prog={cd.prog} days={cd.daysLeft} />
                  <div className="ring-info">
                    <div className="rl">{shipped ? 'Out for delivery' : 'Est. delivery'}</div>
                    <div className="rv">{shipped ? `By ${cd.maxDate}` : cd.estRange}</div>
                    <div className="rs">{shipped ? 'On the way with the courier.' : `Confirmed ${cd.startFmt}`}</div>
                  </div>
                </>
              ) : (
                <div className="ring-info">
                  <div className="rl">Estimated delivery</div>
                  <div className="rv">10–15 days</div>
                  <div className="rs">after confirmation</div>
                </div>
              )}
            </div>

            {(o.lineItems || []).length > 0 && (
              <div className="sum-items">
                <div className="il">Items ({o.lineItems.length})</div>
                {o.lineItems.map((it, i) => (
                  <div key={i} className="iline">
                    <span className="iname">{it.name}</span>
                    <span className="iqty">×{it.quantity}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT — progress + tracking */}
          <div className="col">
            {inProcess && (
              <div className="mnote">
                <div className="mi">🎨</div>
                <div>
                  <div className="mt">Crafting your order</div>
                  <div className="mb">We’re carefully making your custom skin. You’ll get an update the moment it ships.</div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-h"><span className="t">Progress</span></div>
              <div className="step">
                {stages.map((s, i) => (
                  <div key={i} className={`st ${s.state}`}>
                    <div className="d">{s.state === 'done' ? '✓' : ''}</div>
                    <div className="sl">{s.label}</div>
                    <div className="ss">{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {(shipped || delivered) && o.trackingId && (
              <div className="card">
                <div className="card-h">
                  <span className="t">Live courier tracking</span>
                  <span className="cn">{o.trackingId}</span>
                </div>
                <div className="events">
                  <CourierEvents events={courierEvents === undefined ? null : courierEvents} />
                </div>
                <button
                  className="track-link"
                  onClick={() => {
                    if (o.trackingId) navigator.clipboard?.writeText(o.trackingId).catch(() => {})
                    window.open(`https://callcourier.com.pk/tracking/?tc=${o.trackingId}`, '_blank')
                  }}
                >
                  Open on Call Courier · CN copied ✓
                </button>
              </div>
            )}

            <div style={{ textAlign: 'center' }}>
              <button className="reset" onClick={reset}>← Track another order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
