/**
 * AI se naye sawaal/topics ki tajweez banwana.
 *
 *   GET  /api/admin/qna-suggest            — hafta-war cron (CRON_SECRET se)
 *   POST /api/admin/qna-suggest            — /admin/qna ka "Abhi chalao" button
 *
 * Kuch bhi live nahi hota — sab tajweez "pending" rehti hai jab tak aap
 * /admin/qna par approve na karein.
 */

import { NextRequest, NextResponse } from 'next/server'
import { tajweezBanao } from '@/lib/aiSuggest'

export const dynamic = 'force-dynamic'
// Kai AI calls ek ke baad ek. Vercel ke Hobby plan par function ki hadd
// 60 second hai, is liye AI_SUGGEST_MAX itna rakha hai ke us mein poora ho
// jaye (100 jumle = 5 call = takreeban 30 second).
export const maxDuration = 60

function dinKitne(req: NextRequest): number {
  const d = Number(req.nextUrl.searchParams.get('days'))
  if (Number.isFinite(d) && d > 0 && d <= 90) return Math.floor(d)
  return 7
}

/** Cron (Vercel) — hafte mein ek dafa khud chalta hai */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const adminKey = process.env.ADMIN_KEY
  const auth = req.headers.get('authorization') || ''
  const key = req.nextUrl.searchParams.get('key')

  const cronHai = cronSecret && auth === 'Bearer ' + cronSecret
  const adminHai = adminKey && key === adminKey
  if (!cronHai && !adminHai) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const natija = await tajweezBanao(dinKitne(req))
  console.log('[qna-suggest]', JSON.stringify(natija))
  return NextResponse.json(natija)
}

/** Aap ka apna "Abhi chalao" button */
export async function POST(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }

  const form = await req.formData()
  if (String(form.get('key') || '') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const din = Number(form.get('days')) || 7
  const natija = await tajweezBanao(din)
  console.log('[qna-suggest]', JSON.stringify(natija))

  const wapas = new URL('/admin/qna', req.url)
  wapas.searchParams.set('key', adminKey)
  wapas.searchParams.set('chala', String(natija.tajaweez))
  wapas.searchParams.set('dekhe', String(natija.dekhe))
  return NextResponse.redirect(wapas, { status: 303 })
}
