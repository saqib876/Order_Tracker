import crypto from 'crypto'

/**
 * Verify Shopify webhook authenticity
 */
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string
): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET

  if (!secret || !hmacHeader) return false

  const generatedHash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64')

  const a = Buffer.from(generatedHash, 'utf8')
  const b = Buffer.from(hmacHeader, 'utf8')

  if (a.length !== b.length) return false

  return crypto.timingSafeEqual(a, b)
}

/**
 * Normalize phone number for DB + search consistency
 * Example: 0300xxxxxxx → 92300xxxxxxx
 */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null

  let cleaned = phone.replace(/\D/g, '')

  // Pakistan conversion fix
  if (cleaned.startsWith('0')) {
    cleaned = '92' + cleaned.slice(1)
  }

  return cleaned || null
}