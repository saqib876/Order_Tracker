/**
 * Q&A ka control panel — /admin/qna?key=ADMIN_KEY
 *
 * Do kaam yahan se hote hain:
 *   1. Rozana ki Excel download karna (naye sawaal + dropdowns)
 *   2. Bhari hui Excel wapas upload karna — SQL likhne ki zarurat nahi
 */

import type { CSSProperties } from 'react'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function QnaPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return (
      <main style={s.page}>
        <p style={s.error}>ADMIN_KEY environment variable set nahi hai.</p>
      </main>
    )
  }

  const providedKey = typeof searchParams.key === 'string' ? searchParams.key : ''
  if (providedKey !== adminKey) {
    return (
      <main style={s.page}>
        <p style={s.error}>
          Ye page sirf key ke sath khulta hai:
          <br />
          <code>/admin/qna?key=YOUR_ADMIN_KEY</code>
        </p>
      </main>
    )
  }

  const { data: topics } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions, answer, is_active')
    .order('topic', { ascending: true })

  const { count: pendingCount } = await supabaseAdmin
    .from('unmatched_messages')
    .select('*', { count: 'exact', head: true })
    .is('exported_at', null)

  const rows = (topics || []).map((t) => ({
    topic: String(t.topic),
    n: String(t.questions || '').split(/\r?\n/).filter((x) => x.trim()).length,
    active: Boolean(t.is_active),
  }))
  const totalQuestions = rows.reduce((a, r) => a + r.n, 0)
  const exportUrl = `/api/admin/qna-export?key=${encodeURIComponent(adminKey)}`

  return (
    <main style={s.page}>
      <h1 style={s.h1}>Q&amp;A Control</h1>
      <p style={s.sub}>
        {rows.length} topics · {totalQuestions} sawaal · {pendingCount ?? 0} naye sawaal jinka jawab nahi mila
      </p>

      {/* 1. Download */}
      <section style={s.card}>
        <div style={s.step}>1</div>
        <div style={{ flex: 1 }}>
          <h2 style={s.h2}>Excel download karein</h2>
          <p style={s.p}>
            Is mein woh naye sawaal aayenge jo bot samajh nahi paya. Har row par dropdown hai —
            <b> Add karein? </b> aur <b> Kis Topic mein? </b>. Naya topic banana ho to
            <b> “Naya Topic” </b> sheet use karein.
          </p>
          <a href={exportUrl} style={s.btn}>
            Excel download karein
          </a>
          <p style={s.hint}>
            Download hote hi in sawaalon par nishaan lag jata hai — agli dafa sirf naye aayenge.
            Sirf dekhna ho to link ke aakhir mein <code>&amp;peek=1</code> laga dein.
          </p>
        </div>
      </section>

      {/* 2. Upload */}
      <section style={s.card}>
        <div style={s.step}>2</div>
        <div style={{ flex: 1 }}>
          <h2 style={s.h2}>Bhari hui Excel wapas upload karein</h2>
          <p style={s.p}>
            Jo rows par aap ne <b>Haan</b> chuna hoga, wo sawaal us topic mein jur jayenge.
            Naye topics bhi ban jayenge. Jis topic ka <b>jawab khali</b> hoga wo chhod diya jayega.
          </p>
          <form action="/api/admin/qna-import" method="POST" encType="multipart/form-data" style={s.form}>
            <input type="hidden" name="key" value={adminKey} />
            <input type="file" name="file" accept=".xlsx" required style={s.file} />
            <button type="submit" style={s.btn}>
              Upload karein
            </button>
          </form>
          <p style={s.hint}>
            Upload ke baad natija JSON mein dikhega — kitne topics bane, kitne sawaal jure.
            Purane topics mitte nahi, sirf update hote hain.
          </p>
        </div>
      </section>

      {/* Mojooda topics */}
      <h2 style={{ ...s.h2, marginTop: 34 }}>Abhi jo topics live hain</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Topic</th>
            <th style={{ ...s.th, textAlign: 'right', width: 90 }}>Sawaal</th>
            <th style={{ ...s.th, textAlign: 'right', width: 80 }}>Halat</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td style={s.td} colSpan={3}>
                Abhi koi topic nahi — pehli Excel upload karein.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.topic}>
              <td style={s.td}>{r.topic}</td>
              <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.n}</td>
              <td style={{ ...s.td, textAlign: 'right' }}>
                <span style={r.active ? s.on : s.off}>{r.active ? 'ON' : 'OFF'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ ...s.hint, marginTop: 26 }}>
        Manually Check ki list: <code>/admin/review?key=…</code>
      </p>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    maxWidth: 780,
    margin: '0 auto',
    padding: '30px 18px 80px',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Arial, sans-serif',
    color: '#0f172a',
  },
  h1: { fontSize: 27, fontWeight: 700, margin: '0 0 4px' },
  sub: { color: '#64748b', fontSize: 14, margin: '0 0 26px', fontVariantNumeric: 'tabular-nums' },
  card: {
    display: 'flex',
    gap: 16,
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 20,
    marginBottom: 14,
    background: '#fff',
  },
  step: {
    flex: 'none',
    width: 30,
    height: 30,
    borderRadius: 8,
    background: '#0f172a',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    fontSize: 15,
    fontWeight: 600,
  },
  h2: { fontSize: 18, fontWeight: 600, margin: '2px 0 8px' },
  p: { fontSize: 14.5, lineHeight: 1.6, color: '#475569', margin: '0 0 14px' },
  hint: { fontSize: 13, color: '#94a3b8', margin: '10px 0 0', lineHeight: 1.55 },
  btn: {
    display: 'inline-block',
    background: '#0e7c5a',
    color: '#fff',
    padding: '9px 18px',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14.5,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
  },
  form: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  file: { fontSize: 14 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 12 },
  th: {
    textAlign: 'left',
    fontSize: 12,
    letterSpacing: '.04em',
    textTransform: 'uppercase',
    color: '#64748b',
    borderBottom: '1px solid #e2e8f0',
    padding: '8px 6px',
  },
  td: { fontSize: 14.5, borderBottom: '1px solid #f1f5f9', padding: '9px 6px' },
  on: { color: '#0e7c5a', fontWeight: 600, fontSize: 12.5 },
  off: { color: '#94a3b8', fontWeight: 600, fontSize: 12.5 },
  error: { color: '#dc2626', fontSize: 15, lineHeight: 1.6 },
}
