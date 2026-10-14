import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  sendWhatsAppText,
  matchQna,
  matchQnaDetailed,
  getGreetingMessage,
  getTopicAnswer,
  getTrackLinkAnswer,
} from '@/lib/whatsapp'
import { MANUAL_REASON_REPLY, MANUAL_REASON_LABEL } from '@/lib/intents'
import { noteForCourierStage, noteToWhatsAppText } from '@/lib/courierNotes'
import { classifyCourierStage, courierApiUrl } from '@/lib/courierStatus'
import type { CourierStage } from '@/lib/courierStatus'
import { phoneVariants, extractIncomingText, isJunkMessage } from '@/lib/messageParse'
import { planReply, TRACK_LINK } from '@/lib/replyPlan'
import { ocrAvailable, whatsappMedia, readTextFromImage } from '@/lib/ocr'
import { readOrderScreenshot, confirmationVariants } from '@/lib/orderScreenshot'

export const dynamic = 'force-dynamic'
// Tasveer download + parhne mein chand second lagte hain
export const maxDuration = 30

const trackingUrl = (id: string) => `https://postex.pk/tracking?cn=${id}`
const WEBSITE_TRACKING_LINK = 'https://myzan.net/pages/track-your-order'
const MIN_WORKING_DAYS = 10
const MAX_WORKING_DAYS = 15

// Ek hi order ki tracking isi customer ko is waqt ke andar dobara nahi jati
const TRACKING_REPEAT_HOURS = Number(process.env.TRACKING_REPEAT_HOURS) || 24
// Model available hai ya nahi — is ke jawab ki pehli line
const AVAILABLE_LINE = '*Yes Available*'
// Bot ne order number maanga ho to itni der tak us ke jawab ka intezaar
const ASK_STATE_HOURS = 24
// Bilkul wohi message isi number ko itni dair tak dobara nahi jata. Customer
// aksar ek hi baat do message mein likhta hai ("order status?" phir "kab
// milega?") — pehle dono ka alag alag jawab jata tha, yani do dafa paisa.
const SAME_REPLY_MINUTES = Number(process.env.SAME_REPLY_MINUTES) || 15

// Jab order ka pata hi na chale — ye message customer ko jata hai
const ORDER_INFO_MAANGO = [
  'Please Apna ( Text Msg Ma Type Kr K Send Kr Dain )',
  '',
  'Order Number (Jaise 40981), ',
  'Confirmation Number (Jaise #N8FNNZAKE) ',
  'Ya Jis Mobile Number Se Order Kiya Tha Wo Bhej Dein — Main Abhi Check Karti Hun.',
].join('\n')

// 4-step model jo customer ko dikhta hai (WhatsApp message ke liye) -
// underlying Supabase 'status' column abhi bhi 6 values rakh sakta hai
// (website ka apna progress bar isi purane 6-step data pe chalta rahega,
// hum sirf WhatsApp ke message ke liye inhe group kar rahe hain)
const WA_STEP: Record<string, number> = {
  in_process: 1,
  packed: 1,
  ready_to_ship: 1,
  printing_done: 2,
  shipped: 3,
  delivered: 4,
  cancelled: 0,
}

const WA_STATUS_LABEL: Record<string, string> = {
  in_process: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  packed: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  ready_to_ship: 'Aapka order process ho chuka hai aur abhi Making Process mein hai, ready ho raha hai',
  printing_done: 'Order ki printing mukammal ho chuki hai',
  shipped: 'Aap ka order dispatch ho chuka hai aur raaste mein hai',
  delivered: 'Aap ka order deliver ho chuka hai',
  cancelled: 'Aap ka order cancel ho chuka hai',
}

// Server UTC mein chalta hai (Vercel default), lekin customer/website Pakistan
// time use karta hai. Intl API se seedha Asia/Karachi ki calendar date nikalte
// hain - ye guaranteed sahi rahega chahe server kisi bhi timezone mein chale,
// aur date exactly Pakistan midnight (raat 12 baje) pe hi change hogi.
function toPakistanDateOnly(d: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(d)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)
  return new Date(y, m - 1, day) // midnight, calendar-only date
}

function pakistanNow(): Date {
  return toPakistanDateOnly(new Date())
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

function progressBar(step: number, total = 4): string {
  return '🟩'.repeat(step) + '⬜'.repeat(total - step)
}

// N working days (Mon-Sat, Sunday off) aage badhata hai - hamesha Pakistan
// calendar date se normalize karke shuru karta hai
function addWorkingDays(start: Date, days: number): Date {
  const result = toPakistanDateOnly(start)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    if (result.getDay() !== 0) added++ // 0 = Sunday
  }
  return result
}

