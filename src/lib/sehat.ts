/**
 * Bot ki sehat ka saara hisaab — ek jagah.
 *
 * Isi se do cheezein banti hain:
 *   - /admin/sehat        (dekhne wala safha)
 *   - /api/admin/sehat    (wohi cheez JSON mein)
 *
 * Yahan koi message nahi jata aur AI ko koi call nahi hoti. Sirf dekhna.
 */

import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { looksLikeOrderIntent } from '@/lib/orderIntent'
import { MANUAL_REASON_REPLY, MANUAL_REASON_LABEL } from '@/lib/intents'
import { AVAILABLE_LINE, ORDER_INFO_MAANGO, ORDER_NAHI_MILA } from '@/lib/replyText'
import { GREETING_TOPIC, answerForTopic, getTopicAnswer } from '@/lib/whatsapp'
import { MODEL_GUIDE_TOPIC, TRACKING_UNKNOWN_TOPIC } from '@/lib/topicNames'

export const QUICK_REPLY_MIN_CUSTOMERS = Number(process.env.QUICK_REPLY_MIN_CUSTOMERS) || 3

const ghanteQabl = (n: number) => new Date(Date.now() - n * 3600 * 1000).toISOString()

/** Wohi hash jo bhejte waqt banta hai — isi se jawab pehchana jata hai */
const hashOf = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 32)

export interface JawabQism {
  naam: string
  qism: 'topic' | 'tracking' | 'system' | 'anjaan'
  kitne: number
  customers: number
  hissa: number
}

export interface Matan {
  matan: string
  customers: number
  quickReply: boolean
  aakhriDafa: string
}

/** Code jin topics ko naam se bulata hai — wo mil rahe hain ya nahi */
export interface Raasta {
  kaam: string
  topic: string
  mila: boolean
  zariya: string
  jhalak: string
}

/** Ek paimana — 0 se 100 tak, sath mein saaf matlab */
export interface Paimana {
  naam: string
  fisad: number
  matlab: string
  tafseel: string
  /** Kitne faislon par ye paimana bana — kam ho to bharosa bhi kam */
  bunyad: number
}

export interface Kaarkardagi {
  kul: number
  darje: string
  paimane: Paimana[]
  /** AI kin kaamon mein madad kar raha hai */
  aiKeKaam: { kaam: string; kitne: number }[]
  /** Kitne faisle parkhe gaye */
  faisle: number
}

export interface Sehat {
  waqt: string
  khulasa: { baat: string; theek: boolean }[]
  sb: {
    jawab24: number
    tracking24: number
    customers24: number
    naySawaal24: number
    aiCalls24: number
    khamoshAbhi: number
  }
  jawabBreakdown: JawabQism[]
  kaam: Kaarkardagi
  raaste: Raasta[]
  zyadaJawab: { phone: string; kitne: number }[]
  hadParLog: number
  matanList: Matan[]
  echo: { kul: number; matanWale: number; sirfKhabar: number }
  khamoshi: { phone: string; kabTak: string }[]
  excel: { parkhe: number; orderWale: number; namune: string[] }
  nayeKhane: Record<string, boolean>
  tables: Record<string, { thik: boolean; rows: number; khata?: string }>
  settings: Record<string, string | number>
}

async function tableHaal(naam: string) {
  const { count, error } = await supabaseAdmin
    .from(naam)
    .select('*', { count: 'exact', head: true })
  if (error) return { thik: false, rows: 0, khata: error.message }
  return { thik: true, rows: count ?? 0 }
}

async function khanaHai(table: string, khana: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(table).select(khana).limit(1)
  return !error
}

async function ginti(table: string, waqtKaKhana: string, ghante: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(waqtKaKhana, ghanteQabl(ghante))
  return error ? 0 : count ?? 0
}

/**
 * Har jawab ke matan ka hash bana kar naam ki fehrist — isi se pata chalta
 * hai ke aaj kaun sa jawab kitni dafa gaya.
 */
