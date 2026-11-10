/**
 * Q&A ka control panel — /admin/qna?key=ADMIN_KEY
 *
 * Pehle yahan Excel download/upload hota tha. Ab wo kaam AI karta hai:
 * hafte mein ek dafa wo un messages ko parhta hai jin ka bot jawab nahi de
 * saka, aur TAJWEEZ deta hai — "ye sawaal is topic mein daal dein", ya "ye
 * naya topic bana lein".
 *
 * Aap ka kaam sirf itna: tick lagayein aur Approve. Naye topic ka jawab
 * wahin likh dein. Kuch bhi apne aap live nahi hota.
 *
 * Excel ab sirf BACKUP ke liye hai — download ka button neeche hai.
 */

import type { CSSProperties } from 'react'
import { supabaseAdmin } from '@/lib/supabase'
import { aiProvider, aiMode, aiAvailable, aajKiGinti } from '@/lib/aiTopic'

export const dynamic = 'force-dynamic'

interface Suggestion {
  id: string
  kind: string
  topic: string
  questions: string[]
  ask_count: number
}

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

  const one = (k: string) => (typeof searchParams[k] === 'string' ? (searchParams[k] as string) : '')

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: topics } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions, answer, is_active')
    .order('topic', { ascending: true })

  const { count: pendingCount } = await supabaseAdmin
    .from('unmatched_messages')
    .select('*', { count: 'exact', head: true })
    .is('exported_at', null)

  const { data: sugRows, error: sugError } = await supabaseAdmin
    .from('qna_suggestions')
    .select('id, kind, topic, questions, ask_count')
    .eq('status', 'pending')
    .order('ask_count', { ascending: false })

  const suggestions: Suggestion[] = (sugRows || []).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    topic: String(r.topic),
    questions: (r.questions as string[]) || [],
    ask_count: Number(r.ask_count) || 0,
  }))

  const nayeTopics = suggestions.filter((x) => x.kind === 'naya_topic')
  const nayeSawaal = suggestions.filter((x) => x.kind !== 'naya_topic')

  const { count: approvedCount } = await supabaseAdmin
    .from('qna_suggestions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved')

  const aiOn = aiAvailable()
  const aiAaj = aiOn ? await aajKiGinti() : 0
  const aiHadd = Number(process.env.AI_MAX_PER_DAY) || 300

  const rows = (topics || []).map((t) => ({
    topic: String(t.topic),
    n: String(t.questions || '')
      .split(/\r?\n/)
      .filter((x) => x.trim()).length,
    active: Boolean(t.is_active),
  }))
  const totalQuestions = rows.reduce((a, r) => a + r.n, 0)
  const exportUrl = `/api/admin/qna-export?key=${encodeURIComponent(adminKey)}&peek=1`

  return (
    <main style={s.page}>
      <h1 style={s.h1}>Q&amp;A Control</h1>
      <p style={s.sub}>
        {rows.length} topics · {totalQuestions} sawaal · {pendingCount ?? 0} naye sawaal qatar mein
        {approvedCount ? ` · ${approvedCount} tajweez ab tak manzoor` : ''}
      </p>

      {/* Pichhle kaam ka natija */}
      {(one('banay') || one('juray') || one('radd') || one('chala') || one('ruke') || one('kuch')) && (
        <div style={s.flash}>
          {one('chala') && (
            <>
              AI ne <b>{one('dekhe')}</b> sawaal dekhe aur <b>{one('chala')}</b> tajweez banayi.{' '}
            </>
          )}
          {one('banay') && (
            <>
              <b>{one('banay')}</b> naye topic live ho gaye.{' '}
            </>
          )}
          {one('juray') && (
            <>
              <b>{one('juray')}</b> naye sawaal purane topics mein jur gaye.{' '}
            </>
          )}
          {one('radd') && (
            <>
              <b>{one('radd')}</b> tajweez radd — ye baatein aainda dobara nahi aayengi.{' '}
            </>
          )}
          {one('ruke') && (
            <>
              <b>{one('ruke')}</b> ruk gayi — naye topic ka jawab likhna zaroori hai.{' '}
            </>
          )}
          {one('kuch') && <>Kuch chuna hi nahi tha.</>}
        </div>
      )}

      {/* AI ka haal */}
      <section style={s.aiCard}>
        <div style={{ flex: 1 }}>
          <h2 style={s.h2}>Message samajhne wala AI</h2>
          {aiOn ? (
            <p style={s.aiText}>
              <strong>Chalu</strong> — {aiProvider()} · andaz: {aiMode()} · aaj {aiAaj} dafa pucha
              gaya (roz ki hadd {aiHadd})
              <br />
              <span style={s.aiHint}>
                AI khud jawab nahi likhta — wo sirf batata hai ke baat kis topic ki hai, aur jawab
                aap ka likha hua lafz ba lafz jata hai.
              </span>
            </p>
          ) : (
            <p style={s.aiText}>
              <strong>Band</strong> — bot sirf lafz gin kar jawab dhoondta hai.
              <br />
              <span style={s.aiHint}>
                Chalu karne ke liye Vercel mein <code>GEMINI_API_KEY</code> daalein.
              </span>
            </p>
          )}
        </div>
      </section>

      {/* ── AI ki tajweez — asal kaam yahan hota hai ───────────────────── */}
      <h2 style={{ ...s.h2, marginTop: 30, fontSize: 19 }}>
        AI ki tajweez {suggestions.length > 0 && <span style={s.badge}>{suggestions.length}</span>}
      </h2>

      {sugError && (
        <p style={s.error}>
          Tajweez wali table abhi nahi bani: {sugError.message}
          <br />
          Supabase mein <code>qna_suggestions</code> table banana baqi hai.
        </p>
      )}

      {!sugError && suggestions.length === 0 && (
        <div style={s.khaliBox}>
          <p style={s.p}>
            Abhi koi tajweez nahi. AI har <b>Itwar ki subah</b> khud chalta hai aur jo naye sawaal
            samajh mein aate hain un ki tajweez yahan rakh deta hai.
          </p>
          <form action="/api/admin/qna-suggest" method="POST">
            <input type="hidden" name="key" value={adminKey} />
            <input type="hidden" name="days" value="7" />
            <button type="submit" style={s.btn}>
              Abhi chalao
            </button>
          </form>
          <p style={s.hint}>
            Ek dafa chalane mein 1-2 minute lag sakte hain — safha khulne ka intezaar karein.
          </p>
        </div>
      )}

      {suggestions.length > 0 && (
        <form action="/api/admin/qna-approve" method="POST">
          <input type="hidden" name="key" value={adminKey} />

          <div style={s.toolbar}>
            <label style={s.selectAll}>
              <input type="checkbox" id="sabSelect" style={s.cb} />
              <span>Sab select karein</span>
            </label>
            <span style={s.toolbarHint}>
              Tick lagayein, phir neeche <b>Approve</b> ya <b>Radd</b>
            </span>
          </div>

          {/* Naye topics */}
          {nayeTopics.length > 0 && (
            <>
              <h3 style={s.h3}>Naye topic ban sakte hain ({nayeTopics.length})</h3>
              <p style={s.hint}>
                In par customers ne baar baar sawaal kiya hai lekin aap ka koi topic nahi. Jawab
                likh kar tick lagayein — topic foran live ho jayega.
              </p>
              {nayeTopics.map((x) => (
                <div key={x.id} style={s.sugCardNew}>
                  <label style={s.sugHead}>
                    <input type="checkbox" name="pick" value={x.id} style={s.cb} className="pick" />
                    <span style={s.sugTopic}>{x.topic}</span>
                    <span style={s.sugCount}>{x.ask_count} dafa poocha gaya</span>
                  </label>
                  <div style={s.qList}>
                    {x.questions.map((q, i) => (
                      <div key={i} style={s.qLine}>
                        {q}
                      </div>
                    ))}
                  </div>
                  <label style={s.ansLabel}>
                    Is topic ka jawab (jo customer ko bheja jayega):
                    <textarea
                      name={`ans_${x.id}`}
                      rows={4}
                      style={s.textarea}
                      placeholder="Yahan jawab likhein…"
                    />
                  </label>
                </div>
              ))}
            </>
          )}

          {/* Purane topics mein naye sawaal */}
          {nayeSawaal.length > 0 && (
            <>
              <h3 style={s.h3}>Purane topics mein naye sawaal ({nayeSawaal.length})</h3>
              <p style={s.hint}>
                Ye jumle customers ne apne andaz mein likhe the. Topic mein jur gaye to agli dafa
                bot inhein <b>lafzon se hi</b> pehchan lega — AI ki zaroorat nahi, yani muft aur
                foran.
              </p>
              {nayeSawaal.map((x) => (
                <div key={x.id} style={s.sugCard}>
                  <label style={s.sugHead}>
                    <input type="checkbox" name="pick" value={x.id} style={s.cb} className="pick" />
                    <span style={s.sugTopic}>{x.topic}</span>
                    <span style={s.sugCount}>
                      +{x.questions.length} sawaal · {x.ask_count} dafa
                    </span>
                  </label>
                  <div style={s.qList}>
                    {x.questions.map((q, i) => (
                      <div key={i} style={s.qLine}>
                        {q}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          <div style={s.actionBar}>
            <button type="submit" name="faisla" value="approve" style={s.btnBig}>
              Chune hue Approve karein
            </button>
            <button type="submit" name="faisla" value="reject" style={s.btnGhost}>
              Chune hue Radd karein
            </button>
          </div>
          <p style={s.hint}>
            <b>Radd</b> ka matlab hamesha ke liye — wo baatein aainda kabhi tajweez nahi hongi.
          </p>
        </form>
      )}

      {suggestions.length > 0 && (
        <form action="/api/admin/qna-suggest" method="POST" style={{ marginTop: 18 }}>
          <input type="hidden" name="key" value={adminKey} />
          <input type="hidden" name="days" value="7" />
          <button type="submit" style={s.btnGhost}>
            AI ko dobara chalao
          </button>
        </form>
      )}

      {/* ── Backup ───────────────────────────────────────────────────────── */}
      <section style={s.backupCard}>
        <div style={{ flex: 1 }}>
          <h2 style={s.h2}>Backup — Excel download</h2>
          <p style={s.p}>
            Poora Q&amp;A bank aur qatar wale sawaal ek Excel file mein. Kabhi data zaya ho jaye to
            is file se wapas banaya ja sakta hai. <b>Download karne se kuch badalta nahi</b> — ye
            sirf nakal hai.
          </p>
          <a href={exportUrl} style={s.btn}>
            Excel download karein
          </a>
          <p style={s.hint}>Mahine mein ek dafa download kar ke apne paas rakh lein.</p>
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
                Abhi koi topic nahi.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.topic}>
              <td style={s.td}>{r.topic}</td>
              <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.n}
              </td>
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

      {/* "Sab select karein" — chhota sa kaam, chhota sa script */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.getElementById('sabSelect').addEventListener('change',function(e){" +
            "var on=e.target.checked;" +
            "var all=document.querySelectorAll('.pick');" +
            "for(var i=0;i<all.length;i++){all[i].checked=on}});",
        }}
      />
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
  h1: { fontSize: 26, fontWeight: 800, margin: '0 0 6px' },
  h2: { fontSize: 16.5, fontWeight: 700, margin: '0 0 6px' },
  h3: { fontSize: 15, fontWeight: 700, margin: '24px 0 6px', color: '#0f172a' },
  sub: { fontSize: 14, color: '#475569', margin: '0 0 20px' },
  p: { fontSize: 14, lineHeight: 1.7, margin: '6px 0 12px', color: '#1e293b' },
  hint: { fontSize: 12.8, lineHeight: 1.65, color: '#64748b', margin: '8px 0 0' },
  error: {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#991b1b',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '12px 14px',
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
  aiCard: {
    display: 'flex',
    gap: 16,
    border: '1px solid #c7d2fe',
    borderRadius: 12,
    padding: 18,
    marginBottom: 6,
    background: '#eef2ff',
  },
  aiText: { margin: '6px 0 0', fontSize: 14, lineHeight: 1.7, color: '#1e293b' },
  aiHint: { color: '#475569', fontSize: 13 },
  backupCard: {
    display: 'flex',
    gap: 16,
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 18,
    marginTop: 34,
    background: '#f8fafc',
  },
  khaliBox: {
    border: '1px dashed #cbd5e1',
    borderRadius: 12,
    padding: 18,
    background: '#f8fafc',
  },
  badge: {
    display: 'inline-block',
    background: '#0f172a',
    color: '#fff',
    borderRadius: 999,
    padding: '1px 10px',
    fontSize: 13,
    marginLeft: 6,
    verticalAlign: 'middle',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px 16px',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '10px 14px',
    margin: '10px 0 4px',
  },
  selectAll: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  toolbarHint: { fontSize: 12.8, color: '#64748b' },
  cb: { width: 18, height: 18, accentColor: '#0f172a', cursor: 'pointer', flex: 'none' },
  sugCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '14px 16px',
    marginTop: 10,
    background: '#fff',
  },
  sugCardNew: {
    border: '1px solid #fcd34d',
    borderRadius: 12,
    padding: '14px 16px',
    marginTop: 10,
    background: '#fffbeb',
  },
  sugHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px 10px',
    cursor: 'pointer',
  },
  sugTopic: { fontSize: 15, fontWeight: 700, flex: 1, minWidth: 200 },
  sugCount: { fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap' },
  qList: { margin: '10px 0 0', paddingLeft: 28, display: 'grid', gap: 5 },
  qLine: { fontSize: 13.5, lineHeight: 1.6, color: '#334155' },
  ansLabel: {
    display: 'block',
    marginTop: 12,
    paddingLeft: 28,
    fontSize: 13,
    fontWeight: 600,
    color: '#78350f',
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
  actionBar: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 },
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
    padding: '13px 24px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
  },
  btnGhost: {
    background: '#fff',
    color: '#334155',
    fontSize: 14,
    fontWeight: 600,
    padding: '12px 20px',
    borderRadius: 10,
    border: '1px solid #cbd5e1',
    cursor: 'pointer',
  },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 10 },
  th: {
    textAlign: 'left',
    fontSize: 12.5,
    fontWeight: 700,
    color: '#475569',
    borderBottom: '1px solid #e2e8f0',
    padding: '8px 6px',
  },
  td: { fontSize: 13.5, borderBottom: '1px solid #f1f5f9', padding: '8px 6px' },
  on: { color: '#15803d', fontWeight: 700, fontSize: 12 },
  off: { color: '#b91c1c', fontWeight: 700, fontSize: 12 },
}
