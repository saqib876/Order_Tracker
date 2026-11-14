/**
 * Topics ka safha — /admin/topics?key=ADMIN_KEY
 *
 * Yahan se har topic khol kar dekha ja sakta hai (kaun se sawaal, kya
 * jawab), badla ja sakta hai, ON/OFF ho sakta hai, aur hataya ja sakta hai.
 *
 * Buttons ke naam
 * ---------------
 * Jo buttons har jagah hote hain — Save, Back, Cancel, Delete, ON/OFF — wo
 * apni aam angrezi shakl mein rakhe gaye hain. Samjhane wali baat un ke
 * neeche Roman Urdu mein likhi jati hai. Button ka naam paheli nahi hona
 * chahiye.
 *
 * ON/OFF ka alag button
 * ---------------------
 * Pehle ye ek checkbox tha jo Save ke sath chalta tha — do alag kaam ek hi
 * button mein mil kar uljhan paida karte the. Ab ON/OFF ka apna button hai,
 * aur wo list mein bhi hai taake topic khole baghair badla ja sake. Save ab
 * sirf likhi hui baat mehfooz karta hai, ON/OFF ko haath nahi lagata.
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
import { unstable_noStore as noStore } from 'next/cache'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { ignoreKey } from '@/lib/qnaIgnore'
import { ThemeBoot, ThemeToggle } from '../ThemeBits'
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
  // Har dafa taza data - Next ka koi bhi cache beech mein na aaye
  noStore()

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

  // Kin CHALU topics ka jawab harf-ba-harf ek jaisa hai?
  //
  // Aisa ho to customer kuch bhi poochhe, use wohi ek jawab milta hai. Misal
  // ke taur par "Buy 1 Get 1 Offer" aur "Salaam" ka jawab ek ho jaye to offer
  // poochhne wale ko welcome message chala jata hai.
  const jawabGrup = new Map<string, Row[]>()
  for (const r of chalu) {
    const saaf = r.answer.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!saaf) continue
    const list = jawabGrup.get(saaf) || []
    list.push(r)
    jawabGrup.set(saaf, list)
  }
  const ekJaisa = Array.from(jawabGrup.values())
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length)

  const chuna = one('t') ? rows.find((r) => r.id === one('t')) : undefined
  const nayaBanana = one('naya') === '1'

  const href = (extra: string) => `/admin/topics?key=${encodeURIComponent(adminKey)}${extra}`
  const qnaHref = `/admin/qna?key=${encodeURIComponent(adminKey)}`

  const fisad = (x: number) => Math.round(x * 100)

  /**
   * ON/OFF ka button — har jagah bilkul ek hi shakl mein.
   *
   * Form maujooda halat ka ULAT bhejta hai: ON dikh raha ho to dabane par
   * OFF ho jayega. `khulaRahe` bhejne par safha wapas isi topic par khulta
   * hai, warna list par.
   */
  const SwitchBtn = ({ r, khulaRahe }: { r: Row; khulaRahe?: boolean }) => (
    <form action="/api/admin/topic-save" method="POST" className="adm-switch-form">
      <input type="hidden" name="key" value={adminKey} />
      <input type="hidden" name="kaam" value="toggle" />
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="chalu" value={r.is_active ? '0' : '1'} />
      {khulaRahe && <input type="hidden" name="khulaRahe" value="1" />}
      <button
        type="submit"
        className="adm-switch"
        data-on={r.is_active ? '1' : '0'}
        title={r.is_active ? 'Turn OFF' : 'Turn ON'}
      >
        <i />
        <b>{r.is_active ? 'ON' : 'OFF'}</b>
      </button>
    </form>
  )

  return (
    <main className="adm">
      <ThemeBoot />
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
            <Link href={`/admin/sehat?key=${encodeURIComponent(adminKey)}`}>Sehat</Link>
            <ThemeToggle />
          </span>
        </nav>

        <h1 className="adm-title">Topics</h1>
        <p className="adm-sub">
          Har topic khol kar dekhein ke us mein kaun se sawaal hain aur jawab kya hai — wahin badal
          bhi sakte hain. ON/OFF karne ke liye kholna zaroori nahi, list mein hi button hai.
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
          <div className="adm-flash" id="khabar">
            {one('mehfooz') && (
              <>
                <b>{one('mehfooz')}</b> — jo likha tha wo mehfooz ho gaya.
              </>
            )}
            {one('bana') && (
              <>
                <b>{one('bana')}</b> naya topic ban gaya.
              </>
            )}
            {one('hataya') && <>Topic hamesha ke liye hata diya gaya.</>}
            {one('badla') === 'chalu' && (
              <>
                Topic ab <b>ON</b> hai — bot is ka jawab bhejega.
              </>
            )}
            {one('badla') === 'band' && (
              <>
                Topic ab <b>OFF</b> hai — bot is ka jawab nahi bhejega.
              </>
            )}
            {one('safai') && (
              <>
                <b>{one('safai')}</b> purane naam saaf ho gaye.
              </>
            )}
          </div>
        )}
        {one('khata') && (
          <p className="adm-error" id="khabar">
            {one('khata')}
          </p>
        )}

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
                  Create
                </button>
                <Link href={href('')} className="adm-btn-ghost">
                  Cancel
                </Link>
              </div>
              <p className="adm-hint">
                <b>Create</b> dabate hi topic ban kar ON ho jata hai — bot foran is ke sawaal
                pehchanne lagega.
              </p>
            </form>
          </section>
        ) : (
          <Link href={href('&naya=1')} className="adm-btn">
            + Naya topic
          </Link>
        )}

        {/* ── Chuna hua topic ──────────────────────────────────────────── */}
        {chuna && (
          <section className="adm-card adm-in" id="edit" style={{ marginTop: 16 }}>
            <div className="adm-card-top">
              <h2 className="adm-h2">{chuna.topic}</h2>
              <Link href={href('')} className="adm-back">
                &#8592; Back
              </Link>
            </div>

            {/* ON/OFF — apna alag button, Save se bilkul alag kaam */}
            <div className="adm-switch-row">
              <SwitchBtn r={chuna} khulaRahe />
              <span>
                {chuna.is_active ? (
                  <>
                    Ye topic is waqt <b>ON</b> hai — bot is ka jawab bhejta hai. Band karna ho to ye
                    button daba dein.
                  </>
                ) : (
                  <>
                    Ye topic is waqt <b>OFF</b> hai — bot is ka jawab nahi bhejta. Chalu karna ho to
                    ye button daba dein.
                  </>
                )}
              </span>
            </div>

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
                  rows={Math.min(12, Math.max(6, chuna.n + 2))}
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

              <div className="adm-stick">
                <button type="submit" className="adm-btn-go">
                  Save
                </button>
              </div>
              <p className="adm-hint">
                <b>Save</b> upar likhi hui baatein mehfooz karta hai — naam, sawaal, jawab aur
                wajah. Ye topic ko ON ya OFF nahi karta; us ke liye upar wala ON/OFF button hai.
              </p>
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
                Delete
              </button>
              <p className="adm-hint">
                <b>Delete</b> ke baad topic wapas nahi aata. Sirf kuch dair ke liye rokna ho to
                Delete ke bajaye upar wala <b>ON/OFF</b> button istemal karein.
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
                  Delete selected
                </button>
                <Link href={href('')} className="adm-btn-ghost">
                  Cancel
                </Link>
              </div>
            </form>
          </section>
        )}

        {/* ── Ek jaisa jawab ───────────────────────────────────────────── */}
        {ekJaisa.length > 0 && (
          <section className="adm-card adm-in" data-tone="quiet" style={{ marginTop: 20 }}>
            <h2 className="adm-h2">
              Ek jaisa jawab{' '}
              <span className="adm-badge" data-tone="count">
                {ekJaisa.length}
              </span>
            </h2>
            <p className="adm-p">
              In topics ka jawab <b>harf-ba-harf ek jaisa</b> hai. Yani customer in mein se kuch bhi
              poochhe, use ek hi matan jata hai. Agar kisi topic ka apna alag jawab hona chahiye, use
              khol kar wahan likh dein.
            </p>
            {ekJaisa.map((grup, gi) => (
              <div key={gi} style={{ marginTop: 14 }}>
                <div className="adm-list">
                  {grup.map((r) => (
                    <div key={r.id} className="adm-item">
                      <Link href={href(`&t=${r.id}#edit`)} className="adm-item-name">
                        {r.topic}
                        <span className="adm-item-sub">khol kar jawab badlein</span>
                      </Link>
                      <span className="adm-item-n">{r.n} sawaal</span>
                      <SwitchBtn r={r} />
                    </div>
                  ))}
                </div>
                <p className="adm-hint" style={{ marginTop: 6 }}>
                  Jawab: {grup[0].answer.replace(/\s+/g, ' ').slice(0, 180)}
                  {grup[0].answer.length > 180 ? '...' : ''}
                </p>
              </div>
            ))}
          </section>
        )}

        {/* ── Chalu ────────────────────────────────────────────────────── */}
        <h2 className="adm-h3">Chalu topics ({chalu.length})</h2>
        <div className="adm-list">
          {chalu.map((r) => (
            <div key={r.id} className="adm-item">
              <Link href={href(`&t=${r.id}#edit`)} className="adm-item-name">
                {r.topic}
              </Link>
              <span className="adm-item-n">{r.n} sawaal</span>
              <SwitchBtn r={r} />
            </div>
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
                <div key={r.id} className="adm-item" data-off="1">
                  <Link href={href(`&t=${r.id}#edit`)} className="adm-item-name">
                    {r.topic}
                    {r.off_reason && <span className="adm-item-sub">{r.off_reason}</span>}
                  </Link>
                  <span className="adm-item-n">{r.n} sawaal</span>
                  <SwitchBtn r={r} />
                </div>
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