async function jawabKeNaam(): Promise<Map<string, { naam: string; qism: JawabQism['qism'] }>> {
  const naqsha = new Map<string, { naam: string; qism: JawabQism['qism'] }>()
  const rakho = (matan: string, naam: string, qism: JawabQism['qism']) => {
    if (!matan) return
    const h = hashOf(matan)
    const pehle = naqsha.get(h)
    if (!pehle) naqsha.set(h, { naam, qism })
    else if (!pehle.naam.includes(naam)) pehle.naam = `${pehle.naam} / ${naam}`
  }

  // 1) Excel ke topics
  const { data: topics } = await supabaseAdmin
    .from('qna_topics')
    .select('topic,answer,is_active')
    .limit(500)

  let salaam = ''
  for (const t of topics || []) {
    const naam = String(t.topic || '')
    rakho(String(t.answer || ''), naam, 'topic')
    if (naam === GREETING_TOPIC) salaam = String(t.answer || '')
  }

  // 2) Code ke andar likhe hue jawab
  rakho(AVAILABLE_LINE, 'Model available hai', 'system')
  if (salaam) rakho(`${AVAILABLE_LINE}\n\n${salaam}`, 'Model available + salaam', 'system')
  rakho(ORDER_INFO_MAANGO, 'Order number maanga', 'system')
  rakho(ORDER_NAHI_MILA, 'Order nahi mila — number dobara maanga', 'system')

  for (const [k, matan] of Object.entries(MANUAL_REASON_REPLY)) {
    const label = MANUAL_REASON_LABEL[k as keyof typeof MANUAL_REASON_LABEL] || k
    rakho(matan, `Team dekh rahi hai: ${label}`, 'system')
  }

  return naqsha
}

/**
 * BOT KI KAARKARDAGI — roznamche (bot_faisla) se nikali gayi.
 *
 * Har paimana ek sawaal ka jawab hai jo aap poochna chahte hain:
 *   Samajh      — kitne sawaal samajh aaye?
 *   Durusti     — jo bheja wo sahi jagah se tha?
 *   Tracking    — order dhoondne mein kitni kaamyabi?
 *   Muft kaam   — kitna kaam bina AI ke hua (yani bina kharche ke)?
 *   Waqt        — guzra aur aane wala waqt theek pehchana?
 *
 * Har paimane ke sath "bunyad" bhi hai: wo kitne faislon par bana. Bunyad
 * chhoti ho to number par zyada bharosa nahi karna chahiye.
 */
