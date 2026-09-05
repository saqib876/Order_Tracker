/**
 * Woh messages pehchanta hai jo bot ko KHUD nahi handle karne chahiye —
 * order cancel, address change, design change, phone number change.
 *
 * Ye chaar cheezein paise aur customer ke data se juri hain, is liye bot
 * sirf ek holding reply bhejta hai aur message ko `manual_review_queue`
 * mein daal deta hai. Aap /admin/review par khud dekh kar faisla karte hain.
 */

import { normalizeForMatch } from '@/lib/textNormalize'

export type ManualReason =
  | 'order_cancel'
  | 'address_change'
  | 'design_change'
  | 'phone_change'

export const MANUAL_REASON_LABEL: Record<ManualReason, string> = {
  order_cancel: 'Order Cancel',
  address_change: 'Address Change',
  design_change: 'Design / Order Change',
  phone_change: 'Phone Number Change',
}

/** Default holding replies — Q&A table mein isi topic ka jawab ho to wo jeetega. */
export const MANUAL_REASON_REPLY: Record<ManualReason, string> = {
  order_cancel:
    'Aap ki request mil gayi hai. Order cancel karne ke liye humari team ise check kar rahi hai — thori dair mein aap ko confirm kar diya jayega.',
  address_change:
    'Aap ki address change ki request mil gayi hai. Humari team ise check kar ke thori dair mein aap ko confirm kar degi.',
  design_change:
    'Aap ki request mil gayi hai. Order ya design mein tabdeeli humari team check kar rahi hai — thori dair mein jawab mil jayega.',
  phone_change:
    'Shukriya, naya number note kar liya gaya hai. Humari team ise order par update kar ke aap ko confirm kar degi.',
}

const CHANGE_WORDS = [
  'change', 'chng', 'chnge', 'badal', 'badl', 'update', 'karwana', 'krwana',
  'karwani', 'krwani', 'karwa', 'krwa', 'galat', 'ghalat', 'wrong', 'different',
  'sahi', 'shi', 'correct', 'edit',
]

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w))
}

/**
 * Normalized message dekh kar batata hai ke ye insaan ke paas jana chahiye ya nahi.
 * Kuch na mile to null.
 */
export function detectManualReason(rawText: string): ManualReason | null {
  const t = normalizeForMatch(rawText)

  // ── 1. Cancel ────────────────────────────────────────────────────────────
  // 'cancel' itna decisive hai ke aur kisi shart ki zarurat nahi.
  // (normalizer 'cancle'/'cancal' ko pehle hi 'cancel' bana chuka hota hai)
  if (t.includes('cancel')) return 'order_cancel'
  if (t.includes('mansookh') || t.includes('wapas le lo')) return 'order_cancel'

  // ── 2. Phone / contact number ────────────────────────────────────────────
  const mentionsNumber =
    t.includes('contact number') ||
    t.includes('phone number') ||
    t.includes('mobile number') ||
    t.includes('number') ||
    t.includes('num')
  if (mentionsNumber) {
    if (
      hasAny(t, ['galat', 'ghalat', 'wrong', 'change', 'update', 'sahi', 'shi']) ||
      t.includes('use this number') ||
      t.includes('is number par') ||
      t.includes('naya number')
    ) {
      return 'phone_change'
    }
  }

  // ── 3. Address ───────────────────────────────────────────────────────────
  if (t.includes('address') || t.includes('location') || t.includes('pata')) {
    if (hasAny(t, CHANGE_WORDS) || t.includes('shift') || t.includes('move')) {
      return 'address_change'
    }
  }

  // ── 4. Design / order badalna ────────────────────────────────────────────
  const mentionsOrderThing =
    t.includes('design') ||
    t.includes('order') ||
    t.includes('model') ||
    t.includes('cover') ||
    t.includes('case') ||
    t.includes('colour') ||
    t.includes('color')
  if (mentionsOrderThing) {
    if (
      t.includes('change') ||
      t.includes('badal') ||
      t.includes('wrong selection') ||
      t.includes('galat select') ||
      t.includes('ghalat select') ||
      t.includes('galat likh') ||
      t.includes('ghalat likh')
    ) {
      return 'design_change'
    }
  }

  return null
}
