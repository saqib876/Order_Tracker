/**
 * Bot ki sehat — /api/admin/sehat?key=ADMIN_KEY
 *
 * Ek safha jo bata deta hai ke poora nizam theek chal raha hai ya nahi:
 *   - Supabase ki saari tables aur naye khane maujood hain?
 *   - Meta se "echo" (aap ke bheje message ka matan) aa raha hai?
 *   - Bot ne ab tak kaun se matan ko QUICK REPLY maan liya hai?
 *   - is waqt kis customer par bot khamosh hai, aur kab tak?
 *   - tracking, jawab, naye sawaal — pichle 24 ghanton ka hisaab
 *
 * Ye safha koi WhatsApp message NAHI bhejta aur na AI ko call karta hai.
 * Sirf dekhta hai.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const QUICK_REPLY_MIN_CUSTOMERS = Number(process.env.QUICK_REPLY_MIN_CUSTOMERS) || 3

const ghanteQabl = (n: number) => new Date(Date.now() - n * 3600 * 1000).toISOString()

/** Table chalti hai? Aur us mein kitni rows hain? */
async function tableHaal(naam: string): Promise<any> {
  const { count, error } = await supabaseAdmin
    .from(naam)
    .select('*', { count: 'exact', head: true })
  if (error) return { thik: false, khata: error.message }
  return { thik: true, 'kul rows': count ?? 0 }
}

/** Is table mein ye khana (column) maujood hai? */
async function khanaHai(table: string, khana: string): Promise<string> {
  const { error } = await supabaseAdmin.from(table).select(khana).limit(1)
  return error ? 'NAHI — ' + error.message : 'haan'
}

/** Pichle N ghanton mein kitni rows? */
async function ginti(table: string, waqtKaKhana: string, ghante: number): Promise<number | string> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(waqtKaKhana, ghanteQabl(ghante))
  return error ? 'nahi gin saka' : count ?? 0
}

