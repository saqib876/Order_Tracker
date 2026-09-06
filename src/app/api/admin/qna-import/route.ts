/**
 * Q&A Excel upload — SQL likhne ki koi zarurat nahi.
 *
 *   POST /api/admin/qna-import   (multipart form: key + file)
 *
 * Jo Excel `/api/admin/qna-export` se milti hai, wahi bhar kar wapas upload
 * kar dein. Parhne wali logic `@/lib/qnaImportParse` mein hai (taake alag se
 * test ho sake); yahan sirf database ka kaam hota hai.
 *
 * Usool:
 *   - Jis topic ka JAWAB khali hai wo import nahi hota (bot us par chup rahega)
 *   - Sawaal dobara nahi jurte
 *   - Jo topics file mein nahi hain wo waise hi rehte hain (mitte nahi)
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateQnaCache } from '@/lib/whatsapp'
import { parseQnaWorkbook, splitQuestions } from '@/lib/qnaImportParse'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Form parh nahi saka' }, { status: 400 })
  }

  if (String(form.get('key') || '') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const file = form.get('file')
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Excel file nahi mili' }, { status: 400 })
  }

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(await (file as File).arrayBuffer())
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Excel file parhi nahi ja saki: ' + (e?.message || 'unknown') },
      { status: 400 }
    )
  }

  const { topics: incoming, picked, notes } = parseQnaWorkbook(wb)

  if (incoming.size === 0) {
    return NextResponse.json(
      { error: 'File mein koi topic nahi mila. Kya ye wahi Excel hai jo export se mili thi?' },
      { status: 400 }
    )
  }

  const { data: existingRows, error: readErr } = await supabaseAdmin
    .from('qna_topics')
    .select('id, topic, questions, answer')

  if (readErr) {
    return NextResponse.json({ error: 'Database parh nahi saka: ' + readErr.message }, { status: 500 })
  }

  const byTopic = new Map<string, any>()
  for (const row of existingRows || []) byTopic.set(String(row.topic).toLowerCase(), row)

  let created = 0
  let updated = 0
  let addedQuestions = 0
  const skipped: string[] = []

  for (const item of Array.from(incoming.values())) {
    const existing = byTopic.get(item.topic.toLowerCase())

    const merged = existing ? splitQuestions(String(existing.questions || '')) : []
    const before = merged.length
    for (const q of item.questions) if (!merged.includes(q)) merged.push(q)
    addedQuestions += merged.length - before

    const answer = item.answer || (existing ? String(existing.answer || '') : '')
    if (!answer) {
      skipped.push(item.topic)
      continue
    }

    if (existing) {
      const { error } = await supabaseAdmin
        .from('qna_topics')
        .update({ questions: merged.join('\n'), answer, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) {
        return NextResponse.json({ error: `"${item.topic}" update nahi hua: ${error.message}` }, { status: 500 })
      }
      updated++
    } else {
      const { error } = await supabaseAdmin.from('qna_topics').insert({
        topic: item.topic,
        questions: merged.join('\n'),
        answer,
        priority: 0,
        is_active: true,
      })
      if (error) {
        return NextResponse.json({ error: `"${item.topic}" add nahi hua: ${error.message}` }, { status: 500 })
      }
      created++
    }
  }

  invalidateQnaCache()

  const result = {
    ok: true,
    naye_topics: created,
    update_hue_topics: updated,
    naye_sawaal_jure: addedQuestions,
    naye_sawaal_sheet_se_chune: picked,
    jawab_khali_is_liye_chhode: skipped,
    notes: notes.slice(0, 30),
  }
  console.log('[qna-import]', JSON.stringify(result))
  return NextResponse.json(result)
}
