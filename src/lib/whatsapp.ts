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
// Do jagah se parhta hai:
//   1. qna_topics  (naya)   — 'questions' column, har line par POORA sawaal
//   2. qna         (purana) — 'keywords' comma-separated
//
// Dono ko ek hi shakal mein badal kar word-score matcher ko dete hain, taake
// purana data toote nahi aur naya data bina migration ke chal jaye.

const CACHE_MS = 60_000

let cachedIndex: QnaIndex | null = null
let cachedAt = 0
let cachedEntryCount = 0

function splitQuestions(raw: string): string[] {
  // Nayi table: har line par ek sawaal. Purani: comma se alag.
  // Pehle newline par torte hain; agar ek hi line thi to comma par.
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

  // 1. Nayi table. Agar abhi tak banayi nahi gayi to error aayega — use chup
  //    chaap ignore karte hain, purani table se kaam chalta rahega.
  const { data: topics, error: topicsError } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions, answer, priority')
    .eq('is_active', true)

  if (topicsError) {
    console.warn('[qna] qna_topics parh nahi saka (shayad abhi banayi nahi):', topicsError.message)
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

  // 2. Purani table
  const { data: legacy, error: legacyError } = await supabaseAdmin
    .from('qna')
    .select('keywords, answer')
    .eq('is_active', true)

  if (legacyError) {
    console.warn('[qna] purani qna table parh nahi saka:', legacyError.message)
  } else if (legacy) {
    for (const row of legacy) {
      const questions = splitQuestions(String(row.keywords || ''))
      if (!questions.length || !row.answer) continue
      entries.push({
        topic: 'legacy',
        answer: String(row.answer),
        questions,
        priority: -1, // barabar score par nayi table jeetegi
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
