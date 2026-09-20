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


      {/* 3. Excel bharne ka tareeqa */}
      <section style={s.card}>
        <div style={s.step}>3</div>
        <div style={{ flex: 1 }}>
          <h2 style={s.h2}>Excel bharne ka tareeqa</h2>

          {/* Nayi line — sab se zyada poocha jane wala sawaal */}
          <div style={s.keyBox}>
            <div style={s.keyTitle}>Ek hi khaane (cell) mein nayi line kaise banayein</div>
            <ul style={s.keyList}>
              <li style={s.keyItem}>
                <span style={s.keyWhere}>Excel (Windows)</span>
                <span><kbd style={s.kbd}>Alt</kbd> + <kbd style={s.kbd}>Enter</kbd></span>
              </li>
              <li style={s.keyItem}>
                <span style={s.keyWhere}>Excel (Mac)</span>
                <span><kbd style={s.kbd}>Option ⌥</kbd> + <kbd style={s.kbd}>Enter</kbd></span>
              </li>
              <li style={s.keyItem}>
                <span style={s.keyWhere}>Google Sheets</span>
                <span>
                  <kbd style={s.kbd}>Alt</kbd> + <kbd style={s.kbd}>Enter</kbd>
                  <span style={s.keyOr}> (Mac par <kbd style={s.kbd}>⌘</kbd> + <kbd style={s.kbd}>Enter</kbd>)</span>
                </span>
              </li>
              <li style={s.keyItem}>
                <span style={s.keyWhere}>Mobile par</span>
                <span>Cell par tap karein, phir keyboard ka <b>return / ↵</b> — ya laptop use karein</span>
              </li>
            </ul>
            <p style={s.keyNote}>
              Sirf <kbd style={s.kbd}>Enter</kbd> dabane se aap cell se <b>bahar</b> nikal jate hain, nayi line nahi banti.
              Har sawaal apni alag line par hona chahiye.
            </p>
          </div>

          {/* Teen sheets */}
          <h3 style={s.h3}>File mein teen sheets hain</h3>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: '27%' }}>Sheet</th>
                <th style={s.th}>Is mein kya karna hai</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={s.tdName}>Naye Sawaal</td>
                <td style={s.td}>
                  Customer ke woh sawaal jin ka jawab bot ke paas nahi tha. Jis sawaal ka jawab dena ho
                  us row mein <b>Add karein? = Haan</b> chunein <i>aur</i> <b>Kis Topic mein?</b> se topic
                  chunein. Dono chunna zaroori hai. Jo rows chhod dein wo agli dafa dobara nahi aayengi.
                </td>
              </tr>
              <tr>
                <td style={s.tdName}>Naya Topic</td>
                <td style={s.td}>
                  Bilkul naya topic banane ke liye: naam, us ke sawaal (har line par ek), aur jawab.
                  Sab se upar wali hari <b>“MISAAL”</b> row sirf namoona hai — wo upload nahi hoti.
                </td>
              </tr>
              <tr>
                <td style={s.tdName}>Mojooda Topics</td>
                <td style={s.td}>
                  Purane topics — sawaal aur jawab dono yahan se <b>badle</b> ja sakte hain. Naya sawaal
                  bhi neeche nayi line par likh sakte hain. Greeting ka matan bhi isi sheet ki
                  <b> “Salaam / Greeting” </b> row mein hai.
                </td>
              </tr>
            </tbody>
          </table>

          {/* Usool */}
          <h3 style={s.h3}>Yaad rakhne wali baatein</h3>
          <ol style={s.ol}>
            <li style={s.li}>
              <b>Sawaal jurte hain, mitte nahi.</b> Excel se koi line hata kar upload karne se wo
              sawaal database se nahi hatta. (Hatana ho to mujhe bata dein.)
            </li>
            <li style={s.li}>
              <b>Jawab badal jata hai.</b> Jo jawab Excel mein likha hoga wohi naya jawab ban jayega —
              is liye jawab poora likhein, adhoora nahi.
            </li>
            <li style={s.li}>
              <b>Jawab khali chhoda to wo row chhod di jayegi.</b> Kuch mitega nahi, bas wo topic
              update nahi hoga.
            </li>
            <li style={s.li}>
              <b>Sheet ke naam aur column ke naam na badlein.</b> Column ki tarteeb badalna theek hai,
              naam badalna nahi — warna wo sheet parhi nahi jayegi.
            </li>
            <li style={s.li}>
              <b>Ek hi sawaal do topics mein na likhein.</b> Aisi soorat mein bot confuse ho kar
              <b> chup </b> ho jata hai. Har sawaal sirf ek hi topic mein rakhein.
            </li>
            <li style={s.li}>
              <b>Peele khaane bharne ke liye hain.</b> Jo khaane khali/peele hain wahi aap ko bharne
              hain; baqi sirf dekhne ke liye hain.
            </li>
            <li style={s.li}>
              <b>Customize wali row ka naam “Custom…” se shuru rahe.</b> Bot picture/design wale
              sawaalon ka jawab isi row se uthata hai.
            </li>
            <li style={s.li}>
              <b>File .xlsx hi rahe.</b> CSV ya Google Sheet ka link kaam nahi karega — Google Sheets
              se “File → Download → Microsoft Excel (.xlsx)” kar ke upload karein.
            </li>
          </ol>

          <p style={s.hint}>
            Upload ke foran baad jawab chalu ho jate hain — bot ko dobara start karne ki zarurat nahi.
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
  h3: { fontSize: 15, fontWeight: 700, margin: '22px 0 10px', color: '#0f172a' },
  keyBox: {
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: 12,
    padding: '14px 16px',
    margin: '4px 0 6px',
  },
  keyTitle: { fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#0c4a6e' },
  keyList: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 },
  keyItem: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '4px 10px',
    fontSize: 13.5,
    color: '#0f172a',
  },
  keyWhere: { minWidth: 132, color: '#475569', fontSize: 13 },
  keyOr: { color: '#64748b' },
  kbd: {
    display: 'inline-block',
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderBottomWidth: 2,
    borderRadius: 6,
    padding: '1px 7px',
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#0f172a',
    whiteSpace: 'nowrap',
  },
  keyNote: { fontSize: 12.5, color: '#475569', margin: '11px 0 0', lineHeight: 1.6 },
  ol: { margin: '0 0 4px', paddingLeft: 20, display: 'grid', gap: 9 },
  li: { fontSize: 13.5, lineHeight: 1.65, color: '#334155' },
  tdName: {
    padding: '10px 12px',
    borderTop: '1px solid #e2e8f0',
    fontSize: 13.5,
    fontWeight: 600,
    color: '#0f172a',
    verticalAlign: 'top',
  },
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
