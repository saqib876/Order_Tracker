/**
 * Q&A matching engine — POORA SAWAAL padhta hai, keyword nahi dhoondta.
 *
 * Purana tareeqa (substring) is liye toot ta tha:
 *     store kiya : "parcel kab tak"
 *     customer   : "Parcel ki delivery kab tak possible hai"
 *     natija     : FAIL — beech mein "ki delivery" aa gaya
 *
 * Naya tareeqa: dono taraf ke lafz alag karke score nikalte hain. Lafzon ki
 * tarteeb badle, beech mein kuch aa jaye, aakhir mein kuch laga ho — koi
 * farq nahi parta.
 *
 * Score kaise banta hai
 * ---------------------
 * 1. Dono ko normalize karo (textNormalize.ts) — spelling/short-form seedhi
 * 2. Faltu lafz (stopwords) hata do — "hai, ka, ki, ko, se" har sawaal mein
 *    hote hain, in se koi faisla nahi hota
 * 3. Har lafz ko WEIGHT do (IDF): jo lafz kam sawaalon mein aata hai woh
 *    zyada ahem hai. "cancel" decisive hai, "order" har jagah hai.
 * 4. Precision + Recall ka F1:
 *      precision = kitna store kiya hua sawaal customer ke message mein mila
 *      recall    = customer ke message ka kitna hissa samjha gaya
 *    F1 dono ko balance karta hai. Isi liye sirf "order" store karne se
 *    har sawaal match nahi hoga — recall gir jayega.
 * 5. Agar score threshold se kam hai to bot ANDAZA NAHI lagata.
 *    Galat jawab, koi jawab na hone se zyada nuqsan karta hai.
 */

import { normalizeForMatch } from '@/lib/textNormalize'
import { toConcept } from '@/lib/synonyms'

// ── Faltu lafz ────────────────────────────────────────────────────────────
// NOTE: negation (nahi / na / ni / nh) yahan JAAN BOOJH KAR nahi hai —
// "cancel na karo" aur "cancel karo" ka matlab ulta hai.
const STOPWORDS = new Set([
  // Roman Urdu
  'hai', 'ha', 'hy', 'h', 'ho', 'hain', 'hn', 'hun', 'hoon', 'hoga', 'hogi',
  'ka', 'ki', 'ke', 'k', 'ko', 'se', 'sy', 'mein', 'me', 'ma', 'main', 'mai',
  'par', 'pe', 'py', 'pr', 'aur', 'or', 'to', 'tou', 'ye', 'yeh', 'ya', 'wo',
  'woh', 'is', 'us', 'ap', 'aap', 'apna', 'apni', 'apne', 'bhai', 'bhaii',
  'sir', 'ji', 'g', 'please', 'plz', 'plzz', 'pls', 'kindly', 'tha', 'thi',
  'thay', 'hua', 'huwa', 'hoi', 'kar', 'kr', 'karo', 'kro', 'karna', 'krna',
  'kya', 'kia', 'kiya', 'do', 'dein', 'den', 'dy', 'de', 'da', 'ek', 'aik',
  'koi', 'kuch', 'bhi', 'b', 'jo', 'agar', 'agr', 'lekin', 'magar',
  // English
  'i', 'my', 'me', 'you', 'your', 'the', 'a', 'an', 'of', 'for', 'on', 'in',
  'it', 'this', 'that', 'and', 'so', 'but', 'at', 'be', 'im', 'its', 'we',
  'us', 'our', 'please', 'want', 'get', 'got',
])

export interface QnaEntry {
  topic: string
  answer: string
  /** Har element ek poora sawaal hai (variant) */
  questions: string[]
  priority: number
}

export interface MatchResult {
  answer: string
  topic: string
  score: number
  /** Store kiya hua woh sawaal jis se match hua — debugging ke liye */
  matchedQuestion: string
}

interface Doc {
  entry: QnaEntry
  /** normalized poora sawaal (phrase bonus ke liye) */
  raw: string
  tokens: string[]
  tokenSet: Set<string>
}

