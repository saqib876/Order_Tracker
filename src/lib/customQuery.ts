/**
 * "Apni picture wala cover bana dein" — customization ka sawaal pehchanta hai.
 *
 * Do masle hal karta hai:
 *
 *  1. Ye sawaal Q&A tak pohanchte hi nahi the. "apni picture wala cover bana
 *     dein" ko model-availability samajh kar "Yes Available" chala jata tha,
 *     aur "mujhe apni photo wala case chahiye" par order number maanga jata
 *     tha. Ab customization sab se pehle pehchana jata hai, to message seedha
 *     Q&A ko jata hai aur wahan se AAP ki Excel ka Customize wala jawab.
 *
 *  2. Agar aap ne wo khaas jumla Excel mein daala hi na ho, to bhi customer
 *     chup nahi rehta — Customize wale topic ka jawab chala jata hai.
 *
 * Note: "apni / meri / khud ki picture|photo|design|marzi" ko textNormalize
 * pehle hi 'custom' bana deta hai, is liye wo yahan khud-ba-khud aa jate hain.
 */

import { normalizeForMatch } from '@/lib/textNormalize'

/** Cheez jo banwani hai */
const PRODUCT = ['cover', 'case', 'skin', 'pouch', 'mobile', 'phone', 'laptop']

/** Banwane ke alfaz */
const BANWANA = [
  'bana', 'banwa', 'bnwa', 'banva', 'lagwa', 'lagana', 'lagwani', 'print',
  'chhap', 'chap', 'make', 'made', 'create', 'likh', 'likha', 'likhwa',
]

/** Customer ki apni cheez bhejne ka zikr */
const APNI_CHEEZ = [
  'pic', 'pics', 'picture', 'photo', 'tasveer', 'image', 'logo', 'name wala',
  'naam wala', 'name likha', 'naam likha', 'quote',
]

function hasAny(t: string, list: string[]): boolean {
  return list.some((w) => t.includes(w))
}

// "custom" lekin "customER" nahi — warna "ap customer ko..." jaisa jumla
// bhi customization ban jata hai. (Test ne ye pakda tha.)
const CUSTOM_WORD = /custom(?!er)/i

// Baat pehle se mile hue ya bheje ja chuke order ki ho to ye customization
// ka sawaal nahi — wo shikayat hai aur Manual Check ka haq hai.
// "Pics ma itna acha printed cover dekha kar ye paint wala bhaj dya ha"
const PEHLE_SE_MILA = [
  'bhej dya', 'bhaj dya', 'bhej diya', 'bhaj diya', 'bhej dia', 'bheja',
  'bhej diye', 'bhj diye', 'mila', 'mile', 'mil gaya', 'receive', 'recieve',
  'aya hai', 'aya ha', 'parcel', 'refund', 'replace', 'wapas', 'shikayat',
  'order kiya tha', 'order kia tha', 'order diya tha',
]

export function looksLikeCustomization(text: string): boolean {
  const t = normalizeForMatch(text)
  if (!t) return false

  // Jo cheez mil chuki hai us par baat ho rahi ho to ye shikayat hai
  if (hasAny(t, PEHLE_SE_MILA)) return false

  // Lafz "custom" — normalize ke baad "apni picture/photo/marzi" bhi yahi
  // ban jate hain
  if (CUSTOM_WORD.test(t)) return true

  // "picture bhej kar cover bnwana hai" — apni cheez bhej kar banwana.
  // Dhyan: "cover ki pics bhej dein" (yani HAMARI tasveerein) is se bahar
  // hai, kyunki us mein banwane ka koi lafz nahi hota.
  if (hasAny(t, APNI_CHEEZ) && hasAny(t, BANWANA) && hasAny(t, PRODUCT)) return true

  return false
}
