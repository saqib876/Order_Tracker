/**
 * "Naye Sawaal" mein jis sawaal par aap ne "Nahi" kiya, wo `qna_ignored`
 * table mein yaad rakha jata hai aur agli Excel mein kabhi wapas nahi aata.
 *
 * Pehchan ke liye sawaal ki saaf shakal: chhote huroof, sirf harf aur adad,
 * ek space (Angrezi + Urdu huroof) — taake "Hello!!" aur "hello" ek hi ginay jayen.
 */
export function ignoreKey(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