export interface QnaIndex {
  docs: Doc[]
  idf: (token: string) => number
  /**
   * Customer ke lafz ko bank ke sabse milte-julte lafz par le jata hai
   * (spelling ki galti ke liye). Kuch na mile to lafz waisa hi wapas.
   */
  resolveToken: (token: string) => string
}

// ── Spelling ki galtiyan ───────────────────────────────────────────────────
// Dictionary mein har typo likhna namumkin hai ("recieve", "reciev", "recevie"
// ...). Is liye jo lafz bank mein bilkul na mile, use bank ke sabse milte-julte
// lafz se mila dete hain — teen-teen harf ke tukdon (trigrams) ki bunyaad par.
const FUZZY_MIN_SIMILARITY = 0.62
// Chhote lafzon par fuzzy khatarnak hai (kab/kar/kam sab ek jaise lagte hain)
const FUZZY_MIN_LENGTH = 5

function trigrams(word: string): string[] {
  if (word.length < 3) return [word]
  const out: string[] = []
  for (let i = 0; i <= word.length - 3; i++) out.push(word.slice(i, i + 3))
  return out
}

/** Dice similarity: 0 se 1 ke darmiyan */
function diceSimilarity(aGrams: string[], bGrams: string[]): number {
  if (aGrams.length === 0 || bGrams.length === 0) return 0
  const bSet = new Set(bGrams)
  let shared = 0
  for (const g of aGrams) if (bSet.has(g)) shared++
  return (2 * shared) / (aGrams.length + bGrams.length)
}

/**
 * Default hadd + ambiguity margin.
 *
 * Ye values andaze se nahi chuni gayin — aap ke 979 asli sawaalon par
 * held-out test (har teesra sawaal bank se chhupa kar) ka poora grid:
 *
 *   margin \ thr    0.34         0.38         0.40         0.45
 *      0        60.0 / 6.7   55.0 / 5.8   54.2 / 5.0   48.3 / 0.8
 *      0.10     55.0 / 2.5   50.8 / 2.5   50.0 / 2.5   45.0 / 0.0
 *      0.15     51.7 / 0.0   49.2 / 0.0   48.3 / 0.0   44.2 / 0.0
 *      0.20     47.5 / 0.0   45.8 / 0.0   45.8 / 0.0   42.5 / 0.0
 *                                         (sahi% / GALAT%)
 *
 * Chuna gaya: threshold 0.40 + margin 0.15 -> 48.3% sahi, 0% galat.
 *
 * 0.34 thora zyada coverage deta hai (51.7%) lekin jab Q&A bank chhota ho
 * (jaise deploy ke pehle din, jab sirf purani 3 entries hain) to wahan
 * ghalat jawab aane lagte hain — test kar ke dekha gaya. 0.40 dono soorton
 * mein mehfooz rehta hai.
 *
 * Env se badla ja sakta hai: QNA_MATCH_THRESHOLD, QNA_AMBIGUITY_MARGIN
 */
export const DEFAULT_THRESHOLD = 0.4

/**
 * Ambiguity guard: agar sabse behtar topic aur doosre number ke topic ka
 * score is se kam farq rakhta ho, to bot jawab nahi deta.
 *
 * Maqsad: "koi galat jawab na jaye". Env AMBIGUITY_MARGIN se badla ja sakta hai.
 */
export const DEFAULT_AMBIGUITY_MARGIN = 0.15

const AMBIGUITY_MARGIN = (() => {
  const raw = process.env.QNA_AMBIGUITY_MARGIN
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : DEFAULT_AMBIGUITY_MARGIN
})()


export function getThreshold(): number {
  const raw = process.env.QNA_MATCH_THRESHOLD
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_THRESHOLD
}

/**
 * Message ko content-lafzon mein torta hai.
 *
 * Aakhri qadam ham-mani lafzon ko ek canonical lafz par le aata hai
 * (cover/case -> cover, when/kab -> kab), taake English aur Roman Urdu
 * likhne wale dono ek hi bank se match ho sakein.
 */
