/**
 * Message ko SAMAJHNA — lafz ginne ke bajaye matlab pehchanna.
 *
 * Kaam kya aata hai
 * -----------------
 * Hamara purana tareeqa lafz gin kar jawab dhoondta hai (qnaMatch.ts). Wo
 * tez aur muft hai, lekin do jagah chook jata hai:
 *
 *   1. Customer apne andaz mein likhe aur Excel mein wo jumla na ho —
 *      "Nhi mujhe covered Hi chahiyye" — to kuch match nahi hota.
 *   2. Lafz milte hain lekin baat kuch aur hai — "Total?" ka "Totally
 *      Disappointed" se milan ho gaya aur Replacement Policy chali gayi.
 *
 * Ye file us masle ka hal hai: ek chhota AI model customer ka jumla parhta
 * hai aur sirf ITNA batata hai ke ye AAP KE KIS TOPIC ka sawaal hai.
 *
 * ZAROORI: AI jawab NAHI likhta. Jawab hamesha aap ki Excel mein jo likha
 * hai wahi jata hai, lafz ba lafz. AI ka kaam sirf sahi row chunna hai —
 * ya kehna "ye kisi topic ka nahi, bot khamosh rahe".
 *
 * Teen option — AI_PROVIDER se chunein
 * ------------------------------------
 *   gemini   Google Gemini     — muft tier, card nahi chahiye   (default)
 *   groq     Groq              — muft tier, data save nahi hota
 *   claude   Claude Haiku      — paid, sab se behtar Roman Urdu
 *
 * Koi key set na ho to ye poora hissa band — bot bilkul pehle jaisa chalta
 * rahega, kuch tootta nahi.
 *
 * Paisa aur quota bachane ke teen pehre
 * -------------------------------------
 *   1. Cache  — bilkul wohi jumla dobara aaye to AI ko pucha hi nahi jata
 *   2. Hadd   — roz AI_MAX_PER_DAY se zyada call nahi (default 300)
 *   3. Mauqa  — AI sirf tab chalta hai jab lafz wala rasta na chala ho
 *
 * Privacy
 * -------
 * AI ko bhejne se PEHLE message mein se order number, phone number,
 * confirmation number aur email hata diye jate hain — classifier ko sirf
 * baat ka matlab chahiye, numbers ki zaroorat nahi. Customer ki zaati
 * maloomat kisi bahar wali service tak jati hi nahi.
 */

import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeForMatch } from '@/lib/textNormalize'

export type AiProvider = 'gemini' | 'groq' | 'claude'
export type AiMode = 'off' | 'check' | 'full'

export interface AiFaisla {
  /** Aap ki Excel ka topic ka naam — ya null (koi topic nahi) */
  topic: string | null
  /** AI kehta hai ye baat insaan ke liye hai — bot khamosh rahe */
  insaan: boolean
  /** Log ke liye: kahan se aaya */
  kahan: 'cache' | 'ai'
}

// Gemini 3.x jawab dene se pehle thora "sochta" hai — asli jumlon par 3 se
// 7 second lag jate hain. 8 second ki hadd us ke bohat kareeb thi, is liye
// 12 kar di hai. (Function ki apni hadd 30 second hai — maxDuration.)
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 12_000
const MAX_PER_DAY = Number(process.env.AI_MAX_PER_DAY) || 300
// Topic ki list prompt mein jati hai — har topic ke itne namune
const NAMUNE_PER_TOPIC = 3

// ── Kaun sa provider, kaun sa model ────────────────────────────────────────

export function aiProvider(): AiProvider {
  const p = String(process.env.AI_PROVIDER || 'gemini').toLowerCase().trim()
  if (p === 'groq') return 'groq'
  if (p === 'claude' || p === 'anthropic' || p === 'haiku') return 'claude'
  return 'gemini'
}

function aiKey(p: AiProvider): string | undefined {
  if (p === 'gemini') return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (p === 'groq') return process.env.GROQ_API_KEY
  return process.env.ANTHROPIC_API_KEY
}

function aiModel(p: AiProvider): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL
  // Har provider ka sab se sasta/tez model jo is kaam ke liye kaafi hai
  if (p === 'gemini') return 'gemini-3.5-flash-lite'
  if (p === 'groq') return 'llama-3.3-70b-versatile'
  return 'claude-haiku-5-5'
}

/** Key set hai? Na ho to ye poora hissa band. */
export function aiAvailable(): boolean {
  if (aiMode() === 'off') return false
  return Boolean(aiKey(aiProvider()))
}

/**
 * AI kitna kaam kare:
 *   off    bilkul band (purana tareeqa hi chalega)
 *   check  sirf PEHRA — lafz wala jawab ghalat lage to rok de. Naya jawab
 *          nahi bhejta, is liye Meta ke message BARHTE NAHI, kam hote hain.
 *   full   pehra + bachao — jo sawaal lafz se na mile, AI us ka sahi topic
 *          dhoond kar aap ka saved jawab bhej deta hai (default)
 */
