/**
 * Ye file Roman Urdu spelling, common typos, aur English grammar variations
 * ko normalize karti hai - taake customer chahe kaise bhi likhe (short-forms,
 * galat grammar, typos), matching sahi ho.
 *
 * YE SHARED FILE HAI: order-status detection (route.ts) AUR Q&A matching
 * (whatsapp.ts / Supabase 'qna' table) DONO isi file ko use karte hain.
 * Iska matlab: naya short-form/typo/spelling-variant dekho to bas NEECHE
 * dictionary mein ek line add karo - automatically dono jagah (order-detection
 * aur tumhari Excel Q&A) mein kaam karega, do jagah update nahi karna padega.
 */

// Punctuation hata ke lowercase karta hai - "order?" aur "order" ek jaisa
export function cleanText(t: string): string {
  return t.toLowerCase().replace(/[?!.,;:'"()]/g, '').replace(/\s+/g, ' ').trim()
}

// ── Roman Urdu spelling normalization ──────────────────────────────────
// Pehle multi-word shorthand (jahan ek lafz 2-3 tukdon mein likha jata hai)
const PHRASE_NORMALIZE: [RegExp, string][] = [
  [/\bml\s*jy\s*ga\b/g, 'milega'],
  [/\bmly\s*ga\b/g, 'milega'],
  [/\bay\s*ga\b/g, 'aayega'],
  [/\blgy\s*ga\b/g, 'lagega'],
  [/\bpohanch\s*gy?a\b/g, 'pohoncha'],
  [/\bpohonch\s*gy?a\b/g, 'pohoncha'],
]

// Phir single-word short-forms + common typos
// ── NAYA SHORT-FORM / TYPO DEKHO TO YAHAN EK LINE ADD KARO ──
const WORD_NORMALIZE: Record<string, string> = {
  // Roman Urdu short-forms
  kb: 'kab',
  tk: 'tak',
  mlyga: 'milega',
  mlega: 'milega',
  mly: 'milega',
  ayga: 'aayega',
  ay: 'aayega',
  mara: 'mera',
  maera: 'mera',
  ane: 'aane',
  ktna: 'kitna',
  lgyga: 'lagega',
  lgy: 'lagega',
  lega: 'lagega',
  kha: 'kahan',
  kaha: 'kahan',
  pohancha: 'pohoncha',
  pohuncha: 'pohoncha',
  gya: 'gaya',
  // Common English typos
  recieve: 'receive',
  wher: 'where',
  whn: 'when',
  wen: 'when',
  deliverd: 'delivered',
  delivary: 'delivery',
  delevery: 'delivery',
  trackign: 'tracking',
  staus: 'status',
  arived: 'arrived',
  arrivd: 'arrived',
  shiped: 'shipped',
  shippd: 'shipped',
  recieved: 'received',
}

export function normalizeRomanUrdu(text: string): string {
  let t = text.toLowerCase()
  for (const [pattern, replacement] of PHRASE_NORMALIZE) {
    t = t.replace(pattern, replacement)
  }
  return t
    .split(/\s+/)
    .map((word) => {
      const clean = word.replace(/[?!.,;:'"()]/g, '')
      return WORD_NORMALIZE[clean] || clean
    })
    .join(' ')
}

// ── English grammar normalization ──────────────────────────────────────
// Helping verbs (will/is/does/am waghera) hamesha hata dete hain - grammar
// sahi ho ya na ho, dono ek jaisa match honge.
const ENGLISH_AUX_WORDS = ['will', 'would', 'shall', 'do', 'does', 'did', 'is', 'are', 'am', 'can', 'could', 'has', 'have']

export function stripEnglishAux(text: string): string {
  let t = text
  for (const w of ENGLISH_AUX_WORDS) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), '')
  }
  return t.replace(/\s+/g, ' ').trim()
}

/**
 * Poora normalization pipeline - customer ke message PAR aur har
 * keyword/template PAR (order-detection ho ya Q&A) dono jagah isi function
 * ko use karo, taake matching consistent rahe.
 */
export function normalizeForMatch(text: string): string {
  return stripEnglishAux(normalizeRomanUrdu(cleanText(text)))
}
