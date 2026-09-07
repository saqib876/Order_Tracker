/**
 * Manual Check list — /admin/review?key=ADMIN_KEY
 *
 * Do qism ke messages yahan aate hain, aur dono ka apna alag section hai:
 *   1. Tabdeeli ki darkhwast — order abhi raaste mein hai
 *   2. Order ki shikayat — order mil chuka hai
 * Har section apne tags khud dikhata hai aur usi ke messages us ke neeche
 * aate hain. Har row par "WhatsApp mein kholein" ka link hai jo seedha usi
 * customer ki chat khol deta hai.
 */

import type { CSSProperties } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { MANUAL_REASON_LABEL, CHANGE_REASONS, ISSUE_REASONS } from '@/lib/intents'
import type { ManualReason } from '@/lib/intents'

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

const REASON_COLOR: Record<string, string> = {
  order_cancel: '#dc2626',
  address_change: '#d97706',
  model_change: '#0f766e',
  design_change: '#7c3aed',
  phone_change: '#0891b2',
  wrong_model_received: '#b91c1c',
  wrong_design_received: '#c2410c',
  missing_items: '#a16207',
  quality_issue: '#9333ea',
}

const SECTIONS: { title: string; note: string; reasons: ManualReason[] }[] = [
  {
    title: 'Tabdeeli ki darkhwast',
    note: 'Order abhi raaste mein hai',
    reasons: CHANGE_REASONS,
  },
  {
    title: 'Order ki shikayat',
    note: 'Order mil chuka hai',
    reasons: ISSUE_REASONS,
  },
]

