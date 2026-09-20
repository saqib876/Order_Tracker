/**
 * Q&A Excel ko parhne wali logic.
 *
 * Ye alag file is liye hai ke ise seedha test kiya ja sake — route file mein
 * Next.js aur Supabase ki dependencies hoti hain, jin ke saath standalone
 * test chalana mumkin nahi.
 *
 * Yahan koi database ya network nahi: workbook andar, saaf data bahar.
 */

import type { Workbook, Worksheet } from 'exceljs'

export interface IncomingTopic {
  topic: string
  questions: string[]
  /** Khali ho to matlab: file mein jawab nahi tha (database wala rakha jayega) */
  answer: string
  /** "Hata dein?" khane mein Haan — poora topic band kar dena hai */
  remove: boolean
}

export interface ParseResult {
  /** topic ka naam lowercase -> data */
  topics: Map<string, IncomingTopic>
  /** "Naye Sawaal" sheet se kitne sawaal chune gaye */
  picked: number
  /** Jo rows chhod di gayin, un ki wajah */
  notes: string[]
  /**
   * File mein "Mojooda Topics" sheet mojood thi aur us mein kam se kam ek
   * topic tha?
   *
   * Sirf us soorat mein file ko POORI sachai mana jata hai — yani jo file
   * mein hai wahi database mein rahega (sawaal hat sakte hain, topic ka naam
   * badal sakta hai, topic band ho sakta hai). Agar ye sheet na ho to file
   * adhoori hai, aur hum sirf jorte hain — kuch mitate nahi.
   */
  fullSheet: boolean
}

/** exceljs ka cell kabhi object hota hai (rich text / formula) — saaf text nikalo */
export function cellText(value: any): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value.richText)) return value.richText.map((r: any) => r.text).join('')
  if (typeof value.text === 'string') return value.text
  if (value.result !== undefined) return String(value.result)
  return String(value)
}

/** Header ke naam se column number (tarteeb badal jaye to bhi chale) */
function headerMap(ws: Worksheet): Record<string, number> {
  const map: Record<string, number> = {}
  ws.getRow(1).eachCell((cell, col) => {
    const key = cellText(cell.value).toLowerCase().trim()
    if (key) map[key] = col
  })
  return map
}

/** Jo header in mein se kisi se shuru ho, us ka column number */
function findCol(map: Record<string, number>, ...candidates: string[]): number | null {
  for (const c of candidates) {
    const key = c.toLowerCase()
    for (const header of Object.keys(map)) {
      if (header === key || header.startsWith(key)) return map[header]
    }
  }
  return null
}

export function splitQuestions(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function isPlaceholder(topic: string): boolean {
  return !topic || topic.toUpperCase().startsWith('MISAAL')
}

export function parseQnaWorkbook(wb: Workbook): ParseResult {
  const topics = new Map<string, IncomingTopic>()
  const notes: string[] = []
  let picked = 0

  let fullSheet = false

  const put = (topic: string, questions: string[], answer: string, remove = false) => {
    const key = topic.toLowerCase()
    const existing = topics.get(key)
    if (existing) {
      for (const q of questions) if (!existing.questions.includes(q)) existing.questions.push(q)
      if (answer) existing.answer = answer
      if (remove) existing.remove = true
    } else {
      topics.set(key, { topic, questions: questions.slice(), answer, remove })
    }
  }

  // ── "Mojooda Topics" / purani shakal ki "Topic Answers" ─────────────────
  for (const sheetName of ['Mojooda Topics', 'Topic Answers']) {
    const ws = wb.getWorksheet(sheetName)
    if (!ws) continue
    const map = headerMap(ws)
    const cTopic = findCol(map, 'topic')
    const cQs = findCol(map, 'sawaal', 'questions')
    const cAns = findCol(map, 'jawab', 'answer')
    const cDel = findCol(map, 'hata dein', 'hatayen', 'delete')
    if (!cTopic || !cAns) continue

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const topic = cellText(row.getCell(cTopic).value).replace(/\s+/g, ' ').trim()
      const answer = cellText(row.getCell(cAns).value).trim()
      if (isPlaceholder(topic)) continue

      const del = cDel ? cellText(row.getCell(cDel).value).trim().toLowerCase() : ''
      const remove = del === 'haan' || del === 'yes'

      // Sheet mojood hai aur padhne layak row mili — ab file poori sachai hai
      fullSheet = true

      if (remove) {
        put(topic, [], answer, true)
        continue
      }
      if (!answer) {
        notes.push(`"${topic}" — jawab khali hai, chhod diya`)
        continue
      }
      put(topic, cQs ? splitQuestions(cellText(row.getCell(cQs).value)) : [], answer)
    }
  }

  // ── "Naya Topic" ────────────────────────────────────────────────────────
  const wsNew = wb.getWorksheet('Naya Topic')
  if (wsNew) {
    const map = headerMap(wsNew)
    const cTopic = findCol(map, 'naya topic', 'topic')
    const cQs = findCol(map, 'sawaal', 'questions')
    const cAns = findCol(map, 'jawab', 'answer')
    if (cTopic && cAns) {
      for (let r = 2; r <= wsNew.rowCount; r++) {
        const row = wsNew.getRow(r)
        const topic = cellText(row.getCell(cTopic).value).replace(/\s+/g, ' ').trim()
        const answer = cellText(row.getCell(cAns).value).trim()
        if (isPlaceholder(topic)) continue
        if (!answer) {
          notes.push(`"${topic}" — naya topic hai lekin jawab khali, chhod diya`)
          continue
        }
        put(topic, cQs ? splitQuestions(cellText(row.getCell(cQs).value)) : [], answer)
      }
    }
  }

  // ── "Naye Sawaal" (dropdown wali) ───────────────────────────────────────
  const wsQ = wb.getWorksheet('Naye Sawaal')
  if (wsQ) {
    const map = headerMap(wsQ)
    const cQ = findCol(map, 'naya sawaal', 'sawaal')
    const cAdd = findCol(map, 'add karein')
    const cTopic = findCol(map, 'kis topic')
    if (cQ && cAdd && cTopic) {
      for (let r = 2; r <= wsQ.rowCount; r++) {
        const row = wsQ.getRow(r)
        const add = cellText(row.getCell(cAdd).value).trim().toLowerCase()
        if (add !== 'haan' && add !== 'yes') continue

        const question = cellText(row.getCell(cQ).value).replace(/\s+/g, ' ').trim()
        const topic = cellText(row.getCell(cTopic).value).replace(/\s+/g, ' ').trim()
        if (!question) continue
        if (!topic || topic.includes('NAYA TOPIC')) {
          notes.push(`"${question.slice(0, 40)}" — topic nahi chuna, chhod diya`)
          continue
        }
        const key = topic.toLowerCase()
        const existing = topics.get(key)
        if (existing) {
          if (!existing.questions.includes(question)) existing.questions.push(question)
        } else {
          // Topic file mein nahi tha — jawab database se aayega
          topics.set(key, { topic, questions: [question], answer: '', remove: false })
        }
        picked++
      }
    }
  }

  return { topics, picked, notes, fullSheet }
}
