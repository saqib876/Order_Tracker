import { supabaseAdmin } from '@/lib/supabase'

/**
 * WhatsApp Cloud API se text message bhejta hai.
 * Sirf inbound reply ke liye use hota hai (jaisa tum chahte ho) - kabhi khud se
 * pehle message initiate nahi karta, isliye ye tumhare case mein hamesha free hai
 * (24-hour customer service window ke andar).
 */
export async function sendWhatsAppText(to: string, body: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN!
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  })

  if (!res.ok) {
    console.error('[whatsapp] send failed:', await res.text())
  }
  return res.json()
}

/**
 * Supabase 'qna' table se keyword-match karta hai. Match milte hi wahi answer
 * return karta hai - bot khud se kabhi kuch generate nahi karta.
 */
export async function matchQna(text: string): Promise<string | null> {
  const { data: rows, error } = await supabaseAdmin
    .from('qna')
    .select('keywords, answer')
    .eq('is_active', true)

  if (error || !rows) return null

  const lower = text.toLowerCase()
  for (const row of rows) {
    for (const kw of row.keywords as string[]) {
      if (lower.includes(kw.toLowerCase())) return row.answer
    }
  }
  return null
}
