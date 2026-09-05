/**
 * Customer ke message se cheezein nikalne wale pure functions.
 *
 * Ye pehle route.ts ke andar the. Yahan is liye laye gaye hain ke inhe seedha
 * test kiya ja sake — route file se export karna Next.js allow nahi karta
 * (wahan sirf GET/POST jaise handlers export ho sakte hain).
 *
 * In mein koi database ya network call nahi hai — sirf text in, jawab out.
 */

import { normalizeForMatch } from '@/lib/textNormalize'
import { looksLikeOrderIntent } from '@/lib/orderIntent'

// Customer ke message ko clean karta hai (punctuation hata ke) taake matching
// zyada reliable ho - "order?" aur "order" dono ek jaisa treat ho
// (Roman Urdu spelling, typos, English grammar normalization - sab
// src/lib/textNormalize.ts mein hai, taake Q&A matching bhi wahi use kar sake)

// Customer apne order ko "order", "parcel", "cover", "case" - kisi bhi naam se
// bula sakta hai (khaas kar jab specific product ka zikar kare, jaise "mera
// cover kab milega"). Templates aur nouns ka combination banate hain taake
// har noun ke sath automatically saare relevant phrases match ho jayein.
// Har template tumhare diye asal sawaalon (English + Roman Urdu) se liya gaya hai.
export const ORDER_NOUNS = ['order', 'orders', 'parcel', 'parcels', 'cover', 'covers', 'case', 'cases']

export const NOUN_TEMPLATES = [
  // English (tumhare diye sawaalon se)
  'when will i receive my {n}', 'when will my {n} arrive',
  'expected delivery date for my {n}', 'how long will it take for my {n}',
  'where is my {n} right now', 'update on my {n} status',
  'has my {n} been shipped', 'tracking status of my {n}',
  'is my {n} out for delivery', 'why is my {n} delayed',
  "why hasn't my {n} arrived", 'delay in my {n} delivery',
  'track my {n}', 'where is my {n}', 'when will my {n}',
  // Roman Urdu (tumhare diye sawaalon se)
  'mera {n} kab tak milega', 'mera {n} kab aayega', '{n} kab tak deliver hoga',
  '{n} aane mein kitna time', 'mera {n} kahan tak pohncha',
  'mera {n} dispatch hua', 'mera {n} tracking update', 'mera {n} kab ship hoga',
  'tracking id mil sakti hai {n}', '{n} abhi tak nahi mila', 'kab milega mera {n}',
  'mera {n} kab tak punchay', '{n} kab tak', '{n} kahan', '{n} status', '{n} delayed', '{n} kab',
]

export const NOUN_BASED_KEYWORDS = NOUN_TEMPLATES.flatMap((tpl) =>
  ORDER_NOUNS.map((n) => tpl.replace('{n}', n))
)

// Urdu script mein log aam tor par sirf "آرڈر" (order) aur "پارسل" (parcel)
// hi likhte hain (cover/case Roman letters mein likhte hain, Urdu script mein nahi)
export const URDU_NOUNS = ['آرڈر', 'پارسل']
export const URDU_TEMPLATES = [
  'میرا {u} کب تک ملے گا', 'میرا {u} کب تک پہنچے گا', '{u} کب ڈلیور ہوگا',
  'میرے {u} کی موجودہ لوکیشن', 'میرا {u} ڈسپیچ', 'میرے {u} کی ٹریکنگ آئی ڈی',
  'میرا {u} کہاں تک پہنچا', 'میرا {u} ابھی تک کیوں نہیں ملا', 'میرا {u} ملنے میں کتنے دن',
]
export const URDU_NOUN_KEYWORDS = URDU_TEMPLATES.flatMap((tpl) =>
  URDU_NOUNS.map((u) => tpl.replace('{u}', u))
)