export function tokenize(text: string): string[] {
  return normalizeForMatch(text)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(toConcept)
    .filter((w) => !STOPWORDS.has(w))
}

/**
 * Saare stored sawaalon se index banata hai (IDF weights samet).
 * Ye har message par dobara nahi banta — whatsapp.ts ise cache karta hai.
 */
export function buildIndex(entries: QnaEntry[]): QnaIndex {
  const docs: Doc[] = []

  for (const entry of entries) {
    for (const q of entry.questions) {
      const tokens = tokenize(q)
      if (tokens.length === 0) continue
      docs.push({
        entry,
        raw: normalizeForMatch(q),
        tokens,
        tokenSet: new Set(tokens),
      })
    }
  }

  // document frequency
  const df = new Map<string, number>()
  for (const d of docs) {
    for (const t of Array.from(d.tokenSet)) {
      df.set(t, (df.get(t) || 0) + 1)
    }
  }

  const n = docs.length || 1
  const idf = (token: string): number => {
    const seen = df.get(token) || 0
    // smoothed IDF — hamesha > 0, taake naya lafz bhi score de sake
    return Math.log((n + 1) / (seen + 1)) + 1
  }

  // ── Spelling ki galtiyon ke liye trigram index ──────────────────────────
  // Har lafz ke teen-harf wale tukde nikal kar ulta naqsha banate hain, taake
  // "recevie" jaise anjaan lafz ka sabse qareebi lafz foran mil jaye —
  // poori vocabulary chhanne ki zarurat nahi parti.
  const vocab = Array.from(df.keys())
  const vocabGrams = new Map<string, string[]>()
  const gramToTokens = new Map<string, string[]>()

  for (const token of vocab) {
    const grams = trigrams(token)
    vocabGrams.set(token, grams)
    for (const g of grams) {
      const list = gramToTokens.get(g)
      if (list) list.push(token)
      else gramToTokens.set(g, [token])
    }
  }

  const resolveCache = new Map<string, string>()

  const resolveToken = (token: string): string => {
    if (df.has(token)) return token // bank mein bilkul mojood hai
    if (token.length < FUZZY_MIN_LENGTH) return token

    const cached = resolveCache.get(token)
    if (cached !== undefined) return cached

    const grams = trigrams(token)
    const candidates = new Set<string>()
    for (const g of grams) {
      const list = gramToTokens.get(g)
      if (list) for (const t of list) candidates.add(t)
    }

    let best = token
    let bestSim = FUZZY_MIN_SIMILARITY

    for (const cand of Array.from(candidates)) {
      if (cand.length < FUZZY_MIN_LENGTH) continue
      if (Math.abs(cand.length - token.length) > 3) continue
      if (cand[0] !== token[0]) continue // pehla harf aksar sahi hota hai
      const sim = diceSimilarity(grams, vocabGrams.get(cand) || [])
      if (sim > bestSim) {
        bestSim = sim
        best = cand
      }
    }

    resolveCache.set(token, best)
    return best
  }

  return { docs, idf, resolveToken }
}

function massOf(tokens: Set<string>, idf: (t: string) => number): number {
  let sum = 0
  for (const t of Array.from(tokens)) sum += idf(t)
  return sum
}

/**
 * Ek stored sawaal ka score. SIRF YAHAN scoring hoti hai — matchAgainstIndex
 * aur explainMatches dono isi ko bulate hain, taake dono kabhi alag na hon.
 * Match na ho to 0.
 */
