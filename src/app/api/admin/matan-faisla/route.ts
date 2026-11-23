/**
 * Aap ka faisla: ye matan quick reply hai ya aap ki apni likhai?
 *
 *   POST /api/admin/matan-faisla
 *     key     ADMIN_KEY
 *     hash    matan ka nishan (Health ke safhe se aata hai)
 *     quick   "1" = quick reply (bot chalta rahe)
 *             "0" = meri apni likhai (bot khamosh ho jaye)
 *             ""  = faisla hata do, bot apne andaze par chale
 *
 * Aap ka faisla bot ke andaze par bhaari hai.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function wapas(req: NextRequest, adminKey: string, params: Record<string, string>) {
  const url = new URL('/admin/health', req.url)
  url.searchParams.set('key', adminKey)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  url.hash = 'echo'
  return NextResponse.redirect(url, { status: 303 })
}

/**
 * Table hi na bani ho to Supabase ka apna paigham samajh nahi aata.
 * Us ki jagah seedha bata dete hain ke kya karna hai.
 *
 * Dhyan rahe: "schema cache" wali khata do soorton mein aati hai — table
 * waqai na bani ho, YA ban chuki ho magar Supabase ke API ko abhi pata na
 * chala ho. Doosri soorat mein sirf ek line chalani parti hai, is liye
 * dono baatein saath likhte hain.
 */
function khataSaaf(message: string): string {
  const m = String(message || '')
  if (m.includes('wa_matan_faisla') && (m.includes('schema cache') || m.includes('does not exist'))) {
    return (
      'Supabase ko wa_matan_faisla table nahi mil rahi. SQL editor mein qna_v2.sql ka ' +
      'section 18 chala dein. Agar wo pehle hi chala chuke hain to table ban chuki hai, ' +
      "bas Supabase ke API ko khabar nahi — us soorat mein sirf ye ek line chalayein: " +
      "notify pgrst, 'reload schema';"
    )
  }
  return m
}

export async function POST(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }

  const form = await req.formData()
  if (String(form.get('key') || '') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const hash = String(form.get('hash') || '').trim()
  const quick = String(form.get('quick') || '')
  let sample = String(form.get('sample') || '').slice(0, 200)

  if (!hash) return wapas(req, adminKey, { khata: 'Matan nahi mila' })

  // Niche wale "add" wale khane se sirf nishan aata hai — matan khud dhoond lein,
  // taake list mein poora jumla nazar aaye aur baad mein bhi mehfooz rahe.
  if (!sample) {
    const { data } = await supabaseAdmin
      .from('wa_recent_reply')
      .select('sample')
      .eq('text_hash', hash)
      .not('sample', 'is', null)
      .limit(1)
      .maybeSingle()
    sample = String(data?.sample || '').slice(0, 200)
  }

  // Faisla hata dena — bot phir apne andaze par chalega
  if (quick === '') {
    const { error } = await supabaseAdmin.from('wa_matan_faisla').delete().eq('text_hash', hash)
    if (error) return wapas(req, adminKey, { khata: khataSaaf(error.message) })
    console.log('[matan] faisla hata diya: ' + sample.slice(0, 50))
    return wapas(req, adminKey, { faisla: 'khud' })
  }

  const { error } = await supabaseAdmin.from('wa_matan_faisla').upsert(
    {
      text_hash: hash,
      quick: quick === '1',
      sample,
      decided_at: new Date().toISOString(),
    },
    { onConflict: 'text_hash' }
  )

  if (error) return wapas(req, adminKey, { khata: khataSaaf(error.message) })
  console.log(`[matan] ${quick === '1' ? 'QUICK REPLY' : 'aap ki likhai'}: ${sample.slice(0, 50)}`)
  return wapas(req, adminKey, { faisla: quick === '1' ? 'quick' : 'mera' })
}