export function aiMode(): AiMode {
  const m = String(process.env.AI_MODE || 'full').toLowerCase().trim()
  if (m === 'off') return 'off'
  if (m === 'check') return 'check'
  return 'full'
}

// ── Privacy: numbers aur email hatao ──────────────────────────────────────

/**
 * Classifier ko sirf baat ka matlab chahiye. Order number, phone number,
 * confirmation code aur email nikal kar hi bhejte hain.
 */
export function zaatiMaloomatHatao(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '(email)')
    .replace(/#\s*[A-Za-z0-9]{6,}/g, '(number)')
    .replace(/\b[A-Za-z]{0,3}\d[\d\s-]{3,}\d\b/g, '(number)')
    .replace(/\b\d{4,}\b/g, '(number)')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Cache: wohi jumla dobara aaye to AI ko pucha hi na jaye ───────────────

function cacheKey(text: string, topicsVersion: string): string {
  return createHash('sha1')
    .update(topicsVersion + '|' + normalizeForMatch(text))
    .digest('hex')
}

async function cacheSeDekho(key: string): Promise<AiFaisla | null> {
  const { data, error } = await supabaseAdmin
    .from('ai_topic_cache')
    .select('topic, insaan')
    .eq('message_hash', key)
    .maybeSingle()

  if (error || !data) return null
  return {
    topic: data.topic ? String(data.topic) : null,
    insaan: Boolean(data.insaan),
    kahan: 'cache',
  }
}

async function cacheMeinRakho(key: string, f: AiFaisla, saaf: string) {
  await supabaseAdmin.from('ai_topic_cache').upsert({
    message_hash: key,
    topic: f.topic,
    insaan: f.insaan,
    sample: saaf.slice(0, 200),
    created_at: new Date().toISOString(),
  })
}

// ── Roz ki hadd ───────────────────────────────────────────────────────────

/** Aaj kitne AI call ho chuke? Hadd paar ho to AI band, purana rasta chalega. */
export async function aajKiGinti(): Promise<number> {
  const subah = new Date()
  subah.setUTCHours(0, 0, 0, 0)
  const { count, error } = await supabaseAdmin
    .from('ai_call_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', subah.toISOString())
  if (error) return 0
  return count || 0
}

async function callLikho(
  provider: string,
  model: string,
  topic: string | null,
  insaan: boolean,
  ms: number
) {
  await supabaseAdmin.from('ai_call_log').insert({
    provider,
    model,
    topic,
    insaan,
    ms,
    created_at: new Date().toISOString(),
  })
}

// ── Topic ki list (prompt ke liye) ────────────────────────────────────────

export interface TopicNamuna {
  topic: string
  questions: string[]
}

let topicCache: { list: TopicNamuna[]; version: string; at: number } | null = null
const TOPIC_CACHE_MS = 60_000

/** Aap ki Excel ke topics — naam aur do teen namune sawaal. */
export async function topicList(): Promise<{ list: TopicNamuna[]; version: string }> {
  const now = Date.now()
  if (topicCache && now - topicCache.at < TOPIC_CACHE_MS) {
    return { list: topicCache.list, version: topicCache.version }
  }

  const { data, error } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions')
    .eq('is_active', true)

  if (error || !data) {
    console.warn('[ai] topics parh nahi saka:', error?.message)
    return { list: [], version: '0' }
  }

  const list: TopicNamuna[] = []
  for (const row of data) {
    const topic = String(row.topic || '').trim()
    if (!topic) continue
    const questions = String(row.questions || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, NAMUNE_PER_TOPIC)
    list.push({ topic, questions })
  }
  list.sort((a, b) => a.topic.localeCompare(b.topic))

  // Topics badlein to cache ki chaabi bhi badal jaye — purane faisle naye
  // topics ke sath na chipke rahein.
  const version = createHash('sha1')
    .update(list.map((t) => t.topic).join('|'))
    .digest('hex')
    .slice(0, 8)

  topicCache = { list, version, at: now }
  return { list, version }
}

// ── Prompt ────────────────────────────────────────────────────────────────

function hidayat(list: TopicNamuna[]): string {
  const rows = list
    .map((t, i) => {
      const namune = t.questions.length ? ' — jaise: ' + t.questions.join(' / ') : ''
      return String(i + 1) + '. ' + t.topic + namune
    })
    .join('\n')

  return [
    'Aap Pakistan ki ek mobile cover shop (Myzan) ki WhatsApp support ki madad kar rahe hain.',
    'Customer ke message ka matlab samajh kar batana hai ke ye NEECHE DI GAYI list ke kis topic ka sawaal hai.',
    '',
    'Customer Roman Urdu, Urdu aur English mila kar likhte hain, aur spelling aksar ghalat hoti hai.',
    'Aap ne khud jawab NAHI likhna. Sirf topic ka naam chunna hai.',
    '',
    'SAB SE AHEM BAAT — HAR MESSAGE PAR PAISA LAGTA HAI:',
    'Shop ko WhatsApp par bheje gaye HAR message ka paisa dena parta hai. Ek',
    'faltu ya ghalat message sirf paisa zaya nahi karta, customer ko pareshan',
    'bhi karta hai aur dukan ki sakh girata hai. Is liye aap ka pehla sawaal',
    'khud se hamesha ye ho: "kya is message ka jawab bhejna WAQAI zaroori hai?"',
    'Zara sa bhi shak ho to topic null — khamoshi muft hai, ghalti mehngi.',
    '',
    'TOPICS:',
    rows,
    '',
    'QAWANEEN (bohat ahem):',
    '- Jab tak poora yaqeen na ho, topic na chunein. Ghalat jawab bhejna, khamosh rehne se zyada nuqsan deta hai.',
    '- In sooraton mein "human": true dein aur topic null —',
    '    * customer koi shikayat, cancel, return, refund, address badalna ya paisa wapas maang raha ho',
    '    * baat jari ho aur ye sirf haan/na, shukriya, "ok", "I know that", "I am waiting" jaisa jawab ho',
    '    * customer ko kisi insaan se baat karni ho, ya baat uljhi hui ho',
    '    * message ka matlab hi samajh na aaye',
    '- Ye cheezein KABHI topic nahi banteen (topic null) — in par bot ka jawab sirf paisa zaya karta hai:',
    '    * sirf salaam, shukriya, duaen, emoji, "ji", "acha", "theek hai"',
    '    * customer ka apna faisla ya elaan ("ma soch kar batata hun", "baad mein lunga")',
    '    * jo baat customer pehle hi poochh chuka ho aur jawab ja chuka ho',
    '- Apne maujooda order ki khabar (kab milega, kahan hai, abhi tak nahi aaya) ka topic na chunein —',
    '  ye baat bot khud tracking ke raste se sambhalta hai. Aise message par topic null.',
    '- Matlab saaf ho lekin list mein us ka koi topic na ho, to topic null aur human false.',
    '- Sirf wahi topic naam likhein jo list mein LAFZ BA LAFZ mojood hai.',
    '',
    'Jawab sirf JSON mein, kuch aur nahi:',
    '{"topic": "<list ka topic naam ya null>", "human": <true ya false>}',
  ].join('\n')
}

// ── Providers ─────────────────────────────────────────────────────────────

async function withTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal, cache: 'no-store' })
  } catch (e: any) {
    console.warn('[ai] call nakaam:', e?.name === 'AbortError' ? 'waqt khatam' : e?.message || e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function geminiCall(
  key: string,
  model: string,
  system: string,
  user: string
): Promise<string | null> {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) +
    ':generateContent?key=' +
    encodeURIComponent(key)

  const res = await withTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }),
  })
  if (!res) return null
  if (!res.ok) {
    console.warn('[ai] gemini:', res.status, (await res.text()).slice(0, 300))
    return null
  }
  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null
  const text = parts.map((p: any) => p?.text || '').join('')
  return text || null
}