async function kaarkardagiNikalo(
  ghante: number,
  kulJawab: number,
  anjaanJawab: number
): Promise<Kaarkardagi> {
  const { data, error } = await supabaseAdmin
    .from('bot_faisla')
    .select('qism,zariya,marhala,bheja,wajah,topic')
    .gte('created_at', ghanteQabl(ghante))
    .limit(5000)

  const rows = error ? [] : data || []
  const ginti = (f: (r: any) => boolean) => rows.filter(f).length

  const kul = rows.length
  const khamosh = ginti((r) => r.qism === 'khamosh')
  const samjha = kul - khamosh

  const tracking = ginti((r) => r.qism === 'tracking')
  const trackingNa = ginti((r) => r.qism === 'tracking_na_mila')
  const lafzSe = ginti((r) => r.zariya === 'lafz' && r.qism !== 'khamosh')
  const aiSe = ginti((r) => r.zariya === 'ai' && r.qism !== 'khamosh')
  const manual = ginti((r) => r.qism === 'manual')
  const manualPakka = ginti((r) => r.qism === 'manual' && r.marhala === 'baad')

  const hissa = (upar: number, neeche: number) =>
    neeche > 0 ? Math.round((upar / neeche) * 100) : 0

  const paimane: Paimana[] = [
    {
      naam: 'Samajh',
      fisad: hissa(samjha, kul),
      bunyad: kul,
      matlab: `${samjha} mein se ${kul} messages ka jawab bana`,
      tafseel:
        'Jitne messages aaye un mein se kitnon ka bot ne jawab nikala. Baqi par wo ' +
        'jaan boojh kar khamosh raha — khamoshi muft hai, ghalat jawab mehnga.',
    },
    {
      naam: 'Durusti',
      fisad: hissa(kulJawab - anjaanJawab, kulJawab),
      bunyad: kulJawab,
      matlab:
        anjaanJawab === 0
          ? `${kulJawab} jawab gaye, sab pehchane hue raston se`
          : `${kulJawab} mein se ${anjaanJawab} jawab aise the jo kisi maujooda topic se nahi milte`,
      tafseel:
        'Har bheja hua jawab kisi maloom raste se aana chahiye — Excel ka topic, ' +
        'tracking, ya code ka apna matan. Jo kahin se na mile wo "faltu jawab" ka ' +
        'sab se pehla nishan hai.',
    },
    {
      naam: 'Tracking',
      fisad: hissa(tracking, tracking + trackingNa),
      bunyad: tracking + trackingNa,
      matlab: `${tracking} dafa live status mila, ${trackingNa} dafa order nahi mila`,
      tafseel:
        'Jab customer apne order ki baat karta hai, bot kitni dafa us ka asli order ' +
        'dhoond kar live status bhej deta hai. Na mile to track link wala jawab jata hai.',
    },
    {
      naam: 'Muft kaam',
      fisad: hissa(lafzSe, lafzSe + aiSe),
      bunyad: lafzSe + aiSe,
      matlab: `${lafzSe} lafzon se, ${aiSe} AI ki madad se`,
      tafseel:
        'Lafzon se pehchana gaya jawab foran aur muft hota hai. AI sirf wahan bulaya ' +
        'jata hai jahan lafz kaam na aayein. Ye number jitna ooncha, utna behtar.',
    },
    {
      naam: 'Waqt ki samajh',
      fisad: hissa(manualPakka, manual),
      bunyad: manual,
      matlab: `${manual} manual check mein se ${manualPakka} par yaqeen tha ke order mil chuka hai`,
      tafseel:
        'Shikayat sirf us waqt manual check mein jani chahiye jab order mil chuka ho. ' +
        'Baqi par bot ehtiyatan manual check hi chunta hai — taake koi baat chhoot na jaye.',
    },
  ]

  // Jin paimanon ki bunyad hi nahi bani, wo kul hisaab bigarte hain
  const ginne = paimane.filter((x) => x.bunyad > 0)
  const kulFisad = ginne.length
    ? Math.round(ginne.reduce((a, x) => a + x.fisad, 0) / ginne.length)
    : 0

  const darje =
    kulFisad >= 85
      ? 'Bohat acha'
      : kulFisad >= 70
      ? 'Theek'
      : kulFisad >= 50
      ? 'Behtar ho sakta hai'
      : kul === 0
      ? 'Abhi koi khabar nahi'
      : 'Dekhne ki zaroorat hai'

  // AI kin kaamon mein madad kar raha hai
  const aiKaam = new Map<string, number>()
  for (const r of rows) {
    if (r.zariya !== 'ai') continue
    const kaam =
      r.qism === 'khamosh'
        ? String(r.wajah || 'bot ko rokna')
        : r.wajah
        ? 'lafzon ka ghalat milan theek karna'
        : 'sawaal samajh kar topic chunna'
    aiKaam.set(kaam, (aiKaam.get(kaam) || 0) + 1)
  }

  return {
    kul: kulFisad,
    darje,
    paimane,
    faisle: kul,
    aiKeKaam: Array.from(aiKaam.entries())
      .map(([kaam, kitne]) => ({ kaam, kitne }))
      .sort((a, b) => b.kitne - a.kitne),
  }
}