export const ORDER_KEYWORDS = [
  ...NOUN_BASED_KEYWORDS,
  ...URDU_NOUN_KEYWORDS,
  // Noun-agnostic (koi bhi cheez ho, ye phrases apne aap match ho jate hain)
  'track', 'mila', 'mla', 'status', 'tracking', 'kb mlyga', 'kab milega',
  // English - delivery timing (noun-agnostic)
  'when can i expect my delivery', 'expected delivery date',
  'how long will it take', 'delivery date',
  // English - status/location (noun-agnostic)
  'been shipped', 'tracking status', 'out for delivery',
  // English - delay (noun-agnostic)
  "hasn't arrived", 'has not arrived', 'any delay',
  // Roman Urdu - delivery timing (noun-agnostic)
  'kab tak milega', 'kab deliver', 'delivery kab tak milegi', 'kitna time',
  'kab tak aayega', 'kab tak punchay', 'kab tak pohnchega', 'kitne din lagenge',
  'milega', 'aayega', 'lagega', 'pohoncha', // normalize hone ke baad canonical safety-net
  // Roman Urdu - status/location (noun-agnostic)
  'dispatch hua', 'tracking update', 'kab ship', 'tracking id mil',
  // Roman Urdu - delay (noun-agnostic)
  'abhi tak nahi mila',
  // Urdu script - noun-agnostic
  'ڈلیوری میں کتنا وقت', 'ڈلیوری میں کوئی تاخیر', 'تاخیر', 'مزید لگیں گے',
]

// Har template ko ek dafa normalize kar lete hain (module load par) - taake
// runtime par har message ke liye baar baar normalize na karna pade
export const ORDER_KEYWORDS_NORMALIZED = ORDER_KEYWORDS.map((k) => normalizeForMatch(k)).filter(Boolean)

export function looksLikeOrderQuery(text: string) {
  // 1. Purani keyword list — tez hai aur asli data par is ki jhooti pehchan
  //    bilkul zero thi (0/239), is liye ise rakha hai.
  const t = normalizeForMatch(text)
  if (ORDER_KEYWORDS_NORMALIZED.some((k) => t.includes(k))) return true

  // 2. Naya word-score — jo keywords se nikal jate hain unhe ye pakadta hai.
  //    Held-out test: keywords ne 51 mein se 1 pakda, ye 25 pakadta hai,
  //    aur jhooti pehchan sirf 1/239.
  return looksLikeOrderIntent(text)
}

