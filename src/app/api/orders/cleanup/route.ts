import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fortyFiveDaysAgo = new Date()
  fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45)

  const { error, count } = await supabaseAdmin
    .from('orders')
    .delete({ count: 'exact' })
    .lt('created_at', fortyFiveDaysAgo.toISOString())

  if (error) {
    console.error('[cron] Delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[cron] Deleted ${count} orders older than 45 days`)
  return NextResponse.json({ ok: true, deleted: count })
}