export async function sehatLo(): Promise<Sehat> {
  const naqsha = await jawabKeNaam()

  // ── Aaj ke jawab: kaun sa kitni dafa gaya ──────────────────────────────
  const { data: jawabRows } = await supabaseAdmin
    .from('wa_recent_reply')
    .select('reply_hash,phone')
    .gte('sent_at', ghanteQabl(24))
    .limit(3000)

  const jawab = jawabRows || []
  const perHash = new Map<string, Set<string>>()
  const perHashN = new Map<string, number>()
  for (const r of jawab) {
    const h = String(r.reply_hash || '')
    perHashN.set(h, (perHashN.get(h) || 0) + 1)
    const s = perHash.get(h) || new Set<string>()
    s.add(String(r.phone))
    perHash.set(h, s)
  }

  // Kis customer ko kitne jawab gaye — "extra jawab" yahin pakra jata hai
  const perLog = new Map<string, number>()
  for (const r of jawab) {
    const ph = String(r.phone)
    perLog.set(ph, (perLog.get(ph) || 0) + 1)
  }
  const zyadaJawab = Array.from(perLog.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phone, kitne]) => ({ phone, kitne }))
  const hadPar = Number(process.env.MAX_REPLIES_PER_DAY) || 4
  const hadParLog = Array.from(perLog.values()).filter((n) => n >= hadPar).length

  const tracking24 = await ginti('wa_tracking_sent', 'sent_at', 24)

  const jane: JawabQism[] = []
  let anjaanN = 0
  const anjaanLog = new Set<string>()
  Array.from(perHashN.entries()).forEach(([h, n]) => {
    const mila = naqsha.get(h)
    if (mila) {
      jane.push({
        naam: mila.naam,
        qism: mila.qism,
        kitne: n,
        customers: (perHash.get(h) || new Set()).size,
        hissa: 0,
      })
    } else {
      anjaanN += n
      for (const p of Array.from(perHash.get(h) || new Set<string>())) anjaanLog.add(p)
    }
  })

  // Anjaan hashon mein sab se pehle TRACKING hai — har order ka jawab alag
  // hota hai is liye us ka hash hamesha naya hota hai.
  const trackingHissa = Math.min(tracking24, anjaanN)
  if (trackingHissa > 0) {
    jane.push({
      naam: 'Tracking — order ka status',
      qism: 'tracking',
      kitne: trackingHissa,
      customers: Math.min(anjaanLog.size, trackingHissa),
      hissa: 0,
    })
  }
  const bache = anjaanN - trackingHissa
  if (bache > 0) {
    jane.push({
      naam: 'Pehchana nahi gaya (purana ya badla hua jawab)',
      qism: 'anjaan',
      kitne: bache,
      customers: Math.max(anjaanLog.size - trackingHissa, 0),
      hissa: 0,
    })
  }

  const kulJawab = jawab.length || 1
  for (const j of jane) j.hissa = Math.round((j.kitne / kulJawab) * 100)
  jane.sort((a, b) => b.kitne - a.kitne)

  // ── Aap ke bheje hue message (echo) ────────────────────────────────────
  const { data: bahar } = await supabaseAdmin
    .from('wa_human_message')
    .select('phone,text_hash,sample,sent_at')
    .gte('sent_at', ghanteQabl(24 * 7))
    .order('sent_at', { ascending: false })
    .limit(1000)

  const rows = bahar || []
  const matanWale = rows.filter((r) => r.text_hash)

  const jama = new Map<string, { log: Set<string>; namuna: string; aakhri: string }>()
  for (const r of matanWale) {
    const h = String(r.text_hash)
    const pehle = jama.get(h)
    if (pehle) pehle.log.add(String(r.phone))
    else
      jama.set(h, {
        log: new Set([String(r.phone)]),
        namuna: String(r.sample || '').slice(0, 90),
        aakhri: String(r.sent_at || ''),
      })
  }

  const matanList: Matan[] = Array.from(jama.values())
    .sort((a, b) => b.log.size - a.log.size)
    .slice(0, 15)
    .map((m) => ({
      matan: m.namuna || '(matan mehfooz nahi)',
      customers: m.log.size,
      quickReply: m.log.size >= QUICK_REPLY_MIN_CUSTOMERS,
      aakhriDafa: m.aakhri,
    }))

  // ── Abhi kis par khamoshi ──────────────────────────────────────────────
  const { data: pauses } = await supabaseAdmin
    .from('wa_human_pause')
    .select('phone,until')
    .gt('until', new Date().toISOString())
    .order('until', { ascending: false })
    .limit(50)

  // ── Excel ki list saaf hai? ────────────────────────────────────────────
  const { data: tazaSawaal } = await supabaseAdmin
    .from('unmatched_messages')
    .select('message_text')
    .gte('created_at', ghanteQabl(24 * 7))
    .order('created_at', { ascending: false })
    .limit(300)

  const parkhe = tazaSawaal || []
  const orderWale = parkhe.filter((r) => looksLikeOrderIntent(String(r.message_text || '')))

  // ── Code jin topics ko naam se bulata hai ────────────────────
  const raastaDekho = async (kaam: string, topic: string): Promise<Raasta> => {
    const poora = await answerForTopic(topic)
    const tukra = poora ? null : await getTopicAnswer(topic)
    const jawab = poora || tukra
    return {
      kaam,
      topic,
      mila: Boolean(jawab),
      zariya: poora ? 'poore naam se mila' : tukra ? 'naam ke shuru se mila' : 'nahi mila',
      jhalak: jawab ? String(jawab).replace(/\s+/g, ' ').slice(0, 110) : '',
    }
  }

  const raaste: Raasta[] = [
    await raastaDekho('"Yes Available" ke sath jane wali guide', MODEL_GUIDE_TOPIC),
    await raastaDekho('Order ki pehchan na mile to ye jawab', TRACKING_UNKNOWN_TOPIC),
  ]

  // ── Tables aur naye khane ──────────────────────────────────────────────
  const tables: Record<string, { thik: boolean; rows: number; khata?: string }> = {}
  for (const t of [
    'wa_human_message',
    'wa_human_pause',
    'wa_manual_jawab',
    'bot_faisla',
    'bot_health_daily',
    'wa_bot_message',
    'wa_recent_reply',
    'wa_tracking_sent',
    'qna_topics',
    'qna_suggestions',
    'qna_ignored',
    'order_sawaal_log',
    'unmatched_messages',
    'ai_topic_cache',
    'ai_call_log',
  ]) {
    tables[t] = await tableHaal(t)
  }

  const nayeKhane = {
    'wa_human_message.text_hash': await khanaHai('wa_human_message', 'text_hash'),
    'wa_human_message.sample': await khanaHai('wa_human_message', 'sample'),
    'qna_topics.off_reason': await khanaHai('qna_topics', 'off_reason'),
  }

  // ── Seedha matlab ──────────────────────────────────────────────────────
  const khulasa: { baat: string; theek: boolean }[] = []
  const khaneTheek = Object.values(nayeKhane).every(Boolean)
  if (!khaneTheek) {
    khulasa.push({ baat: 'Supabase ka SQL poora nahi chala — naye khane nahi bane.', theek: false })
  }
  if (matanWale.length === 0) {
    khulasa.push({
      baat: 'Aap ke bheje message ka matan nahi aa raha — Meta par smb_message_echoes dekh lein.',
      theek: false,
    })
  } else {
    khulasa.push({
      baat: `Meta se echo aa raha hai — ${matanWale.length} message matan ke sath mehfooz hue.`,
      theek: true,
    })
  }

  if (!tables['bot_faisla']?.thik) {
    khulasa.push({
      baat: 'bot_faisla table nahi bani — kaarkardagi ke numbers khali rahenge.',
      theek: false,
    })
  }

  if (!tables['bot_health_daily']?.thik) {
    khulasa.push({
      baat: 'bot_health_daily table nahi bani — rozana ka hisaab mehfooz nahi hoga.',
      theek: false,
    })
  }

  if (!tables['wa_manual_jawab']?.thik) {
    khulasa.push({
      baat: 'wa_manual_jawab table nahi bani — cancel/return ka jawab abhi bhi dobara ja sakta hai.',
      theek: false,
    })
  }

  for (const r of raaste) {
    if (!r.mila) {
      khulasa.push({
        baat: `Topic nahi mila: "${r.topic}" — ${r.kaam} ke liye bot purane matan par chalega.`,
        theek: false,
      })
    }
  }

  const pehchane = matanList.filter((m) => m.quickReply).length
  khulasa.push({
    baat: pehchane
      ? `${pehchane} matan ko bot ne quick reply maan liya — un par kabhi khamosh nahi hoga.`
      : 'Abhi koi matan quick reply nahi mana gaya — har matan ko 3 alag customers tak jana baqi hai.',
    theek: pehchane > 0,
  })

  khulasa.push({
    baat: (pauses || []).length
      ? `${(pauses || []).length} customers par bot is waqt khamosh hai (tracking phir bhi jati hai).`
      : 'Is waqt kisi customer par ghalat khamoshi nahi lagi hui.',
    theek: true,
  })

  if (parkhe.length) {
    khulasa.push({
      baat: orderWale.length
        ? `Excel ki list mein ${orderWale.length} sawaal ab bhi order tracking wale lag rahe hain.`
        : `Excel ki list saaf hai — ${parkhe.length} sawaalon mein ek bhi order tracking wala nahi.`,
      theek: orderWale.length === 0,
    })
  }

  if (hadParLog > 0) {
    khulasa.push({
      baat: `${hadParLog} customers ko aaj ${hadPar} ya us se zyada jawab gaye — had par pohonch gaye.`,
      theek: false,
    })
  }

  const anjaanKul = jane.find((j) => j.qism === 'anjaan')?.kitne || 0
  if (anjaanKul > 0) {
    khulasa.push({
      baat: `${anjaanKul} jawab aise gaye jo kisi maujooda topic se nahi milte — niche dekh lein.`,
      theek: false,
    })
  }

  const anjaanJawab = jane.find((j) => j.qism === 'anjaan')?.kitne || 0

  return {
    waqt: new Date().toISOString(),
    khulasa,
    sb: {
      jawab24: jawab.length,
      tracking24,
      customers24: new Set(jawab.map((r) => String(r.phone))).size,
      naySawaal24: await ginti('unmatched_messages', 'created_at', 24),
      aiCalls24: await ginti('ai_call_log', 'created_at', 24),
      khamoshAbhi: (pauses || []).length,
    },
    jawabBreakdown: jane,
    kaam: await kaarkardagiNikalo(24, jawab.length, anjaanJawab),
    raaste,
    zyadaJawab,
    hadParLog,
    matanList,
    echo: {
      kul: rows.length,
      matanWale: matanWale.length,
      sirfKhabar: rows.length - matanWale.length,
    },
    khamoshi: (pauses || []).map((p) => ({ phone: String(p.phone), kabTak: String(p.until) })),
    excel: {
      parkhe: parkhe.length,
      orderWale: orderWale.length,
      namune: orderWale.slice(0, 8).map((r) => String(r.message_text || '').slice(0, 90)),
    },
    nayeKhane,
    tables,
    settings: {
      AI_MODE: process.env.AI_MODE || 'check (default)',
      AI_PROVIDER: process.env.AI_PROVIDER || 'gemini (default)',
      MAX_REPLIES_PER_DAY: Number(process.env.MAX_REPLIES_PER_DAY) || 4,
      HUMAN_PAUSE_HOURS: Number(process.env.HUMAN_PAUSE_HOURS) || 2,
      MANUAL_PAUSE_HOURS: Number(process.env.MANUAL_PAUSE_HOURS) || 24,
      SAME_REPLY_HOURS: Number(process.env.SAME_REPLY_HOURS) || 24,
      QUICK_REPLY_MIN_CUSTOMERS,
      TRACKING_DURING_PAUSE: process.env.TRACKING_DURING_PAUSE || '1 (default)',
    },
  }
}