function scoreDoc(
  doc: Doc,
  qSet: Set<string>,
  qMass: number,
  normalizedMessage: string,
  idf: (t: string) => number
): number {
  let interMass = 0
  for (const t of Array.from(doc.tokenSet)) {
    if (qSet.has(t)) interMass += idf(t)
  }
  if (interMass === 0) return 0

  const docMass = massOf(doc.tokenSet, idf)
  if (docMass === 0) return 0

  const precision = interMass / docMass
  const recall = interMass / qMass
  const score = (2 * precision * recall) / (precision + recall)

  // Phrase bonus: poora stored sawaal jyun ka tyun message ke andar mila.
  //
  // Shart: stored sawaal mein kam se kam 3 content-lafz hon. Warna chhote
  // tukde (jaise "order kb") har lambe message ke andar mil jate hain aur
  // 0.9 ka jhoota score de dete hain — yehi purane substring system ki asal
  // kharabi thi, aur test mein ye dobara pakri gayi.
  if (
    doc.tokens.length >= 3 &&
    doc.raw.length >= 12 &&
    normalizedMessage.includes(doc.raw)
  ) {
    return Math.max(score, 0.9)
  }

  return score
}

/**
 * Ek customer message ka sabse behtar jawab dhoondta hai.
 * Threshold se kam score par null — yani bot andaza nahi lagayega.
 */
export function matchAgainstIndex(
  index: QnaIndex,
  message: string,
  threshold: number = getThreshold()
): MatchResult | null {
  const qTokens = tokenize(message).map(index.resolveToken)
  if (qTokens.length === 0) return null

  const qSet = new Set(qTokens)
  const qMass = massOf(qSet, index.idf)
  if (qMass === 0) return null

  const normalizedMessage = normalizeForMatch(message)

  let bestDoc: Doc | null = null
  let bestScore = 0
  // Dusre topic ka sabse acha score — ambiguity check ke liye
  let rivalScore = 0
  let rivalTopic = ''

  for (const doc of index.docs) {
    const score = scoreDoc(doc, qSet, qMass, normalizedMessage, index.idf)
    if (score === 0) continue

    // Barabar score par zyada priority wala topic jeetega.
    const better =
      !bestDoc ||
      score > bestScore ||
      (score === bestScore && doc.entry.priority > bestDoc.entry.priority)

    if (better) {
      // purana best ab rival ban sakta hai (agar topic alag hai)
      if (bestDoc && bestDoc.entry.topic !== doc.entry.topic && bestScore > rivalScore) {
        rivalScore = bestScore
        rivalTopic = bestDoc.entry.topic
      }
      bestDoc = doc
      bestScore = score
    } else if (bestDoc && doc.entry.topic !== bestDoc.entry.topic && score > rivalScore) {
      rivalScore = score
      rivalTopic = doc.entry.topic
    }
  }

  if (!bestDoc || bestScore < threshold) return null

  // ── Ambiguity guard ─────────────────────────────────────────────────────
  // Agar do ALAG topics ka score qareeb qareeb hai to bot ko pata hi nahi ke
  // customer kis baare mein poochh raha hai. Aise mein andaza lagane se behtar
  // hai chup rehna — fallback insaan tak pohancha dega.
  if (rivalTopic && rivalTopic !== bestDoc.entry.topic) {
    if (bestScore - rivalScore < AMBIGUITY_MARGIN) return null
  }

  return {
    answer: bestDoc.entry.answer,
    topic: bestDoc.entry.topic,
    score: bestScore,
    matchedQuestion: bestDoc.raw,
  }
}

/**
 * Debugging / testing ke liye — top N matches score ke sath.
 * Isse pata chalta hai ke bot ne kyun ye jawab chuna.
 */
export function explainMatches(
  index: QnaIndex,
  message: string,
  topN = 5
): MatchResult[] {
  const qTokens = tokenize(message).map(index.resolveToken)
  if (qTokens.length === 0) return []

  const qSet = new Set(qTokens)
  const qMass = massOf(qSet, index.idf)
  if (qMass === 0) return []

  const normalizedMessage = normalizeForMatch(message)
  const results: MatchResult[] = []

  for (const doc of index.docs) {
    const score = scoreDoc(doc, qSet, qMass, normalizedMessage, index.idf)
    if (score === 0) continue

    results.push({
      answer: doc.entry.answer,
      topic: doc.entry.topic,
      score,
      matchedQuestion: doc.raw,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topN)
}
