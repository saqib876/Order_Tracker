/**
 * Sawaal ko theek jagah par lagana — /api/admin/sawaal-fix
 *
 *   kaam = "hatao"   sawaal ko IS topic se nikal do
 *   kaam = "bhejo"   sawaal ko is topic se nikal kar doosre topic mein daal do
 *
 * Dono soorton mein sirf wohi ek line hilti hai jo aap ne chuni — baqi
 * topic jyun ka tyun rehta hai.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateQnaCache } from '@/lib/whatsapp'
import { ignoreKey } from '@/lib/qnaIgnore'

export const dynamic = 'force-dynamic'

function wapas(req: NextRequest, adminKey: string, params: Record<string, string>, q?: string) {
  const url = new URL('/admin/health', req.url)
  url.searchParams.set('key', adminKey)
  if (q) url.searchParams.set('q', q)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  url.hash = 'safai'
  return NextResponse.redirect(url, { status: 303 })
}

/** Topic ke sawaalon mein se ek line nikal deta hai */
async function lineNikalo(topicId: string, matan: string): Promise<string | null> {
  const { data: t } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions')
    .eq('id', topicId)
    .maybeSingle()

  if (!t) return null

  const key = ignoreKey(matan)
  const bachi = String(t.questions || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => ignoreKey(x) !== key)

  await supabaseAdmin
    .from('qna_topics')
    .update({ questions: bachi.join('\n'), updated_at: new Date().toISOString() })
    .eq('id', topicId)

  return String(t.topic)
}

/** Topic ke sawaalon mein ek line daal deta hai (pehle se ho to kuch nahi) */
async function lineDaalo(topicId: string, matan: string): Promise<string | null> {
  const { data: t } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions')
    .eq('id', topicId)
    .maybeSingle()

  if (!t) return null

  const lines = String(t.questions || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)

  const key = ignoreKey(matan)
  if (!lines.some((x) => ignoreKey(x) === key)) lines.push(matan)

  await supabaseAdmin
    .from('qna_topics')
    .update({ questions: lines.join('\n'), updated_at: new Date().toISOString() })
    .eq('id', topicId)

  return String(t.topic)
}

export async function POST(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }

  const form = await req.formData()
  if (String(form.get('key') || '') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const kaam = String(form.get('kaam') || '')
  const matan = String(form.get('matan') || '').trim()
  const seTopic = String(form.get('se_topic') || '')
  const talash = String(form.get('q') || '')

  if (!matan || !seTopic) return wapas(req, adminKey, { khata: 'Sawaal nahi mila' }, talash)

  if (kaam === 'hatao') {
    const naam = await lineNikalo(seTopic, matan)
    if (!naam) return wapas(req, adminKey, { khata: 'Topic nahi mila' }, talash)
    invalidateQnaCache()
    console.log(`[safai] "${matan.slice(0, 50)}" ko ${naam} se nikaal diya`)
    return wapas(req, adminKey, { nikla: naam }, talash)
  }

  if (kaam === 'bhejo') {
    const koTopic = String(form.get('ko_topic') || '')
    if (!koTopic) return wapas(req, adminKey, { khata: 'Naya topic chunna zaroori hai' }, talash)
    if (koTopic === seTopic) {
      return wapas(req, adminKey, { khata: 'Ye to wohi topic hai' }, talash)
    }

    const naya = await lineDaalo(koTopic, matan)
    if (!naya) return wapas(req, adminKey, { khata: 'Naya topic nahi mila' }, talash)
    const purana = await lineNikalo(seTopic, matan)

    invalidateQnaCache()
    console.log(`[safai] "${matan.slice(0, 50)}" ${purana} -> ${naya}`)
    return wapas(req, adminKey, { bheja: `${purana} se ${naya}` }, talash)
  }

  return wapas(req, adminKey, { khata: 'Ye kaam samajh nahi aaya' }, talash)
}