async function groqCall(
  key: string,
  model: string,
  system: string,
  user: string
): Promise<string | null> {
  const res = await withTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 256,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res) return null
  if (!res.ok) {
    console.warn('[ai] groq:', res.status, (await res.text()).slice(0, 300))
    return null
  }
  const json = await res.json()
  const txt = json?.choices?.[0]?.message?.content
  return txt ? String(txt) : null
}

async function claudeCall(
  key: string,
  model: string,
  system: string,
  user: string
): Promise<string | null> {
  const res = await withTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res) return null
  if (!res.ok) {
    console.warn('[ai] claude:', res.status, (await res.text()).slice(0, 300))
    return null
  }
  const json = await res.json()
  const blocks = json?.content
  if (!Array.isArray(blocks)) return null
  const text = blocks
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('')
  return text || null
}

/**
 * Seedha AI se baat — jo bhi provider chalu hai usi se.
 *
 * `samjho()` ek message ka topic batata hai. Ye us se neeche ki seerhi hai:
 * koi bhi hidayat aur koi bhi matan bhej kar kachcha jawab lena. Hafta-war
 * tajweez wala hissa (aiSuggest.ts) isi se kaam leta hai.
 *
 * Yahan na cache hai na rozana ki hadd — bulane wala khud sambhale.
 */
