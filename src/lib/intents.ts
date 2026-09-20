/**
 * Woh messages pehchanta hai jo bot ko KHUD nahi handle karne chahiye.
 *
 * Do qism ke khane hain:
 *   1. TABDEELI ki darkhwast — order abhi raaste mein hai, customer kuch
 *      badalna chahta hai (cancel, address, model, design, phone number).
 *   2. SHIKAYAT — order mil chuka hai aur us mein kharabi nikli (galat model,
 *      galat design, kam cases, quality).
 *
 * Ye sab cheezein paise aur customer ke data se juri hain, is liye bot
 * sirf ek holding reply bhejta hai aur message ko `manual_review_queue`
 * mein daal deta hai. Aap /admin/review par khud dekh kar faisla karte hain.
 */

import { normalizeForMatch, expandNumberAbbreviation } from '@/lib/textNormalize'

export type ManualReason =
  // 1. Tabdeeli ki darkhwast
  | 'order_cancel'
  | 'address_change'
  | 'model_change'
  | 'design_change'
  | 'phone_change'
  // 2. Mila hua order — shikayat
  | 'wrong_model_received'
  | 'wrong_design_received'
  | 'missing_items'
  | 'quality_issue'

/** Baayen column: order raaste mein hai, customer kuch badalna chahta hai. */
export const CHANGE_REASONS: ManualReason[] = [
  'order_cancel',
  'address_change',
  'model_change',
  'design_change',
  'phone_change',
]

/** Daayen column: order mil chuka hai, us mein kharabi nikli. */
export const ISSUE_REASONS: ManualReason[] = [
  'wrong_model_received',
  'wrong_design_received',
  'missing_items',
  'quality_issue',
]

export const MANUAL_REASON_LABEL: Record<ManualReason, string> = {
  order_cancel: 'Order Cancel',
  address_change: 'Address Change',
  model_change: 'Mobile Model Change',
  design_change: 'Design / Order Change',
  phone_change: 'Phone Number Change',
  wrong_model_received: 'Wrong Model Receive',
  wrong_design_received: 'Wrong Design Receive',
  missing_items: 'Kam Cases Receive',
  quality_issue: 'Quality Issue',
}

