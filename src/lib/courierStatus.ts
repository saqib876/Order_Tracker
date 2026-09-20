/**
 * Courier ke status ko samajhne wali EK HI JAGAH.
 *
 * Pehle ye list teen jagah alag alag likhi hui thi (website ki tracking page
 * mein do dafa, WhatsApp bot mein ek dafa). Us ka natija ye nikla ke courier
 * ka asal lafz "RETURN SUBMITTED" hai aur code mein "returnED submitted"
 * likha tha — yani return hone wale parcel par na website ka Note dikhta tha
 * na WhatsApp ka. Ab sab yahin se aata hai, to dobara farq ho hi nahi sakta.
 *
 * ── Courier ke ASAL alfaz (17 asli parcels se nikale gaye) ──
 *   CONSIGNMENT BOOKED           PICKED FROM SHIPPER
 *   ARRIVED AT ORIGIN BRANCH     MOVED TO DEST. BRANCH
 *   REACHED AT DEST. BRANCH      OUT FOR DELIVERY
 *   DELIVERED                    UNDELIVERED
 *   CONTACTING CONSIGNEE         MOVED TO ORIGIN BRANCH
 *   REACHED AT ORIGIN BRANCH     OUT FOR RETURN SUBMISSION
 *   RETURN SUBMITTED
 *
 * Dhyan: "ARRIVED at origin" shuru ka normal safar hai (pickup ke foran baad),
 * jabke "MOVED/REACHED at origin" wapsi ka safar hai. Is liye 'arrived at
 * origin' ko return mein NAHI ginte.
 */

export type CourierStage =
  | 'delivered'
  | 'out_for_delivery'
  | 'near'
  | 'in_transit'
  | 'booked'
  | 'undelivered'
  | 'contacting'
  | 'returning'

/** Parcel wapas aa raha hai */
export function isReturningLabel(label: string): boolean {
  const l = (label || '').toLowerCase()
  return (
    l.includes('moved to origin') ||
    l.includes('reached at origin') ||
    l.includes('out for return') ||
    l.includes('return submission') ||
    // "RETURN SUBMITTED" aur "RETURNED SUBMITTED" dono
    /return(ed)?\s*submitted/.test(l)
  )
}

/** Delivered — lekin "Undelivered" ko galti se delivered na samajh len */
export function isDeliveredLabel(label: string): boolean {
  const l = (label || '').toLowerCase()
  return l.includes('delivered') && !l.includes('undelivered')
}

export function isUndeliveredLabel(label: string): boolean {
  return (label || '').toLowerCase().includes('undelivered')
}

export function isContactingLabel(label: string): boolean {
  return (label || '').toLowerCase().includes('contacting consignee')
}

/** Courier ke matan ko chand khanon mein baant deta hai */
export function classifyCourierStage(label: string): CourierStage {
  const l = (label || '').toLowerCase()
  if (isUndeliveredLabel(l)) return 'undelivered'
  if (isDeliveredLabel(l)) return 'delivered'
  if (isContactingLabel(l)) return 'contacting'
  if (isReturningLabel(l)) return 'returning'
  if (l.includes('out for delivery')) return 'out_for_delivery'
  if (l.includes('reached at dest')) return 'near'
  if (l.includes('moved to dest') || l.includes('en-route') || l.includes('en route')) return 'in_transit'
  return 'booked'
}

/** Timeline mein har event ka rang */
export function courierSeverity(label: string): 'red' | 'amber' | null {
  if (isUndeliveredLabel(label)) return 'red'
  if (isContactingLabel(label) || isReturningLabel(label)) return 'amber'
  return null
}

/** Courier ki live tracking ka pata — HTTPS (http par browser block kar deta hai) */
export function courierApiUrl(trackingId: string): string {
  return `https://cod.callcourier.com.pk/api/CallCourier/GetTackingHistory?cn=${encodeURIComponent(trackingId)}`
}
