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
  answerForTopic,
} from '@/lib/whatsapp'
import { samjho, aiAvailable, aiMode } from '@/lib/aiTopic'
import { MANUAL_REASON_REPLY, MANUAL_REASON_LABEL, ISSUE_REASONS } from '@/lib/intents'
import { noteForCourierStage, noteToWhatsAppText } from '@/lib/courierNotes'
import { classifyCourierStage, courierApiUrl } from '@/lib/courierStatus'
import type { CourierStage } from '@/lib/courierStatus'
import { phoneVariants, extractIncomingText, isJunkMessage } from '@/lib/messageParse'
import { planReply, TRACK_LINK } from '@/lib/replyPlan'
import { looksLikeOrderIntent } from '@/lib/orderIntent'
import {
  AVAILABLE_LINE,
  ORDER_INFO_MAANGO,
  ORDER_NAHI_MILA,
  TRACK_LINK_JAWAB,
} from '@/lib/replyText'
import { MODEL_GUIDE_TOPIC, TRACKING_UNKNOWN_TOPIC } from '@/lib/topicNames'
import { faislaLikho } from '@/lib/faisla'
import { marhalaPehchano } from '@/lib/marhala'
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
// Bot ne order number maanga ho to itni der tak us ke jawab ka intezaar
const ASK_STATE_HOURS = 24
// Bilkul wohi jawab isi number ko itne ghante tak DOBARA NAHI jata.
//
// Customer ek hi baat kai andaz mein poochta hai — "delivery kitne din mein",
// phir "kab tak mil jayega", phir "kitna time lagta hai". Jawab teenon ka
// ek hi hai, aur us jawab ko ek hi dafa jana chahiye. Pehle ye hadd sirf 15
// minute ki thi, to thori der baad wahi matan dobara chala jata tha — har
// dafa Meta ka paisa, aur customer ke liye bhi be-sood.
//
// Pehchan jawab ke MATAN se hoti hai, topic ke naam se nahi — is liye ye
// khud ba khud har raste par chalti hai: lafz wala milan ho, AI ka faisla
// ho, ya order number wala message.
const SAME_REPLY_HOURS =
  Number(process.env.SAME_REPLY_HOURS) ||
  (Number(process.env.SAME_REPLY_MINUTES)
    ? Number(process.env.SAME_REPLY_MINUTES) / 60
    : 24)
// Aap (ya team) ne khud customer ko jawab de diya ho to bot itni dair us
// customer se bilkul khamosh rehta hai. Aap baat kar rahe hon aur beech mein
// bot ka taiyar shuda message chala jaye — ye sab se buri baat hai.
//
// AHEM: ye waqt CHHOTA hona chahiye. Har dafa jab aap khud jawab dete hain,
// ginti phir se shuru ho jati hai (upsert `until` ko aage barha deta hai) —
// yani jab tak aap baat kar rahe hain, bot chup hi rahega. Is liye bari
// hadd rakhne ka koi faida nahi, nuqsan hai: 24 ghante rakhne se ek chhote
// se jawab ke baad poora din us customer ko TRACKING tak nahi jati thi.
const HUMAN_PAUSE_HOURS = Number(process.env.HUMAN_PAUSE_HOURS) || 2

// Aap ka QUICK REPLY har customer ko jata hai — wo "aap baat kar rahe hain"
// ka saboot nahi.
//
// Masla ye hai ke Meta hamein sirf itna batata hai ke "ek message bahar
// gaya" — MATAN nahi batata. Is liye bot apni aankh se quick reply aur aap
// ki apni likhai mein farq nahi kar sakta. (Matan tab milta jab Meta ke
// developer dashboard se `smb_message_echoes` chalu hota, lekin wo account
// abhi khulta hi nahi.)
//
// Is liye GINTI se faisla karte hain, jo aap ki apni baat par bana hai:
// quick reply EK message hota hai aur bas. Aap waqai kisi customer se baat
// karen to ek se zyada message likhte hain. Chunanche pehla message
// nazarandaz, doosre par bot khamosh.
const HUMAN_PAUSE_MIN_MSGS = Number(process.env.HUMAN_PAUSE_MIN_MSGS) || 2
// Itni dair ke andar ke message ek hi guftagu ginay jate hain
const HUMAN_WINDOW_MINUTES = Number(process.env.HUMAN_WINDOW_MINUTES) || 60

