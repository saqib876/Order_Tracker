'use client'

import { useState } from 'react'

type OrderStatus = 'in_process' | 'shipped' | 'delivered'

const STATUS_LABEL: Record<OrderStatus, string> = {
  in_process: 'In Process',
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
  const d1 = new Date(a); d1.setHours(0,0,0,0)
  const d2 = new Date(b); d2.setHours(0,0,0,0)
  return Math.floor((d2.getTime()-d1.getTime())/86400000)
}
function todayStr() { const t=new Date(); t.setHours(0,0,0,0); return t.toISOString().slice(0,10) }
function fmtShort(d: Date) { return d.toLocaleDateString('en-PK',{day:'numeric',month:'short'}) }
function fmtFull(d: Date) { return d.toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}) }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}) }
function fmtDateTime(iso: string) { return new Date(iso).toLocaleString('en-PK',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) }

function calcCountdown(order: TrackingResult['order']) {
  const today = todayStr()
  if (order.status==='in_process') {
    const confirmed=new Date(order.createdAt); confirmed.setHours(0,0,0,0)
    const maxD=new Date(confirmed); maxD.setDate(confirmed.getDate()+10)
    const minD=new Date(confirmed); minD.setDate(confirmed.getDate()+7)
    const passed=daysBetween(order.createdAt,today)
    const daysLeft=Math.max(1,10-passed)
    const prog=Math.min(95,Math.round((passed/10)*100))
    return { daysLeft, prog, startFmt:fmtFull(confirmed), maxDate:fmtFull(maxD), estRange:`${fmtShort(minD)} – ${fmtFull(maxD)}`, shippedMode:false }
  }
  if (order.status==='shipped' && order.shippedAt) {
    const shipped=new Date(order.shippedAt); shipped.setHours(0,0,0,0)
    const deadlineD=new Date(shipped); deadlineD.setDate(shipped.getDate()+3)
    const passed=daysBetween(order.shippedAt,today)
    const daysLeft=Math.max(1,3-passed)
    const prog=Math.min(95,Math.round((passed/3)*100))
    return { daysLeft, prog, startFmt:fmtFull(shipped), maxDate:fmtFull(deadlineD), estRange:'', shippedMode:true }
  }
  return null
}

async function fetchPostEx(trackingId: string): Promise<{ok:boolean;data?:any}> {
  try {
    const res=await fetch(`https://api.postex.pk/services/integration/api/order/v3/track-order?trackingNumber=${trackingId}`,{
      headers:{'token':process.env.NEXT_PUBLIC_POSTEX_TOKEN||''},
    })
    if (!res.ok) return {ok:false}
    const json=await res.json()
    if (json?.statusCode===200 && json?.dist?.length) {
      const events=json.dist.map((ev:any,i:number)=>({
        label:ev.orderStatus||ev.status, time:ev.dateTime||ev.date||'', state:i===0?'active':'done',
      }))
      return {ok:true,data:{events}}
    }
    return {ok:false}
  } catch { return {ok:false} }
}

function buildTimeline(order: TrackingResult['order'], history: TrackingResult['history']) {
  const isDelivered=order.status==='delivered'
  const isShipped=order.status==='shipped'
  const historyTime=(s:string)=>{
    const entry=history.find(h=>h.status===s)
    return entry?fmtDateTime(entry.changed_at):'Completed'
  }
  if (isDelivered) return [
    {dot:'green',label:'Delivered',sub:historyTime('delivered'),tag:null},
    {dot:'blue',label:'Shipped',sub:`Tracking ID: ${order.trackingId}`,tag:null},
    {dot:'blue',label:'Making in Progress',sub:'Completed',tag:null},
    {dot:'blue',label:'Order Confirmed',sub:fmtDate(order.createdAt),tag:null},
  ]
  if (isShipped) return [
    {dot:'amber',label:'Shipped',sub:`Tracking ID: ${order.trackingId}`,tag:'current'},
    {dot:'blue',label:'Making in Progress',sub:'Completed',tag:null},
    {dot:'blue',label:'Order Confirmed',sub:fmtDate(order.createdAt),tag:null},
  ]
  return [
    {dot:'blue',label:'In Process',sub:'In progress',tag:'current'},
    {dot:'green',label:'Order Confirmed',sub:fmtDate(order.createdAt),tag:null},
  ]
}

