/**
 * Kisi ek number par bot ko khamosh karna (ya wapas chalu karna).
 *
 *   POST /api/admin/bot-pause   (form: key, phone, hours | "chalu")
 *
 * Kaam kya aata hai: aap khud customer se baat kar rahe hain aur nahi
 * chahte ke beech mein bot ka taiyar shuda message chala jaye.
 *
 * Bot aam tor par khud bhi khamosh ho jata hai (jab koi baat team ke
 * khane mein jaye, ya aaj ke jawab had se barh jayen) — ye button us ke
 * ilawa, aap ke apne haath ka switch hai.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const key = String(form.get('key') || '')
  const phone = String(form.get('phone') || '').replace(/[^0-9]/g, '')
  const hours = Number(form.get('hours') || 24)

  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }
  if (key !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!phone) {
    return NextResponse.json({ error: 'Number nahi mila' }, { status: 400 })
  }

  // hours = 0 ka matlab: bot dobara chalu kar do
  const until = new Date(Date.now() + Math.max(0, hours) * 3600 * 1000).toISOString()

  const { error } = await supabaseAdmin
    .from('wa_human_pause')
    .upsert({ phone, until, updated_at: new Date().toISOString() })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[admin] ${phone} par bot ${hours > 0 ? hours + ' ghante khamosh' : 'dobara chalu'}`)

  // Wapas usi safhe par
  const wapas = new URL('/admin/review', req.url)
  wapas.searchParams.set('key', adminKey)
  return NextResponse.redirect(wapas, { status: 303 })
}
