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
  // 'alaikum' ki dozens spellings hain (alaikum/alikum/alaikun/aalaikm...),
  // is liye chhota prefix rakha hai
  'walik', 'walaik', 'alik', 'alaik',
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

  // "A o A" jaise bikhre hue salaam — sab lafz mila kar dekhte hain
  if (isGreetingWord(words.join(''))) return true

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

// ── Pakistani mobile number — har mumkin shakal ────────────────────────────
//
// Customer number jaise chahe likh sakta hai. Sab yahan handle hote hain:
//
//   03067078508          0307-707-8508        0307 707 8508
//   +92 307 7078508      +923067078508        92 307 7078508
//   0092 307 7078508     092 307 7078508      (0307) 707-8508
//   0307.707.8508        0307_707_8508        0307–707–8508 (en dash)
//   3067078508           92-307-7078508       ٠٣٠٦ (Urdu ke adad)
//
// Sab ka natija ek hi shakal: "92XXXXXXXXXX"
//
// Pakistan ke mobile numbers hamesha 3 se shuru hote hain aur network+number
// mila kar 10 adad ke hote hain (jaise 3067078508). Bas yehi asal hissa hai —
// aage jo bhi lage (0, 92, 092, 0092, +92) wo sirf country/trunk prefix hai.

/** Urdu/Arabic adad ko angrezi adad mein badalta hai (٠١٢٣ -> 0123) */
function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0)
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660
    return String(code - base)
  })
}

export function normalizeExtractedPhone(digits: string): string | null {
  let d = digits

  // Country / trunk prefix utar do — jo bhi shakal mein laga ho
  if (d.length === 15 && d.startsWith('00920')) d = d.slice(5)      // 0092 0307...
  else if (d.length === 14 && d.startsWith('0092')) d = d.slice(4)  // 0092 307...
  else if (d.length === 14 && d.startsWith('9200')) d = d.slice(4)
  else if (d.length === 13 && d.startsWith('0920')) d = d.slice(4)  // 092 0307...
  else if (d.length === 13 && d.startsWith('092')) d = d.slice(3)   // 092 307...
  else if (d.length === 13 && d.startsWith('920')) d = d.slice(3)   // 92 0307...
  else if (d.length === 12 && d.startsWith('92')) d = d.slice(2)    // 92 307...
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)     // 0307...

  // Ab asal 10 adad bachne chahiyein, aur pehla adad 3 hona chahiye
  if (d.length === 10 && d.charAt(0) === '3') return '92' + d

  return null
}

/**
 * Ek hi number ki tamam shaklein — database mein purane orders kisi bhi
 * shakal mein mehfooz ho sakte hain, is liye lookup teeno se karte hain.
 */
export function phoneVariants(normalized: string): string[] {
  const local = normalized.slice(2) // 3067078508
  return [normalized, '0' + local, local, '+' + normalized, '0092' + local]
}

