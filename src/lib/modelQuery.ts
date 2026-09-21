/**
 * "Kya mere model ka cover mil jayega?" — ye sawaal pehchanta hai.
 *
 * Masla jo hal kar raha hai: "Samsung A54 ka cover mil jayega" mein "mil
 * jayega" hai, is liye bot ise order-status ka sawaal samajh kar "apna order
 * number bhejein" bhej deta tha — halanke customer ne abhi kuch khareeda hi
 * nahi.
 *
 * Tareeqa: duniya ke har model ki list banana namumkin hai, is liye do
 * cheezon par chalte hain —
 *   1. BRAND ka naam (samsung, iphone, oppo, hp, macbook ... Urdu mein bhi)
 *   2. MODEL ki shakal (13 pro max, a16, y17, note 12, s23 ultra, 14pm)
 * In mein se koi ek mil jaye aur baat kisi maujooda order / qeemat / kisi
 * aur khaas topic ki na ho, to ye availability ka sawaal hai.
 *
 * ── NAYA BRAND aaye to bas BRANDS list mein ek lafz add kar dein ──
 */

import { normalizeForMatch } from '@/lib/textNormalize'

const BRANDS = [
  // mobile
  'iphone', 'i phone', 'apple', 'samsung', 'galaxy', 'oppo', 'vivo', 'xiaomi',
  'mi', 'redmi', 'poco', 'realme', 'infinix', 'tecno', 'itel', 'huawei',
  'honor', 'nokia', 'motorola', 'moto', 'oneplus', 'one plus', 'pixel',
  'sony', 'xperia', 'lg', 'alcatel', 'sparx', 'qmobile', 'nothing phone',
  'zte', 'blackberry', 'asus', 'iqoo', 'nubia',
  // laptop
  'macbook', 'mac', 'hp', 'dell', 'lenovo', 'thinkpad', 'ideapad', 'vivobook',
  'zenbook', 'acer', 'aspire', 'nitro', 'msi', 'inspiron', 'latitude',
  'pavilion', 'elitebook', 'probook', 'chromebook', 'surface', 'toshiba',
  'matebook',
  // Urdu
  'سام سنگ', 'سامسنگ', 'آئی فون', 'ایفون', 'اوپو', 'ریڈمی', 'شیاؤمی',
  'وی وو', 'انفینکس', 'ٹیکنو', 'ہواوے', 'نوکیا',
]

const esc = (b: string) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SHORT = BRANDS.filter((b) => b.length <= 3).map(esc)
const LONG = BRANDS.filter((b) => b.length > 3).map(esc)

// Chhote lafz (mi, hp, lg, mac) POORE lafz ke tor par milne chahiyein — warna
// "custo-mi-se" Xiaomi ban jata hai aur "s-hp" HP laptop. Ye ghalti test mein
// pakdi gayi thi: 27 customization wale sawaal hijack ho rahe the.
const SHORT_RE = new RegExp('(^|[^a-z0-9])(' + SHORT.join('|') + ')([^a-z0-9]|$)', 'i')
// Lamby brand ke baad ya to lafz khatam ho, ya foran model ka number aaye —
// "VivoY17s" aur "RealmeC71" customer ek hi lafz mein likh deta hai. Bina is
// shart ke "o-ppo-site" (opposite) bhi Oppo ban jata tha.
const LONG_RE = new RegExp(
  '(^|[^a-z0-9])(' + LONG.join('|') + ')([^a-z]|[a-z]{0,2}[0-9]|$)',
  'i'
)

// "13 pro max", "12pro", "14pm", "s23 ultra", "a16", "note 12", "y17", "reno 2f"
const MODEL_SHAPES = [
  /\b\d{1,2}\s*(pro\s*max|promax|pro|plus|ultra|lite|mini|max|pm)\b/,
  /\b[a-z]\d{1,3}[a-z]?\b/,
  /\b(note|reno|hot|nord|find|magic|edge|spark|air|pad|zero|camon|narzo|rog)\s*\d{1,2}\b/,
]

// PAKKE lafz — in ka matlab sirf "available hai ya nahi" hi hota hai
const STRONG_AVAILABILITY = [
  'available', 'availble', 'avaliable', 'avilable', 'availabe', 'availabl',
  'stock', 'mojood', 'mojud', 'maujood', 'moujood', 'dastyab',
  'ap k pas', 'ap ke pas', 'apke pas', 'apke pass', 'ap ky pas', 'ap ky pss',
  'ap k pss', 'aap ke pas', 'tumhare pas', 'do you have', 'do u have',
  'have you', 'is there', 'show me', 'dikha', 'dekha d',
  'دستیاب', 'موجود', 'آپ کے پاس',
]

// KAMZOR lafz — "mil jayega" apne maujooda order ke liye bhi likha jata hai
// ("mera order kab milega"). In par akela bharosa nahi kiya ja sakta: sath
// mein product ka zikr laazmi hai aur "kab" nahi hona chahiye.
// (Test ne pakda tha: "kab tak milega" Yes-Available ban raha tha.)
const WEAK_AVAILABILITY = [
  'mil jayega', 'milega', 'mil sakta', 'mil sakti', 'mil jaye', 'mil jaeyga',
  'banega', 'ban jayega', 'bana dein', 'bana den', 'bnay ga', 'bna dein',
  'مل جائے', 'ملے گا',
]