function formatWhen(iso: string): string {
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
      <main style={styles.page}>
        <p style={styles.error}>ADMIN_KEY environment variable set nahi hai.</p>
      </main>
    )
  }

  const providedKey = typeof searchParams.key === 'string' ? searchParams.key : ''

  if (providedKey !== adminKey) {
    return (
      <main style={styles.page}>
        <p style={styles.error}>
          Ye page sirf key ke sath khulta hai:
          <br />
          <code>/admin/review?key=YOUR_ADMIN_KEY</code>
        </p>
      </main>
    )
  }

  const showDone = searchParams.show === 'done'

  // Har dafa database se taza data — "Ho gaya" ke foran baad list
  // purani na dikhe.
  noStore()

  const { data, error } = await supabaseAdmin
    .from('manual_review_queue')
    .select('*')
    .eq('status', showDone ? 'done' : 'pending')
    .order('created_at', { ascending: false })
    .limit(300)

  const rows = (data || []) as ReviewRow[]

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ key: adminKey, ...extra })
    return `/admin/review?${p.toString()}`
  }

  const renderCard = (row: ReviewRow) => {
    const label = MANUAL_REASON_LABEL[row.reason as ManualReason] || row.reason
    const color = REASON_COLOR[row.reason] || '#475569'

    return (
      <article key={row.id} style={styles.card}>
        <div style={styles.cardTop}>
          <span style={{ ...styles.badge, background: color }}>{label}</span>
          {(row.message_count || 1) > 1 && (
            <span style={styles.count}>{row.message_count} messages</span>
          )}
          <span style={styles.when}>{formatWhen(row.last_message_at || row.created_at)}</span>
        </div>

        <p style={styles.message}>{row.message_text}</p>

        <div style={styles.meta}>
          <span>
            <strong>Number:</strong> +{row.phone}
          </span>
          {row.order_number && (
            <span>
              <strong>Order:</strong> #{row.order_number}
            </span>
          )}
        </div>

        <div style={styles.actions}>
          <a
            href={`https://wa.me/${row.phone}`}
            target="_blank"
            rel="noreferrer"
            style={styles.waButton}
          >
            WhatsApp mein kholein
          </a>

          {!showDone && (
            <form action="/api/admin/review" method="POST" style={{ margin: 0 }}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="key" value={adminKey} />
              <button type="submit" style={styles.doneButton}>
                Ho gaya
              </button>
            </form>
          )}
        </div>
      </article>
    )
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>Manually Check</h1>

      <div style={styles.tabs}>
        <a href={qs({})} style={showDone ? styles.tab : styles.tabActive}>
          Pending
        </a>
        <a href={qs({ show: 'done' })} style={showDone ? styles.tabActive : styles.tab}>
          Ho gaye
        </a>
      </div>

      {error && <p style={styles.error}>Database error: {error.message}</p>}

      {!error &&
        SECTIONS.map((section) => {
          const sectionRows = rows.filter((r) =>
            section.reasons.includes(r.reason as ManualReason)
          )

          return (
            <section key={section.title} style={styles.section}>
              <header style={styles.sectionHead}>
                <div>
                  <h2 style={styles.sectionTitle}>{section.title}</h2>
                  <p style={styles.sectionNote}>{section.note}</p>
                </div>
                <span style={styles.sectionCount}>{sectionRows.length}</span>
              </header>

              <ul style={styles.tagRow}>
                {section.reasons.map((r) => (
                  <li key={r} style={styles.tag}>
                    <span style={{ ...styles.dot, background: REASON_COLOR[r] }} />
                    {MANUAL_REASON_LABEL[r]}
                  </li>
                ))}
              </ul>

              {sectionRows.length === 0 ? (
                <p style={styles.sectionEmpty}>
                  {showDone
                    ? 'Is section mein abhi tak kuch mark nahi hua.'
                    : 'Is section mein koi pending item nahi. ✅'}
                </p>
              ) : (
                sectionRows.map((row) => renderCard(row))
              )}
            </section>
          )
        })}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    maxWidth: 820,
    margin: '0 auto',
    padding: '28px 18px 80px',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Arial, sans-serif',
    color: '#0f172a',
  },
  h1: { fontSize: 26, fontWeight: 700, margin: '0 0 16px' },
  tabs: { display: 'flex', gap: 8, marginBottom: 22 },
  tab: {
    padding: '7px 16px',
    borderRadius: 999,
    background: '#f1f5f9',
    color: '#475569',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
  },
  tabActive: {
    padding: '7px 16px',
    borderRadius: 999,
    background: '#0f172a',
    color: '#fff',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
  },
  section: {
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: '16px 16px 4px',
    marginBottom: 22,
    background: '#f8fafc',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' },
  sectionNote: { fontSize: 12.5, color: '#94a3b8', margin: '2px 0 0' },
  sectionCount: {
    fontSize: 13,
    fontWeight: 700,
    color: '#0f172a',
    background: '#fff',
    border: '1px solid #e2e8f0',
    minWidth: 30,
    textAlign: 'center',
    padding: '4px 9px',
    borderRadius: 999,
  },
  // flexWrap se ye chips chhoti screen par khud agli line par chali jati hain
  tagRow: {
    listStyle: 'none',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    margin: '12px 0 14px',
    padding: 0,
  },
  tag: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 500,
    color: '#334155',
    background: '#fff',
    border: '1px solid #e2e8f0',
    padding: '4px 10px',
    borderRadius: 999,
  },
  dot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  sectionEmpty: { fontSize: 13, color: '#94a3b8', margin: '0 0 14px' },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    background: '#fff',
  },
  // flexWrap zaroori hai: phone par badge + ginti + waqt ek line mein nahi
  // samate, aur bina wrap ke badge ka text do tukdon mein toot jata hai.
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 10,
    gap: 8,
  },
  badge: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },
  count: {
    fontSize: 12,
    fontWeight: 600,
    color: '#475569',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    padding: '3px 9px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },
  when: { color: '#94a3b8', fontSize: 13, marginLeft: 'auto' },
  message: {
    margin: '0 0 12px',
    fontSize: 15,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  meta: {
    display: 'flex',
    gap: 18,
    flexWrap: 'wrap',
    fontSize: 13,
    color: '#475569',
    marginBottom: 14,
  },
  actions: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  waButton: {
    background: '#25D366',
    color: '#fff',
    padding: '8px 16px',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  doneButton: {
    background: '#f1f5f9',
    color: '#0f172a',
    border: '1px solid #cbd5e1',
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  error: { color: '#dc2626', fontSize: 15, lineHeight: 1.6 },
}
