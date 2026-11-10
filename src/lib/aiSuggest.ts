/**
 * Hafte mein ek dafa — AI khud Excel wala kaam kar deta hai.
 *
 * Pehle ye kaam aap karte the: har hafte Excel download, 100 rows parhna,
 * har sawaal ke saamne topic chunna, file wapas upload. Ab wo sab AI karta
 * hai aur aap sirf **haan ya nahi** karte hain.
 *
 * Kaam kaise hota hai
 * -------------------
 *   1. Pichhle hafte ke wo sare message uthao jin ka bot jawab nahi de saka
 *   2. Faltu, dohre aur order-tracking wale nikal do (un ka apna rasta hai)
 *   3. Jo bache, unhein AI ko dikhao — thore thore kar ke, poori topic list
 *      ke sath. AI har jumle ke liye batata hai:
 *          * ye kis MAUJOODA topic ka sawaal hai, ya
 *          * ye kisi NAYE topic ka hai (naam bhi tajweez karta hai), ya
 *          * ye kisi kaam ka nahi — chhod do
 *   4. Natije ko jama karo: ek topic ke sare naye sawaal ek tajweez banti hai
 *   5. Sab kuch `qna_suggestions` mein "pending" rakh do — kuch bhi apne
 *      aap live NAHI hota. Aap /admin/qna par dekh kar approve karte hain.
 *
 * Naya topic kab banta hai
 * ------------------------
 * Sirf tab jab customer us cheez ka sawaal BAAR BAAR poochein — ek do dafa
 * ki baat par naya topic nahi banta. Had NAYA_TOPIC_KAM_SE_KAM se set hoti
 * hai. Aap ne yehi kaha tha: "agar koi 1 ya 2 topic jis par customer bohat
 * zyada sawaal poochta ho, sirf usi tarah ke sawaalon ka naya topic bane".
 */

import { supabaseAdmin } from '@/lib/supabase'
import { aiPoochho, topicList, aiAvailable, zaatiMaloomatHatao } from '@/lib/aiTopic'
import { ignoreKey } from '@/lib/qnaIgnore'
import { isJunkMessage } from '@/lib/messageParse'
import { looksLikeOrderIntent } from '@/lib/orderIntent'
import { buildIndex, matchAgainstIndex } from '@/lib/qnaMatch'
import { GREETING_TOPIC } from '@/lib/whatsapp'

// Ek dafa mein itne jumle AI ko dikhate hain (zyada bhejein to jawab katne
// lagta hai, kam bhejein to call zyada hote hain)
const BATCH = 20
// Ek chalaane mein itne se zyada jumle nahi dekhte (hadd se bahar na jayein)
const MAX_JUMLE = Number(process.env.AI_SUGGEST_MAX) || 100
// Naya topic banane ke liye kam se kam itne ALAG customer jumle chahiyein
const NAYA_TOPIC_KAM_SE_KAM = Number(process.env.AI_NEW_TOPIC_MIN) || 3
// Aur kam se kam itni dafa customers ne wo baat ki ho
const NAYA_TOPIC_KAM_SE_KAM_DAFA = Number(process.env.AI_NEW_TOPIC_MIN_COUNT) || 4

export interface Tajweez {
  kind: 'naya_topic' | 'naya_sawaal'
  topic: string
  questions: string[]
  samples: string[]
  count: number
}

export interface SuggestNatija {
  dekhe: number
  chhode: { faltu: number; pehle_mana_kiya: number; bot_deta_hai: number; order_wale: number }
  tajaweez: number
  naye_topics: number
  naye_sawaal: number
  ai_calls: number
  batch_id: string | null
  notes: string[]
}

// ── Prompt ────────────────────────────────────────────────────────────────

