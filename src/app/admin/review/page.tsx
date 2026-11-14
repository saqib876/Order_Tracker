/**
 * Manually Check — /admin/review?key=ADMIN_KEY
 *
 * Do qism ke messages yahan aate hain, aur dono ka apna section hai:
 *   1. Tabdeeli ki darkhwast — order abhi raaste mein hai
 *   2. Order ki shikayat    — order mil chuka hai
 *
 * Chhantai (filter)
 * -----------------
 * Oopar ke tiles aur har qism ke tags — sab clickable hain:
 *   ?sec=change|issue   sirf ek section
 *   ?r=order_cancel     sirf ek qism
 * Wohi cheez dobara dabayein to chhantai hat jati hai. Har tag par us ki
 * apni ginti bhi likhi hai, is liye ek nazar mein pata chal jata hai ke
 * kaun si baat sab se zyada aa rahi hai.
 *
 * Ginti poori list par hoti hai (safha-dar-safha), sirf dikhne wale 300
 * par nahi — warna "488 ho gaye" wali soorat mein adhoora hisaab milta.
 *
 * Har row par teen raste: customer ki chat kholna, us number par bot ko
 * 24 ghante chup karana, aur "Ho gaya" kar dena.
 */

import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { MANUAL_REASON_LABEL, CHANGE_REASONS, ISSUE_REASONS } from '@/lib/intents'
import type { ManualReason } from '@/lib/intents'
import { ThemeBoot, ThemeToggle } from '../ThemeBits'
import '../admin.css'

export const dynamic = 'force-dynamic'

interface ReviewRow {
  id: string
  phone: string
  message_text: string
  reason: string
  order_number: string | null
  status: string
  created_at: string
  last_message_at: string | null
  message_count: number | null
}

/* Har qism ka apna rang — dot, hashiya aur badge teenon isi se bante hain.
   Dark aur light dono mein parhe jane wale rang chune hain. */
const REASON_COLOR: Record<string, string> = {
  order_cancel: '#ef4444',
  address_change: '#f59e0b',
  model_change: '#14b8a6',
  design_change: '#a855f7',
  phone_change: '#06b6d4',
  return_refund: '#f43f5e',
  wrong_model_received: '#f87171',
  wrong_design_received: '#fb923c',
  missing_items: '#eab308',
  quality_issue: '#c084fc',
}

const SECTIONS: { id: string; title: string; note: string; reasons: ManualReason[] }[] = [
  {
    id: 'change',
    title: 'Tabdeeli ki darkhwast',
    note: 'Order abhi raaste mein hai',
    reasons: CHANGE_REASONS,
  },
  {
    id: 'issue',
    title: 'Order ki shikayat',
    note: 'Order mil chuka hai',
    reasons: ISSUE_REASONS,
  },
]

const PAGE = 1000

