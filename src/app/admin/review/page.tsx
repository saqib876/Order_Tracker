/**
 * Manually Check — /admin/review?key=ADMIN_KEY
 *
 * Do qism ke messages yahan aate hain, aur dono ka apna section hai:
 *   1. Tabdeeli ki darkhwast — order abhi raaste mein hai
 *   2. Order ki shikayat    — order mil chuka hai
 *
 * Har row par teen raste: customer ki chat kholna, us number par bot ko
 * 24 ghante chup karana, aur "Ho gaya" kar dena.
 *
 * Look dono doosre admin safhon jaisa hi hai (admin.css) — wohi rang, wohi
 * dark/light switch, wohi chipki hui patti.
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

const SECTIONS: { title: string; note: string; reasons: ManualReason[] }[] = [
  { title: 'Tabdeeli ki darkhwast', note: 'Order abhi raaste mein hai', reasons: CHANGE_REASONS },
  { title: 'Order ki shikayat', note: 'Order mil chuka hai', reasons: ISSUE_REASONS },
]

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

  const providedKey = typeof searchParams.key === 'string' ? searchParams.key : ''
  if (providedKey !== adminKey) {
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

  const hoGaye = searchParams.show === 'done'

  // Har dafa database se taza data — "Ho gaya" ke foran baad list purani
  // na dikhe.
  noStore()

  const { data, error } = await supabaseAdmin
    .from('manual_review_queue')
    .select('*')
    .eq('status', hoGaye ? 'done' : 'pending')
    .order('created_at', { ascending: false })
    .limit(300)

  const rows = (data || []) as ReviewRow[]

  // Doosri taraf ki ginti bhi dikhti rahe
  const { count: doosriGinti } = await supabaseAdmin
    .from('manual_review_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', hoGaye ? 'pending' : 'done')

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ key: adminKey, ...extra })
    return `/admin/review?${p.toString()}`
  }

  const sectionGinti = SECTIONS.map(
    (sec) => rows.filter((r) => sec.reasons.includes(r.reason as ManualReason)).length
  )

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
          <a
            href={`https://wa.me/${row.phone}`}
            target="_blank"
            rel="noreferrer"
            className="adm-wa"
          >
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
            <Link href={qs({})} data-on="1">
              Review
            </Link>
            <ThemeToggle />
          </span>
        </nav>

        <h1 className="adm-title">Manually Check</h1>
        <p className="adm-sub">
          Jin baaton ka jawab bot nahi de sakta — cancel, address, shikayat — wo yahan aati hain.
          Jab tak koi row yahan hai, us number par bot khamosh rehta hai.
        </p>

        <div className="adm-stats">
          <div className="adm-stat">
            <b>{rows.length}</b>
            <span>{hoGaye ? 'HO GAYE' : 'PENDING'}</span>
          </div>
          {SECTIONS.map((sec, i) => (
            <div className="adm-stat" key={sec.title}>
              <b>{sectionGinti[i]}</b>
              <span>{sec.title.toUpperCase()}</span>
            </div>
          ))}
          <div className="adm-stat">
            <b>{doosriGinti ?? 0}</b>
            <span>{hoGaye ? 'ABHI PENDING' : 'AB TAK HO GAYE'}</span>
          </div>
        </div>

        <div className="adm-tabs">
          <a href={qs({})} className="adm-tab" data-on={hoGaye ? '0' : '1'}>
            Pending
          </a>
          <a href={qs({ show: 'done' })} className="adm-tab" data-on={hoGaye ? '1' : '0'}>
            Ho gaye
          </a>
        </div>

        {error && <p className="adm-error">Database error: {error.message}</p>}

        {!error &&
          SECTIONS.map((section, i) => {
            const sectionRows = rows.filter((r) =>
              section.reasons.includes(r.reason as ManualReason)
            )

            return (
              <section key={section.title} className="adm-sec">
                <header className="adm-sec-head">
                  <h2>{section.title}</h2>
                  <span className="adm-sec-n">{sectionRows.length}</span>
                  <p>{section.note}</p>
                </header>

                <ul className="adm-tags">
                  {section.reasons.map((r) => (
                    <li key={r} className="adm-tag">
                      <span className="adm-dot" style={{ ['--c' as any]: REASON_COLOR[r] }} />
                      {MANUAL_REASON_LABEL[r]}
                    </li>
                  ))}
                </ul>

                {sectionRows.length === 0 ? (
                  <p className="adm-khali">
                    {hoGaye
                      ? 'Is section mein abhi tak kuch mark nahi hua.'
                      : 'Is section mein koi pending item nahi.'}
                  </p>
                ) : (
                  sectionRows.map((row) => card(row))
                )}
              </section>
            )
          })}

        <p className="adm-foot">Myzan WhatsApp Bot · Manually Check</p>
      </div>
    </main>
  )
}
