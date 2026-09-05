/**
 * Q&A Excel export.
 *
 *   /api/admin/qna-export?key=ADMIN_KEY
 *
 * Excel file download hoti hai jis mein:
 *   Sheet "Topic Answers"        — abhi jo Q&A live hai (aap edit kar sakte hain)
 *   Sheet "New Questions <date>" — sirf WOH naye sawaal jo pichhle export ke
 *                                  baad aaye aur bot samajh nahi paya
 *
 * Har export ke baad un messages par `exported_at` lag jata hai, is liye agli
 * dafa sirf naye sawaal aayenge — purane dobara nahi.
 *
 * Sirf dekhna hai, mark nahi karna? `&peek=1` laga dein.
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEADER_FILL = 'FF1F3864'
const FILL_ME = 'FFFFFF00'

function todayInPakistan(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// NOTE: header styling inline rakhi hai (helper ke bajaye) taake exceljs ke
// type namespace par depend na karna pade.
function styleHeader(ws: { getRow: (n: number) => any }) {
  const row = ws.getRow(1)
  row.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  row.height = 26
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json(
      { error: 'ADMIN_KEY environment variable set nahi hai' },
      { status: 500 }
    )
  }
  if (searchParams.get('key') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const peek = searchParams.get('peek') === '1'

  // ── 1. Abhi ki live Q&A ─────────────────────────────────────────────────
  const { data: topics } = await supabaseAdmin
    .from('qna_topics')
    .select('id, topic, questions, answer, priority, is_active')
    .order('priority', { ascending: false })

  // ── 2. Naye unanswered sawaal ───────────────────────────────────────────
  const { data: unmatched, error: unmatchedError } = await supabaseAdmin
    .from('unmatched_messages')
    .select('id, message_text, created_at')
    .is('exported_at', null)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (unmatchedError) {
    return NextResponse.json({ error: unmatchedError.message }, { status: 500 })
  }

  // Ek jaisa sawaal kai dafa aaya ho to ek hi row, count ke sath
  const grouped = new Map<string, { text: string; count: number; last: string }>()
  for (const row of unmatched || []) {
    const text = String(row.message_text || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = text.toLowerCase()
    const existing = grouped.get(key)
    if (existing) {
      existing.count++
    } else {
      grouped.set(key, { text, count: 1, last: String(row.created_at) })
    }
  }

  const newQuestions = Array.from(grouped.values()).sort(
    (a, b) => b.count - a.count || a.text.localeCompare(b.text)
  )

  // ── 3. Workbook ─────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Myzan Order Tracker'
  wb.created = new Date()

  // Sheet 1 — live Q&A
  const ws1 = wb.addWorksheet('Topic Answers')
  ws1.columns = [
    { header: 'id (mat badlein)', key: 'id', width: 38 },
    { header: 'Topic', key: 'topic', width: 30 },
    { header: 'Questions (har line par ek poora sawaal)', key: 'questions', width: 62 },
    { header: 'Answer', key: 'answer', width: 55 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Active', key: 'is_active', width: 9 },
  ]
  styleHeader(ws1)

  for (const t of topics || []) {
    ws1.addRow({
      id: t.id,
      topic: t.topic,
      questions: t.questions,
      answer: t.answer,
      priority: t.priority,
      is_active: t.is_active ? 'TRUE' : 'FALSE',
    })
  }
  ws1.eachRow((row, i) => {
    if (i === 1) return
    row.font = { name: 'Arial', size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
  })
  ws1.views = [{ state: 'frozen', ySplit: 1 }]

  // Sheet 2 — naye sawaal
  const date = todayInPakistan()
  const ws2 = wb.addWorksheet(`New Questions ${date}`.slice(0, 31))
  ws2.columns = [
    { header: '#', key: 'n', width: 6 },
    { header: 'Naya Sawaal (customer ke alfaz)', key: 'q', width: 72 },
    { header: 'Kitni Baar', key: 'c', width: 11 },
    { header: 'Q&A mein daalein? (haan/nahi)', key: 'add', width: 24 },
    { header: 'Topic', key: 'topic', width: 28 },
    { header: 'ANSWER', key: 'answer', width: 52 },
  ]
  styleHeader(ws2)

  newQuestions.forEach((q, i) => {
    const row = ws2.addRow({ n: i + 1, q: q.text, c: q.count })
    row.font = { name: 'Arial', size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
    for (const col of ['add', 'topic', 'answer']) {
      row.getCell(col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: FILL_ME },
      }
    }
  })
  ws2.views = [{ state: 'frozen', ySplit: 1 }]

  // ── 4. Export ho gaye — mark kar do ─────────────────────────────────────
  let markedCount = 0
  if (!peek && unmatched && unmatched.length > 0) {
    const ids = unmatched.map((r) => r.id)
    const now = new Date().toISOString()

    // Supabase URL ki length ki hadd hai, is liye chunks mein
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { error } = await supabaseAdmin
        .from('unmatched_messages')
        .update({ exported_at: now })
        .in('id', chunk)
      if (error) {
        console.error('[qna-export] mark failed:', error.message)
        break
      }
      markedCount += chunk.length
    }
  }

  console.log(
    `[qna-export] ${newQuestions.length} naye sawaal (${unmatched?.length || 0} messages), marked=${markedCount}, peek=${peek}`
  )

  const buffer = await wb.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Myzan_QnA_${date}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