function hidayat(topics: string[]): string {
  return [
    'Aap Pakistan ki ek mobile cover shop (Myzan) ki WhatsApp support ka Q&A bank behtar bana rahe hain.',
    '',
    'Neeche customers ke WO asli message hain jin ka bot jawab nahi de saka.',
    'Har message ke liye batana hai ke wo kahan fit hota hai.',
    '',
    'MAUJOODA TOPICS:',
    topics.map((t, i) => String(i + 1) + '. ' + t).join('\n'),
    '',
    'HAR MESSAGE KE TEEN MEIN SE EK FAISLA:',
    '  A. Ye kisi MAUJOODA topic ka sawaal hai  → {"i":0,"topic":"<topic ka poora naam>"}',
    '  B. Ye kisi NAYE topic ka sawaal hai      → {"i":0,"naya":"<naye topic ka chhota naam>"}',
    '  C. Ye kisi kaam ka nahi                  → {"i":0,"chhodo":true}',
    '',
    'SAB SE AHEM BAAT — HAR MESSAGE PAR PAISA LAGTA HAI:',
    'Jo sawaal aap Q&A bank mein daalte hain, aainda un par bot KHUD jawab',
    'bhejega, aur shop ko har bheje hue message ka paisa dena parta hai. Is',
    'liye sirf WAHI sawaal rakhein jin ka jawab bhejna waqai kaam ka ho.',
    'Zara sa bhi shak ho to "chhodo" — khamoshi muft hai, ghalat jawab mehnga.',
    '',
    '"chhodo" kab — (in par bot ka jawab sirf paisa zaya karta hai):',
    '  * sirf salaam, shukriya, duaen, emoji, "ok", "ji", "acha", "theek hai"',
    '  * apne maujooda order ki khabar (kab milega, kahan hai, abhi tak nahi aaya,',
    '    order number, tracking) — ye bot khud tracking ke raste se dekhta hai',
    '  * shikayat, cancel, refund, address badalna — ye insaan ka kaam hai',
    '  * jo baat samajh hi na aaye, ya jis ka koi aam jawab na ban sakta ho',
    '  * ek hi customer ki zaati baat jo doosron ke kaam ki na ho',
    '',
    'NAYA topic kab — bohat ehtiyat se:',
    '  * sirf jab EK HI cheez ka sawaal KAI customers ne alag alag andaz mein poocha ho',
    '  * naam chhota aur saaf rakhein (jaise "Gift Packing", "Bulk Order")',
    '  * agar baat kisi maujooda topic ke kareeb bhi hai to NAYA na banayein, usi maujooda ko chunein',
    '',
    'Jawab sirf JSON mein, is shakal mein, kuch aur nahi:',
    '{"faisle":[{"i":0,"topic":"..."},{"i":1,"naya":"..."},{"i":2,"chhodo":true}]}',
  ].join('\n')
}

interface Faisla {
  i: number
  topic?: string
  naya?: string
  chhodo?: boolean
}

function faislayNikalo(raw: string): Faisla[] {
  const shuru = raw.indexOf('{')
  const khatam = raw.lastIndexOf('}')
  if (shuru < 0 || khatam <= shuru) return []
  try {
    const o = JSON.parse(raw.slice(shuru, khatam + 1))
    const list = Array.isArray(o?.faisle) ? o.faisle : Array.isArray(o) ? o : []
    return list.filter((f: any) => typeof f?.i === 'number')
  } catch {
    return []
  }
}

/** AI ka likha naam asli topic se milao (thora farq chal jaye) */
function topicMilao(naam: string, topics: string[]): string | null {
  const saaf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const target = saaf(naam)
  if (!target) return null
  const theek = topics.find((t) => saaf(t) === target)
  if (theek) return theek
  return topics.find((t) => saaf(t).includes(target) || target.includes(saaf(t))) || null
}

// ── Asal kaam ─────────────────────────────────────────────────────────────

