/**
 * Bot ki health, JSON mein — /api/admin/health?key=ADMIN_KEY
 *
 * Dekhne ke liye behtar safha /admin/health hai. Ye wohi hisaab hai, bas
 * khaali JSON — agar kabhi kuch copy kar ke bhejna ho.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sehatLo } from '@/lib/sehat'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }
  if (req.nextUrl.searchParams.get('key') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(await sehatLo())
}
