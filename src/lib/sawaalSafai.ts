/**
 * SAWAALON KI SAFAI — kaun sa sawaal ghalat topic mein laga hua hai?
 *
 * Do masle aam hain:
 *
 *   1. Ek hi sawaal DO (ya zyada) topics mein pada hua hai. Aisa ho to bot
 *      ka milan batt jata hai aur kabhi ghalat topic jeet jata hai.
 *
 *   2. Koi sawaal kisi aise topic mein chala gaya jahan us ka koi kaam
 *      nahi. Wo khud se nazar nahi aata — dhoondna parta hai.
 *
 * Ye file dono ke liye data deti hai. Badalne ka kaam /api/admin/sawaal-fix
 * karta hai.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { ignoreKey } from '@/lib/qnaIgnore'

export interface SawaalJagah {
  topicId: string
  topic: string
  chalu: boolean
  /** Sawaal jaisa topic mein likha hua hai */
  asli: string
}

export interface DohraSawaal {
  key: string
  matan: string
  jagahein: SawaalJagah[]
}

export interface TopicChota {
  id: string
  topic: string
  chalu: boolean
}

interface Jama {
  topics: TopicChota[]
  /** saaf shakal -> wo kahan kahan hai */
  naqsha: Map<string, SawaalJagah[]>
}

async function sabJama(): Promise<Jama> {
  const { data } = await supabaseAdmin
    .from('qna_topics')
    .select('id,topic,questions,is_active')
    .order('topic', { ascending: true })
    .limit(500)

  const topics: TopicChota[] = []
  const naqsha = new Map<string, SawaalJagah[]>()

  for (const t of data || []) {
    const topicId = String(t.id)
    const topic = String(t.topic || '')
    const chalu = Boolean(t.is_active)
    topics.push({ id: topicId, topic, chalu })

    const lines = String(t.questions || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)

    for (const line of lines) {
      const key = ignoreKey(line)
      if (!key) continue
      const list = naqsha.get(key) || []
      list.push({ topicId, topic, chalu, asli: line })
      naqsha.set(key, list)
    }
  }

  return { topics, naqsha }
}

/**
 * Wo sawaal jo ek se zyada CHALU topics mein mojood hain.
 *
 * Band topics ko nahi ginte — un se bot ka koi faisla nahi hota.
 */
export async function dohreSawaal(hadd = 40): Promise<{
  dohre: DohraSawaal[]
  topics: TopicChota[]
  kulSawaal: number
}> {
  const { topics, naqsha } = await sabJama()

  const dohre: DohraSawaal[] = []
  let kulSawaal = 0

  for (const [key, jagahein] of Array.from(naqsha.entries())) {
    const chaluJagah = jagahein.filter((j) => j.chalu)
    kulSawaal += chaluJagah.length

    // Alag alag topics mein hona ahem hai — ek hi topic mein do dafa nahi
    const alagTopics = new Set(chaluJagah.map((j) => j.topicId))
    if (alagTopics.size > 1) {
      dohre.push({ key, matan: chaluJagah[0].asli, jagahein: chaluJagah })
    }
  }

  dohre.sort((a, b) => b.jagahein.length - a.jagahein.length)
  return { dohre: dohre.slice(0, hadd), topics, kulSawaal }
}

/**
 * Koi bhi sawaal dhoondna — chahe wo kisi bhi topic mein ho.
 *
 * Isi se wo masla hal hota hai: "ye sawaal ghalat topic mein laga hua hai".
 * Dhoond kar wahin se doosre topic mein bheja ja sakta hai.
 */
export async function sawaalDhoondo(
  talash: string,
  hadd = 60
): Promise<{ mile: SawaalJagah[]; topics: TopicChota[] }> {
  const { topics, naqsha } = await sabJama()
  const saaf = ignoreKey(talash)
  if (!saaf) return { mile: [], topics }

  const mile: SawaalJagah[] = []
  for (const [key, jagahein] of Array.from(naqsha.entries())) {
    if (!key.includes(saaf)) continue
    for (const j of jagahein) {
      mile.push(j)
      if (mile.length >= hadd) break
    }
    if (mile.length >= hadd) break
  }

  mile.sort((a, b) => a.topic.localeCompare(b.topic) || a.asli.localeCompare(b.asli))
  return { mile, topics }
}