export async function GET(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }
  if (req.nextUrl.searchParams.get('key') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── 1) Tables aur naye khane ───────────────────────────────────────────
  const tables: Record<string, any> = {}
  for (const t of [
    'wa_human_message',
    'wa_human_pause',
    'wa_bot_message',
    'wa_recent_reply',
    'wa_tracking_sent',
    'qna_topics',
    'qna_suggestions',
    'qna_ignored',
    'order_sawaal_log',
    'unmatched_messages',
    'ai_topic_cache',
    'ai_call_log',
  ]) {
    tables[t] = await tableHaal(t)
  }

  const nayeKhane = {
    'wa_human_message.text_hash': await khanaHai('wa_human_message', 'text_hash'),
    'wa_human_message.sample': await khanaHai('wa_human_message', 'sample'),
    'qna_topics.off_reason': await khanaHai('qna_topics', 'off_reason'),
  }

  // ── 2) Meta se echo aa raha hai? ───────────────────────────────────────
  // Echo = matan ke sath khabar (text_hash bhara hua).
  // Status = sirf khabar, matan nahi (text_hash khali).
  const { data: bahar } = await supabaseAdmin
    .from('wa_human_message')
    .select('phone,text_hash,sample,sent_at')
    .gte('sent_at', ghanteQabl(24 * 7))
    .order('sent_at', { ascending: false })
    .limit(1000)

  const rows = bahar || []
  const matanWale = rows.filter((r) => r.text_hash)
  const sirfKhabar = rows.length - matanWale.length

  // ── 3) Bot ne kaun sa matan QUICK REPLY maan liya? ────────────────────
  const jama = new Map<string, { log: Set<string>; namuna: string; aakhri: string }>()
  for (const r of matanWale) {
    const h = String(r.text_hash)
    const pehle = jama.get(h)
    if (pehle) {
      pehle.log.add(String(r.phone))
    } else {
      jama.set(h, {
        log: new Set([String(r.phone)]),
        namuna: String(r.sample || '').slice(0, 70),
        aakhri: String(r.sent_at || ''),
      })
    }
  }

  const matanList = Array.from(jama.values())
    .sort((a, b) => b.log.size - a.log.size)
    .slice(0, 15)
    .map((m) => ({
      matan: m.namuna || '(matan mehfooz nahi)',
      'kitne alag customers': m.log.size,
      faisla:
        m.log.size >= QUICK_REPLY_MIN_CUSTOMERS
          ? 'QUICK REPLY — bot chalta rahega'
          : `abhi aap ki likhai samjha ja raha hai (${QUICK_REPLY_MIN_CUSTOMERS} customers par pehchan lega)`,
      'aakhri dafa': m.aakhri,
    }))

  // ── 4) Abhi kis par bot khamosh hai? ───────────────────────────────────
  const { data: pauses } = await supabaseAdmin
    .from('wa_human_pause')
    .select('phone,until')
    .gt('until', new Date().toISOString())
    .order('until', { ascending: false })
    .limit(50)

  // ── 5) Pichle 24 ghante ka kaam ────────────────────────────────────────
  const kaam = {
    'bot ne message bheje': await ginti('wa_bot_message', 'sent_at', 24),
    'alag alag jawab gaye': await ginti('wa_recent_reply', 'sent_at', 24),
    'tracking gayi': await ginti('wa_tracking_sent', 'sent_at', 24),
    'aap ke bheje message (echo/status)': await ginti('wa_human_message', 'sent_at', 24),
    'naye sawaal (Excel ke liye)': await ginti('unmatched_messages', 'created_at', 24),
    'order tracking wale sawaal': await ginti('order_sawaal_log', 'created_at', 24),
    'AI calls': await ginti('ai_call_log', 'created_at', 24),
  }

  // ── 6) Settings (koi secret nahi) ──────────────────────────────────────
  const settings = {
    AI_MODE: process.env.AI_MODE || 'check (default)',
    AI_PROVIDER: process.env.AI_PROVIDER || 'gemini (default)',
    MAX_REPLIES_PER_DAY: Number(process.env.MAX_REPLIES_PER_DAY) || 4,
    HUMAN_PAUSE_HOURS: Number(process.env.HUMAN_PAUSE_HOURS) || 2,
    MANUAL_PAUSE_HOURS: Number(process.env.MANUAL_PAUSE_HOURS) || 24,
    SAME_REPLY_HOURS: Number(process.env.SAME_REPLY_HOURS) || 24,
    QUICK_REPLY_MIN_CUSTOMERS,
    'TRACKING_DURING_PAUSE (1 = khamoshi mein bhi tracking jaye)':
      process.env.TRACKING_DURING_PAUSE || '1 (default)',
  }

  // ── 7) Seedha matlab ───────────────────────────────────────────────────
  const khulasa: string[] = []
  if (nayeKhane['wa_human_message.text_hash'] !== 'haan') {
    khulasa.push('RUKIYE: text_hash wala khana nahi bana — SQL chalana baqi hai.')
  } else if (matanWale.length === 0) {
    khulasa.push(
      'Echo abhi tak nahi aaya. Ya to abhi koi message bahar nahi gaya, ya Meta par smb_message_echoes ka tick nahi laga.'
    )
  } else {
    khulasa.push(`Echo aa raha hai — ${matanWale.length} message matan ke sath mehfooz hue.`)
  }
  if (sirfKhabar > 0) {
    khulasa.push(`${sirfKhabar} message aise the jin ka matan nahi mila (tasveer, ya sirf status).`)
  }
  const pehchane = matanList.filter((m) => m['kitne alag customers'] >= QUICK_REPLY_MIN_CUSTOMERS).length
  khulasa.push(
    pehchane
      ? `${pehchane} matan ko bot ne QUICK REPLY maan liya hai — un par ab kabhi khamosh nahi hoga.`
      : 'Abhi koi matan quick reply nahi mana gaya — har matan ko 3 alag customers tak jana baqi hai.'
  )
  khulasa.push(`Is waqt ${(pauses || []).length} customers par bot khamosh hai (tracking phir bhi jati hai).`)

  return NextResponse.json({
    'ek nazar mein': khulasa,
    'pichle 24 ghante': kaam,
    'aap ke bheje message (7 din)': {
      kul: rows.length,
      'matan ke sath (echo)': matanWale.length,
      'sirf khabar (status)': sirfKhabar,
    },
    'matan — bot kya samajhta hai': matanList,
    'abhi khamoshi in par': (pauses || []).map((p) => ({
      phone: String(p.phone),
      'kab tak': String(p.until),
    })),
    'naye khane': nayeKhane,
    settings,
    'Supabase tables': tables,
  })
}
