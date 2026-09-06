import { supabaseAdmin } from '@/lib/supabase'
import { buildIndex, matchAgainstIndex, explainMatches } from '@/lib/qnaMatch'
import type { QnaEntry, QnaIndex, MatchResult } from '@/lib/qnaMatch'

/**
 * WhatsApp Cloud API se text message bhejta hai.
 * Sirf inbound reply ke liye use hota hai - kabhi khud se pehle message
 * initiate nahi karta, isliye ye hamesha free hai (24-hour customer service
 * window ke andar).
 */
export async function sendWhatsAppText(to: string, body: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN!
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  })

  if (!res.ok) {
    console.error('[whatsapp] send failed:', await res.text())
  }
  return res.json()
}

// ── Q&A bank ───────────────────────────────────────────────────────────────
//
// Sirf qna_topics se — 'questions' column mein har line par ek POORA sawaal.
//
// Purani 'qna' table (comma-separated keywords wali) delete kar di gayi hai,
// owner ke kehne par. Us ka content /admin/qna se Excel mein wapas add kiya
// ja sakta hai.

const CACHE_MS = 60_000

let cachedIndex: QnaIndex | null = null
let cachedAt = 0
let cachedEntryCount = 0

function splitQuestions(raw: string): string[] {
  // Har line par ek sawaal. Agar poori cheez ek hi line mein ho to comma
  // par tor dete hain — taake koi purane andaz mein likh de to bhi chale.
  const byLine = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (byLine.length > 1) return byLine

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function loadEntries(): Promise<QnaEntry[]> {
  const entries: QnaEntry[] = []

  // Table na mile to error aayega — us soorat mein khali bank ke saath aage
  // badh jate hain (bot Q&A ka jawab nahi dega, baqi sab chalta rahega).
  const { data: topics, error: topicsError } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions, answer, priority')
    .eq('is_active', true)

  if (topicsError) {
    console.warn('[qna] qna_topics parh nahi saka:', topicsError.message)
  } else if (topics) {
    for (const row of topics) {
      const questions = splitQuestions(String(row.questions || ''))
      if (!questions.length || !row.answer) continue
      entries.push({
        topic: String(row.topic || 'Untitled'),
        answer: String(row.answer),
        questions,
        priority: Number(row.priority) || 0,
      })
    }
  }

  return entries
}

async function getIndex(force = false): Promise<QnaIndex> {
  const now = Date.now()
  if (!force && cachedIndex && now - cachedAt < CACHE_MS) return cachedIndex

  const entries = await loadEntries()
  cachedIndex = buildIndex(entries)
  cachedAt = now
  cachedEntryCount = entries.length
  return cachedIndex
}

/** Cache turant khaali karo — Excel import ke baad kaam aata hai. */
export function invalidateQnaCache() {
  cachedIndex = null
  cachedAt = 0
}

/**
 * Greeting ka topic. Is ka jawab bot har naye customer ko sab se pehle
 * bhejta hai, is liye ise Q&A matching se BAHAR rakhte hain — warna "Hi"
 * likhne wale ko wahi message do dafa chala jata.
 */
export const GREETING_TOPIC = 'Salaam / Greeting'

/**
 * Customer ka POORA sawaal parh kar behtareen jawab dhoondta hai.
 * Threshold se kam score par null — bot andaza nahi lagata.
 */
export async function matchQna(text: string): Promise<string | null> {
  const result = await matchQnaDetailed(text)
  return result ? result.answer : null
}

/** Wahi matching, lekin score/topic ke sath — logging aur testing ke liye. */
export async function matchQnaDetailed(text: string): Promise<MatchResult | null> {
  const index = await getIndex()
  if (index.docs.length === 0) return null

  const result = matchAgainstIndex(index, text)
  if (!result) return null

  // Greeting alag se bheja jata hai — yahan se nahi
  if (result.topic === GREETING_TOPIC) return null

  return result
}

/**
 * Aap ka apna greeting message (Excel ki "Salaam / Greeting" row ka jawab).
 * Agar aap ne wo row nahi bhari to null — us soorat mein bot greeting nahi
 * bhejega, seedha sawaal ka jawab dega.
 */
export async function getGreetingMessage(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('qna_topics')
    .select('answer')
    .eq('topic', GREETING_TOPIC)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.warn('[qna] greeting parh nahi saka:', error.message)
    return null
  }
  return data && data.answer ? String(data.answer) : null
}

/** Debugging: top 5 candidates score ke sath. */
export async function debugQna(text: string) {
  const index = await getIndex(true)
  return {
    entries: cachedEntryCount,
    documents: index.docs.length,
    matches: explainMatches(index, text, 5),
  }
}