const PRODUCT = ['cover', 'case', 'skin', 'pouch', 'mobile', 'phone', 'laptop', 'kor', 'کور']

// Baat kisi MAUJOODA order ki ho to ye availability ka sawaal nahi
const ORDER_CONTEXT = [
  'mera order', 'meri order', 'my order', 'order number', 'order no',
  'tracking', 'kab aayega', 'kab ayega', 'delivery kab', 'dispatch',
  'shipped', 'courier', 'status', 'confirmation number', 'abhi tak nahi',
  'order kiya tha', 'order kia tha', 'order kar diya', 'order kardiya',
  'receive', 'mila hai', 'mile hain', 'bought', 'purchased', 'khareeda',
  'shown in the pic', 'like the pic',
  // "Oppo A57 ha... many jab order kiya ha" — model ka zikr hai lekin
  // customer order kar chuka hai, ye availability ka sawaal nahi
  'order kiya', 'order kia', 'jab order', 'order wala',
]

// Qeemat ka sawaal Price wale jawab ka haq hai
const PRICE_CONTEXT = [
  'price', 'rate', 'kimat', 'qeemat', 'cost', 'charges', 'kitne ka',
  'kitne ki', 'kitne ke', 'kitny ka', 'kitny ki', 'ktne ka', 'paisay',
  'paise', 'rupees', 'discount',
]

// Ye sawaal apne apne topic ke hain — model ka zikr ho tab bhi Q&A hi behtar
// jawab dega (camera cutout, customization, refund waghera).
const OTHER_TOPIC = [
  'cutout', 'cut out', 'camera', 'customise', 'customize', 'customis',
  'customiz', 'custom', 'silicone', 'jelly', 'material', 'refund', 'replace',
  'return', 'exchange', 'allow to open', 'buy 1 get 1', 'buy one get one',
  'buyonegetone', 'tax', 'delivery charge', 'free delivery', 'collab',
  'review', 'fingerprint', 'quality', 'complain', 'cancel', 'address',
  'side cut', 'original',
  // "Karachi delivery available??" — ye delivery ka sawaal hai, model ka nahi
  'delivery', 'deliver', 'shipping',
  // "COD available??" — payment ka sawaal
  'cod', 'cash on', 'payment', 'easypaisa', 'jazzcash',
  // "aik iphone and the other one android?" — Same Models wala topic
  'other one', 'different', 'diffrent',
]

// Model ka naam liye BAGHAIR aam sawaal — "Cover kon kon se hai", "Do you
// have covers for all models", "Pic send me". normalizeForMatch "do/have"
// jaise lafz hata deta hai, is liye ye asal (lowercase) text par chalte hain.
const GENERIC_ASK = [
  /\bkon\s*kon\s*s[aeiy]/,
  /\b(all|sab|saray|sare|saare|har|every|any)\s+(models?|mobiles?|phones?)\b/,
  /\b(mere|meray|mera|meri|my)\s+(model|mobile|phone)\s+(k|ka|ki|ke|ky|for)?\s*(cover|case)/,
  /\bdo\s+(you|u)\s+have\b.*\b(covers?|cases?|designs?)\b/,
  /\b(covers?|cases?|designs?)\s+kit?n[aeiy]+\s+(h|hn|hai|hain|hen|he)\b/,
  /\b(pics?|pictures?|photos?)\s+(send|bhej|bhij|dikha)/,
  /\bsend\s+(me\s+)?(the\s+)?(pics?|pictures?|photos?)\b/,
  /\b(designs?)\s+(dikha|show)/,
]

function hasAny(t: string, list: string[]): boolean {
  return list.some((w) => t.includes(w))
}

/** Text mein kisi mobile/laptop model ka zikr hai? (brand ya model ki shakal) */
export function mentionsDeviceModel(text: string): boolean {
  const t = normalizeForMatch(text)
  const raw = text.toLowerCase()
  if (SHORT_RE.test(t) || SHORT_RE.test(raw)) return true
  if (LONG_RE.test(t) || LONG_RE.test(raw)) return true
  return MODEL_SHAPES.some((re) => re.test(t))
}

/**
 * Ye "mera model available hai?" wala sawaal hai?
 *
 * Sirf model ka naam bhejna bhi (jaise "12pro max", "For iPhone 14") isi
 * mein ginte hain — customer aur kuch poochna hi nahi chahta.
 */
export function looksLikeModelAvailability(text: string): boolean {
  const t = normalizeForMatch(text)
  if (!t) return false

  if (hasAny(t, OTHER_TOPIC)) return false
  if (hasAny(t, ORDER_CONTEXT)) return false
  if (hasAny(t, PRICE_CONTEXT)) return false

  if (mentionsDeviceModel(text)) return true

  const raw = text.toLowerCase().replace(/\s+/g, ' ')
  if (GENERIC_ASK.some((re) => re.test(raw))) return true

  // Model ka naam liye baghair — "covers available hain?", "Available?"
  const strong = hasAny(t, STRONG_AVAILABILITY)
  const weak = hasAny(t, WEAK_AVAILABILITY)
  const product = hasAny(t, PRODUCT)

  if (strong && product) return true
  // "kab" ho to baat waqt ki hai, availability ki nahi — "cover kab milega"
  if (weak && product && !t.includes('kab')) return true
  // Bilkul chhota message: "Available?", "Stock hai?"
  return strong && t.split(/\s+/).filter(Boolean).length <= 3
}
