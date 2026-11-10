/**
 * Topics ka safha — /admin/topics?key=ADMIN_KEY
 *
 * Yahan se har topic khol kar dekha ja sakta hai (kaun se sawaal, kya
 * jawab), badla ja sakta hai, ON/OFF ho sakta hai, aur hataya ja sakta hai.
 *
 * "Purane naam" ki safai
 * ----------------------
 * Excel mein topic ka naam badalne par purana naam delete nahi hota tha,
 * sirf BAND ho jata tha. Is liye har rename ke baad ek band copy reh gayi.
 * Ye safha khud pehchan leta hai ke kisi band topic ke sawaal kisi chalu
 * topic mein pehle se mojood hain — aise topic ek click mein saaf ho jate
 * hain. Jin ke sawaal kahin aur nahi mile, unhein alag rakha jata hai
 * taake ghalti se kuch zaya na ho.
 */

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { ignoreKey } from '@/lib/qnaIgnore'
import '../admin.css'

export const dynamic = 'force-dynamic'

// Band topic ke itne hisse ke sawaal kisi chalu topic mein mil jayen to use
// "purana naam" maan lete hain
const PURANA_HAD = 0.6

interface Row {
  id: string
  topic: string
  questions: string
  answer: string
  is_active: boolean
  off_reason: string
  n: number
  /** Is band topic ke kitne sawaal kisi chalu topic mein mil gaye (0-1) */
  milaan: number
  /** Kis chalu topic se sab se zyada mila */
  milaWala: string
}

