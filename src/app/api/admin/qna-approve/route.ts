/**
 * AI ki tajweez par aap ka faisla laagu karna.
 *
 *   POST /api/admin/qna-approve
 *     key     ADMIN_KEY
 *     faisla  "approve" ya "reject"
 *     pick    chuni hui tajweez ki id (kai dafa aa sakti hai)
 *     ans_<id>  naye topic ka jawab (jo aap ne wahin likha)
 *
 * Approve par:
 *   naya_sawaal  → tajweez ke sawaal us maujooda topic mein jur jate hain
 *   naya_topic   → naya topic ban jata hai (sawaal + aap ka likha jawab)
 *
 * Reject par wo tajweez band, AUR us ke sawaal "qna_ignored" mein chale
 * jate hain — yani aainda kabhi dobara tajweez nahi honge.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateQnaCache } from '@/lib/whatsapp'
import { ignoreKey } from '@/lib/qnaIgnore'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }

  const form = await req.formData()
  if (String(form.get('key') || '') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const faisla = String(form.get('faisla') || 'approve')
  const ids = form.getAll('pick').map((v) => String(v)).filter(Boolean)

  if (!ids.length) {
    return wapas(req, adminKey, { kuch: 'kuch chuna hi nahi' })
  }

  const { data: rows, error } = await supabaseAdmin
    .from('qna_suggestions')
    .select('id, kind, topic, questions, status')
    .in('id', ids)
    .eq('status', 'pending')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const ab = new Date().toISOString()

  // ── Radd karna ──────────────────────────────────────────────────────────
  if (faisla === 'reject') {
    const keys = new Set<string>()
    for (const r of rows || []) {
      for (const q of (r.questions as string[]) || []) {
        const k = ignoreKey(q)
        if (k) keys.add(k)
      }
    }
    if (keys.size) {
      await supabaseAdmin
        .from('qna_ignored')
        .upsert(
          Array.from(keys).map((text_norm) => ({ text_norm })),
          { onConflict: 'text_norm', ignoreDuplicates: true }
        )
    }
    await supabaseAdmin
      .from('qna_suggestions')
      .update({ status: 'rejected', decided_at: ab })
      .in('id', ids)

    return wapas(req, adminKey, { radd: String((rows || []).length) })
  }

  // ── Approve karna ───────────────────────────────────────────────────────
  let juray = 0
  let banay = 0
  const rukay: string[] = []

  for (const r of rows || []) {
    const topic = String(r.topic)
    const sawaal = ((r.questions as string[]) || []).map((q) => String(q).trim()).filter(Boolean)
    if (!sawaal.length) continue

    if (r.kind === 'naya_topic') {
      const answer = String(form.get('ans_' + r.id) || '').trim()
      if (!answer) {
        // Jawab likhe baghair topic live nahi ho sakta — pending hi rehta hai
        rukay.push(topic)
        continue
      }
      // qna_topics par 'topic' ka unique constraint nahi hai, is liye upsert
      // nahi chalta — pehle dekhte hain, phir insert ya update.
      const { data: pehleSe } = await supabaseAdmin
        .from('qna_topics')
        .select('id')
        .ilike('topic', topic)
        .maybeSingle()

      const e = pehleSe
        ? (
            await supabaseAdmin
              .from('qna_topics')
              .update({
                topic,
                questions: sawaal.join('\n'),
                answer,
                is_active: true,
                updated_at: ab,
              })
              .eq('id', pehleSe.id)
          ).error
        : (
            await supabaseAdmin.from('qna_topics').insert({
              topic,
              questions: sawaal.join('\n'),
              answer,
              priority: 0,
              is_active: true,
            })
          ).error

      if (e) {
        rukay.push(topic + ' (' + e.message + ')')
        continue
      }
      banay++
    } else {
      // Maujooda topic mein sawaal jorna — purane sawaal barqarar rakhte hain
      const { data: mojooda } = await supabaseAdmin
        .from('qna_topics')
        .select('questions')
        .eq('topic', topic)
        .maybeSingle()

      if (!mojooda) {
        rukay.push(topic + ' (topic ab mojood nahi)')
        continue
      }

      const purane = String(mojooda.questions || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      const dekhe = new Set(purane.map((q) => ignoreKey(q)))
      const naye = sawaal.filter((q) => {
        const k = ignoreKey(q)
        if (!k || dekhe.has(k)) return false
        dekhe.add(k)
        return true
      })
      if (!naye.length) continue

      const { error: e } = await supabaseAdmin
        .from('qna_topics')
        .update({ questions: purane.concat(naye).join('\n') })
        .eq('topic', topic)

      if (e) {
        rukay.push(topic + ' (' + e.message + ')')
        continue
      }
      juray += naye.length
    }

    await supabaseAdmin
      .from('qna_suggestions')
      .update({ status: 'approved', decided_at: ab })
      .eq('id', r.id)
  }

  invalidateQnaCache()
  console.log(
    '[qna-approve] naye topics: ' + banay + ', sawaal jure: ' + juray +
      (rukay.length ? ', ruke: ' + rukay.join('; ') : '')
  )

  return wapas(req, adminKey, {
    banay: String(banay),
    juray: String(juray),
    ruke: rukay.length ? String(rukay.length) : '',
  })
}

function wapas(req: NextRequest, adminKey: string, params: Record<string, string>) {
  const url = new URL('/admin/qna', req.url)
  url.searchParams.set('key', adminKey)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  return NextResponse.redirect(url, { status: 303 })
}
