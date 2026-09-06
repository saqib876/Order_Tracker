/**
 * Rozana ka Q&A Excel.
 *
 *   /api/admin/qna-export?key=ADMIN_KEY
 *
 * Excel mein chaar sheets hoti hain:
 *
 *   1. "Naye Sawaal"      — jo naye sawaal bot samajh nahi paya. Har row par
 *                           dropdown: add karna hai ya nahi, aur kis topic mein.
 *   2. "Naya Topic"       — khali rows, jahan aap khud naya topic + sawaal +
 *                           jawab likh sakte hain.
 *   3. "Mojooda Topics"   — abhi jo Q&A live hai (padhne ke liye).
 *   4. "Lists"            — dropdown ke liye (chhupi hui).
 *
 * Har export ke baad un messages par nishaan lag jata hai, is liye agli dafa
 * SIRF naye sawaal aayenge. Sirf dekhna ho, nishaan na lage — `&peek=1`.
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEADER_FILL = 'FF1F3864'
const FILL_ME = 'FFFFFF00'
const FILL_READ = 'FFF2F2F2'
const NEW_TOPIC_OPTION = '++ NAYA TOPIC ++'

function todayInPakistan(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function styleHeader(ws: { getRow: (n: number) => any }) {
  const row = ws.getRow(1)
  row.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  row.height = 30
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY environment variable set nahi hai' }, { status: 500 })
  }
  if (searchParams.get('key') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const peek = searchParams.get('peek') === '1'

  // ── 1. Mojooda topics ───────────────────────────────────────────────────
  const { data: topics } = await supabaseAdmin
    .from('qna_topics')
    .select('id, topic, questions, answer, priority, is_active')
    .order('topic', { ascending: true })

  const topicNames = (topics || []).map((t) => String(t.topic)).filter(Boolean)

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

  const grouped = new Map<string, { text: string; count: number }>()
  for (const row of unmatched || []) {
    const text = String(row.message_text || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = text.toLowerCase()
    const existing = grouped.get(key)
    if (existing) existing.count++
    else grouped.set(key, { text, count: 1 })
  }

  const newQuestions = Array.from(grouped.values()).sort(
    (a, b) => b.count - a.count || a.text.localeCompare(b.text)
  )

  const date = todayInPakistan()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Myzan Order Tracker'
  wb.created = new Date()

  // ── Sheet 4 (pehle banate hain, dropdown isi par depend karta hai) ──────
  const wsList = wb.addWorksheet('Lists')
  wsList.getCell('A1').value = 'Topics'
  wsList.getCell('B1').value = 'Haan/Nahi'
  topicNames.forEach((t, i) => {
    wsList.getCell('A' + (i + 2)).value = t
  })
  wsList.getCell('A' + (topicNames.length + 2)).value = NEW_TOPIC_OPTION
  wsList.getCell('B2').value = 'Haan'
  wsList.getCell('B3').value = 'Nahi'
  wsList.state = 'hidden'

  const topicRange = `=Lists!$A$2:$A$${topicNames.length + 2}`
  const yesNoRange = '=Lists!$B$2:$B$3'

  // ── Sheet 1: Naye Sawaal ────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Naye Sawaal')
  ws1.columns = [
    { header: '#', key: 'n', width: 6 },
    { header: 'Naya Sawaal (customer ke asli alfaz)', key: 'q', width: 66 },
    { header: 'Kitni Baar', key: 'c', width: 11 },
    { header: 'Add karein?', key: 'add', width: 14 },
    { header: 'Kis Topic mein?', key: 'topic', width: 34 },
    { header: 'Note (optional)', key: 'note', width: 28 },
  ]
  styleHeader(ws1)

  newQuestions.forEach((q, i) => {
    const row = ws1.addRow({ n: i + 1, q: q.text, c: q.count })
    row.font = { name: 'Arial', size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }

    for (const col of ['add', 'topic', 'note']) {
      row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_ME } }
    }

    row.getCell('add').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [yesNoRange],
      showErrorMessage: true,
      errorTitle: 'Sirf Haan ya Nahi',
      error: 'Is khane mein sirf "Haan" ya "Nahi" chun sakte hain.',
    }
    row.getCell('topic').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [topicRange],
      showErrorMessage: true,
      errorTitle: 'List mein se chunein',
      error: 'Topic list mein se chunein. Naya topic banana ho to "Naya Topic" sheet use karein.',
    }
  })

  ws1.views = [{ state: 'frozen', ySplit: 1 }]
  ws1.autoFilter = { from: 'A1', to: 'F1' }

  // ── Sheet 2: Naya Topic ─────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Naya Topic')
  ws2.columns = [
    { header: 'Naya Topic ka Naam', key: 'topic', width: 32 },
    { header: 'Sawaal (har line par ek — Alt+Enter se nayi line)', key: 'questions', width: 58 },
    { header: 'Jawab', key: 'answer', width: 58 },
  ]
  styleHeader(ws2)

  const example = ws2.addRow({
    topic: 'MISAAL — is row ko mita dein',
    questions: 'gift wrap ho sakti hai\ngift packing karte ho\ncan you gift wrap it',
    answer: 'Ji haan, gift packing available hai. Order karte waqt note mein likh dein.',
  })
  example.font = { name: 'Arial', size: 10, italic: true }
  example.alignment = { vertical: 'top', wrapText: true }
  for (const c of ['topic', 'questions', 'answer']) {
    example.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }
  }
  example.height = 46

  for (let i = 0; i < 30; i++) {
    const row = ws2.addRow({})
    row.font = { name: 'Arial', size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
    for (const c of ['topic', 'questions', 'answer']) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_ME } }
    }
  }
  ws2.views = [{ state: 'frozen', ySplit: 1 }]

  // ── Sheet 3: Mojooda Topics (reference) ─────────────────────────────────
  // Poore sawaal bhi isi sheet mein aate hain, taake file "round-trip" kare:
  // download -> edit -> upload. Jo yahan badlenge wo upload par update ho jayega.
  const ws3 = wb.addWorksheet('Mojooda Topics')
  ws3.columns = [
    { header: 'Topic', key: 'topic', width: 30 },
    { header: 'Sawaal (har line par ek)', key: 'questions', width: 54 },
    { header: 'Jawab', key: 'answer', width: 60 },
    { header: 'Kitne Sawaal', key: 'nq', width: 13 },
  ]
  styleHeader(ws3)

  for (const t of topics || []) {
    const qs = String(t.questions || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    const row = ws3.addRow({
      topic: t.topic,
      questions: qs.join('\n'),
      answer: t.answer,
      nq: qs.length,
    })
    row.font = { name: 'Arial', size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
    // Topic/sawaal/jawab edit kiye ja sakte hain — is liye peele
    for (const c of ['topic', 'questions', 'answer']) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_ME } }
    }
    row.getCell('nq').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_READ } }
    row.height = 40
  }
  ws3.views = [{ state: 'frozen', ySplit: 1 }]

  // ── Export ho gaye — nishaan laga do ────────────────────────────────────
  let markedCount = 0
  if (!peek && unmatched && unmatched.length > 0) {
    const ids = unmatched.map((r) => r.id)
    const now = new Date().toISOString()
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
    `[qna-export] ${newQuestions.length} naye sawaal, ${topicNames.length} topics, marked=${markedCount}, peek=${peek}`
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