function PostExEvents({events}:{events:any[]|null}) {
  const icons=['🚚','📦','✅']
  if (!events) return <div className="ps-loading"><div className="ps-dot"/>Fetching live status…</div>
  if (events.length===0) return <div style={{fontSize:13,color:'#888'}}>Status not available yet.</div>
  return <>
    {events.map((ev,i)=>(
      <div key={i} className="ps-row">
        <div className={`ps-icon ${ev.state}`}>{icons[i]||'📍'}</div>
        <div className="ps-info">
          <div className="ps-name">{ev.label}{ev.state==='active'&&<span className="ps-current-tag">NOW</span>}</div>
          <div className="ps-time">{ev.time}</div>
        </div>
      </div>
    ))}
  </>
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f0f6ff}
.wrap{background:#f0f6ff;min-height:100vh;padding:0 0 48px;font-family:'Inter',sans-serif}

.topbar{background:#fff;border-bottom:1px solid #dde8f5;padding:14px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10}
.logo{background:#0A85D1;color:#fff;font-weight:800;font-size:12px;letter-spacing:1.5px;padding:5px 11px;border-radius:6px}
.app-sub{font-size:12px;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;font-weight:500}

.inner{max-width:520px;margin:0 auto;padding:0 16px}

.tabs{display:flex;gap:6px;margin:16px 0 10px}
.tab{flex:1;padding:10px;font-size:13px;font-weight:600;cursor:pointer;border-radius:8px;color:#555;background:#e8f0fb;border:1px solid #d0e2f5;font-family:'Inter',sans-serif;transition:all .2s}
.tab.active{background:#0A85D1;color:#fff;border-color:#0A85D1}

.search-row{display:flex;gap:8px;margin-bottom:20px}
.search-row input{flex:1;background:#fff;border:1px solid #d0e2f5;border-radius:8px;padding:11px 14px;color:#111;font-family:'Inter',sans-serif;font-size:14px;outline:none;transition:border .2s}
.search-row input::placeholder{color:#aac4df}
.search-row input:focus{border-color:#0A85D1}
.search-btn{background:#0A85D1;color:#fff;border:none;padding:11px 20px;border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;cursor:pointer;font-weight:700;white-space:nowrap}
.search-btn:hover{background:#0977bc}
.search-btn:disabled{background:#93c5fd;cursor:not-allowed;color:#fff}

.hero{background:linear-gradient(135deg,#0A85D1,#0967a8);padding:24px 20px 20px;margin-bottom:1px}
.hero-order{font-size:11px;color:rgba(255,255,255,.55);letter-spacing:2px;text-transform:uppercase;font-weight:600;margin-bottom:6px}
.hero-name{font-size:26px;font-weight:800;color:#fff;margin-bottom:14px;letter-spacing:-.3px}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.badge{font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px}
.badge-status{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)}
.badge-date{background:rgba(255,255,255,.08);color:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.12)}
.badge-delivered{background:#052e16;color:#4ade80;border:1px solid #16a34a55}
.badge-shipped{background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.25)}

.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#d0e2f5;margin-bottom:1px}
.info-card{background:#fff;padding:16px 18px}
.info-label{font-size:11px;color:#888;letter-spacing:.5px;margin-bottom:5px;font-weight:500;text-transform:uppercase}
.info-value{font-size:15px;font-weight:700;color:#111}
.info-value.blue{color:#0A85D1}
.info-value.green{color:#22c55e}
.info-value.sm{color:#888;font-size:13px;font-weight:500}

.note-card{background:#e8f5fc;border-left:3px solid #0A85D1;padding:14px 16px;margin-bottom:1px;display:flex;gap:12px;align-items:flex-start}
.note-dot{width:8px;height:8px;background:#0A85D1;border-radius:50%;flex-shrink:0;margin-top:5px}
.note-title{font-size:13px;font-weight:700;color:#0967a8;margin-bottom:3px}
.note-text{font-size:12px;color:#0A85D1;line-height:1.6}

.countdown-card{background:#fff;border-top:1px solid #d0e2f5;padding:16px 18px;margin-bottom:1px}
.cd-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.cd-label{font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase;font-weight:600}
.cd-badge{font-size:12px;font-weight:700;color:#fff;background:#0A85D1;padding:4px 12px;border-radius:6px}
.cd-badge.amber{background:rgba(251,191,36,.12);color:#f59e0b;border:1px solid rgba(251,191,36,.25)}
.pbar{height:3px;background:#d0e2f5;border-radius:2px;margin-bottom:10px;overflow:hidden}
.pfill{height:100%;background:#0A85D1;border-radius:2px}
.cd-dates{display:flex;justify-content:space-between}
.cd-dates span{font-size:12px;color:#888}
.cd-dates .right{color:#0A85D1;font-weight:600}

.section-label{font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;padding:16px 18px 8px;font-weight:600}

.tl-wrap{background:#fff;border-top:1px solid #d0e2f5;border-bottom:1px solid #d0e2f5;margin-bottom:1px}
.tl-item{display:flex;gap:14px;position:relative;padding:14px 18px}
.tl-item:not(:last-child){border-bottom:1px solid #edf3fb}
.tl-line{display:none}
.dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;margin-top:4px}
.dot-blue{background:#0A85D1;box-shadow:0 0 0 3px rgba(10,133,209,.2)}
.dot-amber{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.2)}
.dot-green{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2)}
.dot-grey{background:#333}
.tl-status-text{font-size:14px;font-weight:700;color:#111;margin-bottom:3px;display:flex;align-items:center;gap:8px}
.tl-time{font-size:12px;color:#888}
.tl-tag{font-size:10px;color:#0A85D1;background:rgba(10,133,209,.12);padding:2px 8px;border-radius:4px;border:1px solid rgba(10,133,209,.3);font-weight:600}
.tl-tag-amber{font-size:10px;color:#f59e0b;background:rgba(245,158,11,.1);padding:2px 8px;border-radius:4px;border:1px solid rgba(245,158,11,.25);font-weight:600}

.postex-wrap{background:#fff;border-top:1px solid #d0e2f5;border-bottom:1px solid #d0e2f5;margin-bottom:1px;overflow:hidden}
.postex-head{padding:12px 18px;border-bottom:1px solid #d0e2f5;background:#f0f8ff}
.postex-head-label{font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;font-weight:600}
.tid-row{padding:14px 18px;border-bottom:1px solid #edf3fb}
.tid-label{font-size:11px;color:#888;margin-bottom:4px}
.tid-value{font-size:16px;font-weight:700;color:#111;letter-spacing:1px}
.postex-status-area{padding:16px 18px}
.ps-loading{display:flex;align-items:center;gap:10px;font-size:13px;color:#888}
.ps-dot{width:8px;height:8px;border-radius:50%;background:#0A85D1;animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.ps-row{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.ps-row:last-child{margin-bottom:0}
.ps-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px}
.ps-icon.active{background:rgba(10,133,209,.15);border:1px solid rgba(10,133,209,.3)}
.ps-icon.done{background:#f0fdf4;border:1px solid #bbf7d0}
.ps-icon.pending{background:#f8fafc;border:1px solid #e2e8f0}
.ps-info{flex:1;padding-top:4px}
.ps-name{font-size:14px;font-weight:600;color:#111;margin-bottom:2px;display:flex;align-items:center;gap:8px}
.ps-time{font-size:12px;color:#888}
.ps-current-tag{font-size:10px;color:#0A85D1;background:rgba(10,133,209,.12);padding:2px 7px;border-radius:4px;border:1px solid rgba(10,133,209,.3);font-weight:600}
.postex-link{display:block;padding:12px 18px;border-top:1px solid #2a2d35;font-size:13px;color:#0A85D1;text-decoration:none;text-align:center;font-weight:500}
.postex-link:hover{background:#e8f5fc}

.items-wrap{background:#fff;border-top:1px solid #d0e2f5;border-bottom:1px solid #d0e2f5;overflow:hidden}
.item-row{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;border-bottom:1px solid #edf3fb}
.item-row:last-child{border-bottom:none}
.item-name{font-size:14px;color:#111;font-weight:600}
.item-qty{font-size:12px;color:#0A85D1;font-weight:700}

.error-box{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;color:#f87171;font-size:13px;margin-bottom:16px}
`

export default function TrackPage() {
  const [tab, setTab] = useState<'order'|'phone'>('order')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrackingResult|null>(null)
  const [postexEvents, setPostexEvents] = useState<any[]|null|undefined>(undefined)

  async function handleTrack() {
    if (!query.trim()) { setError('Please enter your '+(tab==='order'?'order number.':'phone number.')); return }
    setLoading(true); setError(''); setResult(null); setPostexEvents(undefined)
    try {
      const res=await fetch('/api/track',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(tab==='order'?{orderNumber:query.trim()}:{phone:query.trim()}),
      })
      const data=await res.json()
      if (!res.ok) { setError(data.error||'Order not found.'); return }
      setResult(data)
      if ((data.order.status==='shipped'||data.order.status==='delivered')&&data.order.trackingId) {
        setPostexEvents(null)
        const px=await fetchPostEx(data.order.trackingId)
        setPostexEvents(px.ok?px.data.events:[])
      }
    } catch { setError('Network error. Please try again.') }
    finally { setLoading(false) }
  }

  function switchTab(t:'order'|'phone') { setTab(t);setQuery('');setError('');setResult(null);setPostexEvents(undefined) }

  function renderResult() {
    if (!result) return null
    const o=result.order
    const isDelivered=o.status==='delivered'
    const isShipped=o.status==='shipped'
    const isInProcess=o.status==='in_process'
    const label=STATUS_LABEL[o.status]??o.status
    const cd=calcCountdown(o)

    const heroBadge=isDelivered?'badge badge-delivered':isShipped?'badge badge-shipped':'badge badge-status'

    const estCard=isDelivered
      ?<div className="info-card"><div className="info-label">Delivered on</div><div className="info-value green">{fmtDate(o.updatedAt)}</div></div>
      :<div className="info-card"><div className="info-label">Est. Delivery</div><div className="info-value blue sm">{cd?cd.estRange||`By ${cd.maxDate}`:'—'}</div></div>

    const noteBlock=isInProcess&&(
      <div className="note-card">
        <div className="note-dot"/>
        <div>
          <div className="note-title">Crafting your order</div>
          <div className="note-text">We're carefully making your custom order. We'll notify you once it ships.</div>
        </div>
      </div>
    )

    const countdownBlock=cd&&!isDelivered&&(
      <div className="countdown-card">
        <div className="cd-top">
          <span className="cd-label">{isShipped?'Delivery Window':'Delivery Countdown'}</span>
          <span className={`cd-badge${isShipped?' amber':''}`}>
            {isShipped?(cd.daysLeft===1?'Arriving soon':`${cd.daysLeft} days to deliver`):`${cd.daysLeft} day${cd.daysLeft===1?'':'s'} left`}
          </span>
        </div>
        <div className="pbar"><div className="pfill" style={{width:`${cd.prog}%`}}/></div>
        <div className="cd-dates">
          <span>{isShipped?`Shipped ${cd.startFmt}`:`Confirmed ${cd.startFmt}`}</span>
          <span className="right">By {cd.maxDate}</span>
        </div>
      </div>
    )

    const postexBlock=(isShipped||isDelivered)&&o.trackingId&&(
      <div className="postex-wrap">
        <div className="postex-head"><span className="postex-head-label">PostEx Live Tracking</span></div>
        <div className="tid-row">
          <div className="tid-label">Tracking ID</div>
          <div className="tid-value">{o.trackingId}</div>
        </div>
        <div className="postex-status-area">
          <PostExEvents events={postexEvents===undefined?null:postexEvents}/>
        </div>
        <a className="postex-link" href={o.postexUrl||`https://postex.pk/tracking/${o.trackingId}`} target="_blank" rel="noopener noreferrer">
          Open on PostEx website →
        </a>
      </div>
    )

    const timeline=buildTimeline(o,result.history)
    const tlItems=timeline.map((item,i)=>(
      <div key={i} className="tl-item">
        <div className={`dot dot-${item.dot}`}/>
        <div>
          <div className="tl-status-text">
            {item.label}
            {item.tag==='current'&&!isShipped&&<span className="tl-tag">current</span>}
            {item.tag==='current'&&isShipped&&<span className="tl-tag-amber">current</span>}
          </div>
          <div className="tl-time">{item.sub}</div>
        </div>
      </div>
    ))

    const itemsHTML=(o.lineItems||[]).map((item,i)=>(
      <div key={i} className="item-row">
        <span className="item-name">{item.name}</span>
        <span className="item-qty">×{item.quantity}</span>
      </div>
    ))

    return (
      <>
        <div className="hero">
          <div className="hero-order">Order #{o.orderNumber}</div>
          <div className="hero-name">{o.customerName||'Your Order'}</div>
          <div className="badges">
            <span className={heroBadge}>{label}</span>
            <span className="badge badge-date">{fmtDate(o.createdAt)}</span>
          </div>
        </div>

        <div className="info-grid">
          <div className="info-card"><div className="info-label">Ordered on</div><div className="info-value">{fmtDate(o.createdAt)}</div></div>
          {estCard}
        </div>

        {noteBlock}
        {countdownBlock}
        {postexBlock}

        <div className="section-label">Status History</div>
        <div className="tl-wrap">{tlItems}</div>

        {itemsHTML.length>0&&(
          <>
            <div className="section-label">Items</div>
            <div className="items-wrap">{itemsHTML}</div>
          </>
        )}
      </>
    )
  }

  return (
    <>
      <style>{css}</style>
      <div className="wrap">
        <div className="topbar">
          <div className="logo">MYZAN</div>
          <span className="app-sub">Order Tracker</span>
        </div>
        <div className="inner">
          <div className="tabs">
            <button className={`tab${tab==='order'?' active':''}`} onClick={()=>switchTab('order')}>Order Number</button>
            <button className={`tab${tab==='phone'?' active':''}`} onClick={()=>switchTab('phone')}>Phone Number</button>
          </div>
          <div className="search-row">
            <input
              type={tab==='phone'?'tel':'text'}
              placeholder={tab==='order'?'Enter order number e.g. 2087':'Enter phone e.g. 03001234567'}
              value={query}
              onChange={e=>setQuery(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handleTrack()}
            />
            <button className="search-btn" onClick={handleTrack} disabled={loading}>
              {loading?'Searching…':'Track →'}
            </button>
          </div>
          {error&&<div className="error-box">{error}</div>}
          <div>{renderResult()}</div>
        </div>
      </div>
    </>
  )
}
