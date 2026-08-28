import { supabaseAdmin } from '@/lib/supabase'
import { normalizeForMatch } from '@/lib/textNormalize'

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
 * Excel mein har row ke 'keywords' column mein ek hi sawaal ke MULTIPLE poore
 * variants likho (jaise "order kab milega, mera order kab tak aayega, order
 * kitne din mein milega"), na ke sirf ek chhota generic word - isse matching
 * bohot zyada precise hoti hai.
 *
 * Roman Urdu short-forms (kb/tk/mlyga), common typos, aur English grammar
 * variations (will/is missing) - ye sab src/lib/textNormalize.ts se automatic
 * handle ho jate hain, order-detection wale system jaisa hi. Naya short-form
 * dikhe to sirf textNormalize.ts mein add karna - yahan kuch nahi karna.
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

  const cleaned = normalizeForMatch(text)
  let bestAnswer: string | null = null
  let bestMatchLength = 0

  for (const row of rows) {
    const keywords = (row.keywords as string).split(',').map((k) => normalizeForMatch(k))
    for (const kw of keywords) {
      if (kw && cleaned.includes(kw) && kw.length > bestMatchLength) {
        bestMatchLength = kw.length
        bestAnswer = row.answer
      }
    }
  }

  return bestAnswer
}
