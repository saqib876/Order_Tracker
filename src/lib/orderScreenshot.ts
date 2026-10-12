/**
 * Customer ke bheje hue ORDER ke screenshot ko parhna.
 *
 * Teen tarah ki tasveerein aati hain (aap ne jo bheji thin):
 *
 *   1. "Order #49086 / Confirmed 6 Oct / CallCourier 10272260062718"
 *      — account ka Orders page
 *   2. "Confirmation #8IVAKP0FY / Thank you, ... / +923315663520"
 *      — order karne ke foran baad wala Thank You page
 *   3. "Order details / Contact information / email / 03292285825"
 *      — usi page ka neeche wala hissa
 *
 * In ke ilawa koi bhi tasveer (design, cover ki photo, meme) PARHI to jati
 * hai lekin us par koi amal nahi hota — `isOrderScreenshot` false rehta hai
 * aur bot khamosh rehta hai.
 *
 * Yahan koi network nahi: OCR ka text andar, order ki pehchan bahar. Isi
 * liye ise test karna aasan hai.
 */

import { extractPhone, normalizeExtractedPhone } from '@/lib/messageParse'

export interface OrderScreenshot {
  /** Ye waqai order ka screenshot hai? (warna bot ko kuch nahi karna) */
  isOrderScreenshot: boolean
  orderNumber: string | null
  /** Jaise 8IVAKP0FY — hamesha BARE huroof mein, bina # ke */
  confirmation: string | null
  /** CallCourier / PostEx ka tracking number */
  trackingId: string | null
  /** Customer ka mobile number, "92..." shakal mein */
  phone: string | null
  email: string | null
}

/**
 * Hamara apna WhatsApp number — ye screenshot mein likha hota hai
 * ("Kindly share this order number on our WhatsApp. WhatsApp Number:
 * 03477485247"). Ise customer ka number samajh lena sab se bari ghalti
 * hoti, is liye nikalne se pehle hata dete hain.
 */
const APNE_NUMBERS = ['03477485247', '923477485247', '3477485247']

// Pakki nishaniyan — in mein se ek bhi mil jaye to ye order ka screenshot hai
const PAKKI_NISHANI = [
  /confirmation\s*#/i,
  /your\s+order\s+is\s+confirmed/i,
  /\border\s*#\s*\d{4,6}/i,
  /\bcall\s*courier\b/i,
  /\bpostex\b/i,
  /myzan\.net/i,
  /thank\s*you\s*,/i,
]

// Halki nishaniyan — in mein se do mil jayen to kaafi hai
const HALKI_NISHANI = [
  /contact\s+information/i,
  /shipping\s+address/i,
  /billing\s+address/i,
  /payment\s+method/i,
  /shipping\s+method/i,
  /cash\s+on\s+delivery/i,
  /\bsubtotal\b/i,
  /mobile\s+model\s*:/i,
  /estimated\s+delivery\s+time/i,
  /buy\s*1\s*get\s*1/i,
  /\border\s+details\b/i,
  /\border\s+updates\b/i,
  /\bconfirmed\b/i,
]

/** OCR ka text — har line alag, faltu khali jagah saaf */
function lines(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Hamare apne number wali line nikal do */
function apneNumberKiLineHatao(all: string[]): string[] {
  return all.filter((l) => {
    if (/whatsapp\s*(number|no)/i.test(l)) return false
    const digits = l.replace(/[^0-9]/g, '')
    return !APNE_NUMBERS.some((n) => digits.includes(n))
  })
}

export function readOrderScreenshot(text: string): OrderScreenshot {
  const all = lines(text)
  const jor = all.join('\n')

  const pakki = PAKKI_NISHANI.some((re) => re.test(jor))
  const halki = HALKI_NISHANI.filter((re) => re.test(jor)).length
  const isOrderScreenshot = pakki || halki >= 2

  // ── Order number: "Order #49086" ──────────────────────────────────────
  const orderMatch = jor.match(/\border\s*#\s*(\d{4,6})\b/i)
  const orderNumber = orderMatch ? orderMatch[1] : null

  // ── Confirmation: "Confirmation #8IVAKP0FY" ───────────────────────────
  let confirmation: string | null = null
  const confMatch = jor.match(/confirmation\s*#?\s*([A-Za-z0-9]{8,10})\b/i)
  if (confMatch) {
    confirmation = confMatch[1].toUpperCase()
  } else {
    // OCR ne "Confirmation" lafz hi ghalat parh liya ("Confirmatlon") —
    // phir # ke baad wala 8-10 harf ka code dhoondte hain jis mein harf
    // aur adad dono hon (order number sirf adad ka hota hai, wo nahi uthta).
    const koi = jor.match(/#\s*([A-Za-z0-9]{8,10})\b/)
    if (koi && /[A-Za-z]/.test(koi[1]) && /[0-9]/.test(koi[1])) {
      confirmation = koi[1].toUpperCase()
    }
  }

  // ── Tracking: "CallCourier 10272260062718" ────────────────────────────
  let trackingId: string | null = null
  const courierIdx = all.findIndex((l) => /call\s*courier|postex|tracking/i.test(l))
  if (courierIdx >= 0) {
    for (const l of all.slice(courierIdx, courierIdx + 3)) {
      const m = l.match(/\b(\d{11,18})\b/)
      if (m) {
        trackingId = m[1]
        break
      }
    }
  }

  // ── Customer ka mobile number (apna number nikaal kar) ────────────────
  const saafLines = apneNumberKiLineHatao(all)
  let phone: string | null = null
  for (const l of saafLines) {
    const p = extractPhone(l)
    if (p && !APNE_NUMBERS.includes(p) && p !== normalizeExtractedPhone(APNE_NUMBERS[0])) {
      phone = p
      break
    }
  }

  // ── Email ─────────────────────────────────────────────────────────────
  let email: string | null = null
  const emails = jor.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []
  // apni dukan ka email (agar screenshot mein ho) customer ka nahi hai
  const customerEmail = emails.find((e) => !/myzan/i.test(e))
  if (customerEmail) email = customerEmail.toLowerCase()

  return { isOrderScreenshot, orderNumber, confirmation, trackingId, phone, email }
}

/**
 * OCR aksar milte julte huroof mein ghalti karta hai (O aur 0, I aur 1).
 * Confirmation number isi liye chand shaklon mein dhoonda jata hai.
 *
 * Misal: "8IVAKPOFY" parha gaya ho to "8IVAKP0FY" bhi try hota hai.
 */
export function confirmationVariants(code: string): string[] {
  const swaps: Record<string, string> = { O: '0', '0': 'O', I: '1', '1': 'I', S: '5', '5': 'S', B: '8', '8': 'B' }
  const out = new Set<string>([code.toUpperCase()])

  // Ek waqt mein ek harf badalte hain — 2 harf ki ghalti bohot kam hoti hai
  // aur poori list banane se database par bojh par jata.
  const up = code.toUpperCase()
  for (let i = 0; i < up.length; i++) {
    const alt = swaps[up[i]]
    if (!alt) continue
    out.add(up.slice(0, i) + alt + up.slice(i + 1))
  }
  return Array.from(out).slice(0, 12)
}
