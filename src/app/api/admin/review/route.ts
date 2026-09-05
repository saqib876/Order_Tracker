/**
 * "Ho gaya" button — manual review item ko done mark karta hai
 * aur wapas list par bhej deta hai.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const id = String(form.get('id') || '')
  const key = String(form.get('key') || '')

  const adminKey = process.env.ADMIN_KEY
  if (!adminKey || key !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!id) {
    return NextResponse.json({ error: 'id missing' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('manual_review_queue')
    .update({ status: 'done', handled_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[review] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const back = new URL(`/admin/review?key=${encodeURIComponent(adminKey)}`, req.url)
  return NextResponse.redirect(back, { status: 303 })
}