// Ab Meta hamein aap ke bheje hue message ka MATAN bhi deta hai
// (smb_message_echoes). Is se pakki pehchan mumkin ho gayi: quick reply wo
// matan hai jo KAI ALAG customers ko jata hai; aap ki apni likhai sirf ek
// customer ke liye hoti hai. Itne alag customers ko ja chuka matan quick
// reply mana jata hai — us par bot kabhi khamosh nahi hota.
//
// Bot ye KHUD seekhta hai: aap ko kuch likhna ya batana nahi parta, bas
// apne quick replies hameshaa ki tarah bhejte rahein.
const QUICK_REPLY_MIN_CUSTOMERS = Number(process.env.QUICK_REPLY_MIN_CUSTOMERS) || 3

// Jab baat TEAM ke khane mein jaye (cancel, return, address, shikayat) —
// ye jaan boojh kar lamba hai. Aisi baat ka faisla insaan hi karta hai, aur
// beech mein bot ka bolna theek nahi.
const MANUAL_PAUSE_HOURS = Number(process.env.MANUAL_PAUSE_HOURS) || 24
// Ek customer ko bot din bhar mein itne se zyada jawab nahi dega. Is ke baad
// baat aap ke haath mein — bot khamosh. (Jab aap khud customer se baat kar
// rahe hon to bot ka beech mein bolna sab se bura lagta hai.)
const MAX_REPLIES_PER_DAY = Number(process.env.MAX_REPLIES_PER_DAY) || 4

// Cancel / address change / return jaisa jawab EK ORDER par ek hi dafa jata
// hai. Usi order ke liye customer dobara likhe to bot khamosh rehta hai
// (us ki request aap ke manual check mein pehle se mojood hoti hai).
//
// NAYA order aaye to ye pabandi us par nahi lagti — naye order ka jawab
// jayega, kyunki wo alag baat hai.
//
// 0 = usi order par kabhi dobara nahi. Koi number dein (jaise 30) to utne
// din baad usi order par bhi dobara ja sakega.
const MANUAL_REPLY_REPEAT_DAYS = Number(process.env.MANUAL_REPLY_REPEAT_DAYS) || 0

// Kabhi bot ko pata hi nahi chalta ke baat kis order ki ho rahi hai. Aise
// mein "hamesha" ki pabandi khatarnak hai — mahine baad wo naye order ki
// baat kar raha ho sakta hai. Is liye sirf itne ghante ki khamoshi.
const MANUAL_ANJAAN_ORDER_HOURS = Number(process.env.MANUAL_UNKNOWN_REPEAT_HOURS) || 48

