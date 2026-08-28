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
 * 'keywords' column ab plain comma-separated text hai (Excel/CSV se bulk-add
 * karne ke liye asaan), isliye yahan split karke check karte hain.
 *
 * Sabse zyada "specific" (lambe) keyword ka match jeetega - taake overlapping
 * keywords wale alag Q&A entries mein customer ko sabse relevant/exact jawab mile,
 * generic keyword wala nahi.
 */
export async function matchQna(text: string): Promise<string | null> {
  const { data: rows, error } = await supabaseAdmin
    .from('qna')
    .select('keywords, answer')
    .eq('is_active', true)

  if (error || !rows) return null

  const lower = text.toLowerCase()
  let bestAnswer: string | null = null
  let bestMatchLength = 0

  for (const row of rows) {
    const keywords = (row.keywords as string).split(',').map((k) => k.trim().toLowerCase())
    for (const kw of keywords) {
      if (kw && lower.includes(kw) && kw.length > bestMatchLength) {
        bestMatchLength = kw.length
        bestAnswer = row.answer
      }
    }
  }

  return bestAnswer
}
