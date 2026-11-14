/**
 * Naye sawaal par wahin se kaam — /api/admin/sawaal-action
 *
 * Health ke safhe par jo naye sawaal dikhte hain, un par do cheezein ho
 * sakti hain — bina kisi aur safhe par jaye:
 *
 *   kaam = "joro"    sawaal ko kisi maujooda topic mein daal do
 *   kaam = "hatao"   sawaal ko hamesha ke liye nazar-andaz kar do
 *
 * Dono soorton mein sawaal "Naye Sawaal" ki list se nikal jata hai, taake
 * dobara saamne na aaye.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateQnaCache } from '@/lib/whatsapp'
import { ignoreKey } from '@/lib/qnaIgnore'

export const dynamic = 'force-dynamic'

function wapas(req: NextRequest, adminKey: string, params: Record<string, string>) {
  const url = new URL('/admin/health', req.url)
  url.searchParams.set('key', adminKey)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  url.hash = 'tracking-sawaal'
  return NextResponse.redirect(url, { status: 303 })
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
  const id = String(form.get('id') || '')
  const matan = String(form.get('matan') || '').trim()

  if (!id || !matan) return wapas(req, adminKey, { khata: 'Sawaal nahi mila' })

  // ── Hamesha ke liye nazar-andaz ─────────────────────────────────────────
  if (kaam === 'hatao') {
    const key = ignoreKey(matan)
    if (key) {
      await supabaseAdmin
        .from('qna_ignored')
        .upsert({ text_norm: key }, { onConflict: 'text_norm', ignoreDuplicates: true })
    }
    await supabaseAdmin.from('unmatched_messages').delete().eq('id', id)
    console.log('[sawaal] nazar-andaz: ' + matan.slice(0, 60))
    return wapas(req, adminKey, { hataya: '1' })
  }

  // ── Tracking wale sawaalon mein bhej do ─────────────────────
  //
  // Do kaam hote hain: jumla bot ki tracking wali list mein darj ho jata
  // hai (taake aage se pehchana jaye), aur ye message "naye sawaal" ki
  // list se nikal kar apni sahi jagah chala jata hai.
  if (kaam === 'tracking') {
    const { error: likhKhata } = await supabaseAdmin
      .from('order_intent_extra')
      .upsert({ matan }, { onConflict: 'matan', ignoreDuplicates: true })

    if (likhKhata) return wapas(req, adminKey, { khata: likhKhata.message })

    const { data: purana } = await supabaseAdmin
      .from('unmatched_messages')
      .select('phone')
      .eq('id', id)
      .maybeSingle()

    await supabaseAdmin.from('order_sawaal_log').insert({
      phone: purana?.phone ? String(purana.phone) : 'maloom nahi',
      message_text: matan,
    })
    await supabaseAdmin.from('unmatched_messages').delete().eq('id', id)

    console.log('[sawaal] tracking wale mein: ' + matan.slice(0, 60))
    return wapas(req, adminKey, { tracking: '1' })
  }

  // ── Kisi topic mein daal do ─────────────────────────────────────────────
  if (kaam === 'joro') {
    const topicId = String(form.get('topic_id') || '')
    if (!topicId) return wapas(req, adminKey, { khata: 'Topic chunna zaroori hai' })

    const { data: t, error: parhKhata } = await supabaseAdmin
      .from('qna_topics')
      .select('id, topic, questions')
      .eq('id', topicId)
      .maybeSingle()

    if (parhKhata || !t) return wapas(req, adminKey, { khata: 'Topic nahi mila' })

    const lines = String(t.questions || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)

    // Pehle se mojood ho to dobara na daalein
    const pehleSe = new Set(lines.map((x) => ignoreKey(x)))
    if (!pehleSe.has(ignoreKey(matan))) lines.push(matan)

    const { error } = await supabaseAdmin
      .from('qna_topics')
      .update({ questions: lines.join('\n'), updated_at: new Date().toISOString() })
      .eq('id', topicId)

    if (error) return wapas(req, adminKey, { khata: error.message })

    await supabaseAdmin.from('unmatched_messages').delete().eq('id', id)
    invalidateQnaCache()
    console.log(`[sawaal] "${matan.slice(0, 50)}" -> ${t.topic}`)
    return wapas(req, adminKey, { jura: String(t.topic) })
  }

  return wapas(req, adminKey, { khata: 'Ye kaam samajh nahi aaya' })
}
