/**
 * MARHALA — baat kis waqt ki ho rahi hai?
 *
 * Ek hi lafz do bilkul alag baatein keh sakta hai:
 *
 *   "Replacement ki policy kya hai?"        <- abhi kharida bhi nahi
 *   "Cover toota hua mila, replacement do"  <- mil chuka, shikayat hai
 *
 * Dono mein "replacement" hai, lekin pehla ek SAWAAL hai aur doosra ek
 * SHIKAYAT. Pehle wale ko manual check mein daalna ghalat hai — wahan sirf
 * wo jana chahiye jis ka order aa chuka ho aur us mein kharabi nikli ho.
 *
 * Ye file sirf itna batati hai ke baat guzre waqt ki hai ya aane wale ki:
 *
 *   'baad'        — order mil chuka, ab us ke bare mein baat ho rahi hai
 *   'pehle'       — abhi mila nahi; policy, tareeqa ya "agar aisa hua to"
 *   'maloom-nahi' — saaf na ho. Aise mein bot ehtiyat karta hai.
 *
 * Yahan koi AI nahi — sirf alfaz. Tez hai, muft hai, aur har message par
 * chalta hai. AI sirf tab bulaya jata hai jab yahan se faisla na ho.
 */

import { normalizeForMatch } from '@/lib/textNormalize'

export type Marhala = 'pehle' | 'baad' | 'maloom-nahi'

/**
 * "Mil chuka hai" — guzra waqt. In mein se koi lafz ho to customer apne
 * haath mein aa chuke parcel ki baat kar raha hai.
 */
const MIL_CHUKA = [
  'mil gaya', 'mil gya', 'mil gai', 'mil gaye', 'milgaya', 'mila hai', 'mila h',
  'mil chuka', 'receive hua', 'receive ho gaya', 'received', 'recieved',
  'receive kiya', 'receive kia', 'recieve kia', 'pohoncha', 'pouncha',
  'deliver ho gaya', 'delivered', 'aa gaya', 'agaya', 'aa gai', 'agai',
  'khola', 'khol kar', 'open kiya', 'open kia', 'unbox', 'nikla', 'nikali',
  'parcel khol',
]

/**
 * Kharabi ke alfaz — ye bhi usi waqt bole jate hain jab cheez saamne ho.
 */
const KHARABI = [
  'toota', 'tuta', 'tuti', 'tota', 'broken', 'break', 'crack', 'damage',
  'scratch', 'kharab', 'kharaab', 'kharb', 'ghatiya', 'bakwas', 'bekar',
  'faded', 'rang utar', 'color utar', 'print kharab', 'quality kharab',
  'poor quality', 'bad quality', 'low quality', 'defect', 'faulty',
  'fit nahi', 'fit ni', 'size galat', 'size ghalat',
]

/**
 * "Jo mangwaya tha wo nahi aaya" — ghalat cheez milne ki shikayat.
 * Lafz 'galat' akela kaafi nahi (order number galat ho sakta hai), is liye
 * sath mein milne ka zikr zaroori hai.
 */
const GHALAT_MILA = [
  /\b(galat|ghalat|wrong|different|doosra|dusra|aur hi)\b[^.]{0,25}\b(mila|mil gaya|aya|aaya|bheja|bhej diya|send|receive|recieve|deliver)\b/,
  /\b(mila|mil gaya|aya|aaya|receive|recieve)\b[^.]{0,25}\b(galat|ghalat|wrong|different|doosra|dusra)\b/,
]

/**
 * Sawaal poochne ke andaz — abhi kuch hua nahi, maloomat chahiye.
 */
const SAWAAL_KA_ANDAZ = [
  'policy', 'policies', 'guarantee', 'guranty', 'warranty', 'warrenty',
  'kya aap', 'kia ap', 'kya ap', 'do you', 'can i', 'is there', 'ho sakta',
  'ho sakti', 'hoti hai', 'hota hai', 'hoti he', 'hota he', 'karte hain',
  'krte hain', 'karte ho', 'krte ho', 'milti hai', 'milta hai',
  'ka tareeqa', 'ka tariqa', 'kaise hota', 'kaise hoti', 'kaise karte',
  'process kya', 'kitne din ke andar', 'kitne dino',
]

/**
 * "Agar" — faraz ki baat. "Agar galat mila to?" mein kharabi ke alfaz to
 * hain, lekin hua kuch nahi. Ye sab par bhaari hai.
 */
const FARAZ = [
  'agar', 'agr', 'aghar', 'if ', 'in case', 'suppose', 'farz karein',
  'kahin aisa', 'maan lein',
]

/**
 * Aane wale waqt ki baat — abhi kharidna hai.
 */
const AANE_WALA = [
  'order karna hai', 'order krna hai', 'order karna h', 'order krna h',
  'want to order', 'lena hai', 'lena h', 'khareedna', 'kharidna',
  'order karne se pehle', 'order krne se pehle', 'before order',
  'lene se pehle', 'mangwane se pehle',
]

const koi = (t: string, list: string[]) => list.some((w) => t.includes(w))

/**
 * Baat guzre waqt ki hai ya aane wale ki?
 *
 * Tarteeb ahem hai:
 *   1. "Agar / if" ho to baat faraz ki hai — chahe kharabi ke lafz bhi hon
 *   2. Mil chuka / kharabi ke alfaz — guzra waqt
 *   3. Policy ya sawaal ka andaz — aane wala waqt
 *   4. Warna maloom nahi
 */
export function marhalaPehchano(rawText: string): Marhala {
  const t = normalizeForMatch(rawText)
  if (!t) return 'maloom-nahi'

  const farazHai = koi(t, FARAZ)
  const milChuka = koi(t, MIL_CHUKA) || koi(t, KHARABI) || GHALAT_MILA.some((re) => re.test(t))
  const sawaalHai = koi(t, SAWAAL_KA_ANDAZ)
  const aaneWala = koi(t, AANE_WALA)

  // "Agar cover toota hua mila to?" — hua kuch nahi, poochh raha hai
  if (farazHai && !aaneWala) return 'pehle'
  if (aaneWala) return 'pehle'

  if (milChuka) return 'baad'
  if (sawaalHai) return 'pehle'

  return 'maloom-nahi'
}