export function extractOrderNumber(text: string) {
  // Standalone 3-6 digit number only - won't match a chunk embedded inside a longer phone number
  const m = text.match(/(?<!\d)#?(\d{3,6})(?!\d)/)
  return m ? m[1] : null
}

// ── Shopify confirmation number ────────────────────────────────────────────
// Order place karte waqt customer ko yehi milta hai (order number nahi):
//   "Confirmation #N8FNNZAKE was generated for this order."
// Hamesha 9 characters, sirf A-Z aur 0-9. 8 din mein 45 log ye bhej chuke
// hain aur bot inhe bilkul nahi pehchanta tha.
//
// Kam se kam ek digit lazmi rakhi hai, warna "SEPTEMBER" jaise 9 harf wale
// aam lafz bhi confirmation number samjhe jane lagte.
export function extractConfirmationNumber(text: string): string | null {
  const candidates = text.match(/#?\b[A-Za-z0-9]{9}\b/g)
  if (!candidates) return null

  for (const raw of candidates) {
    const code = raw.replace('#', '').toUpperCase()
    if (code.length !== 9) continue
    if (!/[0-9]/.test(code)) continue // digit ke bina nahi
    if (!/[A-Z]/.test(code)) continue // sirf digits ho to wo order/tracking number hai
    return code
  }
  return null
}

// Message mein saaf saaf order number ka zikr hai?
// (isse "1400 ka hai?" jaise price wale sawaal order-lookup mein nahi jate)
export function mentionsOrderNumber(text: string): boolean {
  return (
    /\border\s*(no|number|num|#)/i.test(text) ||
    /\bconfirmation\b/i.test(text) ||
    /#\s*\d{3,6}\b/.test(text)
  )
}

// ── Sirf salaam / hello — koi asal sawaal nahi ─────────────────────────────
// Log salaam ki dozens spellings likhte hain (Assalamualaikum, Aslam o alikum,
// Asssalam o alaikum, AsslamuAlaikum, A.o.a ...). Har spelling list karne ke
// bajaye pehle dohre harf squeeze karte hain ("asssalaam" -> "asalam") aur
// phir chand prefixes se milate hain.
export function squeezeRepeats(w: string): string {
  return w.replace(/(.)\1+/g, '$1')
}

// Ye prefixes khud bhi squeezed shakal mein hain
export const GREETING_PREFIXES = [
  'salam', 'asalam', 'aslam', 'asalm', 'aslm', 'aoa',
  'helo', 'halo', 'hi', 'hy', 'hey', 'hlo', 'hlw',
  'walikum', 'walaikum', 'alikum', 'alaikum',
]

// Ye lafz akele salaam nahi bante, lekin salaam ke sath aa sakte hain
export const GREETING_FILLER = new Set([
  'bhai', 'bhaii', 'sir', 'ji', 'g', 'o', 'u', 'wa', 'myzan', 'team', 'a',
])

export function isGreetingWord(word: string): boolean {
  const w = squeezeRepeats(word)
  return GREETING_PREFIXES.some((p) => w.startsWith(p))
}

export function isGreetingOnly(text: string): boolean {
  const t = normalizeForMatch(text)
  if (!t || t.length > 40) return false

  const words = t.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 5) return false

  // Kam se kam ek asal greeting lazmi hai, baqi sab filler ho sakte hain.
  let greetings = 0
  for (const w of words) {
    if (isGreetingWord(w)) {
      greetings++
    } else if (!GREETING_FILLER.has(w)) {
      return false
    }
  }
  return greetings > 0
}

// Customer number kisi bhi format mein bhej sakta hai:
// +92 307 4942009, 0307-494-2009, (0092) 307.4942009, 92/307/4942009 waghera.
// Ye function har format se digits nikaal ke standard "92XXXXXXXXXX" banata hai.
export function normalizeExtractedPhone(digits: string): string | null {
  if (digits.length === 14 && digits.startsWith('0092')) return '92' + digits.slice(4)
  if (digits.length === 11 && digits.startsWith('0')) return '92' + digits.slice(1)
  if (digits.length === 12 && digits.startsWith('92')) return digits
  return null
}

export function extractPhone(text: string): string | null {
  // Phone-jaisa dikhne wala koi bhi block dhoondo: digits + spaces/dashes/dots/
  // slashes/commas/parentheses/plus - phir usme se digits nikaal ke length/prefix check karo
  const candidates = text.match(/[+()0-9][+()0-9.,\-/\s]{7,}[0-9)]/g)
  if (!candidates) return null
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '')
    const normalized = normalizeExtractedPhone(digits)
    if (normalized) return normalized
  }
  return null
}

export function isNumericOnlyMessage(text: string) {
  // Customer sirf apna number/order-number hi bhej de, kisi bhi separator format mein
  return /^[+()0-9][+()0-9.,\-/\s]{1,20}[0-9)]$/.test(text.trim())
}

// Agar customer order/phone ki jagah PostEx/Call Courier ka tracking number
// paste kar de (jo unhe courier SMS se mila ho) - wo 10-15 digit ka number
// hota hai jo phone-pattern se match nahi karta. Ise bhi ek fallback lookup
// ke tor pe try karte hain.
export function extractTrackingCandidate(text: string): string | null {
  const candidates = text.match(/[0-9][0-9.,\-/\s]{8,}[0-9]/g)
  if (!candidates) return null
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length <= 15 && !normalizeExtractedPhone(digits)) {
      return digits
    }
  }
  return null
}