export function extractPhone(text: string): string | null {
  const t = toAsciiDigits(text)

  // Phone-jaisa koi bhi block: adad + koi bhi aam separator
  // (space, dash, en/em dash, dot, comma, slash, underscore, brackets, plus)
  const candidates = t.match(/[+(\d][+()\d.,\-‐-―/_\s]{6,}[\d)]/g) || []

  // Alag alag block ke ilawa, poore message ke adad bhi try karte hain —
  // kabhi customer "0 3 0 6 7 0 7 8 5 0 8" jaise bhi likh deta hai
  for (const c of candidates) {
    const normalized = normalizeExtractedPhone(c.replace(/\D/g, ''))
    if (normalized) return normalized
  }

  // Aakhri koshish: bina kisi separator ke likha hua lamba number
  const bare = t.match(/\d{10,15}/g) || []
  for (const b of bare) {
    const normalized = normalizeExtractedPhone(b)
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

// ── Sirf haan / nahi / ok — koi sawaal nahi ────────────────────────────────
// "No", "No abhi nhi", "Ok", "Ji theek hai", "Thanks" — ye jawab hote hain,
// sawaal nahi. Pehle "no" ko "number" samjha jata tha, aur bot in par
// "apna order number bhejein" ya number-change wala lamba jawab bhej deta
// tha. Aise message par bot ko chup rehna chahiye.
//
// Ye lafz normalizeForMatch ke BAAD wali shakal mein hain (nhi -> nahi,
// ab -> abhi waghera), aur dohre harf squeeze kiye hote hain (okkk -> ok).
const ACK_WORDS = new Set([
  // inkaar
  'no', 'nahi', 'na', 'nope', 'nah', 'abhi', 'filhal', 'baad', 'bad', 'later',
  // iqraar
  'ok', 'oky', 'okay', 'okey', 'ohk', 'k', 'kk', 'yes', 'yep', 'yeah', 'ya',
  'yup', 'han', 'haan', 'hn', 'ha', 'hanji', 'ji', 'jee', 'g', 'sure', 'done',
  'thik', 'theek', 'thek', 'thk', 'tik', 'acha', 'achaa', 'achha',
  'hm', 'hmm', 'fine', 'good', 'great', 'nice', 'perfect', 'alright',
  // shukriya
  'thanks', 'thank', 'thanku', 'thankyou', 'thx', 'tnx', 'ty', 'shukriya',
  'shukria', 'jazakallah', 'jzk', 'welcome',
  // bharti ke lafz
  'hai', 'hy', 'he', 'h', 'bhai', 'sir', 'madam', 'mam', 'you', 'u', 'so',
  'much', 'very', 'bohat', 'bht', 'bhut', 'boht', 'mein', 'main', 'kr', 'kar',
  'lunga', 'lungi', 'lu', 'loon', 'krunga', 'karunga', 'karungi', 'krungi',
  'dunga', 'dungi', 'bataunga', 'bataungi', 'btata', 'btaunga',
])

// In mein se kam se kam ek lafz lazmi hai — warna "order karunga" jaisa
// jumla (sirf bharti ke lafz) bhi ack gina jata.
const ACK_CORE = new Set([
  'no', 'nahi', 'na', 'nope', 'nah', 'ok', 'oky', 'okay', 'okey', 'ohk', 'k',
  'kk', 'yes', 'yep', 'yeah', 'yup', 'han', 'haan', 'hanji', 'ji', 'jee',
  'sure', 'done', 'thik', 'theek', 'thek', 'thk', 'tik', 'acha', 'achaa',
  'achha', 'hm', 'hmm', 'fine', 'good', 'great', 'nice', 'perfect', 'alright',
  'thanks', 'thank', 'thanku', 'thankyou', 'thx', 'tnx', 'ty', 'shukriya',
  'shukria', 'jazakallah', 'jzk', 'later', 'filhal',
])

export function isAcknowledgementOnly(text: string): boolean {
  const t = normalizeForMatch(text)
  if (!t || t.length > 40) return false

  const words = t.split(/\s+/).filter(Boolean).map(squeezeRepeats)
  if (words.length === 0 || words.length > 6) return false

  let core = 0
  for (const w of words) {
    if (!ACK_WORDS.has(w)) return false
    if (ACK_CORE.has(w)) core++
  }
  return core > 0
}

// ── "Order kiya hi nahi" — abhi tak order kiya hi nahi ─────────────────────
// Lafz "order" dekh kar bot ise order ka sawaal samajhta tha aur order
// number maang leta tha — jo is customer ke paas hai hi nahi.
//
// Dhyan: "order NAHI MILA" / "order hi nahi aya" ulta matlab hai (order kiya
// hai, pohancha nahi) — wo asal order ka sawaal hai. Is liye inkaar ke foran
// baad agar milne/pohanchne wala lafz ho to ye function false deta hai.
const RECEIVE_AFTER_NEGATION =
  /^(mila|mile|mili|milega|milegi|aya|aaya|ayi|aayi|aye|aaye|pohoncha|pohanch|receive|received|deliver|delivered|hua|huwa|hwa|hui|hoi|update|confirm|ship|shipped|dispatch)\b/

export function saysNotOrderedYet(text: string): boolean {
  const t = normalizeForMatch(text)
  if (!t) return false

  // English: "not ordered yet", "haven't ordered", "didn't order"
  if (/\b(not|never|didnt|havent|hasnt)\s+(yet\s+)?(order|ordered|placed)\b/.test(t)) return true

  // Roman Urdu: "order kiya hi nahi", "order nahi kiya", "abhi order nahi karna"
  const m = t.match(
    /\border\s+(?:(?:kiya|kia|kya|kiye|ki|kari|kra|place)\s+)?(?:(?:hi|he|bhi|b|to|tou)\s+)?nahi\b\s*(\S*)/
  )
  if (m) {
    const next = m[1] || ''
    if (!RECEIVE_AFTER_NEGATION.test(next)) return true
  }

  // "nahi kiya order" / "abhi nahi karna order"
  if (/\bnahi\s+(kiya|kia|karna|karni|kia\s+tha)\s+order\b/.test(t)) return true

  return false
}

// ── "Maine order kar diya hai" — order ho chuka hai ────────────────────────
// Ye customer purana/maujooda order pooch raha hai. Isse "how to place your
// order" wala greeting nahi jana chahiye (wo naye kharidar ke liye hai).
export function saysAlreadyOrdered(text: string): boolean {
  const t = normalizeForMatch(text)
  if (!t || saysNotOrderedYet(text)) return false

  return (
    /\b(i|maine|mene|meine|mein|main|hum|humne|hamne)\s+(already\s+)?(ordered|order\s+(kiya|kia|kar|kr|place|laga|lgaya|lagaya))\b/.test(t) ||
    /\balready\s+ordered\b/.test(t) ||
    /\border\s+(kar|kr)\s+(diya|dia|dya|chuka|chuki|chuke)\b/.test(t) ||
    /\border\s+place\s+(kar|kr|ho)\b/.test(t) ||
    /\border\s+(kiya|kia)\s+(hai|tha|hua)\b/.test(t)
  )
}

// ── WhatsApp ke message mein se parhne layak matan ────────────────────────
// Pehle sirf `type === 'text'` liya jata tha. Tasveer ke sath likha sawaal
// ("Is this for iPhone 13?") aur order ka screenshot — dono bilkul phenk
// diye jate the, customer ko koi jawab nahi milta tha.
//
//   text                 -> us ka matan
//   image/video/document -> caption (na ho to khali string: media aaya hai,
//                           lekin parhne ko kuch nahi)
//   button / interactive -> dabaye gaye button ka naam
//   baqi (reaction, delivery receipt waghera) -> null: is par kuch nahi karna
export interface IncomingText {
  text: string
  isMedia: boolean
}

export function extractIncomingText(message: any): IncomingText | null {
  if (!message || typeof message !== 'object') return null

  switch (message.type) {
    case 'text':
      return { text: String(message.text?.body || ''), isMedia: false }

    case 'image':
    case 'video':
    case 'document':
    case 'sticker':
    case 'audio': {
      const media = message[message.type] || {}
      return { text: String(media.caption || ''), isMedia: true }
    }

    case 'button':
      return { text: String(message.button?.text || ''), isMedia: false }

    case 'interactive': {
      const i = message.interactive || {}
      const title = i.button_reply?.title || i.list_reply?.title || ''
      return { text: String(title), isMedia: false }
    }

    default:
      return null
  }
}