// Order ka pata na ho to is nishani se darj hota hai
const ANJAAN_ORDER = '-'



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
  const value = payload.entry?.[0]?.changes?.[0]?.value

  // Aap ne khud customer ko message bheja? — to bot ko chup kar do
  await insaniJawabDekho(value)

  const message = value?.messages?.[0]
  const incoming = extractIncomingText(message)
  if (!incoming) {
    // delivery/read receipts, reactions waghera — in par kuch nahi karna
    return NextResponse.json({ ok: true })
  }

  const from: string = message.from // already "923001234567" format
  const text = incoming.text.trim()

  // ── Aap khud is customer se baat kar rahe hain ──────────────────────────
  // Aise mein bot ka koi bhi taiyar shuda jawab bemaani hai (customer ne
  // "Okay cancel kr dain" likha aur aap cancel kar chuke the, phir bhi bot
  // ne cancellation policy bhej di thi).
  //
  // EK ISTISNA: TRACKING.
  // Asli maamla jo ye sabaq de gaya — aap ne customer ko likha "order place
  // kar ke order no bata dain", customer ne agle hi minute order number
  // bhej diya, aur bot chup raha. Halanke jo kuch us waqt bhejna chahiye
  // tha wo bilkul wohi tha jo bot bhejta hai. Is liye khamoshi ke dauran
  // taiyar shuda jawab, greeting, Q&A aur AI sab ruke rehte hain — lekin
  // agar customer ka asli order mil jaye to us ki tracking phir bhi jati
  // hai. (Band karna ho to TRACKING_DURING_PAUSE=0)
  const trackingBhiRoken = process.env.TRACKING_DURING_PAUSE === '0'
  const insaanHai = await insaanBaatKarRahaHai(from)
  if (insaanHai && trackingBhiRoken) {
    console.log(`[wa] aap khud baat kar rahe hain — ${from} ko bot kuch nahi bhejega`)
    return NextResponse.json({ ok: true })
  }
  if (insaanHai) {
    console.log(`[wa] aap khud baat kar rahe hain — ${from} ko sirf tracking ja sakti hai`)
  }

  // Bot aaj is customer ko kitni dafa jawab de chuka? Had se zyada ho to
  // aage baat insaan ki hai. Lekin yahan bhi tracking mustasna hai: wo khud
  // apni hadd rakhti hai (ek order ki tracking 24 ghante mein ek dafa), is
  // liye us se bakwaas nahi barhti.
  const hadParHai = await hadSeZyadaJawab(from)
  if (hadParHai) {
    console.log(`[wa] aaj ${MAX_REPLIES_PER_DAY} jawab ja chuke — ${from} ko sirf tracking`)
  }

  const khamoshi = insaanHai || hadParHai

  /**
   * Aam jawab bhejne ka rasta — greeting, Q&A, AI, "order number bhejein".
   * Khamoshi chal rahi ho to ye sab ruk jate hain. Tracking is ke bajaye
   * seedha bhejo() istemal karti hai, is liye wo guzar jati hai.
   */
  const bhejoAam = async (matan: string): Promise<boolean> => {
    if (khamoshi) {
      console.log(`[wa] khamoshi — ${from} ko aam jawab nahi bheja`)
      return false
    }
    return bhejo(from, matan)
  }


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
    if (tasveerHai) await tasveerKaJawab(message, from, khamoshi)
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
  // Matan Excel ke MODEL_GUIDE_TOPIC wale topic se aata hai (jis mein deal,
  // product info aur order karne ka tareeqa — teeno ek hi message mein
  // likhe hue hain). Wo topic chalu rehna chahiye.

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
      await bhejoAam(jawab)
      console.log(`[wa] customization — ${from}`)
    await faislaLikho({ phone: from, qism: 'topic', topic: 'Customization', zariya: 'lafz', bheja: true })
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
    // Pehle poora naam, phir shuru ka tukra (naam mein halki si tabdeeli ho
    // to bhi mil jaye), aur aakhir mein purani "Salaam / Greeting" row -
    // taake kisi surat mein customer khali haath na rahe.
    const orderGuide =
      (await answerForTopic(MODEL_GUIDE_TOPIC)) ||
      (await getTopicAnswer(MODEL_GUIDE_TOPIC)) ||
      (await getGreetingMessage())

    if (!orderGuide) {
      console.warn(`[wa] model guide ka topic nahi mila: "${MODEL_GUIDE_TOPIC}"`)
    }
    await clearState()
    await bhejoAam(orderGuide ? `${AVAILABLE_LINE}\n\n${orderGuide}` : AVAILABLE_LINE)
    // Guide isi message mein ja chuki — record ke liye
    await markGreeted(from)
    console.log(`[wa] model availability — ${from}`)
    await faislaLikho({ phone: from, qism: 'system', topic: MODEL_GUIDE_TOPIC, zariya: 'code', bheja: true, wajah: 'Yes Available' })
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

    // Q&A mein is topic ka apna jawab ho to wo behtar hai.
    //
    // Lekin agar isi baat ki pending request pehle se queue mein hai (yani
    // aap ko pata hai aur aap kaam kar chuke/rahe hain), to wahi lamba jawab
    // dobara nahi jata — customer ko ek hi baat teen dafa nahi milni chahiye.
    // Ye kaam ab TEAM ka hai (cancel, return, address badalna...). Aap khud
    // customer se baat karenge, is liye bot is number se kuch dair ke liye
    // bilkul khamosh ho jata hai — warna aap ke jawab ke beech mein us ka
    // taiyar shuda message chala jata tha.
    await supabaseAdmin.from('wa_human_pause').upsert({
      phone: from,
      until: new Date(Date.now() + MANUAL_PAUSE_HOURS * 3600 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })

    await clearState()
    const label = MANUAL_REASON_LABEL[manualReason]

    // Pabandi poore number par nahi, US ORDER par lagti hai
    const orderKey = contextOrder ? String(contextOrder.order_number) : ANJAAN_ORDER

    // Is baat ka jawab HAMESHA aap ki Excel se jata hai. Pehle poora naam
    // ("Order Cancel"), phir shuru ka tukra, phir alfaz milana — aur in mein
    // se kuch na mile to hi code ka apna message.
    const excelJawab =
      (await answerForTopic(label)) || (await getTopicAnswer(label)) || (await matchQna(text))
    const matan = excelJawab || MANUAL_REASON_REPLY[manualReason]

    // Shikayat par queue mein pehle se hona khamoshi ki wajah nahi banta -
    // wahan 24 ghante wala usool chalta hai (neeche bhejne wala hissa).
    const shikayatHai = (ISSUE_REASONS as string[]).includes(manualReason)

    if (pehleSeMojood && !shikayatHai) {
      console.log(`[wa] ${label} pehle se queue mein — ${from} ko dobara jawab nahi`)
    } else if (await manualJawabPehleGaya(from, manualReason, orderKey)) {
      // Request manual check mein jur chuki hai (upar), sirf message nahi jata
      console.log(`[wa] ${label} ka jawab ${from} ko pehle ja chuka — dobara nahi bheja`)
    } else if (await bhejoAam(matan)) {
      await manualJawabDarj(from, manualReason, orderKey)
      if (!excelJawab) {
        console.warn(`[wa] Excel mein "${label}" ka topic nahi mila — code ka jawab gaya`)
      }
    }

    console.log(
      `[wa] manual review: ${MANUAL_REASON_LABEL[manualReason]} — ${from}` +
        (contextOrder ? ` (order ${contextOrder.order_number})` : '')
    )
    await faislaLikho({
      phone: from,
      qism: 'manual',
      topic: label,
      zariya: 'lafz',
      marhala: marhalaPehchano(text),
      bheja: true,
      wajah: contextOrder ? `order ${contextOrder.order_number}` : 'order maloom nahi',
    })
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
    await faislaLikho({ phone: from, qism: 'tracking', zariya: 'code', bheja: true })
    return NextResponse.json({ ok: true })
  }

  // Number diya tha lekin live tracking nahi bhej sake (order nahi mila —
  // ghalat order / mobile / confirmation number). Ab AAP ki Excel ka web
  // tracking wala jawab jata hai (track-your-order link), taake customer
  // website par khud dekh le. Wo row na ho to purana message.
  if (confirmationNumber || (plan.readNumbers && (orderNumber || phoneInText))) {
    await clearState()
    const webTrack = await getTrackLinkAnswer()
    await bhejoAam(
      (await orderNaMilaJawab(from)) || webTrack || ORDER_NAHI_MILA
    )
    await faislaLikho({
      phone: from,
      qism: 'tracking_na_mila',
      zariya: 'code',
      bheja: !khamoshi,
      wajah: 'number diya lekin order nahi mila',
    })
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
    await faislaLikho({ phone: from, qism: 'khamosh', zariya: 'code', bheja: false, wajah: 'order number pehle maang chuke' })
    return NextResponse.json({ ok: true })
  }
  if (qna && !(sirfTrackingLink && plan.mayAskForNumber)) {
    // ── AI ka PEHRA ───────────────────────────────────────────────────────
    // Lafzon se jawab to mil gaya, lekin score kam hai — yani milan kamzor
    // hai. Yahi wo jagah hai jahan ghalat jawab jate the ("Total?" par
    // Replacement Policy). AI se poochte hain ke baat waqai isi topic ki
    // hai ya nahi. AI mana kare to bot khamosh — ek message bacha.
    const shakWaliHadd = Number(process.env.AI_CHECK_BELOW) || 0.6
    if (qna.score < shakWaliHadd && aiAvailable() && !khamoshi) {
      const raye = await samjho(text)
      if (raye) {
        if (raye.insaan) {
          console.log(`[wa] AI: ye baat insaan ke liye hai — ${from} se bot khamosh`)
          await faislaLikho({ phone: from, qism: 'khamosh', zariya: 'ai', bheja: false, wajah: 'AI: baat insaan ke liye hai' })
          await naySawaalLikho(from, text)
          return NextResponse.json({ ok: true })
        }
        if (!raye.topic) {
          console.log(`[wa] AI: "${qna.topic}" se baat nahi banti — bot khamosh`)
          await faislaLikho({
            phone: from,
            qism: 'khamosh',
            topic: qna.topic,
            zariya: 'ai',
            score: qna.score,
            bheja: false,
            wajah: 'AI ne kamzor milan radd kiya',
          })
          await naySawaalLikho(from, text)
          return NextResponse.json({ ok: true })
        }
        if (raye.topic !== qna.topic) {
          const behtar = await answerForTopic(raye.topic)
          if (behtar) {
            console.log(`[wa] AI ne topic badla: "${qna.topic}" → "${raye.topic}"`)
            if (state) await clearState()
            await bhejoAam(behtar)
            await faislaLikho({
              phone: from,
              qism: 'topic',
              topic: raye.topic,
              zariya: 'ai',
              score: qna.score,
              bheja: !khamoshi,
              wajah: `AI ne badla (lafzon se "${qna.topic}" aaya tha)`,
            })
            await naySawaalLikho(from, text)
            return NextResponse.json({ ok: true })
          }
        }
      }
    }
    if (state) await clearState()
    await bhejoAam(qna.answer)
    await faislaLikho({
      phone: from,
      qism: 'topic',
      topic: qna.topic,
      zariya: 'lafz',
      score: qna.score,
      bheja: !khamoshi,
    })
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
    await bhejoAam((await orderNaMilaJawab(from)) || ORDER_INFO_MAANGO)
    await faislaLikho({
      phone: from,
      qism: 'tracking_na_mila',
      zariya: 'code',
      bheja: !khamoshi,
      wajah: 'order ki koi pehchan nahi mili',
    })
    return NextResponse.json({ ok: true })
  }

  // ── 5) Lafzon se kuch na mila — AI se poochte hain ────────────────────────
  // Yahan tak baat aa gayi to purana bot bilkul khamosh ho jata tha. Customer
  // ka sawaal asli hota tha, bas us ne apne andaz mein likha hota tha
  // ("Nhi mujhe covered Hi chahiyye"). Ab ek chhota AI model us jumle ka
  // MATLAB samajh kar batata hai ke ye aap ke kis topic ka sawaal hai, aur
  // jawab AAP KI EXCEL se lafz ba lafz jata hai — AI khud kuch nahi likhta.
  //
  // AI band ho, hadd paar ho gayi ho, ya wo bhi na samjhe — to purani tarah
  // bot khamosh, aur jumla Excel ki "Naye Sawaal" list mein chala jata hai.
  const asalSawaal = !plan.noQuestion && !plan.orderish && !isJunkMessage(text)

  if (asalSawaal && aiMode() === 'full' && aiAvailable() && !khamoshi) {
    const raye = await samjho(text)
    if (raye && !raye.insaan && raye.topic) {
      const jawab = await answerForTopic(raye.topic)
      if (jawab) {
        console.log(`[wa] AI ne samjha — topic "${raye.topic}" ka jawab bheja`)
        await faislaLikho({ phone: from, qism: 'topic', topic: raye.topic, zariya: 'ai', bheja: true })
        if (state && !askedBefore) await clearState()
        // Jumla Excel mein bhi jata hai: aap wahan us ka sawaal add kar dein
        // to agli dafa AI ki zaroorat hi nahi padegi (muft aur foran).
        await naySawaalLikho(from, text)
        await bhejoAam(jawab)
        return NextResponse.json({ ok: true })
      }
    }
    if (raye?.insaan) {
      console.log(`[wa] AI: ye baat insaan ke liye hai — ${from} se bot khamosh`)
    }
  }

  // ── 6) Kuch match nahi hua — BOT KHAMOSH RAHEGA ───────────────────────────
  // Jaan boojh kar koi reply nahi jata. Agar bot number maang chuka hai to
  // wo intezaar barqarar rehta hai (baad mein number aaye to pehchana jaye),
  // warna saaf kar dete hain.
  if (state && !askedBefore) await clearState()

  // "?", "Hi", "AoA", "Ok", "Thanks" rozana ki Excel mein faltu bheer banate
  // — sirf asal sawaal log hote hain. Order ki baat (jis par number pehle hi
  // maang chuke) bhi sawaal nahi, bot use pehchan chuka hai.
  if (asalSawaal) {
    await naySawaalLikho(from, text)
    await faislaLikho({
      phone: from,
      qism: 'khamosh',
      zariya: 'lafz',
      bheja: false,
      wajah: 'kisi topic se milan nahi hua',
    })
  }

  return NextResponse.json({ ok: true })
}

