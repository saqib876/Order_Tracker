/**
 * Q&A Excel upload — SQL likhne ki koi zarurat nahi.
 *
 *   POST /api/admin/qna-import   (multipart form: key + file)
 *
 * Jo Excel `/api/admin/qna-export` se milti hai, wahi bhar kar wapas upload
 * kar dein. Parhne wali logic `@/lib/qnaImportParse` mein hai (taake alag se
 * test ho sake); yahan sirf database ka kaam hota hai.
 *
 * USOOL: "File mein jo hai, wahi database mein hoga."
 *
 * Agar file mein "Mojooda Topics" sheet mojood hai (yani ye poori export
 * file hai), to upload ke baad database bilkul file jaisa ho jata hai:
 *   - Topic ka naam badla       -> naam badal jayega
 *   - Sawaal hata diya           -> hat jayega
 *   - Sawaal doosre topic mein le gaye -> wahan chala jayega
 *   - "Hata dein? = Haan"        -> poora topic band
 *   - Topic file mein hai hi nahi -> band
 *
 * "Band" ka matlab is_active = false: bot use nahi karta, lekin row database
 * mein rehti hai taake ghalti se kuch zaya na ho (page par OFF dikhti hai).
 *
 * Agar file adhoori ho (Mojooda Topics sheet hi na ho) to kuch mitaya nahi
 * jata — sirf naya jorta hai.
 *
 * Mehfooz rakhne ke liye: agar ek hi upload aadhe se zyada topics band kar
 * raha ho to kuch nahi hota aur saaf error aata hai.
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

  const { topics: incoming, picked, notes, fullSheet } = parseQnaWorkbook(wb)

  if (incoming.size === 0) {
    return NextResponse.json(
      { error: 'File mein koi topic nahi mila. Kya ye wahi Excel hai jo export se mili thi?' },
      { status: 400 }
    )
  }

  const { data: existingRows, error: readErr } = await supabaseAdmin
    .from('qna_topics')
    .select('id, topic, questions, answer, is_active')

  if (readErr) {
    return NextResponse.json({ error: 'Database parh nahi saka: ' + readErr.message }, { status: 500 })
  }

  const byTopic = new Map<string, any>()
  for (const row of existingRows || []) byTopic.set(String(row.topic).toLowerCase(), row)

  // ── Kaun kaun band honge ────────────────────────────────────────────────
  // Poori file ho to: jo topic file mein nahi hai, ya jis par "Hata dein? =
  // Haan" hai, wo band. Adhoori file par kuch band nahi hota.
  const bandKarne: any[] = []
  if (fullSheet) {
    for (const row of existingRows || []) {
      if (row.is_active === false) continue
      const item = incoming.get(String(row.topic).toLowerCase())
      if (!item || item.remove) bandKarne.push(row)
    }
  }

  // Ehtiyat: ek hi upload aadhe se zyada topics band kar de to kuch mat karo
  const activeCount = (existingRows || []).filter((r) => r.is_active !== false).length
  if (bandKarne.length > 0 && bandKarne.length > activeCount / 2) {
    return NextResponse.json(
      {
        error:
          `Ye upload ${activeCount} mein se ${bandKarne.length} topics band kar deta — ` +
          'itni bari tabdeeli ehtiyatan roki gayi hai, database mein kuch nahi badla. ' +
          'Kya ye poori export file hai? Agar waqai ye sab hatane hain to mujhe bata dein.',
        band_hone_wale: bandKarne.map((r) => r.topic),
      },
      { status: 400 }
    )
  }

  let created = 0
  let updated = 0
  let addedQuestions = 0
  let removedQuestions = 0
  const skipped: string[] = []

  for (const item of Array.from(incoming.values())) {
    if (item.remove) continue // neeche band kar diye jayenge

    const existing = byTopic.get(item.topic.toLowerCase())
    const purane = existing ? splitQuestions(String(existing.questions || '')) : []

    // Poori file: sawaal bilkul file jaise. Adhoori file: sirf jorte hain.
    let finalQuestions: string[]
    if (fullSheet) {
      finalQuestions = []
      for (const q of item.questions) if (!finalQuestions.includes(q)) finalQuestions.push(q)
    } else {
      finalQuestions = purane.slice()
      for (const q of item.questions) if (!finalQuestions.includes(q)) finalQuestions.push(q)
    }

    for (const q of finalQuestions) if (!purane.includes(q)) addedQuestions++
    for (const q of purane) if (!finalQuestions.includes(q)) removedQuestions++

    const answer = item.answer || (existing ? String(existing.answer || '') : '')
    if (!answer) {
      skipped.push(item.topic)
      continue
    }

    if (existing) {
      const { error } = await supabaseAdmin
        .from('qna_topics')
        .update({
          // Naam file wala — sirf chhote/bare harf ka farq ho to bhi file jeetegi
          topic: item.topic,
          questions: finalQuestions.join('\n'),
          answer,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) {
        return NextResponse.json({ error: `"${item.topic}" update nahi hua: ${error.message}` }, { status: 500 })
      }
      updated++
    } else {
      const { error } = await supabaseAdmin.from('qna_topics').insert({
        topic: item.topic,
        questions: finalQuestions.join('\n'),
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

  // ── Ab band karo ────────────────────────────────────────────────────────
  const bandHue: string[] = []
  for (const row of bandKarne) {
    const { error } = await supabaseAdmin
      .from('qna_topics')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) {
      return NextResponse.json({ error: `"${row.topic}" band nahi hua: ${error.message}` }, { status: 500 })
    }
    bandHue.push(String(row.topic))
  }

  invalidateQnaCache()

  const result = {
    ok: true,
    tareeqa: fullSheet
      ? 'poori file — database ab bilkul file jaisa hai'
      : 'adhoori file (Mojooda Topics sheet nahi thi) — sirf naya jora gaya, kuch mitaya nahi',
    naye_topics: created,
    update_hue_topics: updated,
    naye_sawaal_jure: addedQuestions,
    sawaal_hataye_gaye: removedQuestions,
    band_kiye_gaye_topics: bandHue,
    naye_sawaal_sheet_se_chune: picked,
    jawab_khali_is_liye_chhode: skipped,
    notes: notes.slice(0, 30),
  }
  console.log('[qna-import]', JSON.stringify(result))
  return NextResponse.json(result)
}