// Do dates ke beech kitne working days (Mon-Sat) hain - dono ko Pakistan
// calendar date mein normalize karke compare karta hai
function workingDaysBetween(from: Date, to: Date): number {
  const start = toPakistanDateOnly(from)
  const end = toPakistanDateOnly(to)
  if (end <= start) return 0
  let count = 0
  const cur = new Date(start)
  while (cur < end) {
    cur.setDate(cur.getDate() + 1)
    if (cur.getDay() !== 0) count++
  }
  return count
}

function prettyCourier(raw?: string): string {
  const t = (raw || '').trim()
  if (!t) return ''
  const letters = t.replace(/[^A-Za-z]/g, '')
  const isAllCaps = letters.length > 0 && letters === letters.toUpperCase()
  if (!isAllCaps) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function fmtCourierTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function daysForCourierStage(stage: CourierStage): number {
  switch (stage) {
    case 'out_for_delivery': return 0
    case 'near': return 1
    case 'in_transit': return 2
    case 'undelivered': return 1
    case 'contacting': return 1
    default: return 3
  }
}

// Call Courier ki live tracking API - koi auth token nahi chahiye
async function fetchLatestCourierRaw(trackingId: string): Promise<{ label: string; time: string } | null> {
  try {
    const res = await fetch(courierApiUrl(trackingId), { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    if (!Array.isArray(json) || json.length === 0) return null

    const sorted = [...json].sort(
      (a: any, b: any) => new Date(b.TransactionDate).getTime() - new Date(a.TransactionDate).getTime()
    )
    const latest = sorted[0]
    const label = prettyCourier(latest.ProcessDescForPortal || latest.OperationDesc)
    if (!label) return null
    return { label, time: fmtCourierTime(latest.TransactionDate) }
  } catch {
    return null
  }
}

async function buildStatusReply(order: any): Promise<string> {
  const status = (order.status || '').toLowerCase()
  const step = WA_STEP[status] ?? 1
  const label = WA_STATUS_LABEL[status] || `Status: ${order.status}`
  const orderDate = new Date(order.shopify_created_at || order.created_at)

  const lines = [
    `📦 *Order #${order.order_number} Update*`,
    '',
    `Order Confirm Date: ${formatDate(orderDate)}`,
    '',
    `Status: ${label} (Step ${step}/4)`,
    progressBar(step),
  ]

  // Cancel ho chuke order par delivery ka koi hisaab kitaab nahi banta.
  if (status === 'cancelled') {
    lines.push('')
    lines.push('❌ Ye order cancel ho chuka hai. Agar aap ko koi ghalat fehmi lagti hai to hamein message kar dein.')
    return lines.join('\n')
  }

  const hasTracking = Boolean(order.tracking_id)

  // Courier ki live update ab SAB SE PEHLE nikalte hain, taake wo progress bar
  // ke foran neeche aa sake — customer ki nazar sab se pehle wahin parti hai.
  const latest = hasTracking ? await fetchLatestCourierRaw(order.tracking_id) : null
  const stage = latest ? classifyCourierStage(latest.label) : null

  if (latest) {
    lines.push('')
    lines.push(`📍 Latest Courier Update: ${latest.label} (${latest.time})`)
  }

  if (!hasTracking) {
    // Tracking add hone se PEHLE - website jaisa hi: order date + 10/15 calendar din
    const orderDatePK = toPakistanDateOnly(orderDate)
    const minDate = new Date(orderDatePK); minDate.setDate(orderDatePK.getDate() + MIN_WORKING_DAYS)
    const maxDate = new Date(orderDatePK); maxDate.setDate(orderDatePK.getDate() + MAX_WORKING_DAYS)
    const passed = workingDaysBetween(orderDate, pakistanNow())
    const daysLeft = Math.max(1, MAX_WORKING_DAYS - passed)

    lines.push('')
    lines.push(`📅 Total Delivery Time: ${MIN_WORKING_DAYS} to ${MAX_WORKING_DAYS} Working Days (Monday to Saturday)`)
    lines.push('')
    lines.push(`📅 Expected Delivery Date: ${formatDate(minDate)} to ${formatDate(maxDate)}`)
    lines.push('')
    lines.push(`⏳ Remaining: ${daysLeft} working day(s)`)
    lines.push('')
    lines.push(`🔗 Live tracking dekhein: ${WEBSITE_TRACKING_LINK}`)
  } else {
    // Tracking add ho chuki hai - live courier status se date adjust karte hain
    lines.push('')
    lines.push(`🚚 Tracking Number: ${order.tracking_id}`)
    lines.push(`🔗 Track here: ${trackingUrl(order.tracking_id)}`)

    if (status === 'delivered' || stage === 'delivered') {
      lines.push('')
      lines.push('✅ Aapka order deliver ho chuka hai. Shopping ke liye shukriya!')
    } else if (stage === 'returning') {
      // MOVED TO ORIGIN / REACHED AT ORIGIN / OUT FOR RETURN SUBMISSION /
      // RETURNED SUBMITTED — sab par ek hi tafseeli note jata hai.
      lines.push('')
      lines.push(noteToWhatsAppText(noteForCourierStage('returning', order.tracking_id)))
    } else {
      let expectedDate: Date

      if (stage) {
        // Live courier status ke hisaab se estimate
        expectedDate = addWorkingDays(pakistanNow(), daysForCourierStage(stage))
      } else {
        // Live data na mile to purana fallback: shipped date + 3 working days
        const { data: h } = await supabaseAdmin
          .from('order_status_history')
          .select('changed_at')
          .eq('order_id', order.id)
          .eq('status', 'shipped')
          .order('changed_at', { ascending: true })
          .limit(1)
          .single()
        expectedDate = h?.changed_at ? addWorkingDays(new Date(h.changed_at), 3) : addWorkingDays(pakistanNow(), 3)
      }

      const remaining = workingDaysBetween(pakistanNow(), expectedDate)
      lines.push('')
      lines.push(`📅 Expected Delivery Date: ${remaining === 0 ? 'Aaj (Today)' : formatDate(expectedDate)}`)
      if (remaining > 0) {
        lines.push('')
        lines.push(`⏳ Remaining: ${remaining} working day(s)`)
      }

      // In do stages mein customer ko khud rider/courier se raabta karna hai,
      // is liye Remaining ke baad poora Note bhi jata hai.
      if (stage === 'undelivered' || stage === 'contacting') {
        lines.push('')
        lines.push(noteToWhatsAppText(noteForCourierStage(stage, order.tracking_id)))
      }
    }
  }

  return lines.join('\n')
}

// Meta webhook verification (ek dafa, jab tum Webhook URL configure karte ho)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Incoming messages
export async function POST(req: NextRequest) {
  const payload = await req.json()

  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
  const incoming = extractIncomingText(message)
  if (!incoming) {
    // delivery/read receipts, reactions waghera — in par kuch nahi karna
    return NextResponse.json({ ok: true })
  }

  const from: string = message.from // already "923001234567" format
  const text = incoming.text.trim()

  // ── Tasveer / video bina caption ke ─────────────────────────────────────
  // Customer aksar sirf screenshot bhej deta hai, likhta kuch nahi. Teen
  // tarah ke screenshot aate hain: Orders page ("Order #49086"), Thank You
  // page ("Confirmation #8IVAKP0FY") aur Order details (email + number).
  //
  // Tareeqa:
  //   1. Tasveer parho (OCR) — us mein order/confirmation/courier number,
  //      phone ya email mil jaye to usi se order dhoond kar tracking
  //   2. Tasveer order ki na ho (design, cover ki photo) — bot khamosh
  //   3. OCR band ho ya na parh sake — bhejne wale ke apne number se dhoondo
  // Sirf TASVEER / document parhe jate hain. Voice note, video aur sticker
  // par bot kuch nahi karta — pehle voice note par bhi tracking chali jati thi.
  const tasveerHai = message?.type === 'image' || message?.type === 'document'

  if (!text) {
    if (tasveerHai) await tasveerKaJawab(message, from)
    return NextResponse.json({ ok: true })
  }

  const { data: state } = await supabaseAdmin
    .from('wa_conversation_state')
    .select('*')
    .eq('phone', from)
    .maybeSingle()

  const clearState = () =>
    supabaseAdmin.from('wa_conversation_state').delete().eq('phone', from)

  const askedBefore = isFreshAskState(state)
  const plan = planReply(text, { alreadyAskedForNumber: askedBefore })
  const { confirmationNumber, orderNumber, phoneInText, trackingCandidate, manualReason } = plan

  // ── Aam GREETING BAND hai ───────────────────────────────────────────────
  // Pehle har naye (aur 24 ghante baad wapas aane wale) customer ko "how to
  // place your order" wala message jata tha — pichhle 30 din mein 1096 dafa.
  // Meta ab har message ka paisa leta hai, is liye ye band kar diya gaya.
  //
  // Wo matan ab SIRF ek jagah jata hai: jab customer kisi model ki
  // availability poochhe ("Samsung A54 ka cover mil jayega?") — tab "Yes
  // Available" ke sath usi ek message mein (neeche 0b).
  //
  // Matan phir bhi Excel ki "Salaam / Greeting" row se aata hai, is liye wo
  // row file mein rehni chahiye.

  // ── 0a) "Apni picture wala cover bana dein" ──────────────────────────────
  // Customization ka sawaal. Jawab AAP ki Excel ki Customize wali row se
  // jata hai — pehle poora sawaal Q&A mein dhoondte hain (shayad aap ne
  // yehi jumla likh rakha ho), aur na mile to usi topic ka jawab bhej dete
  // hain taake customer chup na reh jaye.
  //
  // Ye order-status se PEHLE hai: warna "mujhe apni photo wala case
  // chahiye" par "apna order number bhejein" chala jata tha.
  if (plan.customization) {
    const mila = await matchQnaDetailed(text)
    const jawab = mila ? mila.answer : await getTopicAnswer('custom')
    if (jawab) {
      await clearState()
      await bhejo(from, jawab)
      console.log(`[wa] customization — ${from}`)
      return NextResponse.json({ ok: true })
    }
  }

  // ── 0b) "Mere model ka cover mil jayega?" ────────────────────────────────
  // Duniya ka koi bhi mobile ya laptop model ho, Urdu/English/Roman — jawab
  // ek hi hai: haan available hai, aur order aise place karein. DONO baatein
  // EK hi message mein jati hain, do alag messages nahi.
  //
  // Ye order-status se pehle hai: "Samsung A54 ka cover mil jayega" mein
  // "mil jayega" ki wajah se bot pehle "apna order number bhejein" bhej
  // deta tha.
  if (plan.modelAvailability) {
    const orderGuide = await getGreetingMessage()
    await clearState()
    await bhejo(from, orderGuide ? `${AVAILABLE_LINE}\n\n${orderGuide}` : AVAILABLE_LINE)
    // Greeting isi message mein ja chuki — alag se dobara na jaye
    await markGreeted(from)
    console.log(`[wa] model availability — ${from}`)
    return NextResponse.json({ ok: true })
  }

  // ── 1) Cancel / address / design / phone change / shikayat ───────────────
  // Ye cheezein bot ko khud nahi karni chahiye. Holding reply bhejte hain aur
  // message ko manual review queue mein daal dete hain.
  if (manualReason) {
    const contextOrder = await findOrder({
      confirmationNumber,
      orderNumber: plan.readNumbers ? orderNumber : null,
      phoneInText,
      trackingCandidate: null,
      senderPhone: from,
    })

    // Ek customer aksar ek hi baat kai dafa likhta hai ("I want to cancel",
    // phir "Please cancel my order", phir "For cancelling"). Isi number ki
    // isi wajah ki pending row mojood ho to nayi nahi banti — usi mein naya
    // message jur jata hai aur ginti barh jati hai.
    const { data: pehleSeMojood } = await supabaseAdmin
      .from('manual_review_queue')
      .select('id, message_text, message_count')
      .eq('phone', from)
      .eq('reason', manualReason)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const abhi = new Date().toISOString()

    if (pehleSeMojood) {
      const badlav: Record<string, any> = {
        message_text: `${pehleSeMojood.message_text}\n— ${text}`,
        message_count: (Number(pehleSeMojood.message_count) || 1) + 1,
        last_message_at: abhi,
      }
      // Order ab mila ho to bhar dete hain; na mile to purana jyun ka tyun
      if (contextOrder) badlav.order_number = contextOrder.order_number

      await supabaseAdmin.from('manual_review_queue').update(badlav).eq('id', pehleSeMojood.id)
    } else {
      await supabaseAdmin.from('manual_review_queue').insert({
        phone: from,
        message_text: text,
        reason: manualReason,
        order_number: contextOrder ? contextOrder.order_number : null,
        message_count: 1,
        last_message_at: abhi,
      })
    }

    // Q&A mein is topic ka apna jawab ho to wo behtar hai
    const qnaAnswer = await matchQna(text)
    await clearState()
    await bhejo(from, qnaAnswer || MANUAL_REASON_REPLY[manualReason])

    console.log(
      `[wa] manual review: ${MANUAL_REASON_LABEL[manualReason]} — ${from}` +
        (contextOrder ? ` (order ${contextOrder.order_number})` : '')
    )
    return NextResponse.json({ ok: true })
  }

  // ── 2) Live tracking — teeno tareeqon se ──────────────────────────────────
  // Confirmation number, order number, ya mobile number — jo bhi mile, us se
  // order dhoond kar live status bhej dete hain.
  const seedhaMila = await findOrder({
    confirmationNumber,
    orderNumber: plan.readNumbers ? orderNumber : null,
    phoneInText: plan.readNumbers ? phoneInText : null,
    trackingCandidate: plan.readNumbers ? trackingCandidate : null,
    // Customer jis WhatsApp number se likh raha hai, aksar order bhi usi
    // number par hota hai. Pehle hum phir bhi "apna order number bhejein"
    // bhejte the aur phir tracking — yani DO message ka kharcha. Ab order
    // khud dhoond kar SEEDHA tracking jati hai, ek hi message mein.
    senderPhone: plan.orderish ? from : undefined,
  })

  // Abhi bhi nahi mila? Us order ko dekho jo is customer ko pehle bheja gaya
  // tha (yani jis ka order/cell/confirmation number wo pehle chat mein de
  // chuka hai). Yehi "yaad" hai — taake bar bar number na maangna pare.
  const yaadOrder =
    !seedhaMila && plan.orderish
      ? await findOrder({ orderNumber: await pichhlaOrderNumber(from) })
      : null
  // Tasveer ke SATH likha bhi hua hai (caption). Tarteeb aap ki batayi hui:
  //   1. jo likha hai us mein order / confirmation / cell number — sab se pehle
  //   2. purana record (isi number ka order, ya jo tracking pehle bheji gayi)
  //   3. in dono se na mile — ab TASVEER parhi jati hai
  const tasveerSe =
    !seedhaMila && !yaadOrder && tasveerHai ? await orderTasveerSe(message, from) : null
  const order = seedhaMila || yaadOrder || (tasveerSe ? tasveerSe.order : null)

  if (order) {
    await clearState()

    // Yahi order isi customer ko abhi abhi bheja ja chuka hai — wahi lamba
    // message dobara nahi. Doosra order number bheje to jawab jata hai.
    if (!(await trackingClaim(from, order.order_number))) {
      console.log(`[wa] tracking #${order.order_number} pehle ja chuki — ${from} ko dobara nahi`)
      return NextResponse.json({ ok: true })
    }

    await bhejo(from, await buildStatusReply(order))
    return NextResponse.json({ ok: true })
  }

  // Number diya tha lekin live tracking nahi bhej sake (order nahi mila —
  // ghalat order / mobile / confirmation number). Ab AAP ki Excel ka web
  // tracking wala jawab jata hai (track-your-order link), taake customer
  // website par khud dekh le. Wo row na ho to purana message.
  if (confirmationNumber || (plan.readNumbers && (orderNumber || phoneInText))) {
    await clearState()
    const webTrack = await getTrackLinkAnswer()
    await bhejo(
      from,
      webTrack ||
        [
          'Is Number Se Koi Order Nahi Mil Raha. Please Apna Correct ',
          '',
          'Order Number (Jaise 40981), ',
          'Confirmation Number (Jaise #N8FNNZAKE) ',
          'Ya Jis Mobile Number Se Order Kiya Tha Wo Bhej Dein — Main Again Check Karti Hun.',
        ].join('\n')
    )
    return NextResponse.json({ ok: true })
  }

  // ── 3) Q&A — poora sawaal padh kar word-score matching ────────────────────
  // "No", "Ok", "Thanks" jaise jawab Q&A mein nahi jate — pehle akela "No"
  // number-change wala lamba jawab le aata tha.
  const qna = plan.noQuestion ? null : await matchQnaDetailed(text)

  // Jawab SIRF tracking page ka link ho ("Order Placed / Confirmed", "Order
  // Number Bheja") aur message ORDER ki baat hai lekin number nahi diya:
  //   - pehli dafa → link nahi, order number maangte hain (neeche step 4),
  //     taake WhatsApp par hi LIVE tracking bhej sakein
  //   - number pehle hi maang chuke → bot CHUP (wahi cheez dobara nahi)
  // Order ki baat na lagti ho lekin sawaal inhi topics se mile → link jata hai.
  //
  // Pehchan jawab ke link se hoti hai, topic ke naam se nahi — taake Excel
  // mein topic ka naam badalne se ye na toote.
  const sirfTrackingLink = qna !== null && TRACK_LINK.test(qna.answer)
  if (sirfTrackingLink && plan.orderish && !plan.mayAskForNumber) {
    console.log(`[wa] order number pehle maang chuke — ${from} ko dobara kuch nahi`)
    return NextResponse.json({ ok: true })
  }
  if (qna && !(sirfTrackingLink && plan.mayAskForNumber)) {
    if (state) await clearState()
    await bhejo(from, qna.answer)
    return NextResponse.json({ ok: true })
  }

  // ── 4) Order ka sawaal lagta hai lekin number nahi diya ───────────────────
  // Sirf EK dafa maangte hain. Pehle bot "intezaar" mein chala jata tha aur
  // us ke baad HAR message ("Hi", "camera protection...") par wahi maangta
  // rehta tha.
  // Tasveer order ki thi (Thank You / Orders page) lekin us se bhi order nahi
  // mila — aise mein bhi number maangna banta hai, chahe sath likhi hui baat
  // order ka sawaal na lagti ho.
  const tasveerOrderKiThi = tasveerSe !== null && tasveerSe.orderScreenshot
  if (plan.mayAskForNumber || (tasveerOrderKiThi && !askedBefore)) {
    await supabaseAdmin
      .from('wa_conversation_state')
      .upsert({ phone: from, state: 'awaiting_order_info', updated_at: new Date().toISOString() })
    await bhejo(from, ORDER_INFO_MAANGO)
    return NextResponse.json({ ok: true })
  }

  // ── 5) Kuch match nahi hua — BOT KHAMOSH RAHEGA ───────────────────────────
  // Jaan boojh kar koi reply nahi jata. Agar bot number maang chuka hai to
  // wo intezaar barqarar rehta hai (baad mein number aaye to pehchana jaye),
  // warna saaf kar dete hain.
  if (state && !askedBefore) await clearState()

  // "?", "Hi", "AoA", "Ok", "Thanks" rozana ki Excel mein faltu bheer banate
  // — sirf asal sawaal log hote hain. Order ki baat (jis par number pehle hi
  // maang chuke) bhi sawaal nahi, bot use pehchan chuka hai.
  if (!plan.noQuestion && !plan.orderish && !isJunkMessage(text)) {
    await supabaseAdmin.from('unmatched_messages').insert({ phone: from, message_text: text })
  }

  return NextResponse.json({ ok: true })
}

/**
 * Bot ne order number maanga tha, aur wo abhi taza hai (24 ghante ke andar)?
 * Purana intezaar hamesha ke liye nahi chalna chahiye.
 */
function isFreshAskState(state: any): boolean {
  if (!state || state.state !== 'awaiting_order_info') return false
  const at = state.updated_at ? new Date(state.updated_at).getTime() : 0
  return Date.now() - at < ASK_STATE_HOURS * 3600 * 1000
}

/**
 * "Pehli dafa" ka faisla — aur wo bhi aisa jise do request ek sath mil kar
 * tor na sakein.
 *
 * Customer ke do message ek hi lamhe mein aayen to dono alag alag chalte hain
 * aur dono ko lagta hai "abhi tak kuch nahi bheja" — is tarah ek hi cheez do
 * dafa chali jati thi (aap ne tracking do dafa jate dekhi).
 *
 * Pehle UPDATE chalta hai (sirf tab kaamyab jab pichhli dafa ko kaafi waqt ho
 * chuka ho), warna INSERT. Database ki apni pehredari (primary key) ki wajah
 * se do mein se sirf EK insert kaamyab hota hai, doosra 23505 le kar hat jata
 * hai. Table hi na ho to "haan" keh dete hain taake bot ruke nahi.
 */
async function claim(table: string, keys: Record<string, string>, windowMs: number): Promise<boolean> {
  const ab = new Date().toISOString()
  const cutoff = new Date(Date.now() - windowMs).toISOString()

  let q = supabaseAdmin.from(table).update({ sent_at: ab })
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v)
  const { data, error } = await q.lt('sent_at', cutoff).select('sent_at')

  if (error) {
    console.warn(`[wa] ${table} parh nahi saka:`, error.message)
    return true
  }
  if (data && data.length) return true // purani entry thi aur waqt guzar chuka

  const { error: insErr } = await supabaseAdmin.from(table).insert({ ...keys, sent_at: ab })
  if (!insErr) return true
  if (insErr.code === '23505') return false // abhi abhi ja chuka hai
  console.warn(`[wa] ${table} mein likh nahi saka:`, insErr.message)
  return true
}

/** Isi customer ko yahi order bhejna banta hai? (24 ghante mein ek dafa) */
async function trackingClaim(phone: string, orderNumber: string | number): Promise<boolean> {
  return claim(
    'wa_tracking_sent',
    { phone, order_number: String(orderNumber) },
    TRACKING_REPEAT_HOURS * 3600 * 1000
  )
}

/**
 * Message bhejta hai — lekin bilkul wohi matan isi number ko abhi abhi ja
 * chuka ho to nahi bhejta.
 */
async function bhejo(phone: string, text: string): Promise<boolean> {
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 32)
  if (!(await claim('wa_recent_reply', { phone, reply_hash: hash }, SAME_REPLY_MINUTES * 60 * 1000))) {
    console.log(`[wa] wahi jawab abhi ja chuka — ${phone} ko dobara nahi`)
    return false
  }
  await sendWhatsAppText(phone, text)
  return true
}

/**
 * Bina kisi likhai ke aayi tasveer ka jawab.
 *
 * Pehle tasveer parhi jati hai; order ka screenshot nikle to usi se order
 * dhoond kar SEEDHA tracking jati hai (na sawaal, na "order number bhejein").
 * Order ka screenshot na ho to kuch nahi hota — bot khamosh rehta hai.
 */
async function tasveerKaJawab(message: any, from: string): Promise<void> {
  const parha = await orderTasveerSe(message, from)
  let mila = parha.order

  // Tasveer parhi hi nahi ja saki (OCR band, ya saaf nahi) — phir purana
  // sahara: bhejne wale ka apna number, ya wo order jo use pehle bheja gaya.
  // (Tasveer PARH li gayi aur wo order ki nahi thi — jaise design ya cover ki
  // photo — to kuch nahi bhejte.)
  if (!mila && !parha.parhiGayi) {
    mila =
      (await findOrder({ senderPhone: from })) ||
      (await findOrder({ orderNumber: await pichhlaOrderNumber(from) }))
  }

  if (mila) {
    // Yahi order abhi abhi bheja ja chuka hai to dobara nahi (24 ghante).
    // Kisi DOOSRE order ki tasveer ho to us ki tracking foran jati hai.
    if (!(await trackingClaim(from, mila.order_number))) {
      console.log(`[wa] tasveer: tracking #${mila.order_number} pehle ja chuki — ${from}`)
      return
    }
    await bhejo(from, await buildStatusReply(mila))
    console.log(`[wa] tasveer par tracking #${mila.order_number} — ${from}`)
    return
  }

  // Tasveer order ki thi lekin order nahi mil saka — ab number maang lete hain
  if (parha.orderScreenshot) {
    await supabaseAdmin
      .from('wa_conversation_state')
      .upsert({ phone: from, state: 'awaiting_order_info', updated_at: new Date().toISOString() })
    await bhejo(from, ORDER_INFO_MAANGO)
  }
}

interface TasveerNatija {
  /** Tasveer se mila hua order (na mile to null) */
  order: any | null
  /** Tasveer order ka screenshot thi? (design/cover ki photo nahi) */
  orderScreenshot: boolean
  /** Tasveer parhi ja saki? (OCR band ho ya nakaam ho to false) */
  parhiGayi: boolean
}

/**
 * Tasveer parh kar us mein se order dhoondta hai — khud kuch bhejta nahi.
 *
 * Teen tarah ke screenshot aate hain: Orders page ("Order #49086" aur
 * CallCourier ka number), Thank You page ("Confirmation #8IVAKP0FY") aur
 * Order details (email + mobile number).
 */
async function orderTasveerSe(message: any, from: string): Promise<TasveerNatija> {
  const khali: TasveerNatija = { order: null, orderScreenshot: false, parhiGayi: false }
  const mediaId = message?.image?.id || message?.document?.id

  console.log(
    `[wa] tasveer aayi — qism:${message?.type} mediaId:${mediaId ? 'haan' : 'nahi'} ` +
      `ocr:${ocrAvailable() ? 'chalu' : 'band'} — ${from}`
  )
  if (!mediaId || !ocrAvailable()) return khali

  const file = await whatsappMedia(String(mediaId))
  const text = file ? await readTextFromImage(file.base64, file.mime) : null
  if (!text) return khali

  const parha = readOrderScreenshot(text)
  console.log(
    `[wa] tasveer parhi — order:${parha.isOrderScreenshot} #${parha.orderNumber || '-'} ` +
      `conf:${parha.confirmation || '-'} cn:${parha.trackingId || '-'} — ${from}`
  )
  if (!parha.isOrderScreenshot) return { order: null, orderScreenshot: false, parhiGayi: true }

  const order =
    (await findOrder({
      orderNumber: parha.orderNumber,
      confirmationNumber: parha.confirmation,
      phoneInText: parha.phone,
      trackingCandidate: parha.trackingId,
    })) ||
    (parha.confirmation ? await findByConfirmationVariants(parha.confirmation) : null) ||
    (parha.email ? await findByEmail(parha.email) : null)

  return { order, orderScreenshot: true, parhiGayi: true }
}

/**
 * Confirmation number OCR ne thora ghalat parha ho (O/0, I/1) — chand
 * milti julti shaklon se bhi dhoond lete hain.
 */
async function findByConfirmationVariants(code: string): Promise<any | null> {
  const list = confirmationVariants(code)
  const { data } = await supabaseAdmin
    .from('orders')
    .select('*')
    .in('confirmation_number', list)
    .limit(1)
  if (data && data.length) return data[0]

  // Database mein chhote huroof ya '#' ke sath bhi ho sakta hai
  for (const c of list.slice(0, 4)) {
    const { data: row } = await supabaseAdmin
      .from('orders')
      .select('*')
      .ilike('confirmation_number', `%${c}%`)
      .limit(1)
      .maybeSingle()
    if (row) return row
  }
  return null
}

/** Screenshot mein likhe hue email se order */
async function findByEmail(email: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from('orders')
    .select('*')
    .ilike('customer_email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

/**
 * Is customer ko pehle jis order ki tracking bheji gayi thi, us ka number.
 *
 * Kaam kya aata hai: customer ne kabhi apna order number / cell number /
 * confirmation number diya tha aur tracking le chuka hai. Ab wo sirf "mera
 * order kahan hai?" likhta hai — ab bot dobara number nahi maangta, yehi
 * purana order dekh kar seedha tracking bhej deta hai.
 */
async function pichhlaOrderNumber(phone: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('wa_tracking_sent')
    .select('order_number, sent_at')
    .eq('phone', phone)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[wa] pichhla order parh nahi saka:', error.message)
    return null
  }
  return data && data.order_number ? String(data.order_number) : null
}

async function markTrackingSent(phone: string, orderNumber: string | number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('wa_tracking_sent')
    .upsert({ phone, order_number: String(orderNumber), sent_at: new Date().toISOString() })
  if (error) console.warn('[wa] wa_tracking_sent likh nahi saka:', error.message)
}

/** "Yes Available" ke sath guide ja chuka — record ke liye. */
async function markGreeted(phone: string): Promise<void> {
  await supabaseAdmin
    .from('wa_greeted')
    .upsert({ phone, greeted_at: new Date().toISOString() })
}

/**
 * Order dhoondta hai — confirmation number, order number, mobile number aur
 * courier tracking number, in mein se jo bhi mile us se.
 *
 * Mobile number database mein purane orders par kisi bhi shakal mein mehfooz
 * ho sakta hai (92xxx / 0xxx / xxx), is liye teeno shaklon se dhoondte hain.
 */
async function findOrder(opts: {
  confirmationNumber?: string | null
  orderNumber?: string | null
  phoneInText?: string | null
  trackingCandidate?: string | null
  senderPhone?: string
}): Promise<any | null> {
  const { confirmationNumber, orderNumber, phoneInText, trackingCandidate, senderPhone } = opts

  if (confirmationNumber) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .ilike('confirmation_number', confirmationNumber)
      .maybeSingle()
    if (data) return data
  }

  if (orderNumber) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('order_number', orderNumber)
      .maybeSingle()
    if (data) return data
  }

  for (const phone of [phoneInText, senderPhone]) {
    if (!phone) continue
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .in('customer_phone', phoneVariants(phone))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data
  }

  if (trackingCandidate) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('tracking_id', trackingCandidate)
      .maybeSingle()
    if (data) return data
  }

  return null
}