/**
 * Customer ka jumla Excel ki "Naye Sawaal" list mein daalta hai.
 *
 * Ye list aap ke liye sab se qeemti cheez hai: jo jumla yahan aata hai aur
 * aap use sahi topic mein add kar dete hain, wo agli dafa LAFZON se hi
 * pehchana jata hai — AI ki zaroorat nahi, yani muft aur foran.
 */
async function naySawaalLikho(phone: string, text: string) {
  // Apne maujooda order ki khabar ("mera order kab aayega", "abhi tak nahi
  // mila", "parcel kahan hai") — ye Q&A ka sawaal hai hi nahi. Is ka apna
  // rasta hai: order number poochna aur live tracking bhejna. Aise jumle
  // pehle Excel ki list mein aa jate the aur aap ko har hafte unhein "Nahi"
  // karna parta tha. Ab ye apni alag jagah par mehfooz hote hain.
  if (looksLikeOrderIntent(text)) {
    await supabaseAdmin.from('order_sawaal_log').insert({ phone, message_text: text })
    return
  }
  await supabaseAdmin.from('unmatched_messages').insert({ phone, message_text: text })
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
 * Cancel / return / address wala jawab IS ORDER par pehle ja chuka hai?
 *
 * Haan to dobara nahi jata — us ki request manual check mein pehle se darj
 * ho chuki hai, aur ek hi baat do dafa bhejna customer ko pareshan karta
 * hai. Wohi customer NAYA order kare to ye pabandi us par nahi lagti.
 *
 * Table na bane to purana tareeqa chalta rehta hai (jawab chala jata hai)
 * — kuch tootta nahi.
 */
async function manualJawabPehleGaya(
  phone: string,
  reason: string,
  order: string
): Promise<boolean> {
  // Shikayat wali baatein (quality, ghalat item, return/refund) alag hain.
  //
  // Cancel ya address change ek dafa ho kar khatam ho jata hai, lekin
  // shikayat chalti rehti hai — customer agle din phir likh sakta hai aur
  // us waqt khamoshi bura lagti hai. In par "hamesha ki" pabandi nahi:
  // bhejne wala hissa khud 24 ghante tak wohi matan dobara nahi bhejta,
  // aur manual check mein us ki baat har dafa jurti rehti hai.
  if ((ISSUE_REASONS as string[]).includes(reason)) return false

  const { data, error } = await supabaseAdmin
    .from('wa_manual_jawab')
    .select('sent_at')
    .eq('phone', phone)
    .eq('reason', reason)
    .eq('order_number', order)
    .maybeSingle()

  if (error || !data) return false

  const guzra = Date.now() - new Date(String(data.sent_at)).getTime()

  // Order ka pata hi nahi tha — thori dair ki khamoshi, hamesha ki nahi
  if (order === ANJAAN_ORDER) return guzra < MANUAL_ANJAAN_ORDER_HOURS * 3600 * 1000

  if (MANUAL_REPLY_REPEAT_DAYS > 0) {
    return guzra < MANUAL_REPLY_REPEAT_DAYS * 24 * 3600 * 1000
  }
  return true
}

/** Jawab chala gaya — ab isi order par dobara nahi jayega */
async function manualJawabDarj(phone: string, reason: string, order: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('wa_manual_jawab')
    .upsert(
      { phone, reason, order_number: order, sent_at: new Date().toISOString() },
      { onConflict: 'phone,reason,order_number' }
    )
  if (error) console.warn('[wa] wa_manual_jawab mein likh nahi saka:', error.message)
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
async function claim(
  table: string,
  keys: Record<string, string>,
  windowMs: number,
  /** Sirf yaad-dasht ke liye (jaise jawab ka pehla hissa) — na ho to bhi chalega */
  yaad?: Record<string, string>
): Promise<boolean> {
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

  const { error: insErr } = await supabaseAdmin
    .from(table)
    .insert({ ...keys, ...(yaad || {}), sent_at: ab })
  if (!insErr) return true
  if (insErr.code === '23505') return false // abhi abhi ja chuka hai

  // Yaad-dasht wala khana abhi bana hi na ho (42703) to us ke baghair likho -
  // jawab bhejna kisi haal mein nahi rukna chahiye.
  if (yaad && insErr.code === '42703') {
    const { error: dobara } = await supabaseAdmin.from(table).insert({ ...keys, sent_at: ab })
    if (!dobara) return true
    if (dobara.code === '23505') return false
  }

  console.warn(`[wa] ${table} mein likh nahi saka:`, insErr.message)
  return true
}

/**
 * Webhook mein aaya "status" ya "echo" — kya ye message AAP ne (ya team ne)
 * apne haath se bheja hai?
 *
 * Bot jo bhi bhejta hai us ka message id hum mehfooz kar lete hain. Jo id
 * hamari list mein nahi, wo kisi insaan ne bheja hai — aise mein bot us
 * customer se kuch dair bilkul khamosh ho jata hai.
 */
async function insaniJawabDekho(value: any): Promise<void> {
  const echoes = value?.message_echoes || []
  const statuses = value?.statuses || []
  if (!echoes.length && !statuses.length) return

  console.log(
    `[wa] bahar jane wale message ki khabar: ${echoes.length + statuses.length} ` +
      `(statuses:${statuses.length} echoes:${echoes.length})`
  )

  // ── 1) ECHOES — matan ke sath. Yahi pakki pehchan hai. ─────────────────
  for (const e of echoes) {
    const id = String(e?.id || '')
    const phone = String(e?.to || e?.recipient_id || '')
    if (!id || !phone) continue
    if (await hamaraHai(id, phone)) continue

    const matan = String(e?.text?.body || e?.caption || '').trim()
    const hash = matan ? createHash('sha1').update(matan.toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 32) : null

    await supabaseAdmin
      .from('wa_human_message')
      .upsert({ message_id: id, phone, text_hash: hash, sample: matan.slice(0, 200) })

    // Matan hi na ho (tasveer waghera) to purane andaze par
    if (!hash) {
      await gintiSeFaisla(phone)
      continue
    }

    // Yehi matan kitne ALAG customers ko ja chuka hai? Quick reply sab ko
    // jata hai; aap ki apni likhai sirf ek customer ko. Yehi farq hai.
    const { data: kahanGaya } = await supabaseAdmin
      .from('wa_human_message')
      .select('phone')
      .eq('text_hash', hash)
      .limit(200)

    const alagLog = new Set((kahanGaya || []).map((r) => String(r.phone))).size
    if (alagLog >= QUICK_REPLY_MIN_CUSTOMERS) {
      console.log(`[wa] ye matan ${alagLog} customers ko ja chuka — quick reply, bot chalta rahega`)
      continue
    }

    await khamoshLagao(phone, `aap ne khud likha (ye matan ${alagLog} customer tak gaya)`)
  }

  // ── 2) STATUSES — sirf khabar, matan nahi ──────────────────────────────
  // Echo aa chuka ho to wahi faisla kaafi hai (message_id pehle se mehfooz).
  for (const st of statuses) {
    const id = String(st?.id || '')
    const phone = String(st?.recipient_id || '')
    if (!id || !phone) continue
    if (await hamaraHai(id, phone)) continue

    const { error: insErr } = await supabaseAdmin
      .from('wa_human_message')
      .insert({ message_id: id, phone })
    if (insErr) continue // pehle se gina ja chuka (ya echo se aa chuka)

    await gintiSeFaisla(phone)
  }
}

/**
 * Order ki koi pehchan nahi mili — aap ka apna jawab (agar likha hua ho).
 *
 * Mil jaye to yehi jata hai; warna null, aur bulane wali jagah purana
 * message bhej deti hai.
 */
async function orderNaMilaJawab(phone: string): Promise<string | null> {
  // Asli tracking haal hi mein ja chuki ho to ye NAHI jata. Warna customer
  // ko do tarah ki tracking mil jati — ek live status, ek website ka link.
  const kabSe = new Date(Date.now() - TRACKING_REPEAT_HOURS * 3600 * 1000).toISOString()
  const { data: jaChuki } = await supabaseAdmin
    .from('wa_tracking_sent')
    .select('sent_at')
    .eq('phone', phone)
    .gt('sent_at', kabSe)
    .limit(1)

  if (jaChuki && jaChuki.length) {
    console.log(`[wa] asli tracking pehle ja chuki — ${phone} ko link wala jawab nahi bheja`)
    return null
  }

  // Excel mein aap ka apna matan ho to wo, warna code mein likha hua.
  // Dono surton mein matan ek jaisa rehta hai, is liye bhejne wala hissa
  // khud hi 24 ghante mein ek dafa se zyada nahi bhejta.
  return (
    (await answerForTopic(TRACKING_UNKNOWN_TOPIC)) ||
    (await getTopicAnswer(TRACKING_UNKNOWN_TOPIC)) ||
    TRACK_LINK_JAWAB
  )
}

/** Ye message bot ne khud bheja tha? */
async function hamaraHai(id: string, phone: string): Promise<boolean> {
  const { data: hamara } = await supabaseAdmin
    .from('wa_bot_message')
    .select('message_id')
    .eq('message_id', id)
    .maybeSingle()
  if (hamara) return true

  // Ho sakta hai bot ne abhi abhi bheja ho aur id likhi na gayi ho
  const abhiBheja = new Date(Date.now() - 60 * 1000).toISOString()
  const { data: taza } = await supabaseAdmin
    .from('wa_bot_message')
    .select('message_id')
    .eq('phone', phone)
    .gt('sent_at', abhiBheja)
    .limit(1)
  return Boolean(taza && taza.length)
}

/**
 * Matan maloom na ho to purana andaza: quick reply ek hi message hota hai,
 * waqai baat karne par aap ek se zyada likhte hain.
 */
async function gintiSeFaisla(phone: string): Promise<void> {
  const kabSe = new Date(Date.now() - HUMAN_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('wa_human_message')
    .select('message_id', { count: 'exact', head: true })
    .eq('phone', phone)
    .gte('sent_at', kabSe)

  const kitne = count || 1
  if (kitne < HUMAN_PAUSE_MIN_MSGS) {
    console.log(`[wa] bahar ek message gaya (${phone}) — quick reply samjha, bot chalta rahega`)
    return
  }
  await khamoshLagao(phone, `${kitne} message gaye`)
}

async function khamoshLagao(phone: string, wajah: string): Promise<void> {
  await supabaseAdmin.from('wa_human_pause').upsert({
    phone,
    until: new Date(Date.now() + HUMAN_PAUSE_HOURS * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })
  console.log(`[wa] aap khud baat kar rahe hain — ${wajah} — ${phone} se bot ${HUMAN_PAUSE_HOURS} ghante khamosh`)
}

/**
 * Bot aaj is customer ko kitne jawab de chuka hai? Had se zyada to khamosh.
 *
 * wa_recent_reply mein har alag jawab ki ek row hoti hai, is liye ginti
 * wahin se mil jati hai.
 */
async function hadSeZyadaJawab(phone: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count, error } = await supabaseAdmin
    .from('wa_recent_reply')
    .select('phone', { count: 'exact', head: true })
    .eq('phone', phone)
    .gt('sent_at', cutoff)

  if (error) {
    console.warn('[wa] jawabon ki ginti nahi ho saki:', error.message)
    return false
  }
  return (count || 0) >= MAX_REPLIES_PER_DAY
}

/** Is customer se abhi koi insaan baat kar raha hai? */
async function insaanBaatKarRahaHai(phone: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('wa_human_pause')
    .select('until')
    .eq('phone', phone)
    .maybeSingle()
  if (error) {
    console.warn('[wa] wa_human_pause parh nahi saka:', error.message)
    return false
  }
  return Boolean(data?.until && new Date(String(data.until)).getTime() > Date.now())
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
  // Matan ka pehla hissa bhi mehfooz karte hain. Health ka safha isi se
  // bata deta hai ke "pehchana nahi gaya" wala jawab asal mein tha kya.
  const namuna = text.replace(/\s+/g, ' ').slice(0, 160)
  if (
    !(await claim(
      'wa_recent_reply',
      { phone, reply_hash: hash },
      SAME_REPLY_HOURS * 3600 * 1000,
      { sample: namuna }
    ))
  ) {
    console.log(`[wa] yehi jawab pehle ja chuka — ${phone} ko dobara nahi bheja`)
    return false
  }
  const natija: any = await sendWhatsAppText(phone, text)
  const id = natija?.messages?.[0]?.id
  if (id) {
    // Apne bheje hue message ki pehchan — taake baad mein pata rahe ke ye
    // bot ka tha, aap ka nahi
    const { error } = await supabaseAdmin
      .from('wa_bot_message')
      .insert({ message_id: String(id), phone })
    if (error && error.code !== '23505') {
      console.warn('[wa] wa_bot_message mein likh nahi saka:', error.message)
    }
  }
  return true
}

/**
 * Bina kisi likhai ke aayi tasveer ka jawab.
 *
 * Pehle tasveer parhi jati hai; order ka screenshot nikle to usi se order
 * dhoond kar SEEDHA tracking jati hai (na sawaal, na "order number bhejein").
 * Order ka screenshot na ho to kuch nahi hota — bot khamosh rehta hai.
 */
async function tasveerKaJawab(message: any, from: string, khamoshi = false): Promise<void> {
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

  // Tasveer order ki thi lekin order nahi mil saka — ab number maang lete hain.
  // (Khamoshi chal rahi ho to ye nahi maangte — aap khud baat kar rahe hain.)
  if (parha.orderScreenshot && !khamoshi) {
    await supabaseAdmin
      .from('wa_conversation_state')
      .upsert({ phone: from, state: 'awaiting_order_info', updated_at: new Date().toISOString() })
    await bhejo(from, (await orderNaMilaJawab(from)) || ORDER_INFO_MAANGO)
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

