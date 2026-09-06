/**
 * Manual Check list — /admin/review?key=ADMIN_KEY
 *
 * Order cancel, address change, design change aur phone number change wale
 * messages yahan aate hain. Har row par "WhatsApp mein kholein" ka link hai
 * jo seedha usi customer ki chat khol deta hai.
 */

import type { CSSProperties } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { MANUAL_REASON_LABEL } from '@/lib/intents'
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
  design_change: '#7c3aed',
  phone_change: '#0891b2',
}

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

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>Manually Check</h1>
      <p style={styles.sub}>
        Order cancel · Address change · Design change · Phone number change
      </p>

      <div style={styles.tabs}>
        <a href={qs({})} style={showDone ? styles.tab : styles.tabActive}>
          Pending
        </a>
        <a href={qs({ show: 'done' })} style={showDone ? styles.tabActive : styles.tab}>
          Ho gaye
        </a>
      </div>

      {error && <p style={styles.error}>Database error: {error.message}</p>}

      {!error && rows.length === 0 && (
        <p style={styles.empty}>
          {showDone ? 'Abhi tak kuch mark nahi hua.' : 'Sab clear hai — koi pending item nahi. ✅'}
        </p>
      )}

      {rows.map((row) => {
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
  h1: { fontSize: 26, fontWeight: 700, margin: '0 0 4px' },
  sub: { color: '#64748b', fontSize: 14, margin: '0 0 20px' },
  tabs: { display: 'flex', gap: 8, marginBottom: 20 },
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
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    background: '#fff',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  badge: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 999,
  },
  count: {
    fontSize: 12,
    fontWeight: 600,
    color: '#475569',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    padding: '3px 9px',
    borderRadius: 999,
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
  actions: { display: 'flex', gap: 10, alignItems: 'center' },
  waButton: {
    background: '#25D366',
    color: '#fff',
    padding: '8px 16px',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
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
  },
  empty: { color: '#64748b', fontSize: 15, padding: '24px 0' },
  error: { color: '#dc2626', fontSize: 15, lineHeight: 1.6 },
}