export default async function TopicsPage({
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
            <code>/admin/topics?key=YOUR_ADMIN_KEY</code>
          </p>
        </div>
      </main>
    )
  }

  const { data } = await supabaseAdmin
    .from('qna_topics')
    .select('id, topic, questions, answer, is_active, off_reason')
    .order('topic', { ascending: true })

  const kacha = (data || []).map((t) => ({
    id: String(t.id),
    topic: String(t.topic || ''),
    questions: String(t.questions || ''),
    answer: String(t.answer || ''),
    is_active: Boolean(t.is_active),
    off_reason: t.off_reason ? String(t.off_reason) : '',
    lines: String(t.questions || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
  }))

  // Chalu topics ke sare sawaal — band topics ko inhi se milate hain
  const chaluKeSawaal = new Map<string, Set<string>>()
  for (const t of kacha) {
    if (!t.is_active) continue
    chaluKeSawaal.set(t.topic, new Set(t.lines.map(ignoreKey).filter(Boolean)))
  }

  const rows: Row[] = kacha.map((t) => {
    let milaan = 0
    let milaWala = ''
    if (!t.is_active && t.lines.length) {
      const keys = t.lines.map(ignoreKey).filter(Boolean)
      for (const [naam, set] of Array.from(chaluKeSawaal.entries())) {
        const mile = keys.filter((k) => set.has(k)).length
        const hissa = keys.length ? mile / keys.length : 0
        if (hissa > milaan) {
          milaan = hissa
          milaWala = naam
        }
      }
    }
    return {
      id: t.id,
      topic: t.topic,
      questions: t.questions,
      answer: t.answer,
      is_active: t.is_active,
      off_reason: t.off_reason,
      n: t.lines.length,
      milaan,
      milaWala,
    }
  })

  const chalu = rows.filter((r) => r.is_active)
  const band = rows.filter((r) => !r.is_active)
  const puraneNaam = band.filter((r) => r.n > 0 && r.milaan >= PURANA_HAD)
  const baqiBand = band.filter((r) => !puraneNaam.includes(r))

  const chuna = one('t') ? rows.find((r) => r.id === one('t')) : undefined
  const nayaBanana = one('naya') === '1'

  const href = (extra: string) => `/admin/topics?key=${encodeURIComponent(adminKey)}${extra}`
  const qnaHref = `/admin/qna?key=${encodeURIComponent(adminKey)}`

  const fisad = (x: number) => Math.round(x * 100)

  return (
    <main className="adm">
      <div className="adm-wrap">
        {/* Oopar ki patti */}
        <nav className="adm-bar adm-in">
          <span className="adm-brand">
            <span className="adm-cube">
              <i />
            </span>
            Myzan Bot
          </span>
          <span className="adm-nav">
            <Link href={qnaHref}>Dashboard</Link>
            <Link href={href('')} data-on="1">
              Topics
            </Link>
            <Link href={`/admin/review?key=${encodeURIComponent(adminKey)}`}>Review</Link>
          </span>
        </nav>

        <h1 className="adm-title">Topics</h1>
        <p className="adm-sub">
          Har topic khol kar dekhein ke us mein kaun se sawaal hain aur jawab kya hai — wahin badal
          bhi sakte hain.
        </p>

        <div className="adm-stats">
          <div className="adm-stat">
            <b>{chalu.length}</b>
            <span>CHALU TOPICS</span>
          </div>
          <div className="adm-stat">
            <b>{rows.reduce((a, r) => a + (r.is_active ? r.n : 0), 0)}</b>
            <span>CHALU SAWAAL</span>
          </div>
          <div className="adm-stat">
            <b>{band.length}</b>
            <span>BAND TOPICS</span>
          </div>
          <div className="adm-stat">
            <b>{puraneNaam.length}</b>
            <span>SAFAI KE LAIQ</span>
          </div>
        </div>

        {(one('mehfooz') || one('bana') || one('hataya') || one('badla') || one('safai')) && (
          <div className="adm-flash">
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
            {one('safai') && (
              <>
                <b>{one('safai')}</b> purane naam saaf ho gaye.
              </>
            )}
          </div>
        )}
        {one('khata') && <p className="adm-error">{one('khata')}</p>}

        {/* ── Naya topic ───────────────────────────────────────────────── */}
        {nayaBanana ? (
          <section className="adm-card adm-in" data-tone="new">
            <h2 className="adm-h2">Naya topic</h2>
            <form action="/api/admin/topic-save" method="POST">
              <input type="hidden" name="key" value={adminKey} />
              <input type="hidden" name="kaam" value="naya" />
              <label className="adm-label">
                Topic ka naam
                <input
                  name="topic"
                  className="adm-input"
                  placeholder="Jaise: Gift Packing"
                  required
                />
              </label>
              <label className="adm-label">
                Sawaal — har line par ek
                <textarea
                  name="questions"
                  rows={6}
                  className="adm-area"
                  placeholder={'gift packing hoti hai?\nkya gift pack kar dein ge?'}
                />
              </label>
              <label className="adm-label">
                Jawab — lafz ba lafz customer ko jata hai
                <textarea name="answer" rows={5} className="adm-area" required />
              </label>
              <div className="adm-btn-row">
                <button type="submit" className="adm-btn-go">
                  Topic banayein
                </button>
                <Link href={href('')} className="adm-btn-ghost">
                  Rehne dein
                </Link>
              </div>
            </form>
          </section>
        ) : (
          <Link href={href('&naya=1')} className="adm-btn">
            + Naya topic banayein
          </Link>
        )}

        {/* ── Chuna hua topic ──────────────────────────────────────────── */}
        {chuna && (
          <section className="adm-card adm-in" id="edit" style={{ marginTop: 16 }}>
            <h2 className="adm-h2">
              Topic badlein{' '}
              <span className="adm-badge" data-tone={chuna.is_active ? 'on' : 'off'}>
                {chuna.is_active ? 'ON' : 'OFF'}
              </span>
            </h2>

            <form action="/api/admin/topic-save" method="POST">
              <input type="hidden" name="key" value={adminKey} />
              <input type="hidden" name="kaam" value="save" />
              <input type="hidden" name="id" value={chuna.id} />

              <label className="adm-label">
                Topic ka naam
                <input name="topic" defaultValue={chuna.topic} className="adm-input" required />
              </label>

              <label className="adm-label">
                Sawaal ({chuna.n}) — har line par ek
                <textarea
                  name="questions"
                  rows={Math.min(20, Math.max(6, chuna.n + 2))}
                  defaultValue={chuna.questions}
                  className="adm-area"
                />
              </label>
              <p className="adm-hint">
                Jitne zyada tarah ke jumle yahan honge, utna hi bot bina AI ke pehchan lega — yani
                utna hi tez aur muft.
              </p>

              <label className="adm-label">
                Jawab — lafz ba lafz customer ko jata hai
                <textarea
                  name="answer"
                  rows={7}
                  defaultValue={chuna.answer}
                  className="adm-area"
                  required
                />
              </label>

              <label className="adm-label">
                Band kyun hai? (sirf aap ki yaad-dasht ke liye)
                <input
                  name="wajah"
                  defaultValue={chuna.off_reason}
                  className="adm-input"
                  placeholder="Jaise: ab ye sawaal Yes Available wale raste se jate hain"
                />
              </label>

              <label className="adm-check">
                <input
                  type="checkbox"
                  name="chalu"
                  value="1"
                  defaultChecked={chuna.is_active}
                  className="adm-cb"
                />
                <span>
                  Chalu rakhein — <b>OFF</b> karne par bot is topic ka jawab bhejna band kar dega
                </span>
              </label>

              <div className="adm-btn-row">
                <button type="submit" className="adm-btn-go">
                  Mehfooz karein
                </button>
                <Link href={href('')} className="adm-btn-ghost">
                  Band karein
                </Link>
              </div>
            </form>

            <form action="/api/admin/topic-save" method="POST" style={styles.del}>
              <input type="hidden" name="key" value={adminKey} />
              <input type="hidden" name="kaam" value="delete" />
              <input type="hidden" name="id" value={chuna.id} />
              <label className="adm-check">
                <input type="checkbox" name="pakka" value="haan" className="adm-cb" />
                <span>Haan, is topic ko hamesha ke liye hata dein</span>
              </label>
              <button type="submit" className="adm-btn-bad">
                Hamesha ke liye hatayein
              </button>
              <p className="adm-hint">
                Hatane ke baad wapas nahi aata. Sirf band karna ho to oopar wala tick hata kar
                “Mehfooz karein” daba dein.
              </p>
            </form>
          </section>
        )}

        {/* ── Safai: purane naam ───────────────────────────────────────── */}
        {puraneNaam.length > 0 && (
          <section className="adm-card adm-in" data-tone="new" style={{ marginTop: 20 }}>
            <h2 className="adm-h2">
              Purane naam — safai{' '}
              <span className="adm-badge" data-tone="count">
                {puraneNaam.length}
              </span>
            </h2>
            <p className="adm-p">
              In band topics ke sawaal kisi <b>chalu</b> topic mein pehle se mojood hain — yani ye
              us ke purane naam hain, jo rename ke waqt peeche reh gaye. Hatane se kuch zaya nahi
              hota.
            </p>
            <form action="/api/admin/topic-save" method="POST">
              <input type="hidden" name="key" value={adminKey} />
              <input type="hidden" name="kaam" value="safai" />
              <div className="adm-list">
                {puraneNaam.map((r) => (
                  <label key={r.id} className="adm-item">
                    <input
                      type="checkbox"
                      name="pick"
                      value={r.id}
                      className="adm-cb purana"
                      defaultChecked
                    />
                    <span className="adm-item-name">
                      {r.topic}
                      <span className="adm-item-sub">
                        {fisad(r.milaan)}% sawaal yahan mil gaye → {r.milaWala}
                      </span>
                    </span>
                    <span className="adm-item-n">{r.n} sawaal</span>
                  </label>
                ))}
              </div>
              <div className="adm-btn-row">
                <button type="submit" className="adm-btn-go">
                  Chune hue hata dein
                </button>
                <Link href={href('')} className="adm-btn-ghost">
                  Abhi rehne dein
                </Link>
              </div>
            </form>
          </section>
        )}

        {/* ── Chalu ────────────────────────────────────────────────────── */}
        <h2 className="adm-h3">Chalu topics ({chalu.length})</h2>
        <div className="adm-list">
          {chalu.map((r) => (
            <Link key={r.id} href={href(`&t=${r.id}#edit`)} className="adm-item">
              <span className="adm-item-name">{r.topic}</span>
              <span className="adm-item-n">{r.n} sawaal</span>
              <span className="adm-badge" data-tone="on">
                ON
              </span>
            </Link>
          ))}
        </div>

        {/* ── Band (jo purane naam nahi) ───────────────────────────────── */}
        {baqiBand.length > 0 && (
          <>
            <h2 className="adm-h3">Band topics ({baqiBand.length})</h2>
            <p className="adm-hint" style={{ marginBottom: 10 }}>
              In ke sawaal kisi chalu topic mein nahi mile, is liye safai wali list se bahar rakhe
              hain. Khol kar dekh lein — band rakhne ki wajah bhi wahin likh sakte hain.
            </p>
            <div className="adm-list">
              {baqiBand.map((r) => (
                <Link key={r.id} href={href(`&t=${r.id}#edit`)} className="adm-item" data-off="1">
                  <span className="adm-item-name">
                    {r.topic}
                    {r.off_reason && <span className="adm-item-sub">{r.off_reason}</span>}
                  </span>
                  <span className="adm-item-n">{r.n} sawaal</span>
                  <span className="adm-badge" data-tone="off">
                    OFF
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        <p className="adm-foot">Myzan WhatsApp Bot · Q&amp;A Control</p>
      </div>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  del: { borderTop: '1px solid rgba(255,255,255,0.09)', marginTop: 24, paddingTop: 8 },
}
