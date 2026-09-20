/**
 * Courier ki live tracking — humare apne server se.
 *
 * Website ye call SEEDHA courier ko karti thi, lekin courier ka pata http par
 * hai aur website https par — browser aisi call ko BLOCK kar deta hai
 * ("Mixed Content"). Natija: har customer ko "Tracking info not available
 * yet" dikhta tha, aur courier wala Note kabhi nazar nahi aata tha.
 *
 * Server par ye rukawat nahi hoti (WhatsApp bot isi liye theek chal raha
 * tha). Is liye website ab courier ko yahan se poochti hai.
 */

import { NextRequest, NextResponse } from 'next/server'
import { courierApiUrl } from '@/lib/courierStatus'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cn = (req.nextUrl.searchParams.get('cn') || '').trim()

  // Tracking number sirf adad aur harf ka hota hai
  if (!cn || !/^[A-Za-z0-9-]{5,30}$/.test(cn)) {
    return NextResponse.json({ error: 'Invalid tracking number' }, { status: 400 })
  }

  try {
    const res = await fetch(courierApiUrl(cn), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return NextResponse.json({ error: 'Courier not reachable' }, { status: 502 })
    }
    const data = await res.json()
    return NextResponse.json(Array.isArray(data) ? data : [])
  } catch (e: any) {
    console.error('[courier] fetch fail:', e?.message || e)
    return NextResponse.json({ error: 'Courier not reachable' }, { status: 502 })
  }
}
