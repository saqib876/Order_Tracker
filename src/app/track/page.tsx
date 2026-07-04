'use client'

import { useState, useEffect, useRef } from 'react'

type OrderStatus = 'in_process' | 'shipped' | 'delivered'

const STATUS_LABEL: Record<OrderStatus, string> = {
  in_process: 'In production',
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
  return label.includes('delivered')
}

/* Keep the courier's own status wording. Only tidy ALL-CAPS to readable case;
   never substitute or invent words. */
function prettyCourier(raw?: string): string {
  const t = (raw || '').trim()
  if (!t) return 'Status update'
  const letters = t.replace(/[^A-Za-z]/g, '')
  const isAllCaps = letters.length > 0 && letters === letters.toUpperCase()
  if (!isAllCaps) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
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
      label: prettyCourier(ev.ProcessDescForPortal || ev.OperationDesc),
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
    { label: 'Confirmed', sub: fmtDate(order.createdAt), state: 'done' as string },
    { label: 'Making', sub: shipped ? 'Completed' : 'In progress', state: shipped ? 'done' : 'current' },
    { label: 'Shipped', sub: order.trackingId ? `Tracking No ${order.trackingId}` : timeOf('shipped') || '—',
      state: done ? 'done' : shipped ? 'current' : 'pending' },
    { label: 'Delivered', sub: done ? (timeOf('delivered') || 'Completed') : 'Pending',
      state: done ? 'done' : 'pending' },
  ]
}

/* ---------- styles ---------- */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Jost:wght@500;600;700&family=Poppins:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#111111; --ink2:#17181B;
  --blue:#0A85D1; --blue-d:#0872B3; --blue-l:#38B6FF; --blue-bg:#EAF5FD; --blue-br:#CBE7F8;
  --canvas:#F2F5F8; --card:#FFFFFF; --line:#E6EAEF; --line2:#EFF2F6;
  --txt:#111111; --txt2:#5C6672; --txt3:#95A0AD;
  --grn:#16A34A; --grn-l:#4ED883;
  --red:#DC2626; --red-bg:#FDECEC;
  --disp:'Jost',sans-serif; --body:'Poppins',sans-serif;
}
html,body{background:var(--canvas)}
.app{font-family:var(--body);color:var(--txt);background:var(--canvas);display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow-x:hidden;width:100%;max-width:100%}

/* top bar */
.bar{height:62px;display:flex;align-items:center;gap:13px;padding:0 24px;background:rgba(255,255,255,.86);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.bar-sub{font-size:10.5px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--txt3)}
.bar-right{margin-left:auto;font-family:var(--disp);font-size:14px;font-weight:600;color:var(--blue);background:var(--blue-bg);border:1px solid var(--blue-br);padding:5px 14px;border-radius:99px;white-space:nowrap;flex-shrink:0}
.bar-reset{border:none;background:transparent;font-family:var(--body);font-size:13px;font-weight:600;color:var(--blue);cursor:pointer;padding:7px 11px;border-radius:9px;transition:.2s;display:flex;align-items:center;gap:5px;white-space:nowrap}
.bar-reset:hover{background:var(--blue-bg)}

