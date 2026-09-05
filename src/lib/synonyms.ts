/**
 * Ham-mani lafzon ko ek hi lafz bana deta hai (concept mapping).
 *
 * Masla: aap ke customers aadha English aadha Roman Urdu likhte hain. Bank
 * mein agar "mera order kab milega" likha ho aur customer likhe "when will I
 * receive my parcel" — to ek bhi lafz match nahi hota, halanke matlab bilkul
 * ek hai.
 *
 * Hal: dono ko ek canonical lafz par le aate hain:
 *     order/parcel/shipment  -> order
 *     kab/when               -> kab
 *     milega/receive/aayega  -> milega
 *
 * SIRF word-score matching mein use hota hai (qnaMatch.ts ka tokenize).
 * normalizeForMatch ko chhera nahi gaya, warna purani keyword list toot jati.
 *
 * ── NAYA ham-mani lafz dikhe to bas neeche wali list mein add kar dein ──
 */

/** canonical lafz -> uske tamam roop */
const CONCEPT_GROUPS: Record<string, string[]> = {
  // ── product ─────────────────────────────────────────────────────────────
  cover: ['cover', 'covers', 'case', 'cases', 'casing', 'backcover', 'backcovers', 'cvr', 'covr'],
  pouch: ['pouch', 'pouches'],
  skin: ['skin', 'skins'],

  // ── order / shipment ────────────────────────────────────────────────────
  order: ['order', 'orders', 'parcel', 'parcels', 'shipment', 'packet', 'consignment'],

  // ── waqt ────────────────────────────────────────────────────────────────
  kab: ['kab', 'when', 'kbh', 'kabhi'],
  kitna: ['kitna', 'kitne', 'kitni', 'ktna', 'ktne'],
  din: ['din', 'dino', 'day', 'days', 'roz'],
  hafta: ['hafta', 'haftay', 'week', 'weeks'],
  mahina: ['mahina', 'mahine', 'month', 'months'],
  aaj: ['aaj', 'aj', 'today'],
  kal: ['kal', 'tomorrow', 'yesterday'],

  // ── milna / pohonchna ───────────────────────────────────────────────────
  milega: [
    'milega', 'milegi', 'mile', 'mila', 'milna', 'miljayega',
    'aayega', 'aayegi', 'aaya', 'aana', 'aye',
    'receive', 'received', 'receiving', 'arrive', 'arrived', 'arrival',
    'pohoncha', 'pohonchega', 'punhcha',
  ],

  // ── delivery / shipping ─────────────────────────────────────────────────
  delivery: ['delivery', 'deliver', 'delivered', 'shipping', 'ship', 'shipped', 'dispatch', 'dispatched'],
  tracking: ['tracking', 'track', 'trace'],

  // ── paisa ───────────────────────────────────────────────────────────────
  price: ['price', 'prize', 'rate', 'cost', 'rupees', 'rupay', 'rs'],
  charges: ['charges', 'charge', 'dc', 'deliverycharges', 'fees', 'fee'],
  payment: ['payment', 'pay', 'easypaisa', 'jazzcash', 'cashondelivery', 'cod', 'paisa', 'paise', 'paisay', 'paissy'],

  // ── stock / availability ────────────────────────────────────────────────
  available: ['available', 'avaliable', 'availability', 'stock', 'mojood', 'mojud', 'milta', 'milte'],

  // ── product ki tafseel ──────────────────────────────────────────────────
  customize: ['customize', 'customization', 'custom', 'customized'],
  design: ['design', 'designs', 'print', 'printed', 'printing', 'dezine'],
  model: ['model', 'models', 'mobile', 'phone', 'handset', 'cell'],
  silicone: ['silicone', 'jelly', 'rubber'],
  hard: ['hard', 'plastic', 'metal'],
  color: ['color', 'colour', 'colours', 'colors', 'rang'],

  // ── amal ────────────────────────────────────────────────────────────────
  change: ['change', 'changed', 'changing', 'badal', 'badalna', 'badli', 'tabdeel', 'edit'],
  cancel: ['cancel', 'cancelled', 'cancellation'],
  address: ['address', 'pata', 'location'],
  refund: ['refund', 'return', 'wapis', 'wapas', 'exchange', 'replace', 'replacement'],
  number: ['number', 'num', 'no', 'nmbr', 'nombr'],

  // ── halat ───────────────────────────────────────────────────────────────
  late: ['late', 'deri', 'delay', 'delayed', 'der'],
  reply: ['reply', 'response', 'jawab', 'answer', 'respond'],
  quality: ['quality', 'ghatiya', 'gandi', 'fazul', 'fazool', 'kharab'],
}

/** lafz -> canonical lafz */
const TOKEN_TO_CONCEPT: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const canonical of Object.keys(CONCEPT_GROUPS)) {
    for (const variant of CONCEPT_GROUPS[canonical]) {
      map[variant] = canonical
    }
  }
  return map
})()

/** Ek lafz ko uske canonical roop mein badalta hai (na mile to jaisa hai waisa hi) */
export function toConcept(token: string): string {
  return TOKEN_TO_CONCEPT[token] || token
}

/** Sirf testing/debugging ke liye */
export const CONCEPT_COUNT = Object.keys(CONCEPT_GROUPS).length
