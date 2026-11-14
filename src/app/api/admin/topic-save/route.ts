/**
 * Topics ko khud badalna — /admin/topics ka kaam karne wala hissa.
 *
 *   POST /api/admin/topic-save
 *     key      ADMIN_KEY
 *     kaam     "save" | "toggle" | "delete" | "naya" | "safai"
 *
 * "save" sirf likhi hui baat mehfooz karta hai (naam, sawaal, jawab,
 * wajah). ON/OFF ka kaam alag hai — "toggle" — taake ek button do
 * kaam na kare aur uljhan na ho.
 *     id       jis topic par kaam karna hai (naya ke ilawa)
 *     topic    naam
 *     questions  har line par ek sawaal
 *     answer   jawab
 *
 * Delete ke liye `pakka=haan` zaroori hai — ghalti se kuch mit na jaye.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateQnaCache } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

function saafSawaal(raw: string): string {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  // Dohre sawaal hata do
  const dekhe = new Set<string>()
  const rakhe: string[] = []
  for (const q of lines) {
    const k = q.toLowerCase()
    if (dekhe.has(k)) continue
    dekhe.add(k)
    rakhe.push(q)
  }
  return rakhe.join('\n')
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

  // Checkbox ka tick parhne ka mehfooz tareeqa.
  //
  // Un-ticked checkbox browser bhejta hi nahi. Is liye form mein ek chhupa
  // hua "0" bhi jata hai: tick laga ho to DONO (0 aur 1) aate hain, warna
  // sirf 0. Yani "chalu" hamesha aata hai aur uska matlab saaf hota hai.
  const chaluHai = (): boolean => form.getAll('chalu').map(String).includes('1')

  const kaam = String(form.get('kaam') || 'save')
  const id = String(form.get('id') || '')
  const ab = new Date().toISOString()

  // ── Naya topic ─────────────────────────────────────────────────────────
  if (kaam === 'naya') {
    const topic = String(form.get('topic') || '').trim()
    const answer = String(form.get('answer') || '').trim()
    const questions = saafSawaal(String(form.get('questions') || ''))

    if (!topic) return wapas(req, adminKey, { khata: 'Topic ka naam likhna zaroori hai' })
    if (!answer) return wapas(req, adminKey, { khata: 'Jawab likhna zaroori hai' })

    const { data: pehleSe } = await supabaseAdmin
      .from('qna_topics')
      .select('id')
      .ilike('topic', topic)
      .maybeSingle()

    if (pehleSe) {
      return wapas(req, adminKey, { khata: 'Isi naam ka topic pehle se mojood hai' }, pehleSe.id)
    }

    const { data: naya, error } = await supabaseAdmin
      .from('qna_topics')
      .insert({ topic, questions, answer, priority: 0, is_active: true })
      .select('id')
      .maybeSingle()

    if (error) return wapas(req, adminKey, { khata: error.message })
    invalidateQnaCache()
    console.log('[topics] naya topic bana: ' + topic)
    return wapas(req, adminKey, { bana: topic }, naya?.id)
  }

  if (!id) return wapas(req, adminKey, { khata: 'Topic nahi mila' })

  // ── Kai purane naam ek sath hatana ─────────────────────────────────────
  if (kaam === 'safai') {
    const ids = form.getAll('pick').map((v) => String(v)).filter(Boolean)
    if (!ids.length) return wapas(req, adminKey, { khata: 'Kuch chuna hi nahi' })

    // Ehtiyat: sirf BAND topics hi hat sakte hain, chalu kabhi nahi
    const { data: chunay } = await supabaseAdmin
      .from('qna_topics')
      .select('id, is_active')
      .in('id', ids)

    const hatane = (chunay || []).filter((r) => !r.is_active).map((r) => String(r.id))
    if (!hatane.length) return wapas(req, adminKey, { khata: 'Chalu topic hataya nahi ja sakta' })

    const { error } = await supabaseAdmin.from('qna_topics').delete().in('id', hatane)
    if (error) return wapas(req, adminKey, { khata: error.message })
    invalidateQnaCache()
    console.log('[topics] safai — ' + hatane.length + ' purane naam hata diye')
    return wapas(req, adminKey, { safai: String(hatane.length) })
  }

  // ── ON / OFF ───────────────────────────────────────────────────────────
  if (kaam === 'toggle') {
    const chalu = chaluHai()
    const { data: badle, error } = await supabaseAdmin
      .from('qna_topics')
      .update({
        is_active: chalu,
        // Chalu karte hi "band kyun hai" ki wajah bemani ho jati hai
        ...(chalu ? { off_reason: null } : {}),
        updated_at: ab,
      })
      .eq('id', id)
      .select('id')
    if (error) return wapas(req, adminKey, { khata: error.message })
    if (!badle || !badle.length) {
      return wapas(req, adminKey, { khata: 'Topic nahi mila — kuch badla nahi' })
    }
    invalidateQnaCache()
    console.log('[topics] ' + id + ' ab ' + (chalu ? 'ON' : 'OFF'))
    // Topic khula hua tha to wapas usi par, warna list par
    const khulaRahe = String(form.get('khulaRahe') || '') === '1'
    return wapas(req, adminKey, { badla: chalu ? 'chalu' : 'band' }, khulaRahe ? id : undefined)
  }

  // ── Hamesha ke liye hatao ──────────────────────────────────────────────
  if (kaam === 'delete') {
    if (String(form.get('pakka') || '') !== 'haan') {
      return wapas(req, adminKey, { khata: 'Hatane se pehle tick lagana zaroori hai' }, id)
    }
    const { error } = await supabaseAdmin.from('qna_topics').delete().eq('id', id)
    if (error) return wapas(req, adminKey, { khata: error.message }, id)
    invalidateQnaCache()
    console.log('[topics] hata diya: ' + id)
    return wapas(req, adminKey, { hataya: '1' })
  }

  // ── Save ───────────────────────────────────────────────────────────────
  const topic = String(form.get('topic') || '').trim()
  const answer = String(form.get('answer') || '').trim()
  const questions = saafSawaal(String(form.get('questions') || ''))
  if (!topic) return wapas(req, adminKey, { khata: 'Topic ka naam khali nahi ho sakta' }, id)
  if (!answer) return wapas(req, adminKey, { khata: 'Jawab khali nahi ho sakta' }, id)

  const wajah = String(form.get('wajah') || '').trim()

  const { data: badle, error } = await supabaseAdmin
    .from('qna_topics')
    .update({
      topic,
      questions,
      answer,
      // ON/OFF yahan se nahi badalta — us ka apna button hai. Save sirf
      // likhi hui baat mehfooz karta hai.
      off_reason: wajah || null,
      updated_at: ab,
    })
    .eq('id', id)
    .select('id')

  if (error) return wapas(req, adminKey, { khata: error.message }, id)
  if (!badle || !badle.length) {
    return wapas(req, adminKey, { khata: 'Topic nahi mila — kuch mehfooz nahi hua' }, id)
  }

  invalidateQnaCache()
  console.log('[topics] mehfooz: ' + topic)
  return wapas(req, adminKey, { mehfooz: topic }, id)
}

function wapas(req: NextRequest, adminKey: string, params: Record<string, string>, id?: string) {
  const url = new URL('/admin/topics', req.url)
  url.searchParams.set('key', adminKey)
  if (id) url.searchParams.set('t', id)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  return NextResponse.redirect(url, { status: 303 })
}