/* ===== SEARCH ===== */
.stage{min-height:480px;display:flex;align-items:center;justify-content:center;padding:46px 16px}
.search{width:100%;max-width:456px;text-align:center}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:3.5px;text-transform:uppercase;color:var(--blue);margin-bottom:18px}
.search h1{font-family:var(--disp);font-size:42px;font-weight:600;line-height:1.06;letter-spacing:-.6px;margin-bottom:13px;color:var(--ink)}
.search p{font-size:14px;color:var(--txt2);line-height:1.65;margin-bottom:28px;max-width:406px;margin-left:auto;margin-right:auto}
.card-search{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:22px;box-shadow:0 24px 60px -28px rgba(17,25,40,.28)}
.seg{display:flex;background:var(--canvas);border:1px solid var(--line);border-radius:13px;padding:4px;margin-bottom:12px}
.seg button{flex:1;border:none;background:transparent;font-family:var(--body);font-size:13px;font-weight:600;color:var(--txt2);padding:9px 6px;border-radius:9px;cursor:pointer;transition:.2s;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.25}
.seg button small{font-size:9.5px;font-weight:500;color:inherit;opacity:.65}
.seg button.on{background:var(--ink);color:#fff;box-shadow:0 4px 14px -6px rgba(17,17,17,.5)}
.seg button.on small{opacity:.85}
.field{display:flex;gap:9px}
.field input{flex:1;background:var(--canvas);border:1.5px solid var(--line);border-radius:13px;padding:14px 17px;font-family:var(--body);font-size:15px;font-weight:500;color:var(--txt);outline:none;transition:.2s;min-width:0}
.field input::placeholder{color:var(--txt3);font-weight:400}
.field input:focus{border-color:var(--blue);background:#fff;box-shadow:0 0 0 4px rgba(10,133,209,.1)}
.go{border:none;background:var(--blue);color:#fff;font-family:var(--body);font-weight:600;font-size:14px;padding:0 25px;border-radius:13px;cursor:pointer;white-space:nowrap;transition:.15s;box-shadow:0 8px 18px -7px rgba(10,133,209,.6);flex-shrink:0}
.go:hover{background:var(--blue-d)}
.go:active{transform:scale(.97)}
.go:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
.trust{display:flex;gap:22px;justify-content:center;margin-top:22px;flex-wrap:wrap}
.trust span{font-size:11.5px;color:var(--txt3);font-weight:500;display:flex;align-items:center;gap:6px}
.trust b{color:var(--blue)}
.alert{background:var(--red-bg);border:1px solid #f7cccc;color:#b42323;font-size:13px;font-weight:500;padding:11px 14px;border-radius:11px;margin-top:14px;text-align:left}

/* ===== DASHBOARD ===== */
.dash{padding:22px 18px 32px;display:grid;grid-template-columns:356px minmax(0,1fr);gap:16px;max-width:1100px;margin:0 auto;width:100%;align-items:start}
.dash>*{min-width:0}
.cn{overflow-wrap:anywhere}

/* summary panel (light, on-brand) */
.sum{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:26px;color:var(--txt);position:relative;overflow:hidden;box-shadow:0 12px 34px -20px rgba(17,25,40,.22)}
.sum::before{content:'';position:absolute;inset:0;background:radial-gradient(300px 190px at 96% -10%,rgba(10,133,209,.07),transparent 62%);pointer-events:none}
.sum::after{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--blue),var(--blue-l))}
.sum-top{position:relative;z-index:1;margin-bottom:22px}
.sum-no{display:inline-flex;align-items:center;font-family:var(--disp);font-size:12.5px;font-weight:700;letter-spacing:1px;color:var(--blue-d);background:var(--blue-bg);border:1px solid var(--blue-br);padding:5px 14px;border-radius:99px;margin-bottom:13px}
.sum-name{font-family:var(--disp);font-size:27px;font-weight:600;line-height:1.14;letter-spacing:-.2px;margin-bottom:15px;color:var(--ink)}
.pill{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;padding:6px 15px;border-radius:99px}
.pill.blue{background:var(--blue-bg);color:var(--blue-d);border:1px solid var(--blue-br)}
.pill.green{background:#E7F7ED;color:#127a38;border:1px solid #BCE9CB}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor}

/* ring */
.ring-wrap{position:relative;z-index:1;display:flex;align-items:center;gap:22px;padding:20px 16px;margin:0 -2px;border-radius:16px;background:linear-gradient(135deg,rgba(10,133,209,.07),rgba(56,182,255,.02));border-top:1px solid var(--line2);border-bottom:1px solid var(--line2)}
.ring{position:relative;width:106px;height:106px;flex-shrink:0}
.ring svg{transform:rotate(-90deg)}
.ring-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-num{font-family:var(--disp);font-size:35px;font-weight:600;line-height:1;color:var(--ink)}
.ring-unit{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--txt3);margin-top:3px}
.ring-info .rl{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--txt3);font-weight:600;margin-bottom:6px}
.ofd{display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--blue-d);background:var(--blue-bg);border:1px solid var(--blue-br);padding:5px 12px;border-radius:99px;margin-bottom:10px}
.ofd i{width:6px;height:6px;border-radius:50%;background:var(--blue);box-shadow:0 0 8px rgba(10,133,209,.6);animation:blink 1.4s infinite}
.ring-info .rv{font-family:var(--disp);font-size:16px;font-weight:600;color:var(--ink);line-height:1.25}
.ring-info .rs{font-size:12px;color:var(--txt2);margin-top:9px;line-height:1.45}
.done-badge{width:106px;height:106px;flex-shrink:0;border-radius:50%;background:#E7F7ED;border:1px solid #BCE9CB;display:flex;align-items:center;justify-content:center;color:var(--grn)}

/* items */
.sum-items{position:relative;z-index:1;margin-top:22px}
.sum-items .il{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--txt3);font-weight:600;margin-bottom:13px}
.items-list{padding:6px 22px 16px}
.iline{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line2)}
.iline:last-child{border-bottom:none}
.iname{font-size:13px;font-weight:500;color:var(--txt);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.iqty{font-family:var(--disp);font-size:12px;font-weight:600;color:var(--txt2);background:var(--canvas);border:1px solid var(--line);padding:3px 11px;border-radius:99px;flex-shrink:0}

/* right column */
.col{display:flex;flex-direction:column;gap:16px;min-width:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 8px 26px -16px rgba(17,25,40,.18)}
.card-h{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:8px;padding:17px 22px;border-bottom:1px solid var(--line2)}
.card-h .t{font-family:var(--disp);font-size:15px;font-weight:600;letter-spacing:.2px;color:var(--ink);display:flex;align-items:center;gap:9px}
.cn{font-family:var(--disp);font-size:12px;font-weight:600;color:var(--blue);background:var(--blue-bg);border:1px solid var(--blue-br);padding:4px 13px;border-radius:99px;white-space:nowrap;flex-shrink:0}

/* stepper */
.step{display:flex;padding:24px 22px 22px}
.st{flex:1;position:relative;text-align:center;min-width:0}
.st::before{content:'';position:absolute;top:11px;left:-50%;width:100%;height:2px;background:var(--line);z-index:0}
.st:first-child::before{display:none}
.st.done::before,.st.current::before{background:linear-gradient(90deg,var(--blue),var(--blue-l))}
.st .d{position:relative;z-index:1;width:24px;height:24px;border-radius:50%;margin:0 auto 11px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;justify-content:center;color:#fff}
.st.done .d{background:var(--blue);border-color:var(--blue)}
.st.current .d{background:#fff;border-color:var(--blue);box-shadow:0 0 0 4px rgba(10,133,209,.14)}
.st.current .d::after{content:'';width:8px;height:8px;border-radius:50%;background:var(--blue)}
.st .sl{font-size:12.5px;font-weight:600;color:var(--txt);margin-bottom:3px}
.st.pending .sl{color:var(--txt3)}
.st .ss{font-size:10.5px;color:var(--txt3);line-height:1.3;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* live tracking header dot */
.live-i{width:7px;height:7px;border-radius:50%;background:var(--grn);box-shadow:0 0 8px var(--grn);animation:blink 1.4s infinite;flex-shrink:0}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}

/* courier timeline */
.tl{padding:8px 22px 6px}
.tl-i{display:flex;gap:15px;position:relative;padding-bottom:18px}
.tl-i:last-child{padding-bottom:6px}
.tl-i::before{content:'';position:absolute;left:5px;top:16px;bottom:0;width:2px;background:var(--line2)}
.tl-i:last-child::before{display:none}
.tl-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;margin-top:3px;position:relative;z-index:1;background:#CFE4F3}
.tl-i.active .tl-dot{background:var(--blue);box-shadow:0 0 0 4px rgba(10,133,209,.14)}
.tl-l{font-size:13px;font-weight:600;color:var(--txt);display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.35}
.tl-now{font-size:9px;font-weight:700;letter-spacing:.5px;color:#fff;background:var(--blue);padding:2px 8px;border-radius:5px}
.tl-t{font-size:11.5px;color:var(--txt3);margin-top:3px}
.tl-load{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--txt3);padding:16px 22px}
.tl-load i{width:8px;height:8px;border-radius:50%;background:var(--blue);animation:blink 1s infinite}
.tl-empty{font-size:13px;color:var(--txt3);padding:16px 22px}
.track-link{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;border:none;border-top:1px solid var(--line2);background:transparent;font-family:var(--body);font-size:13px;font-weight:600;color:var(--blue);padding:15px;cursor:pointer;transition:.2s}
.track-link:hover{background:var(--blue-bg)}
.track-link svg{width:14px;height:14px}

/* making note */
.mnote{display:flex;gap:15px;align-items:center;padding:18px 22px;background:linear-gradient(100deg,var(--blue-bg),#F3FAFF);border:1px solid var(--blue-br);border-radius:20px}
.mnote .mi{width:44px;height:44px;flex-shrink:0;border-radius:13px;background:#fff;border:1px solid var(--blue-br);display:flex;align-items:center;justify-content:center;color:var(--blue)}
.mnote .mi svg{width:22px;height:22px}
.mnote .mt{font-family:var(--disp);font-size:15px;font-weight:600;margin-bottom:3px;color:var(--ink)}
.mnote .mb{font-size:12px;color:var(--txt2);line-height:1.5}

.reset{background:transparent;border:none;color:var(--txt3);font-family:var(--body);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 10px;border-radius:9px;transition:.2s}
.reset:hover{color:var(--blue)}

/* responsive */
@media(max-width:880px){
  .dash{grid-template-columns:1fr;padding:16px 14px 26px;gap:14px}
  .sum{padding:22px}
  .search h1{font-size:33px}
}
@media(max-width:480px){
  .bar{padding:0 14px;gap:8px}
  .bar-reset{font-size:12px;padding:6px 8px}
  .bar-right{font-size:12px;padding:4px 11px}
  .cn{font-size:11px;padding:4px 10px}
}
@media(max-width:400px){
  .field{flex-direction:column}
  .go{width:100%;padding:13px 25px}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

/* ---------- courier vertical timeline ---------- */
function CourierEvents({ events }: { events: any[] | null }) {
  if (!events) return <div className="tl-load"><i />Fetching live courier status…</div>
  if (events.length === 0) return <div className="tl-empty">Tracking info not available yet.</div>
  return (
    <div className="tl">
      {events.map((ev, i) => (
        <div key={i} className={`tl-i ${ev.state}`}>
          <span className="tl-dot" />
          <div style={{ minWidth: 0 }}>
            <div className="tl-l">{ev.label}{ev.state === 'active' && <span className="tl-now">LATEST</span>}</div>
            <div className="tl-t">{ev.time}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Ring({ prog, days }: { prog: number; days: number }) {
  const r = 47, c = 2 * Math.PI * r
  const off = c * (1 - prog / 100)
  return (
    <div className="ring">
      <svg width="106" height="106" viewBox="0 0 106 106">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#38B6FF" />
            <stop offset="1" stopColor="#0A85D1" />
          </linearGradient>
        </defs>
        <circle cx="53" cy="53" r={r} fill="none" stroke="#E7EAEF" strokeWidth="6" />
        <circle cx="53" cy="53" r={r} fill="none" stroke="url(#rg)" strokeWidth="6"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset .9s ease', filter: 'drop-shadow(0 0 5px rgba(56,182,255,.45))' }} />
      </svg>
      <div className="ring-mid">
        <div className="ring-num">{days}</div>
        <div className="ring-unit">day{days === 1 ? '' : 's'} left</div>
      </div>
    </div>
  )
}

/* inline icons */
const IconSpark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15l.7 1.8L21.5 17.5 19.7 18.2 19 20l-.7-1.8L16.5 17.5 18.3 16.8 19 15z" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
)
const IconExt = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17L17 7M8 7h9v9" />
  </svg>
)
const IconStepCheck = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

export default function TrackPage() {
  const [tab, setTab] = useState<'order' | 'phone'>('order')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrackingResult | null>(null)
  const [courierEvents, setCourierEvents] = useState<any[] | null | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastH = useRef(0)

  /* auto-resize the parent iframe (Shopify listens for {type:'resize', height}).
     Fires only when the height genuinely changes, so it can't feed back into itself. */
  useEffect(() => {
    const send = () => {
      const el = rootRef.current
      if (!el) return
      const h = Math.ceil(el.getBoundingClientRect().height) + 16
      if (Math.abs(h - lastH.current) < 4) return
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

  function switchTab(t: 'order' | 'phone') { setTab(t); setQuery(''); setError('') }
  function reset() { setResult(null); setCourierEvents(undefined); setQuery(''); setError('') }

  const o = result?.order
  const courierDone = isCourierDelivered(courierEvents)
  const cd = o ? calcCountdown(o, courierDone) : null
  const delivered = o ? (o.status === 'delivered' || courierDone) : false
  const shipped = o?.status === 'shipped'
  const inProcess = o?.status === 'in_process'
  const pillCls = delivered ? 'green' : 'blue'
  const stages = o ? buildStages(o, result!.history, courierDone) : []
  /* Prefer the courier's own live status text. If the parcel hasn't reached
     the courier yet (no live events), fall back to the same status the
     progress bar is showing instead of a hardcoded "Out for delivery". */
  const latestCourierLabel = courierEvents && courierEvents.length > 0 ? courierEvents[0].label : null

  return (
    <div className="app" ref={rootRef}>
      <style>{css}</style>

      <div className="bar">
        {o ? (
          <button className="bar-reset" onClick={reset}>← Track another order</button>
        ) : (
          <span className="bar-sub">Order Tracker</span>
        )}
        {o && <span className="bar-right">#{o.orderNumber}</span>}
      </div>

      {/* SEARCH */}
      {!result && (
        <div className="stage">
          <div className="search">
            <div className="eyebrow">Live order status</div>
            <h1>Track your order</h1>
            <p>Enter your order number or phone number to see the real-time status, delivery window, and courier updates — all on one screen.</p>
            <div className="card-search">
              <div className="seg">
                <button className={tab === 'order' ? 'on' : ''} onClick={() => switchTab('order')}>
                  Order number
                  <small>Track with Order No</small>
                </button>
                <button className={tab === 'phone' ? 'on' : ''} onClick={() => switchTab('phone')}>
                  Phone number
                  <small>Track with Phone Number</small>
                </button>
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
            </div>
            <div className="trust">
              <span><b>●</b> Real-time courier feed</span>
              <span><b>●</b> No account needed</span>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD */}
      {o && (
        <div className="dash">
          {/* summary */}
          <div className="sum">
            <div className="sum-top">
              <div className="sum-no">Order #{o.orderNumber}</div>
              <div className="sum-name">{o.customerName || 'Your order'}</div>
              <span className={`pill ${pillCls}`}><i />{delivered ? 'Delivered' : STATUS_LABEL[o.status]}</span>
            </div>

            <div className="ring-wrap">
              {delivered ? (
                <>
                  <div className="done-badge"><IconCheck /></div>
                  <div className="ring-info">
                    <div className="rl">Delivered on</div>
                    <div className="rv">{fmtDate(o.updatedAt)}</div>
                    <div className="rs">Thank you for shopping with Myzan.</div>
                  </div>
                </>
              ) : cd ? (
                <>
                  <Ring prog={cd.prog} days={cd.daysLeft} />
                  <div className="ring-info">
                    {shipped
                      ? <span className="ofd"><i />{latestCourierLabel || STATUS_LABEL[o.status]}</span>
                      : <div className="rl">Est. delivery</div>}
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
          </div>

          {/* right */}
          <div className="col">
            {inProcess && (
              <div className="mnote">
                <div className="mi"><IconSpark /></div>
                <div>
                  <div className="mt">Crafting your order</div>
                  <div className="mb">We’re carefully making your order. You’ll get an update the moment it ships.</div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-h"><span className="t">Progress</span></div>
              <div className="step">
                {stages.map((s, i) => (
                  <div key={i} className={`st ${s.state}`}>
                    <div className="d">{s.state === 'done' ? <IconStepCheck /> : null}</div>
                    <div className="sl">{s.label}</div>
                    <div className="ss">{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {(shipped || delivered) && o.trackingId && (
              <div className="card">
                <div className="card-h">
                  <span className="t"><span className="live-i" />Live courier tracking</span>
                  <span className="cn">{o.trackingId}</span>
                </div>
                <CourierEvents events={courierEvents === undefined ? null : courierEvents} />
                <button
                  className="track-link"
                  onClick={() => {
                    if (o.trackingId) navigator.clipboard?.writeText(o.trackingId).catch(() => {})
                    const url = o.postexUrl || `https://callcourier.com.pk/tracking/?tc=${o.trackingId}`
                    window.open(url, '_blank')
                  }}
                >
                  Track on PostEx <IconExt />
                </button>
              </div>
            )}

            {(o.lineItems || []).length > 0 && (
              <div className="card">
                <div className="card-h"><span className="t">Items ({o.lineItems.length})</span></div>
                <div className="items-list">
                  {o.lineItems.map((it, i) => (
                    <div key={i} className="iline">
                      <span className="iname">{it.name}</span>
                      <span className="iqty">×{it.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
