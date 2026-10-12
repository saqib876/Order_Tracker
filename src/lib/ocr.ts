/**
 * WhatsApp se aayi tasveer ko parhna (OCR).
 *
 * Do kaam:
 *   1. Meta se tasveer download karna (media id -> asli file)
 *   2. Us mein likha hua text nikalna
 *
 * Text nikalne ke liye do mein se jo bhi key set ho wo use hoti hai:
 *
 *   GOOGLE_VISION_API_KEY  — Google Cloud Vision (mahine ke 1000 muft)
 *   OCR_SPACE_API_KEY      — ocr.space (mahine ke 25,000 muft)
 *
 * Dono mein se koi set na ho to OCR band — bot pehle jaisa chalta rahega,
 * kuch tootta nahi.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'
// Tasveer par itne se zyada waqt nahi lagana — WhatsApp ka webhook jaldi
// jawab maangta hai
const TIMEOUT_MS = 12_000

export function ocrAvailable(): boolean {
  return Boolean(process.env.GOOGLE_VISION_API_KEY || process.env.OCR_SPACE_API_KEY)
}

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T | null> {
  let timer: any
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } catch (e: any) {
    console.warn('[ocr] nakaam:', e?.message || e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Meta ke media id se asli tasveer (bytes) nikalta hai */
export async function whatsappMedia(mediaId: string): Promise<{ base64: string; mime: string } | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token || !mediaId) return null

  return withTimeout(
    (async () => {
      const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!metaRes.ok) {
        console.warn('[ocr] media info nahi mili:', metaRes.status)
        return null
      }
      const info = await metaRes.json()
      if (!info?.url) return null

      const fileRes = await fetch(info.url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!fileRes.ok) {
        console.warn('[ocr] tasveer download nahi hui:', fileRes.status)
        return null
      }
      const buf = Buffer.from(await fileRes.arrayBuffer())
      return { base64: buf.toString('base64'), mime: String(info.mime_type || 'image/jpeg') }
    })()
  )
}

/** Tasveer mein likha hua text — na mile to null */
export async function readTextFromImage(base64: string, mime: string): Promise<string | null> {
  if (process.env.GOOGLE_VISION_API_KEY) return googleVision(base64)
  if (process.env.OCR_SPACE_API_KEY) return ocrSpace(base64, mime)
  return null
}

async function googleVision(base64: string): Promise<string | null> {
  const key = process.env.GOOGLE_VISION_API_KEY
  return withTimeout(
    (async () => {
      const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ image: { content: base64 }, features: [{ type: 'TEXT_DETECTION' }] }],
        }),
      })
      if (!res.ok) {
        console.warn('[ocr] google vision:', res.status, (await res.text()).slice(0, 200))
        return null
      }
      const json = await res.json()
      const text = json?.responses?.[0]?.fullTextAnnotation?.text
      return text ? String(text) : null
    })()
  )
}

async function ocrSpace(base64: string, mime: string): Promise<string | null> {
  const key = process.env.OCR_SPACE_API_KEY
  return withTimeout(
    (async () => {
      const form = new URLSearchParams()
      form.set('base64Image', `data:${mime};base64,${base64}`)
      form.set('language', 'eng')
      form.set('OCREngine', '2')
      form.set('scale', 'true')

      const res = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { apikey: key as string, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      if (!res.ok) {
        console.warn('[ocr] ocr.space:', res.status)
        return null
      }
      const json = await res.json()
      if (json?.IsErroredOnProcessing) {
        console.warn('[ocr] ocr.space:', JSON.stringify(json?.ErrorMessage || '').slice(0, 200))
        return null
      }
      const text = json?.ParsedResults?.[0]?.ParsedText
      return text ? String(text) : null
    })()
  )
}
