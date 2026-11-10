/**
 * Topics ko khud dekhna aur badalna — /admin/topics?key=ADMIN_KEY
 *
 * Yahan se:
 *   - har topic ke andar kya kya sawaal hain, aur jawab kya hai — dekh sakte hain
 *   - naam, sawaal, jawab badal sakte hain
 *   - topic ON / OFF kar sakte hain (OFF ka matlab: bot is ka jawab nahi dega)
 *   - purana/faltu topic hamesha ke liye hata sakte hain
 *   - naya topic khud bana sakte hain
 *
 * "OFF" wale topics aksar PURANE NAAM hote hain: Excel mein naam badla to
 * purana naam band ho kar reh gaya. Un ko be-khauf hata sakte hain — bas
 * dekh lein ke us ke sawaal naye naam wale topic mein mojood hain.
 */

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  topic: string
  questions: string
  answer: string
  is_active: boolean
  n: number
}

export default async function TopicsPage({
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

  const one = (k: string) => (typeof searchParams[k] === 'string' ? (searchParams[k] as string) : '')

  if (one('key') !== adminKey) {
    return (
      <main style={s.page}>
        <p style={s.error}>
          Ye page sirf key ke sath khulta hai:
          <br />
          <code>/admin/topics?key=YOUR_ADMIN_KEY</code>
        </p>
      </main>
    )
  }

  const { data } = await supabaseAdmin
    .from('qna_topics')
    .select('id, topic, questions, answer, is_active')
    .order('topic', { ascending: true })

  const rows: Row[] = (data || []).map((t) => ({
    id: String(t.id),
    topic: String(t.topic || ''),
    questions: String(t.questions || ''),
    answer: String(t.answer || ''),
    is_active: Boolean(t.is_active),
    n: String(t.questions || '')
      .split(/\r?\n/)
      .filter((x) => x.trim()).length,
  }))

  const chalu = rows.filter((r) => r.is_active)
  const band = rows.filter((r) => !r.is_active)

  const chuna = one('t') ? rows.find((r) => r.id === one('t')) : undefined
  const nayaBanana = one('naya') === '1'

  const href = (extra: string) => `/admin/topics?key=${encodeURIComponent(adminKey)}${extra}`

  return (
    <main style={s.page}>
      <div style={s.topBar}>
        <h1 style={s.h1}>Topics</h1>
        <Link href={`/admin/qna?key=${encodeURIComponent(adminKey)}`} style={s.link}>
          ← Q&amp;A Control
        </Link>
      </div>
      <p style={s.sub}>
        {chalu.length} chalu · {band.length} band ·{' '}
        {rows.reduce((a, r) => a + r.n, 0)} sawaal
      </p>

      {(one('mehfooz') || one('bana') || one('hataya') || one('badla') || one('khata')) && (
        <div style={one('khata') ? s.error : s.flash}>
          {one('khata') && <>{one('khata')}</>}
          {one('mehfooz') && (
            <>
              <b>{one('mehfooz')}</b> mehfooz ho gaya — bot foran naye mutabiq chalega.
            </>
          )}
          {one('bana') && (
            <>
              <b>{one('bana')}</b> naya topic ban gaya.
            </>
          )}
          {one('hataya') && <>Topic hamesha ke liye hata diya gaya.</>}
          {one('badla') && <>Topic ab {one('badla')} hai.</>}
        </div>
      )}

      {/* ── Naya topic ──────────────────────────────────────────────────── */}
      {nayaBanana ? (
        <section style={s.editCard}>
          <h2 style={s.h2}>Naya topic</h2>
          <form action="/api/admin/topic-save" method="POST">
            <input type="hidden" name="key" value={adminKey} />
            <input type="hidden" name="kaam" value="naya" />
            <label style={s.label}>
              Topic ka naam
              <input name="topic" style={s.input} placeholder="Jaise: Gift Packing" required />
            </label>
            <label style={s.label}>
              Sawaal — har line par ek
              <textarea
                name="questions"
                rows={6}
                style={s.textarea}
                placeholder={'gift packing hoti hai?\nkya gift pack kar dein ge?'}
              />
            </label>
            <label style={s.label}>
              Jawab — ye lafz ba lafz customer ko jata hai
              <textarea name="answer" rows={5} style={s.textarea} required />
            </label>
            <div style={s.btnRow}>
              <button type="submit" style={s.btnBig}>
                Topic banayein
              </button>
              <Link href={href('')} style={s.btnGhost}>
                Rehne dein
              </Link>
            </div>
          </form>
        </section>
      ) : (
        <Link href={href('&naya=1')} style={s.btn}>
          + Naya topic banayein
        </Link>
      )}

      {/* ── Chuna hua topic — badalne ka khana ──────────────────────────── */}
      {chuna && (
        <section style={s.editCard} id="edit">
          <h2 style={s.h2}>Topic badlein</h2>
          <form action="/api/admin/topic-save" method="POST">
            <input type="hidden" name="key" value={adminKey} />
            <input type="hidden" name="kaam" value="save" />
            <input type="hidden" name="id" value={chuna.id} />

            <label style={s.label}>
              Topic ka naam
              <input name="topic" defaultValue={chuna.topic} style={s.input} required />
            </label>

            <label style={s.label}>
              Sawaal ({chuna.n}) — har line par ek
              <textarea
                name="questions"
                rows={Math.min(20, Math.max(6, chuna.n + 2))}
                defaultValue={chuna.questions}
                style={s.textarea}
              />
            </label>
            <p style={s.hint}>
              Jitne zyada tarah ke jumle yahan honge, utna hi bot bina AI ke pehchan lega — yani
              utna hi tez aur muft.
            </p>

            <label style={s.label}>
              Jawab — ye lafz ba lafz customer ko jata hai
              <textarea name="answer" rows={7} defaultValue={chuna.answer} style={s.textarea} required />
            </label>

            <label style={s.check}>
              <input type="checkbox" name="chalu" value="1" defaultChecked={chuna.is_active} style={s.cb} />
              <span>
                Chalu rakhein (<b>OFF</b> karne par bot is topic ka jawab bhejna band kar dega)
              </span>
            </label>

            <div style={s.btnRow}>
              <button type="submit" style={s.btnBig}>
                Mehfooz karein
              </button>
              <Link href={href('')} style={s.btnGhost}>
                Band karein
              </Link>
            </div>
          </form>

          {/* Hamesha ke liye hatana */}
          <form action="/api/admin/topic-save" method="POST" style={s.deleteBox}>
            <input type="hidden" name="key" value={adminKey} />
            <input type="hidden" name="kaam" value="delete" />
            <input type="hidden" name="id" value={chuna.id} />
            <label style={s.check}>
              <input type="checkbox" name="pakka" value="haan" style={s.cb} />
              <span>Haan, is topic ko hamesha ke liye hata dein</span>
            </label>
            <button type="submit" style={s.btnDanger}>
              Hamesha ke liye hatayein
            </button>
            <p style={s.hint}>
              Hatane ke baad wapas nahi aata. Sirf OFF karna ho to oopar wala tick hata kar
              “Mehfooz karein” daba dein.
            </p>
          </form>
        </section>
      )}

      {/* ── Chalu topics ────────────────────────────────────────────────── */}
      <h2 style={{ ...s.h2, marginTop: 30 }}>Chalu topics ({chalu.length})</h2>
      <div style={s.list}>
        {chalu.map((r) => (
          <Link key={r.id} href={href(`&t=${r.id}#edit`)} style={s.item}>
            <span style={s.itemName}>{r.topic}</span>
            <span style={s.itemN}>{r.n} sawaal</span>
            <span style={s.on}>ON</span>
          </Link>
        ))}
      </div>

      {/* ── Band topics ─────────────────────────────────────────────────── */}
      {band.length > 0 && (
        <>
          <h2 style={{ ...s.h2, marginTop: 30 }}>Band topics ({band.length})</h2>
          <p style={s.hint}>
            Ye aksar <b>purane naam</b> hote hain: Excel mein topic ka naam badla to purana naam
            band ho kar reh gaya. Khol kar dekh lein — agar us ke sawaal kisi chalu topic mein
            mojood hain, to be-khauf hata dein. Bot in ka jawab waise bhi nahi bhejta.
          </p>
          <div style={s.list}>
            {band.map((r) => (
              <Link key={r.id} href={href(`&t=${r.id}#edit`)} style={{ ...s.item, ...s.itemOff }}>
                <span style={s.itemName}>{r.topic}</span>
                <span style={s.itemN}>{r.n} sawaal</span>
                <span style={s.off}>OFF</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    maxWidth: 860,
    margin: '0 auto',
    padding: '30px 18px 80px',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    color: '#0f172a',
    background: '#fff',
  },
  topBar: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  h1: { fontSize: 26, fontWeight: 800, margin: '0 0 6px' },
  h2: { fontSize: 16.5, fontWeight: 700, margin: '0 0 10px' },
  sub: { fontSize: 14, color: '#475569', margin: '0 0 18px' },
  link: { fontSize: 14, color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' },
  hint: { fontSize: 12.8, lineHeight: 1.65, color: '#64748b', margin: '8px 0 14px' },
  error: {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#991b1b',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 16,
  },
  flash: {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#065f46',
    background: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 16,
  },
  editCard: {
    border: '1px solid #cbd5e1',
    borderRadius: 12,
    padding: 18,
    margin: '14px 0 10px',
    background: '#f8fafc',
  },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginTop: 14 },
  input: {
    display: 'block',
    width: '100%',
    marginTop: 6,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    boxSizing: 'border-box',
  },
  textarea: {
    display: 'block',
    width: '100%',
    marginTop: 6,
    padding: '10px 12px',
    fontSize: 14,
    lineHeight: 1.6,
    fontFamily: 'inherit',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    fontSize: 13.5,
    color: '#334155',
    marginTop: 16,
    cursor: 'pointer',
  },
  cb: { width: 18, height: 18, accentColor: '#0f172a', cursor: 'pointer', flex: 'none' },
  btnRow: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18, alignItems: 'center' },
  btn: {
    display: 'inline-block',
    background: '#0f172a',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    padding: '10px 18px',
    borderRadius: 9,
    border: 'none',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  btnBig: {
    background: '#15803d',
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    padding: '12px 22px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
  },
  btnGhost: {
    display: 'inline-block',
    background: '#fff',
    color: '#334155',
    fontSize: 14,
    fontWeight: 600,
    padding: '11px 18px',
    borderRadius: 10,
    border: '1px solid #cbd5e1',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  btnDanger: {
    background: '#fff',
    color: '#b91c1c',
    fontSize: 13.5,
    fontWeight: 700,
    padding: '10px 16px',
    borderRadius: 9,
    border: '1px solid #fecaca',
    cursor: 'pointer',
    marginTop: 12,
  },
  deleteBox: {
    borderTop: '1px solid #e2e8f0',
    marginTop: 22,
    paddingTop: 10,
  },
  list: { display: 'grid', gap: 6 },
  item: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '4px 12px',
    padding: '11px 14px',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
    textDecoration: 'none',
    color: '#0f172a',
  },
  itemOff: { background: '#fafafa', borderStyle: 'dashed' },
  itemName: { fontSize: 14, fontWeight: 600, flex: 1, minWidth: 200 },
  itemN: { fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap' },
  on: { color: '#15803d', fontWeight: 700, fontSize: 11.5, width: 32, textAlign: 'right' },
  off: { color: '#b91c1c', fontWeight: 700, fontSize: 11.5, width: 32, textAlign: 'right' },
}
