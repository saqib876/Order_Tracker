/**
 * Meta ki app aur number ki pehchan — /api/admin/meta-info?key=ADMIN_KEY
 *
 * Kaam kya aata hai: developer dashboard na khule (ya yaad na ho ke app ka
 * naam kya tha) to bhi ye bata deta hai —
 *   - App ka ID aur NAAM
 *   - Token kis qism ka hai, kab tak chalega, kaun si ijazatein hain
 *   - WhatsApp number ka ID, dikhne wala number, aur us ka naam
 *   - WABA (WhatsApp Business Account) ka ID
 *
 * ZAROORI: token kabhi jawab mein nahi aata aur na log mein likha jata hai.
 * Meta se sirf us ki "pehchan" poochi jati hai (debug_token), khud token
 * nahi dikhaya jata.
 */

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const GRAPH = 'https://graph.facebook.com/v21.0'

async function graph(path: string, token: string): Promise<any> {
  try {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
    })
    const json = await res.json()
    if (!res.ok) {
      return { khata: json?.error?.message || `HTTP ${res.status}` }
    }
    return json
  } catch (e: any) {
    return { khata: e?.message || 'call nakaam' }
  }
}

export async function GET(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }
  if (req.nextUrl.searchParams.get('key') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!token) {
    return NextResponse.json({ error: 'WHATSAPP_ACCESS_TOKEN set nahi hai' }, { status: 500 })
  }

  // 1) Token kis app ka hai — yahin se app ka ID aur naam milta hai
  const dbg = await graph(`/debug_token?input_token=${encodeURIComponent(token)}`, token)
  const d = dbg?.data || {}

  const kabTak = (n: any) =>
    !n || Number(n) === 0 ? 'kabhi khatam nahi hota' : new Date(Number(n) * 1000).toISOString()

  // 2) WhatsApp number ki tafseel
  const number = phoneId
    ? await graph(
        `/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type`,
        token
      )
    : { khata: 'WHATSAPP_PHONE_NUMBER_ID set nahi hai' }

  // 3) WABA ka ID — number ke zariye
  const waba = phoneId ? await graph(`/${phoneId}?fields=whatsapp_business_account`, token) : null

  return NextResponse.json({
    'App ka ID': d.app_id || dbg?.khata || 'nahi mila',
    'App ka naam': d.application || 'nahi mila',

    Token: {
      qism: d.type || 'maloom nahi',
      'chalu hai': d.is_valid === true,
      'kab tak': kabTak(d.expires_at),
      'ijazatein (scopes)': d.scopes || [],
      ...(dbg?.khata ? { khata: dbg.khata } : {}),
    },

    'WhatsApp number': {
      id: number?.id || phoneId || null,
      'dikhne wala number': number?.display_phone_number || null,
      naam: number?.verified_name || null,
      'quality rating': number?.quality_rating || null,
      platform: number?.platform_type || null,
      ...(number?.khata ? { khata: number.khata } : {}),
    },

    'WABA ka ID': waba?.whatsapp_business_account?.id || null,

    madad: [
      'App ka naam aur ID se aap developers.facebook.com par apni app dhoond sakte hain.',
      'Wahan WhatsApp > Configuration > Webhooks mein "smb_message_echoes" ka tick lagana hai.',
      'Webhook chalu karne ka koi charge nahi — Meta messages ka paisa leta hai, webhook ka nahi.',
    ],
  })
}
