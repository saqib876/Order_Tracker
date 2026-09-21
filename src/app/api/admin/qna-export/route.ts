/**
 * Rozana ka Q&A Excel.
 *
 *   /api/admin/qna-export?key=ADMIN_KEY
 *
 * Excel mein do sheets hoti hain:
 *
 *   1. "Naye Sawaal"      — jo naye sawaal bot samajh nahi paya. Har row par
 *                           dropdown: add karna hai ya nahi, aur kis topic mein.
 *   2. "Mojooda Topics"   — abhi jo Q&A live hai. Yahin badlein, aur NAYA
 *                           topic neeche ki khali (peeli) rows mein likhein —
 *                           wo foran "Kis Topic mein?" dropdown mein aa jata hai.
 *
 * "Naye Sawaal" mein ye KABHI nahi aate:
 *   - jin par aap pehle "Nahi" kar chuke (qna_ignored table)
 *   - "?", "Hi", "AoA", "Hello", "Ok" jaise message
 *   - jin ka jawab bot ab khud de deta hai (Q&A, order, model, customization)
 *
 * Har export ke baad un messages par nishaan lag jata hai, is liye agli dafa
 * SIRF naye sawaal aayenge. Sirf dekhna ho, nishaan na lage — `&peek=1`.
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { supabaseAdmin } from '@/lib/supabase'
import { GREETING_TOPIC } from '@/lib/whatsapp'
import { buildIndex, matchAgainstIndex } from '@/lib/qnaMatch'
import { planReply } from '@/lib/replyPlan'
import { isJunkMessage } from '@/lib/messageParse'
import { ignoreKey } from '@/lib/qnaIgnore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEADER_FILL = 'FF1F3864'
const FILL_ME = 'FFFFFF00'
const FILL_READ = 'FFF2F2F2'

// Supabase ek dafa mein 1000 se zyada rows nahi deta — pehle `.limit(5000)`
// likha tha lekin aata 1000 hi tha, aur baqi purane sawaal agli file mein
// "wapas" aate dikhte the. Ab safha-dar-safha parhte hain.
const PAGE = 1000
const MAX_ROWS = 50000

// "Mojooda Topics" ke neeche itni khali peeli rows — naye topic ke liye
const BLANK_TOPIC_ROWS = 40
// "Kis Topic mein?" dropdown seedha Mojooda Topics ka A column parhta hai.
// Koi formula nahi (formula wali list kuch Excel mein khaali dikhti thi).
const TOPIC_LIST_LAST_ROW = 500
const TOPIC_RANGE = `'Mojooda Topics'!$A$2:$A$${TOPIC_LIST_LAST_ROW}`
const YES_NO = '"Haan,Nahi"'

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

/** Poori table safha-dar-safha (1000 ki had se bachne ke liye) */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
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

  // Sirf CHALU topics file mein jate hain. Band topics shamil hote to file
  // bina chhere wapas upload karne par wo sab dobara chalu ho jate — aur
  // naam badle hue topics ke purane naam phir se zinda ho jate (21 Sept ko
  // yehi hua tha: har cheez do-do dafa chal rahi thi).
  const activeTopics = (topics || []).filter((t) => t.is_active !== false && t.topic)

  // Bot abhi kin sawaalon ka jawab deta hai — wahi index jo webhook use karta hai
  const index = buildIndex(
    activeTopics
      .filter((t) => t.topic !== GREETING_TOPIC && t.answer)
      .map((t) => ({
        topic: String(t.topic),
        answer: String(t.answer),
        priority: Number(t.priority) || 0,
        questions: String(t.questions || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      }))
  )

  // ── 2. Naye unanswered sawaal ───────────────────────────────────────────
  let unmatched: { id: string; message_text: string | null; created_at: string }[]
  let ignoredKeys: Set<string>
  try {
    unmatched = await fetchAll((from, to) =>
      supabaseAdmin
        .from('unmatched_messages')
        .select('id, message_text, created_at')
        .is('exported_at', null)
        .order('created_at', { ascending: false })
        .range(from, to)
    )
    // Table na bani ho to khali set — export phir bhi chale
    const ignoredRows = await fetchAll<{ text_norm: string }>((from, to) =>
      supabaseAdmin.from('qna_ignored').select('text_norm').range(from, to)
    ).catch((e) => {
      console.warn('[qna-export] qna_ignored parh nahi saka:', e.message)
      return []
    })
    ignoredKeys = new Set(ignoredRows.map((r) => r.text_norm))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'unmatched_messages parh nahi saka' }, { status: 500 })
  }

  const skip = { nahi: 0, faltu: 0, botDetaHai: 0 }
  const grouped = new Map<string, { text: string; count: number }>()
  for (const row of unmatched) {
    const text = String(row.message_text || '').replace(/\s+/g, ' ').trim()
    if (!text) continue

    if (ignoredKeys.has(ignoreKey(text))) {
      skip.nahi++
      continue
    }
    if (isJunkMessage(text)) {
      skip.faltu++
      continue
    }
    if (botHandles(text, index)) {
      skip.botDetaHai++
      continue
    }

    const key = ignoreKey(text) || text.toLowerCase()
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
      formulae: [YES_NO],
      showErrorMessage: true,
      errorTitle: 'Sirf Haan ya Nahi',
      error: 'Haan = is topic mein jor do. Nahi = ye sawaal aainda kabhi na dikhao.',
    }
    row.getCell('topic').dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [TOPIC_RANGE],
      showErrorMessage: true,
      errorTitle: 'List mein se chunein',
      error: 'Topic list mein se chunein. Naya topic chahiye to "Mojooda Topics" sheet ki neeche wali khali row mein likhein — phir wo is list mein aa jayega.',
    }
  })

  ws1.views = [{ state: 'frozen', ySplit: 1 }]
  ws1.autoFilter = { from: 'A1', to: 'F1' }

  // ── Sheet 2: Mojooda Topics ─────────────────────────────────────────────
  // Poore sawaal bhi isi sheet mein aate hain, taake file "round-trip" kare:
  // download -> edit -> upload. Jo yahan badlenge wo upload par update ho jayega.
  const ws2 = wb.addWorksheet('Mojooda Topics')
  ws2.columns = [
    { header: 'Topic', key: 'topic', width: 30 },
    { header: 'Sawaal (har line par ek — Alt+Enter se nayi line)', key: 'questions', width: 54 },
    { header: 'Jawab', key: 'answer', width: 60 },
    { header: 'Hata dein?', key: 'del', width: 12 },
    { header: 'Kitne Sawaal', key: 'nq', width: 13 },
  ]
  styleHeader(ws2)
  ws2.getCell('A1').note =
    'Naya topic: sab se neeche wali khali peeli row mein Topic, Sawaal aur Jawab likhein. ' +
    'Wo foran "Naye Sawaal" ke "Kis Topic mein?" dropdown mein aa jayega.'

  const deleteValidation = {
    type: 'list' as const,
    allowBlank: true,
    formulae: [YES_NO],
    showErrorMessage: true,
    errorTitle: 'Sirf Haan ya Nahi',
    error: 'Poora topic hatana ho to "Haan" chunein, warna khali chhod dein.',
  }

  for (const t of activeTopics) {
    const qs = String(t.questions || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    const row = ws2.addRow({
      topic: t.topic,
      questions: qs.join('\n'),
      answer: t.answer,
      nq: qs.length,
    })
    row.font = { name: 'Arial', size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
    // Topic/sawaal/jawab edit kiye ja sakte hain — is liye peele
    for (const c of ['topic', 'questions', 'answer', 'del']) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_ME } }
    }
    row.getCell('del').dataValidation = deleteValidation
    row.getCell('nq').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_READ } }
    row.height = 40
  }

  // Naye topic ke liye khali rows — yahan likha naam dropdown mein foran aata hai
  for (let i = 0; i < BLANK_TOPIC_ROWS; i++) {
    const row = ws2.addRow({})
    row.font = { name: 'Arial', size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
    for (const c of ['topic', 'questions', 'answer', 'del']) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_ME } }
    }
    row.getCell('del').dataValidation = deleteValidation
  }
  ws2.views = [{ state: 'frozen', ySplit: 1 }]

  // ── Export ho gaye — nishaan laga do ────────────────────────────────────
  // Jo rows chhaant di gayin (Nahi / faltu / bot jawab deta hai) un par bhi —
  // warna wo har dafa dobara parhi jatin.
  let markedCount = 0
  if (!peek && unmatched.length > 0) {
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
    `[qna-export] ${unmatched.length} messages parhe → ${newQuestions.length} naye sawaal ` +
      `(chhode: nahi=${skip.nahi} faltu=${skip.faltu} bot_deta_hai=${skip.botDetaHai}), ` +
      `${activeTopics.length} topics, marked=${markedCount}, peek=${peek}`
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

/**
 * Is message ka jawab bot AB khud de deta hai? (to Excel mein dikhane ki
 * zarurat nahi) — webhook wala hi faisla, bina database ke.
 */
function botHandles(text: string, index: ReturnType<typeof buildIndex>): boolean {
  const plan = planReply(text, { alreadyAskedForNumber: false })
  if (plan.noQuestion) return true
  if (plan.customization || plan.modelAvailability || plan.manualReason) return true
  if (plan.orderish || plan.confirmationNumber) return true
  return matchAgainstIndex(index, text) !== null
}
