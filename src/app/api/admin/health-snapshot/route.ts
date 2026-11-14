/**
 * Roz ka hisaab mehfooz karna — /api/admin/health-snapshot
 *
 * Har raat ek dafa khud chalta hai (Vercel cron). Us din ka poora hisaab
 * nikal kar `bot_health_daily` mein ek line likh deta hai.
 *
 * Faida: roznamcha (bot_faisla) chahe purana ho kar saaf kar diya jaye,
 * har din ka natija tareekh ke sath mehfooz rehta hai. Health ka safha
 * isi se "aaj kal se behtar hai ya nahi" dikha sakta hai — aur aap jab
 * bhi waqt milne par aayein, guzra hua sab kuch saamne hota hai.
 *
 * Haath se chalana ho (aaj ka hisaab abhi mehfooz karna ho):
 *   /api/admin/health-snapshot?key=ADMIN_KEY
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sehatLo } from '@/lib/sehat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Pakistan ka din (cron UTC par chalta hai, hisaab yahan ka hona chahiye) */
function ajKaDin(): string {
  const ab = new Date(Date.now() + 5 * 3600 * 1000) // PKT = UTC+5
  return ab.toISOString().slice(0, 10)
}

async function ginti(table: string, khana: string, ghante: number): Promise<number> {
  const kabSe = new Date(Date.now() - ghante * 3600 * 1000).toISOString()
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(khana, kabSe)
  return error ? 0 : count ?? 0
}

async function mehfoozKaro(): Promise<any> {
  const s = await sehatLo()

  const { data: faisle } = await supabaseAdmin
    .from('bot_faisla')
    .select('qism,zariya')
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .limit(5000)

  const rows = faisle || []
  const kitne = (f: (r: any) => boolean) => rows.filter(f).length

  const line = {
    din: ajKaDin(),
    sehat_fisad: s.kaam.kul,
    jawab: s.sb.jawab24,
    customers: s.sb.customers24,
    tracking: kitne((r) => r.qism === 'tracking'),
    tracking_na: kitne((r) => r.qism === 'tracking_na_mila'),
    topic_jawab: kitne((r) => r.qism === 'topic'),
    lafz_se: kitne((r) => r.zariya === 'lafz' && r.qism !== 'khamosh'),
    ai_se: kitne((r) => r.zariya === 'ai' && r.qism !== 'khamosh'),
    khamosh: kitne((r) => r.qism === 'khamosh'),
    manual: kitne((r) => r.qism === 'manual'),
    anjaan: s.jawabBreakdown.find((j) => j.qism === 'anjaan')?.kitne || 0,
    naye_sawaal: await ginti('unmatched_messages', 'created_at', 24),
    ai_calls: s.sb.aiCalls24,
    // Poori tafseel — baad mein kabhi gehrai mein dekhna ho to yahan se
    tafseel: {
      paimane: s.kaam.paimane,
      darje: s.kaam.darje,
      aiKeKaam: s.kaam.aiKeKaam,
      jawabBreakdown: s.kaam.faisle ? s.jawabBreakdown : [],
      raaste: s.raaste,
      excel: s.excel,
    },
    banaya_gaya: new Date().toISOString(),
  }

  const { error } = await supabaseAdmin
    .from('bot_health_daily')
    .upsert(line, { onConflict: 'din' })

  if (error) return { thik: false, khata: error.message }
  console.log(`[health] ${line.din} ka hisaab mehfooz — sehat ${line.sehat_fisad}%`)
  return { thik: true, ...line, tafseel: undefined }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const adminKey = process.env.ADMIN_KEY
  const auth = req.headers.get('authorization')

  const cronSe = cronSecret && auth === `Bearer ${cronSecret}`
  const aapSe = adminKey && req.nextUrl.searchParams.get('key') === adminKey

  if (!cronSe && !aapSe) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(await mehfoozKaro())
}