/** Default holding replies — Q&A table mein isi topic ka jawab ho to wo jeetega. */
export const MANUAL_REASON_REPLY: Record<ManualReason, string> = {
  order_cancel:
    'Aap ki request mil gayi hai. Order cancel karne ke liye humari team ise check kar rahi hai — thori dair mein aap ko confirm kar diya jayega.',
  address_change:
    'Aap ki address change ki request mil gayi hai. Humari team ise check kar ke thori dair mein aap ko confirm kar degi.',
  model_change:
    'Aap ki request mil gayi hai. Mobile model badalne ke liye humari team ise check kar rahi hai — thori dair mein aap ko confirm kar diya jayega.',
  design_change:
    'Aap ki request mil gayi hai. Order ya design mein tabdeeli humari team check kar rahi hai — thori dair mein jawab mil jayega.',
  phone_change:
    'Shukriya, naya number note kar liya gaya hai. Humari team ise order par update kar ke aap ko confirm kar degi.',
  wrong_model_received:
    'Maazrat ke sath — aap ki shikayat mil gayi hai. Humari team aap ka order check kar rahi hai aur thori dair mein aap se raabta karegi.',
  wrong_design_received:
    'Maazrat ke sath — aap ki shikayat mil gayi hai. Humari team aap ka order check kar rahi hai aur thori dair mein aap se raabta karegi.',
  missing_items:
    'Maazrat ke sath — aap ki shikayat mil gayi hai. Humari team aap ka order check kar rahi hai aur thori dair mein aap se raabta karegi.',
  quality_issue:
    'Maazrat ke sath — aap ki shikayat mil gayi hai. Humari team aap ka order check kar rahi hai aur thori dair mein aap se raabta karegi.',
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
 * Chhota lafz POORE lafz ki tarah milna chahiye.
 *
 * "through post office" mein "rough" chhupa hua hai — is wajah se ek aam
 * sawaal quality ki shikayat ban gaya tha. Isi tarah "inside" mein "side"
 * aur "considering" mein "side" hota hai.
 */
function wordRe(words: string[]): RegExp {
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp('(^|[^a-z0-9])(' + esc.join('|') + ')([^a-z0-9]|$)', 'i')
}

// Ye lafz itne saaf hain ke aur koi shart nahi chahiye — "Boht local or
// rough ha" mein na cover ka zikr hai na milne ka.
const SAAF_KHARAB_WORDS = wordRe([
  'rough', 'ripped', 'blur', 'blurr', 'blurry', 'ganda', 'gandi',
  'bhadda', 'bhaddi',
])

// 'local' akela do matlab rakhta hai ("local delivery hoti hai?"), is liye
// wo yahan nahi — us ke saaf jumle ('local lag', 'local ha') upar wali
// mazboot list mein hain.
const NARM_KHARAB_WORDS = wordRe(['fade', 'faded'])

const PRODUCT_WORDS = wordRe([
  'side', 'sides', 'edge', 'edges', 'corner', 'corners', 'finish', 'finishing',
  'writing', 'color', 'colour', 'colors', 'colours', 'rang', 'material',
  'photo', 'picture', 'pic', 'print', 'printing', 'item', 'piece',
])

/**
 * Normalized message dekh kar batata hai ke ye insaan ke paas jana chahiye ya nahi.
 * Kuch na mile to null.
 */
export function detectManualReason(rawText: string): ManualReason | null {
  // "mobile no / cell no" -> "mobile number" (warna "mobile no change" model
  // badalna samjha jata tha)
  const full = expandNumberAbbreviation(normalizeForMatch(rawText))

  // "order number / tracking number" customer ka APNA number nahi hai. "order
  // number galat bheja tha" ka matlab phone badalna nahi, na hi design — wo
  // bas order dhoondwa raha hai. Is liye cancel ke baad wale saare rules is
  // zikr ke bina wali shakal par chalte hain.
  const t = full.replace(/\b(order|tracking|confirmation|cn|parcel)\s+number\b/g, ' ')

  // ── 1. Cancel ────────────────────────────────────────────────────────────
  // 'cancel' itna decisive hai ke aur kisi shart ki zarurat nahi.
  // (normalizer 'cancle'/'cancal' ko pehle hi 'cancel' bana chuka hota hai)
  if (full.includes('cancel')) return 'order_cancel'
  if (full.includes('mansookh') || full.includes('wapas le lo')) return 'order_cancel'
  // Urdu mein likhne wale
  if (full.includes('منسوخ') || full.includes('کینسل')) return 'order_cancel'

  // Ghalti se do (ya us se zyada) order lag gaye aur ek hatwana hai — lafz
  // 'cancel' na bhi likha ho to ye bhi cancel hi ke khane mein jayega.
  const dobaraOrder =
    full.includes('double order') || full.includes('do order') || full.includes('2 order') ||
    full.includes('two order') || full.includes('do dafa order') || full.includes('2 dafa order') ||
    full.includes('do bar order') || full.includes('2 bar order') || full.includes('twice order') ||
    full.includes('order twice') || full.includes('do martaba order') || full.includes('duplicate order')
  if (dobaraOrder && hasAny(full, ['galti', 'ghalti', 'mistake', 'by mistake', 'ek hata', '1 hata', 'remove', 'extra'])) {
    return 'order_cancel'
  }

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
  if (t.includes('پتہ') || t.includes('ایڈریس')) {
    if (t.includes('تبدیل') || t.includes('بدل') || t.includes('غلط') || t.includes('change')) {
      return 'address_change'
    }
  }
  if (t.includes('نمبر') && (t.includes('تبدیل') || t.includes('بدل') || t.includes('غلط'))) {
    return 'phone_change'
  }

  if (t.includes('address') || t.includes('location') || t.includes('pata')) {
    if (hasAny(t, CHANGE_WORDS) || t.includes('shift') || t.includes('move')) {
      return 'address_change'
    }
  }

  // ── 2b. Customer ne sirf apna PATA bhej diya ────────────────────────────
  // "Post office kotanai Tehsil khawaza khela district swat." — is mein lafz
  // "address" kahin nahi, is liye bot bilkul chup reh jata tha. Aam tor par
  // aisa message address theek karwane ke liye hi aata hai.
  //
  // Kam se kam DO dhanche wale lafz laazmi hain (sirf sheher ka naam kaafi
  // nahi), warna "delivery Lahore mein hoti hai?" bhi pata ban jata.
  const pataKeHisse = [
    'street', 'gali', 'mohalla', 'muhalla', 'mohala', 'colony', 'block',
    'sector', 'house no', 'house #', 'makan', 'post office', 'dak khana',
    'tehsil', 'tehseel', 'district', 'zila', 'road', 'bazar', 'bazaar',
    'chowk', 'phase', 'plot', 'flat', 'apartment', 'village', 'goth',
    'near ', 'ke paas', 'k pas', 'town', 'stop', 'adda', 'ada ',
  ]
  const pataGinti = pataKeHisse.filter((w) => t.includes(w)).length
  if (pataGinti >= 2) return 'address_change'

  // ── 3a. Order MIL chuka hai aur us mein kharabi hai ──────────────────────
  // Ye tabdeeli ki darkhwast nahi, shikayat hai — is liye model_change /
  // design_change se PEHLE check hota hai, warna "galat model mila hai"
  // ghalat khane mein chala jata.
  const milChuka = hasAny(t, [
    'mila', 'mile', 'mily', 'mil gaya', 'milgaya', 'receive', 'recive', 'received',
    'aaya', 'aya hai', 'aya ha', 'a gaya', 'agaya', 'aagaya', 'pohoncha',
    'deliver', 'parcel khol', 'box khol', 'khol kar dekha', 'bheja hai',
    'bheja ha', 'bhej dia', 'send kia', 'sent me', 'you sent',
    'bhej diye', 'bhj diye', 'bhej dye', 'bheje hain', 'bheje hai', 'bhje',
    'bhej dia hai', 'bhej diya',
  ])
  const galatCheez = hasAny(t, [
    'galat', 'ghalat', 'wrong', 'different', 'dusra', 'doosra', 'dosra',
    'koi aur', 'kisi aur', 'nahi hai jo', 'jo order kia wo nahi',
    'not the same', 'instead of', 'ki jagah',
  ])
  const productKaZikr = hasAny(t, [
    'cover', 'case', 'parcel', 'product', 'item', 'order', 'packing', 'piece',
    'design', 'quality',
  ]) || PRODUCT_WORDS.test(t) // cheez ke hisse bhi cheez hi hain

  // (a) Galat MOBILE MODEL ka cover mil gaya.
  // Yahan sirf lafz 'model' (ya handset/device) chalta hai — 'mobile'/'phone'
  // to is store ke har message mein hota hai, us se koi signal nahi milta.
  // Bohat se customer lafz 'model' likhte hi nahi — seedha brand ka naam
  // likh dete hain ("cover Infinix Note 10 ka hai, Note 12 ka nahi").
  const brandKaNaam = hasAny(t, [
    'infinix', 'samsung', 'vivo', 'oppo', 'redmi', 'xiaomi', 'realme', 'tecno',
    'itel', 'iphone', 'huawei', 'nokia', 'poco', 'honor', 'oneplus', 'motorola',
  ])
  // "... is for Infinix Note 10 not Infinix Note 12" — angrezi ka ye "X not Y"
  // idiom sirf yahan chalta hai, aur tab bhi nahi jab baat na-milne ki ho ya
  // koi na-pasandeedgi ki ho (wo quality ka khana hai).
  const modelMismatch =
    t.includes(' not ') &&
    !hasAny(t, [
      'not receive', 'not deliver', 'not mila', 'not aya', 'not yet', 'not arrive',
      'not satisfied', 'not happy', 'not good', 'not neatly', 'not the quality',
    ])

  if (milChuka && (galatCheez || modelMismatch) && (hasAny(t, ['model', 'handset', 'device']) || brandKaNaam)) {
    return 'wrong_model_received'
  }

  // (b) Galat DESIGN / print mil gaya.
  const designKaZikr = hasAny(t, [
    'design', 'print', 'picture', 'photo', 'tasveer', 'image', 'colour', 'color',
  ])
  if (milChuka && galatCheez && designKaZikr) return 'wrong_design_received'

  // (c) Poore cases nahi mile — 5 ka order tha, 3-4 aaye.
  // Dhyan rahe: 'kaam hai' mein 'kam hai' nahi hota, is liye ye mehfooz hai.
  const kamMile =
    t.includes('missing') ||
    t.includes('kam mila') || t.includes('kam mile') || t.includes('kam aaya') ||
    t.includes('kam aya') || t.includes('kam aaye') || t.includes('kam aye') ||
    t.includes('kam bhej') || t.includes('kam receive') || t.includes('kam hai') ||
    t.includes('kam hain') || t.includes('ek kam') || t.includes('1 kam') ||
    t.includes('do kam') || t.includes('2 kam') || t.includes('kam nikle') ||
    t.includes('adhoora') || t.includes('adhura') || t.includes('poora order nahi') ||
    t.includes('pura order nahi') || t.includes('short receive') || t.includes('short mila')
  if (kamMile && (milChuka || productKaZikr)) return 'missing_items'

  // Ginti ka farq: "5 ka order tha 4 mile" — do alag ginti + product + mila.
  if (milChuka && productKaZikr) {
    const ginti = t.match(/\b\d{1,2}\b/g)
    const kuchBhiNahiMila = hasAny(t, [
      'nahi mila', 'ni mila', 'nahi aya', 'ni aya', 'nahi aaya', 'nahi howe',
      'nai receive', 'nahi receive', 'ni receive', 'not received', 'abhi tak nahi',
      'abhi tk nahi', 'abhi tak nai', 'abhi tk ni', 'ni hua', 'nahi hua',
      'ni hui', 'nahi hui', 'ni pohoncha', 'nahi pohoncha',
    ])
    if (
      !kuchBhiNahiMila &&
      ginti && ginti.length >= 2 && ginti[0] !== ginti[1] &&
      hasAny(t, ['order kia', 'order kiye', 'order tha', 'mangwaye', 'mangwae'])
    ) {
      return 'missing_items'
    }
  }

  // (d) Quality ki shikayat.
  const kharabWords = hasAny(t, [
    'quality kharab', 'quality achi nahi', 'quality acchi nahi', 'quality bad',
    'quality theek nahi', 'quality thik nahi', 'poor quality', 'bad quality',
    'low quality', 'kharab', 'ghatiya', 'defective', 'damage', 'toota', 'tuta',
    'broken', 'crack', 'phata', 'faded', 'ghisa', 'ghis gaya', 'utar gaya',
    'nikal gaya', 'third class', 'bakwas', 'faltu',
    // angrezi mein shikayat
    'not satisfied', 'not happy', 'poorly made', 'poorly finish',
    'messy edge', 'messy finish', 'edges are messy',
    'not neatly', 'disappointed', 'expecting better', 'very bad', 'so bad',
    // ── asli messages se (audit mein 18 shikayatein chhoot rahi thin) ──
    'white spot', 'whitespot', 'paint utar', 'utar raha', 'utar rha',
    'not up to mark', 'achi nahi', 'acha nahi', 'achi nai', 'acha nai',
    'finishing nahi', 'finish nahi', 'sahi nahi bana', 'jaisa dikhaya',
    'jesa dikhaya', 'nothing like',
  ]) || NARM_KHARAB_WORDS.test(t)

  // Kuch lafz itne saaf hain ke koi aur shart nahi chahiye — "Fraud ha ye
  // seedha seedha" jaise message mein na cover ka zikr hota hai na milne ka,
  // aur wo bilkul nazarandaz ho jate the.
  const saafShikayat = hasAny(t, [
    'fraud', 'dhoka', 'dhoka dia', 'scam', 'bekar', 'be kar', 'worthless',
    'waste of money', 'paise waste', 'local lag', 'local ha', 'local hai',
    'ghatiya', 'bakwas', 'third class', 'faltu', 'intihai fazul', 'fazool',
    'fazul', 'bohat bura', 'bohat hi bura', 'shikayat', 'complaint',
    'white spot', 'whitespot', 'paint utar', 'utar raha', 'utar rha',
  ]) || SAAF_KHARAB_WORDS.test(t)
  if (saafShikayat) return 'quality_issue'
  if (kharabWords && (milChuka || productKaZikr)) return 'quality_issue'

  // ── 3b. Mobile model badalna ─────────────────────────────────────────────
  // Design se PEHLE, warna "model change karna hai" design wale khane mein
  // chala jata hai.
  //
  // Ahem farq: "galat model MIL gaya" shikayat hai (cheez pohanch chuki hai),
  // "galat model SELECT ho gaya, change kar dein" tabdeeli ki darkhwast hai.
  // Is liye jab tak koi badalne wala lafz na ho, ye khana nahi khulta — aur
  // agar cheez pohanch chuki ho to bhi nahi.
  const modelKaZikr = hasAny(t, ['model', 'mobile', 'phone', 'handset', 'device'])
  const badalnaChahta =
    t.includes('change') ||
    t.includes('badal') ||
    t.includes('tabdeel') ||
    t.includes('galat select') ||
    t.includes('ghalat select') ||
    t.includes('galat likh') ||
    t.includes('ghalat likh') ||
    t.includes('wrong select') ||
    t.includes('sahi kar') ||
    t.includes('shi kar')
  const pohanchChuka = hasAny(t, ['mila', 'receive', 'received', 'aaya', 'bheja', 'bhej diya', 'deliver'])

  if (modelKaZikr && badalnaChahta && !pohanchChuka) return 'model_change'

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
      t.includes('ghalat likh') ||
      // "Purple phone case ki jaga par ye karden" — lafz 'change' nahi hai
      // lekin baat tabdeeli ki hi ho rahi hai
      t.includes('ki jaga') ||
      t.includes('ki jagah') ||
      t.includes('ke bajaye') ||
      t.includes('ki bajaye') ||
      t.includes('instead of') ||
      t.includes('replace kar')
    ) {
      return 'design_change'
    }
  }

  return null
}
