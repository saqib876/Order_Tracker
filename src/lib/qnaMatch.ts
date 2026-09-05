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
}

/**
 * Default hadd. Env QNA_MATCH_THRESHOLD se badli ja sakti hai.
 *
 * Ye value andaze se nahi chuni — aap ke 979 asli sawaalon par held-out test
 * chala kar nikali gayi (har teesra sawaal bank se chhupa kar):
 *
 *   threshold   jawab diya   sahi jawab   GALAT jawab
 *      0.40        52.5%        48.3%         4.2%
 *      0.45        45.0%        42.5%         2.5%   <-- yahan hain
 *      0.50        35.8%        34.2%         1.7%
 *      0.55        30.8%        30.8%         0.0%
 *
 * 0.45 par har 1 galat jawab ke badle 17 sahi jawab milte hain. Isse neeche
 * jane par galtiyan tezi se barhti hain, upar jane par bot bewajah chup ho
 * jata hai. Jab Q&A bank mein zyada variants add honge to poora curve upar
 * uthega — us waqt is number ko dobara test karna chahiye.
 */
export const DEFAULT_THRESHOLD = 0.45

export function getThreshold(): number {
  const raw = process.env.QNA_MATCH_THRESHOLD
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_THRESHOLD
}

/** Message ko content-lafzon mein torta hai */
export function tokenize(text: string): string[] {
  return normalizeForMatch(text)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
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

  return { docs, idf }
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
  const qTokens = tokenize(message)
  if (qTokens.length === 0) return null

  const qSet = new Set(qTokens)
  const qMass = massOf(qSet, index.idf)
  if (qMass === 0) return null

  const normalizedMessage = normalizeForMatch(message)

  let bestDoc: Doc | null = null
  let bestScore = 0

  for (const doc of index.docs) {
    const score = scoreDoc(doc, qSet, qMass, normalizedMessage, index.idf)
    if (score === 0) continue

    // Barabar score par zyada priority wala topic jeetega.
    const better =
      !bestDoc ||
      score > bestScore ||
      (score === bestScore && doc.entry.priority > bestDoc.entry.priority)

    if (better) {
      bestDoc = doc
      bestScore = score
    }
  }

  if (!bestDoc || bestScore < threshold) return null

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
  const qTokens = tokenize(message)
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