export async function aiPoochho(system: string, user: string): Promise<string | null> {
  const provider = aiProvider()
  const key = aiKey(provider)
  if (!key) return null

  const model = aiModel(provider)
  const shuru = Date.now()

  let raw: string | null = null
  if (provider === 'gemini') raw = await geminiCall(key, model, system, user)
  else if (provider === 'groq') raw = await groqCall(key, model, system, user)
  else raw = await claudeCall(key, model, system, user)

  const laga = Date.now() - shuru
  if (!raw) {
    console.warn('[ai] ' + provider + ' se jawab nahi aaya (' + laga + 'ms)')
    return null
  }
  console.log('[ai] ' + provider + '/' + model + ' — ' + laga + 'ms, ' + raw.length + ' harf')
  await callLikho(provider, model, null, false, laga)
  return raw
}

// ── JSON parhna ───────────────────────────────────────────────────────────

function jsonNikalo(raw: string): { topic: string | null; human: boolean } | null {
  // Model kabhi JSON ke aage peeche kuch likh deta hai — pehle { se aakhri }
  const shuru = raw.indexOf('{')
  const khatam = raw.lastIndexOf('}')
  if (shuru < 0 || khatam <= shuru) return null
  try {
    const o = JSON.parse(raw.slice(shuru, khatam + 1))
    const t = o?.topic
    const khali =
      t === null ||
      t === undefined ||
      String(t).trim() === '' ||
      String(t).toLowerCase() === 'null' ||
      String(t).toLowerCase() === 'none'
    return { topic: khali ? null : String(t).trim(), human: Boolean(o?.human) }
  } catch {
    return null
  }
}

/** AI ka chuna hua naam asli topic se milao (thora farq chal jaye) */
function topicMilao(naam: string, list: TopicNamuna[]): string | null {
  const saaf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const target = saaf(naam)
  if (!target) return null
  const theek = list.find((t) => saaf(t.topic) === target)
  if (theek) return theek.topic
  // AI ne naam thora chhota ya bara likh diya ho
  const halka = list.find(
    (t) => saaf(t.topic).includes(target) || target.includes(saaf(t.topic))
  )
  return halka ? halka.topic : null
}

// ── Asal kaam ─────────────────────────────────────────────────────────────

/**
 * Customer ka message samajh kar aap ki Excel ka topic batata hai.
 *
 * Wapas null ka matlab: AI se pucha hi nahi gaya (band hai, hadd paar ho
 * gayi, ya call nakaam) — us soorat mein purana lafz wala faisla hi chalega.
 */
export async function samjho(text: string): Promise<AiFaisla | null> {
  if (!aiAvailable()) return null

  const provider = aiProvider()
  const key = aiKey(provider)
  if (!key) return null

  const { list, version } = await topicList()
  if (!list.length) return null

  const saaf = zaatiMaloomatHatao(text)
  if (!saaf) return null

  // 1) Cache — wohi jumla pehle aa chuka hai?
  const ck = cacheKey(saaf, version)
  const cached = await cacheSeDekho(ck)
  if (cached) {
    console.log('[ai] cache se: topic=' + (cached.topic || 'koi nahi') + ' insaan=' + cached.insaan)
    return cached
  }

  // 2) Roz ki hadd
  const ginti = await aajKiGinti()
  if (ginti >= MAX_PER_DAY) {
    console.warn('[ai] aaj ki hadd (' + MAX_PER_DAY + ') paar — AI band, purana rasta chalega')
    return null
  }

  // 3) Puchho
  const model = aiModel(provider)
  const system = hidayat(list)
  const shuru = Date.now()
  let raw: string | null = null
  if (provider === 'gemini') raw = await geminiCall(key, model, system, saaf)
  else if (provider === 'groq') raw = await groqCall(key, model, system, saaf)
  else raw = await claudeCall(key, model, system, saaf)
  const laga = Date.now() - shuru

  if (!raw) {
    console.warn('[ai] ' + provider + ' se jawab nahi aaya (' + laga + 'ms)')
    return null
  }

  const parsed = jsonNikalo(raw)
  if (!parsed) {
    console.warn('[ai] jawab JSON nahi tha:', raw.slice(0, 200))
    return null
  }

  const topic = parsed.topic ? topicMilao(parsed.topic, list) : null
  if (parsed.topic && !topic) {
    console.warn('[ai] "' + parsed.topic + '" naam ka koi topic Excel mein nahi')
  }

  const faisla: AiFaisla = { topic, insaan: parsed.human, kahan: 'ai' }
  console.log(
    '[ai] ' + provider + '/' + model + ' (' + laga + 'ms): topic=' +
      (topic || 'koi nahi') + ' insaan=' + parsed.human
  )

  await Promise.all([
    cacheMeinRakho(ck, faisla, saaf),
    callLikho(provider, model, topic, parsed.human, laga),
  ])

  return faisla
}