export async function tajweezBanao(dinKitne = 7): Promise<SuggestNatija> {
  const notes: string[] = []
  const chhode = { faltu: 0, pehle_mana_kiya: 0, bot_deta_hai: 0, order_wale: 0 }

  if (!aiAvailable()) {
    return {
      dekhe: 0,
      chhode,
      tajaweez: 0,
      naye_topics: 0,
      naye_sawaal: 0,
      ai_calls: 0,
      batch_id: null,
      notes: ['AI band hai — koi key set nahi'],
    }
  }

  // ── 1. Maujooda topics aur un ka matching index ─────────────────────────
  const { data: topicRows } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions, answer, priority')
    .eq('is_active', true)

  const active = (topicRows || []).filter((t) => t.topic)
  const topicNames = active.map((t) => String(t.topic)).filter((t) => t !== GREETING_TOPIC)

  const index = buildIndex(
    active
      .filter((t) => t.topic !== GREETING_TOPIC && t.answer)
      .map((t) => ({
        topic: String(t.topic),
        answer: String(t.answer),
        priority: Number(t.priority) || 0,
        questions: String(t.questions || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      }))
  )

  // Har topic ke maujooda sawaal — wohi sawaal dobara tajweez na karein
  const pehleSeMojood = new Map<string, Set<string>>()
  for (const t of active) {
    const set = new Set<string>()
    for (const q of String(t.questions || '').split(/\r?\n/)) {
      const k = ignoreKey(q)
      if (k) set.add(k)
    }
    pehleSeMojood.set(String(t.topic), set)
  }

  // ── 2. Pichhle hafte ke na-samjhe message ───────────────────────────────
  const kabSe = new Date(Date.now() - dinKitne * 24 * 3600 * 1000).toISOString()
  const { data: rows, error } = await supabaseAdmin
    .from('unmatched_messages')
    .select('id, message_text, created_at')
    .gte('created_at', kabSe)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    return {
      dekhe: 0,
      chhode,
      tajaweez: 0,
      naye_topics: 0,
      naye_sawaal: 0,
      ai_calls: 0,
      batch_id: null,
      notes: ['unmatched_messages parh nahi saka: ' + error.message],
    }
  }

  const { data: ignoredRows } = await supabaseAdmin.from('qna_ignored').select('text_norm').limit(50000)
  const ignored = new Set((ignoredRows || []).map((r) => String(r.text_norm)))

  // Pehle se pending tajweez — wohi baat dobara na poochein
  const { data: pendingRows } = await supabaseAdmin
    .from('qna_suggestions')
    .select('questions')
    .eq('status', 'pending')
  const pehleTajweez = new Set<string>()
  for (const r of pendingRows || []) {
    for (const q of (r.questions as string[]) || []) {
      const k = ignoreKey(q)
      if (k) pehleTajweez.add(k)
    }
  }

  // ── 3. Chhantai ─────────────────────────────────────────────────────────
  const jama = new Map<string, { text: string; count: number }>()
  for (const row of rows || []) {
    const text = String(row.message_text || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = ignoreKey(text)
    if (!key) continue

    if (ignored.has(key) || pehleTajweez.has(key)) {
      chhode.pehle_mana_kiya++
      continue
    }
    if (isJunkMessage(text)) {
      chhode.faltu++
      continue
    }
    // Apne order ki khabar — ye bot khud tracking ke raste se dekhta hai,
    // is ke sawaal Q&A bank mein nahi jate.
    if (looksLikeOrderIntent(text)) {
      chhode.order_wale++
      continue
    }
    if (matchAgainstIndex(index, text)) {
      chhode.bot_deta_hai++
      continue
    }

    const pehle = jama.get(key)
    if (pehle) pehle.count++
    else jama.set(key, { text, count: 1 })
  }

  const jumle = Array.from(jama.values())
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, MAX_JUMLE)

  if (!jumle.length) {
    return {
      dekhe: 0,
      chhode,
      tajaweez: 0,
      naye_topics: 0,
      naye_sawaal: 0,
      ai_calls: 0,
      batch_id: null,
      notes: ['Koi naya sawaal nahi mila — sab kuch pehle se sambhal raha hai'],
    }
  }

  // ── 4. AI se poochho — thore thore kar ke ───────────────────────────────
  const system = hidayat(topicNames)
  const purane = new Map<string, { questions: string[]; count: number }>()
  const naye = new Map<string, { questions: string[]; count: number }>()
  let aiCalls = 0

  for (let i = 0; i < jumle.length; i += BATCH) {
    const tukda = jumle.slice(i, i + BATCH)
    const matan = tukda
      .map((j, n) => String(n) + '. ' + zaatiMaloomatHatao(j.text) + '   [' + j.count + ' dafa]')
      .join('\n')

    const raw = await aiPoochho(system, matan)
    aiCalls++
    if (!raw) {
      notes.push('Batch ' + (i / BATCH + 1) + ': AI se jawab nahi aaya')
      continue
    }

    const faisle = faislayNikalo(raw)
    if (!faisle.length) {
      notes.push('Batch ' + (i / BATCH + 1) + ': jawab samajh nahi aaya')
      continue
    }

    for (const f of faisle) {
      const j = tukda[f.i]
      if (!j || f.chhodo) continue

      if (f.topic) {
        const asli = topicMilao(f.topic, topicNames)
        if (!asli) {
          notes.push('"' + f.topic + '" naam ka koi topic nahi — chhod diya')
          continue
        }
        // Wohi sawaal pehle se topic mein hai?
        if (pehleSeMojood.get(asli)?.has(ignoreKey(j.text))) continue
        const box = purane.get(asli) || { questions: [], count: 0 }
        box.questions.push(j.text)
        box.count += j.count
        purane.set(asli, box)
      } else if (f.naya) {
        const naam = String(f.naya).trim().slice(0, 60)
        if (!naam) continue
        // AI ne naya kaha lekin naam maujooda topic se milta hai → purana hi
        const milta = topicMilao(naam, topicNames)
        if (milta) {
          if (pehleSeMojood.get(milta)?.has(ignoreKey(j.text))) continue
          const box = purane.get(milta) || { questions: [], count: 0 }
          box.questions.push(j.text)
          box.count += j.count
          purane.set(milta, box)
          continue
        }
        const box = naye.get(naam) || { questions: [], count: 0 }
        box.questions.push(j.text)
        box.count += j.count
        naye.set(naam, box)
      }
    }
  }

  // ── 5. Tajweez banao ────────────────────────────────────────────────────
  const tajaweez: Tajweez[] = []

  for (const [topic, box] of Array.from(purane.entries())) {
    if (!box.questions.length) continue
    tajaweez.push({
      kind: 'naya_sawaal',
      topic,
      questions: Array.from(new Set<string>(box.questions)),
      samples: box.questions.slice(0, 5),
      count: box.count,
    })
  }

  for (const [topic, box] of Array.from(naye.entries())) {
    const alag: string[] = Array.from(new Set<string>(box.questions))
    // Naya topic sirf tab jab baat baar baar hui ho
    if (alag.length < NAYA_TOPIC_KAM_SE_KAM || box.count < NAYA_TOPIC_KAM_SE_KAM_DAFA) {
      notes.push(
        'Naya topic "' + topic + '" nahi banaya — abhi sirf ' + alag.length +
          ' tarah ke sawaal (' + box.count + ' dafa). Had: ' + NAYA_TOPIC_KAM_SE_KAM + ' tarah / ' +
          NAYA_TOPIC_KAM_SE_KAM_DAFA + ' dafa.'
      )
      continue
    }
    tajaweez.push({
      kind: 'naya_topic',
      topic,
      questions: alag,
      samples: alag.slice(0, 5),
      count: box.count,
    })
  }

  if (!tajaweez.length) {
    return {
      dekhe: jumle.length,
      chhode,
      tajaweez: 0,
      naye_topics: 0,
      naye_sawaal: 0,
      ai_calls: aiCalls,
      batch_id: null,
      notes: notes.length ? notes : ['AI ne koi tajweez nahi di — sab kuch pehle se sambhal raha hai'],
    }
  }

  // ── 6. Pending list mein rakho — kuch bhi apne aap live NAHI hota ───────
  const batchId = new Date().toISOString()
  const { error: insErr } = await supabaseAdmin.from('qna_suggestions').insert(
    tajaweez.map((t) => ({
      kind: t.kind,
      topic: t.topic,
      questions: t.questions,
      samples: t.samples,
      ask_count: t.count,
      status: 'pending',
      batch_id: batchId,
      created_at: new Date().toISOString(),
    }))
  )

  if (insErr) {
    return {
      dekhe: jumle.length,
      chhode,
      tajaweez: 0,
      naye_topics: 0,
      naye_sawaal: 0,
      ai_calls: aiCalls,
      batch_id: null,
      notes: [...notes, 'Tajweez mehfooz nahi ho saki: ' + insErr.message],
    }
  }

  return {
    dekhe: jumle.length,
    chhode,
    tajaweez: tajaweez.length,
    naye_topics: tajaweez.filter((t) => t.kind === 'naya_topic').length,
    naye_sawaal: tajaweez.filter((t) => t.kind === 'naya_sawaal').length,
    ai_calls: aiCalls,
    batch_id: batchId,
    notes,
  }
}