function kab(iso: string): string {
  return new Date(iso).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const adminKey = process.env.ADMIN_KEY

  if (!adminKey) {
    return (
      <main className="adm">
        <div className="adm-wrap">
          <p className="adm-error">ADMIN_KEY environment variable set nahi hai.</p>
        </div>
      </main>
    )
  }

  const one = (k: string) => (typeof searchParams[k] === 'string' ? (searchParams[k] as string) : '')

  if (one('key') !== adminKey) {
    return (
      <main className="adm">
        <div className="adm-wrap">
          <p className="adm-error">
            Ye page sirf key ke sath khulta hai:
            <br />
            <code>/admin/review?key=YOUR_ADMIN_KEY</code>
          </p>
        </div>
      </main>
    )
  }

  const hoGaye = one('show') === 'done'
  const halat = hoGaye ? 'done' : 'pending'

  // Chhantai — ek qism, ya ek poora section
  const qism = one('r')
  const secId = one('sec')
  const section = SECTIONS.find((s) => s.id === secId)

  // Har dafa database se taza data — "Ho gaya" ke foran baad list purani
  // na dikhe.
  noStore()

  // ── Ginti: poori list par, safha-dar-safha ──────────────────────────────
  const ginti: Record<string, number> = {}
  let kulHalat = 0
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('manual_review_queue')
      .select('reason')
      .eq('status', halat)
      .range(from, from + PAGE - 1)
    if (error) break
    const rows = data || []
    for (const r of rows) {
      const k = String(r.reason)
      ginti[k] = (ginti[k] || 0) + 1
      kulHalat++
    }
    if (rows.length < PAGE) break
  }

  const { count: doosriGinti } = await supabaseAdmin
    .from('manual_review_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', hoGaye ? 'pending' : 'done')

  const secGinti = (s: (typeof SECTIONS)[number]) =>
    s.reasons.reduce((a, r) => a + (ginti[r] || 0), 0)

  // ── Dikhane wali list ───────────────────────────────────────────────────
  let q = supabaseAdmin
    .from('manual_review_queue')
    .select('*')
    .eq('status', halat)
    .order('created_at', { ascending: false })
    .limit(300)

  if (qism) q = q.eq('reason', qism)
  else if (section) q = q.in('reason', section.reasons as string[])

  const { data, error } = await q
  const rows = (data || []) as ReviewRow[]

  // ── Raste ───────────────────────────────────────────────────────────────
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ key: adminKey })
    if (hoGaye) p.set('show', 'done')
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    return `/admin/review?${p.toString()}`
  }
  // Wohi cheez dobara dabayein to chhantai hat jaye
  const secHref = (id: string) => qs({ sec: secId === id && !qism ? '' : id, r: '' })
  const qismHref = (r: string) => qs({ r: qism === r ? '' : r, sec: '' })
  const koiChhantai = Boolean(qism || secId)

  // Chhantai ke mutabiq kaun se section dikhein
  const dikhaneWale = qism
    ? SECTIONS.filter((s) => s.reasons.includes(qism as ManualReason))
    : section
    ? [section]
    : SECTIONS

  const card = (row: ReviewRow) => {
    const label = MANUAL_REASON_LABEL[row.reason as ManualReason] || row.reason
    const color = REASON_COLOR[row.reason] || '#7d8899'

    return (
      <article key={row.id} className="adm-row" style={{ ['--c' as any]: color }}>
        <div className="adm-row-top">
          <span className="adm-reason">{label}</span>
          {(row.message_count || 1) > 1 && (
            <span className="adm-count">{row.message_count} messages</span>
          )}
          <span className="adm-when">{kab(row.last_message_at || row.created_at)}</span>
        </div>

        <p className="adm-msg">{row.message_text}</p>

        <div className="adm-meta">
          <span>
            <b>Number</b>+{row.phone}
          </span>
          {row.order_number && (
            <span>
              <b>Order</b>#{row.order_number}
            </span>
          )}
        </div>

        <div className="adm-acts">
          <a href={`https://wa.me/${row.phone}`} target="_blank" rel="noreferrer" className="adm-wa">
            WhatsApp mein kholein
          </a>

          {/* Aap khud baat kar rahe hain — bot ko is number par chup kara dein */}
          <form action="/api/admin/bot-pause" method="POST">
            <input type="hidden" name="phone" value={row.phone} />
            <input type="hidden" name="key" value={adminKey} />
            <input type="hidden" name="hours" value="24" />
            <button
              type="submit"
              className="adm-quiet"
              title="Is number par bot 24 ghante kuch nahi bhejega"
            >
              Bot band karein (24 ghante)
            </button>
          </form>

          {!hoGaye && (
            <form action="/api/admin/review" method="POST">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="key" value={adminKey} />
              <button type="submit" className="adm-done">
                Ho gaya
              </button>
            </form>
          )}
        </div>
      </article>
    )
  }

  return (
    <main className="adm">
      <ThemeBoot />
      <div className="adm-wrap">
        <nav className="adm-bar adm-in">
          <span className="adm-brand">
            <span className="adm-cube">
              <i />
            </span>
            Myzan Bot
          </span>
          <span className="adm-nav">
            <Link href={`/admin/qna?key=${encodeURIComponent(adminKey)}`}>Dashboard</Link>
            <Link href={`/admin/topics?key=${encodeURIComponent(adminKey)}`}>Topics</Link>
            <Link href={qs({ sec: '', r: '' })} data-on="1">
              Review
            </Link>
            <Link href={`/admin/health?key=${encodeURIComponent(adminKey)}`}>Health</Link>
            <ThemeToggle />
          </span>
        </nav>

        <h1 className="adm-title">Manually Check</h1>
        <p className="adm-sub">
          Jin baaton ka jawab bot nahi de sakta — cancel, address, shikayat — wo yahan aati hain.
          Kisi bhi tile ya tag par click kar ke sirf wohi dekh sakte hain.
        </p>

        {/* Tiles — teeno clickable */}
        <div className="adm-stats">
          <a
            href={qs({ sec: '', r: '' })}
            className="adm-stat"
            data-on={koiChhantai ? '0' : '1'}
          >
            <b>{kulHalat}</b>
            <span>{hoGaye ? 'KUL HO GAYE' : 'KUL PENDING'}</span>
          </a>
          {SECTIONS.map((sec) => (
            <a
              key={sec.id}
              href={secHref(sec.id)}
              className="adm-stat"
              data-on={secId === sec.id && !qism ? '1' : '0'}
            >
              <b>{secGinti(sec)}</b>
              <span>{sec.title.toUpperCase()}</span>
            </a>
          ))}
          <a
            href={`/admin/review?key=${encodeURIComponent(adminKey)}${hoGaye ? '' : '&show=done'}`}
            className="adm-stat"
          >
            <b>{doosriGinti ?? 0}</b>
            <span>{hoGaye ? 'ABHI PENDING' : 'AB TAK HO GAYE'}</span>
          </a>
        </div>

        <div className="adm-tabs">
          <a
            href={`/admin/review?key=${encodeURIComponent(adminKey)}`}
            className="adm-tab"
            data-on={hoGaye ? '0' : '1'}
          >
            Pending
          </a>
          <a
            href={`/admin/review?key=${encodeURIComponent(adminKey)}&show=done`}
            className="adm-tab"
            data-on={hoGaye ? '1' : '0'}
          >
            Ho gaye
          </a>
        </div>

        {error && <p className="adm-error">Database error: {error.message}</p>}

        {!error &&
          dikhaneWale.map((sec) => {
            const secRows = rows.filter((r) => sec.reasons.includes(r.reason as ManualReason))

            return (
              <section key={sec.id} className="adm-sec">
                <header className="adm-sec-head">
                  <h2>{sec.title}</h2>
                  <span className="adm-sec-n">{secGinti(sec)}</span>
                  <p>{sec.note}</p>
                </header>

                {/* Qism ke tags — har ek clickable, sath apni ginti */}
                <ul className="adm-tags">
                  {sec.reasons.map((r) => (
                    <li key={r} style={{ display: 'contents' }}>
                      <a
                        href={qismHref(r)}
                        className="adm-tag"
                        style={{ ['--c' as any]: REASON_COLOR[r] }}
                        data-on={qism === r ? '1' : '0'}
                        data-zero={(ginti[r] || 0) === 0 ? '1' : '0'}
                      >
                        <span className="adm-dot" style={{ ['--c' as any]: REASON_COLOR[r] }} />
                        {MANUAL_REASON_LABEL[r]}
                        <i>{ginti[r] || 0}</i>
                      </a>
                    </li>
                  ))}
                  {koiChhantai && (
                    <li style={{ display: 'contents' }}>
                      <a href={qs({ sec: '', r: '' })} className="adm-clear">
                        &#10005; chhantai hatayein
                      </a>
                    </li>
                  )}
                </ul>

                {secRows.length === 0 ? (
                  <p className="adm-khali">
                    {hoGaye
                      ? 'Yahan abhi tak kuch mark nahi hua.'
                      : 'Yahan koi pending item nahi.'}
                  </p>
                ) : (
                  secRows.map((row) => card(row))
                )}
              </section>
            )
          })}

        <p className="adm-foot">Myzan WhatsApp Bot · Manually Check</p>
      </div>
    </main>
  )
}
