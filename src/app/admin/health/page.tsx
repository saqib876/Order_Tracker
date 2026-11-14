/**
 * Bot ki Health — /admin/health?key=ADMIN_KEY
 *
 * Safha kaise bana hua hai
 * ------------------------
 * Upar wali cheezein HAMESHA khuli rehti hain: ek bara number (bot kitna
 * theek chal raha hai), paanch paimane, aur agar koi gharbar ho to us ki
 * lal lines.
 *
 * Baqi sab kuch BAND hota hai. Har section ek patti hai jis par naam,
 * ginti aur ek chhota khulasa likha hai — click karo to khul jaye, dobara
 * click karo to band. Is tarah safha chhota rehta hai aur jo dekhna ho
 * sirf wohi khulta hai.
 *
 * Ye safha koi message nahi bhejta aur AI ko call nahi karta — sirf dekhta
 * hai. Jitni dafa marzi kholein.
 */

import type { ReactNode } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import Link from 'next/link'
import { sehatLo } from '@/lib/sehat'
import { dohreSawaal, sawaalDhoondo } from '@/lib/sawaalSafai'
import type { SawaalJagah, TopicChota } from '@/lib/sawaalSafai'
import { ThemeBoot, ThemeToggle } from '../ThemeBits'
import '../admin.css'

export const dynamic = 'force-dynamic'

/** 0-100 ko teen darjon mein baant deta hai — rang isi se chunte hain */
function gradeKa(n: number): 'acha' | 'theek' | 'bura' {
  if (n >= 85) return 'acha'
  if (n >= 60) return 'theek'
  return 'bura'
}

const RANG: Record<string, string> = {
  topic: '#6366f1',
  tracking: '#10b981',
  system: '#f59e0b',
  anjaan: '#f43f5e',
}

const RANG_DARJA: Record<string, string> = {
  acha: '#10b981',
  theek: '#f59e0b',
  bura: '#f43f5e',
}

const QISM_NAAM: Record<string, string> = {
  topic: 'Excel ka topic',
  tracking: 'Tracking',
  system: 'Bot ka apna jawab',
  anjaan: 'Pehchana nahi gaya',
}

const waqt = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        timeZone: 'Asia/Karachi',
        hour12: true,
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

/**
 * Ek band hone wala section.
 *
 * `<details>` istemal kiya hai — ye browser ka apna hissa hai, is ke liye
 * koi script nahi chahiye. Safha halka rehta hai aur bina JavaScript ke
 * bhi khulta band hota hai.
 */
function Khana({
  id,
  naam,
  tafseel,
  ginti,
  rang,
  khula,
  children,
}: {
  id: string
  naam: string
  tafseel: string
  ginti?: number | string
  rang?: 'acha' | 'theek' | 'bura'
  khula?: boolean
  children: ReactNode
}) {
  return (
    <details className="adm-fold" id={id} open={khula} data-grade={rang}>
      <summary>
        <span className="adm-fold-arrow" aria-hidden>
          ›
        </span>
        <span className="adm-fold-naam">
          {naam}
          <span className="adm-fold-tafseel">{tafseel}</span>
        </span>
        {ginti !== undefined && <span className="adm-fold-n">{ginti}</span>}
      </summary>
      <div className="adm-fold-andar">{children}</div>
    </details>
  )
}

/**
 * Upar wali "dekhne wali baatein" par click karne se wo section khul jata
 * hai. <details> khud ba khud nahi khulta, is liye ye chhota sa script
 * hash dekh kar use khol deta hai aur wahan le jata hai.
 */
function KholoScript() {
  const code = [
    '(function(){',
    'function kholo(){',
    'var h=location.hash;if(!h||h.length<2)return;',
    'var el=null;try{el=document.querySelector(h)}catch(e){return}',
    // Hash foran saaf kar dete hain. Warna wo URL mein pada rehta hai aur
    // har refresh par safha dobara usi jagah kood jata tha.
    'try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}',
    'if(!el)return;',
    'var d=(el.tagName==="DETAILS")?el:(el.closest?el.closest("details"):null);',
    'if(d)d.open=true;',
    'el.scrollIntoView({block:"start",behavior:"smooth"});',
    '}',
    'kholo();window.addEventListener("hashchange",kholo);',
    '})()',
  ].join('')
  return <script dangerouslySetInnerHTML={{ __html: code }} />
}

/**
 * Ek sawaal, ek topic — aur us par do kaam: doosre topic mein bhej dena,
 * ya is topic se nikaal dena.
 */
function SawaalRow({
  j,
  topics,
  adminKey,
  talash,
}: {
  j: SawaalJagah
  topics: TopicChota[]
  adminKey: string
  talash: string
}) {
  return (
    <div className="adm-sawaal">
      <p className="adm-sawaal-matan">{j.asli}</p>
      <div className="adm-sawaal-niche">
        <span className="adm-sawaal-kab">
          abhi yahan hai: <b>{j.topic}</b>
          {!j.chalu && ' (band topic)'}
        </span>

        <form action="/api/admin/sawaal-fix" method="POST" className="adm-sawaal-form">
          <input type="hidden" name="key" value={adminKey} />
          <input type="hidden" name="kaam" value="bhejo" />
          <input type="hidden" name="matan" value={j.asli} />
          <input type="hidden" name="se_topic" value={j.topicId} />
          <input type="hidden" name="q" value={talash} />
          <select name="ko_topic" className="adm-chota-select" defaultValue="" required>
            <option value="" disabled>
              Is topic mein bhejein...
            </option>
            {topics
              .filter((t) => t.chalu && t.id !== j.topicId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.topic}
                </option>
              ))}
          </select>
          <button type="submit" className="adm-chota-btn">
            Move
          </button>
        </form>

        <form action="/api/admin/sawaal-fix" method="POST" className="adm-sawaal-form">
          <input type="hidden" name="key" value={adminKey} />
          <input type="hidden" name="kaam" value="hatao" />
          <input type="hidden" name="matan" value={j.asli} />
          <input type="hidden" name="se_topic" value={j.topicId} />
          <input type="hidden" name="q" value={talash} />
          <button type="submit" className="adm-chota-btn adm-chota-bad">
            Remove
          </button>
        </form>
      </div>
    </div>
  )
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  // Har dafa taza data — Next ka koi cache beech mein na aaye
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
            <code>/admin/health?key=YOUR_ADMIN_KEY</code>
          </p>
        </div>
      </main>
    )
  }

  const talash = one('q').trim()
  const s = await sehatLo()
  const [dohre, dhoonda] = await Promise.all([
    dohreSawaal(),
    talash ? sawaalDhoondo(talash) : Promise.resolve({ mile: [] as SawaalJagah[], topics: [] }),
  ])
  const safai = {
    dohre: dohre.dohre,
    topics: dohre.topics,
    kulSawaal: dohre.kulSawaal,
    mile: dhoonda.mile,
  }
  const k = encodeURIComponent(adminKey)

  const masle = s.khulasa.filter((x) => !x.theek)
  const topTopic = s.jawabBreakdown[0]
  const anjaanKul = s.jawabBreakdown.find((j) => j.qism === 'anjaan')?.kitne || 0

  return (
    <main className="adm">
      <ThemeBoot />
      <KholoScript />
      <div className="adm-wrap">
        <nav className="adm-bar adm-in">
          <span className="adm-brand">
            <span className="adm-cube">
              <i />
            </span>
            Myzan Bot
          </span>
          <span className="adm-nav">
            <Link href={`/admin/qna?key=${k}`}>Dashboard</Link>
            <Link href={`/admin/topics?key=${k}`}>Topics</Link>
            <Link href={`/admin/review?key=${k}`}>Review</Link>
            <Link href={`/admin/health?key=${k}`} data-on="1">
              Health
            </Link>
            <ThemeToggle />
          </span>
        </nav>

        <h1 className="adm-title">Bot ki Health</h1>
        <p className="adm-sub">
          {waqt(s.waqt)} tak ka haal (Pakistan ka waqt). Har section par click karein — khul
          jayega, dobara click par band.
        </p>

        {(one('nikla') || one('bheja')) && (
          <p className="adm-flash">
            {one('nikla') && (
              <>
                Sawaal <b>{one('nikla')}</b> se nikaal diya gaya.
              </>
            )}
            {one('bheja') && (
              <>
                Sawaal <b>{one('bheja')}</b> mein bhej diya gaya.
              </>
            )}
          </p>
        )}
        {one('tracking') && (
          <p className="adm-flash">
            Sawaal tracking wali list mein darj ho gaya — aage se aise message pehchane
            jayenge.
          </p>
        )}
        {(one('jura') || one('hataya')) && (
          <p className="adm-flash">
            {one('jura') && (
              <>
                Sawaal <b>{one('jura')}</b> mein daal diya gaya — bot foran pehchanne lagega.
              </>
            )}
            {one('hataya') && <>Sawaal hamesha ke liye nazar-andaz kar diya gaya.</>}
          </p>
        )}
        {one('khata') && <p className="adm-error">{one('khata')}</p>}

        {/* ── Bara number: hamesha khula ────────────────────────────────── */}
        <section className="adm-score">
          <div className="adm-score-big" data-grade={gradeKa(s.kaam.kul)}>
            <b>{s.kaam.kul}</b>
            <i>%</i>
            <span>{s.kaam.darje}</span>
          </div>
          <div className="adm-score-note">
            <h2 className="adm-h2">Bot kitna theek chal raha hai</h2>
            <p className="adm-p">
              Paanch cheezon ka ausat — har ek neeche alag se likhi hai. Pichle 24 ghanton ke{' '}
              <b>{s.kaam.faisle}</b> faislon par bana hai.
            </p>
            {s.kaam.faisle === 0 ? (
              <p className="adm-hint">
                Abhi koi faisla darj nahi hua — roznamcha naye messages se bharta hai. Kal tak
                asli tasveer saamne aa jayegi.
              </p>
            ) : s.kaam.faisle < 20 ? (
              <p className="adm-hint">
                Abhi sirf {s.kaam.faisle} faisle hain, is liye ye number kacha hai. Jab 20 se zyada
                ho jayein tab is par bharosa karein.
              </p>
            ) : null}
          </div>
          <a className="adm-btn-ghost" href={`/admin/health?key=${k}&t=${Date.now()}`}>
            Refresh
          </a>
        </section>

        <div className="adm-paimane">
          {s.kaam.paimane.map((x, i) => (
            <div className="adm-paimana" key={i} data-grade={gradeKa(x.fisad)}>
              <div className="adm-paimana-top">
                <span className="adm-paimana-naam">{x.naam}</span>
                <span className="adm-paimana-n">{x.bunyad === 0 ? '—' : x.fisad + '%'}</span>
              </div>
              <span className="adm-meter">
                <i style={{ width: `${x.bunyad === 0 ? 0 : Math.max(x.fisad, 2)}%` }} />
              </span>
              <p className="adm-paimana-matlab">
                {x.bunyad === 0 ? 'abhi koi khabar nahi' : x.matlab}
              </p>
              <p className="adm-paimana-tafseel">{x.tafseel}</p>
            </div>
          ))}
        </div>

        {/* ── Gharbar: sirf tab jab waqai koi masla ho ──────────────────── */}
        {masle.length > 0 ? (
          <div className="adm-card" data-tone="quiet">
            <h2 className="adm-h2">Dekhne wali baatein</h2>
            <div className="adm-list adm-khulasa">
              {masle.map((x, i) =>
                x.jagah ? (
                  <a
                    className="adm-item adm-masla"
                    key={i}
                    href={
                      x.jagah.startsWith('/')
                        ? `${x.jagah}?key=${k}`
                        : `#${x.jagah}`
                    }
                  >
                    <span className="adm-dot" style={{ background: '#f43f5e' }} aria-hidden />
                    <span className="adm-item-name" style={{ fontWeight: 600 }}>
                      {x.baat}
                      <span className="adm-item-sub">
                        {x.jagah.startsWith('/')
                          ? 'Dashboard par khul jayega'
                          : 'Kholne ke liye click karein'}
                      </span>
                    </span>
                    <span className="adm-masla-btn">Dekhein ›</span>
                  </a>
                ) : (
                  <div className="adm-item" key={i} data-off="1">
                    <span className="adm-dot" style={{ background: '#f43f5e' }} aria-hidden />
                    <span className="adm-item-name" style={{ fontWeight: 600 }}>
                      {x.baat}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        ) : (
          <p className="adm-flash">Sab theek chal raha hai — koi dekhne wali baat nahi.</p>
        )}

        {/* ── Aaj ki ginti ─────────────────────────────────────────────── */}
        <div className="adm-stats">
          <div className="adm-stat">
            <b>{s.sb.jawab24}</b>
            <span>JAWAB GAYE (24 GHANTE)</span>
          </div>
          <div className="adm-stat">
            <b>{s.sb.customers24}</b>
            <span>ALAG CUSTOMERS</span>
          </div>
          <div className="adm-stat">
            <b>{s.sb.tracking24}</b>
            <span>TRACKING GAYI</span>
          </div>
          <div className="adm-stat">
            <b>{s.sb.aiCalls24}</b>
            <span>AI SE POOCHA</span>
          </div>
        </div>

        {/* ══ Yahan se sab band hota hai ═══════════════════════════════════ */}

        {anjaanKul > 0 && (
          <Khana
            id="anjaan"
          naam="Pehchana nahi gaya"
            tafseel="Ye jawab kisi maujooda topic se nahi milte — sab se pehle yahi dekhein"
            ginti={anjaanKul}
            rang="bura"
          >
            <p className="adm-p">
              Har jawab kisi maloom raste se aana chahiye. Ye jawab gaye to sahi, lekin ab un ka
              matan kisi chalu topic se nahi milta. <b>Aam wajah:</b> jawab bhejne ke baad aap ne us
              topic ka matan badal diya, ya topic delete ho gaya — matan badalte hi purana jawab
              yahan aa jata hai. Ye kharabi nahi hoti.
            </p>
            <div className="adm-list">
              {s.anjaanList.map((a, i) => (
                <div className="adm-item" key={i} data-off="1">
                  <span className="adm-item-name">
                    {a.namuna}
                    <span className="adm-item-sub">
                      {a.customers} customers · aakhri dafa {waqt(a.aakhri)}
                    </span>
                  </span>
                  <span className="adm-num">{a.kitne}</span>
                </div>
              ))}
            </div>
            <p className="adm-hint">
              Jin jawabon ka matan "mehfooz nahi" likha hai, wo is cheez se pehle gaye the. Aage se
              har jawab ka matan mehfooz hota hai, is liye agli dafa yahan poora matan dikhega.
            </p>
          </Khana>
        )}

        <Khana
          id="jawab"
          naam="Aaj kaun sa jawab kitni dafa gaya"
          tafseel="Kis topic ke jawab gaye, kitne customers ko"
          ginti={s.jawabBreakdown.length}
        >
          {s.jawabBreakdown.length === 0 ? (
            <p className="adm-khali">Pichle 24 ghante mein koi jawab nahi gaya.</p>
          ) : (
            <>
              <div className="adm-list">
                {s.jawabBreakdown.map((j, i) => (
                  <div className="adm-item" key={i}>
                    <span className="adm-dot" style={{ background: RANG[j.qism] }} aria-hidden />
                    {s.topicIds[j.naam] ? (
                      <Link
                        className="adm-item-name"
                        href={`/admin/topics?key=${k}&t=${s.topicIds[j.naam]}#edit`}
                      >
                        {j.naam}
                        <span className="adm-item-sub">
                          {QISM_NAAM[j.qism]} · {j.customers} customers · {j.hissa}% · kholne ke
                          liye click karein
                        </span>
                      </Link>
                    ) : (
                      <span className="adm-item-name">
                        {j.naam}
                        <span className="adm-item-sub">
                          {QISM_NAAM[j.qism]} · {j.customers} customers · {j.hissa}%
                        </span>
                      </span>
                    )}
                    <span className="adm-num">{j.kitne}</span>
                    <span className="adm-meter">
                      <i style={{ width: `${Math.max(j.hissa, 2)}%`, background: RANG[j.qism] }} />
                    </span>
                  </div>
                ))}
              </div>
              {topTopic && (
                <p className="adm-hint">
                  Sab se zyada <b>{topTopic.naam}</b> gaya — {topTopic.kitne} dafa.
                </p>
              )}
            </>
          )}
        </Khana>

        <Khana
          id="ai"
          naam="AI kin kaamon mein madad kar raha hai"
          tafseel="AI har message par nahi chalta — sirf jahan lafz kaam na aayein"
          ginti={s.sb.aiCalls24}
        >
          {s.kaam.aiKeKaam.length === 0 ? (
            <p className="adm-khali">
              Pichle 24 ghanton mein AI ki zaroorat hi nahi pari — sab kuch lafzon se chal gaya.
            </p>
          ) : (
            <div className="adm-list">
              {s.kaam.aiKeKaam.map((a, i) => (
                <div className="adm-item" key={i}>
                  <span className="adm-dot" style={{ background: '#8b5cf6' }} aria-hidden />
                  <span className="adm-item-name">{a.kaam}</span>
                  <span className="adm-num">{a.kitne}</span>
                </div>
              ))}
            </div>
          )}
          <p className="adm-hint">
            AI kabhi jawab nahi likhta — wo sirf aap ka topic chunta hai. Jawab hamesha aap ki
            Excel se lafz ba lafz jata hai.
          </p>
        </Khana>

        <Khana
          id="customers"
          naam="Kis customer ko kitne jawab gaye"
          tafseel={`Ek se zyada jawab paane wale customers — ${s.settings.MAX_REPLIES_PER_DAY} par bot khud ruk jata hai`}
          ginti={s.zyadaJawab.length}
          rang={s.hadParLog > 0 ? 'theek' : undefined}
        >
          {s.zyadaJawab.length === 0 ? (
            <p className="adm-khali">
              Har customer ko sirf ek jawab gaya — koi message dohraya nahi gaya.
            </p>
          ) : (
            <div className="adm-list">
              {s.zyadaJawab.map((c, i) => (
                <details className="adm-andar" key={i} data-off={c.kitne >= 4 ? '1' : undefined}>
                  <summary>
                    <span
                      className="adm-dot"
                      style={{
                        background: c.kitne >= 4 ? '#f43f5e' : c.kitne >= 3 ? '#f59e0b' : '#10b981',
                      }}
                      aria-hidden
                    />
                    <span className="adm-item-name">
                      {c.phone}
                      <span className="adm-item-sub">
                        {c.kitne >= 4
                          ? 'rozana ki had par — bot is se aage khamosh ho jata hai'
                          : c.kitne >= 3
                          ? 'thore zyada — ek dafa chat dekh lein'
                          : 'aam baat'}
                      </span>
                      <span className="adm-chips">
                        {c.topicGinti.map((t, n) => (
                          <span className="adm-chip" key={n} data-qism={t.qism}>
                            {t.naam}
                            <i>{t.kitne}</i>
                          </span>
                        ))}
                      </span>
                      <span className="adm-item-sub">
                        Waqt aur poora matan dekhne ke liye click karein
                      </span>
                    </span>
                    <span className="adm-num">{c.kitne}</span>
                  </summary>
                  <div className="adm-andar-list">
                    {c.jawabList.map((j, n) => (
                      <div className="adm-jawab-line" key={n}>
                        <span className="adm-dot" style={{ background: RANG[j.qism] || '#6b7a93' }} aria-hidden />
                        <span className="adm-jawab-naam">
                          {s.topicIds[j.naam] ? (
                            <Link href={`/admin/topics?key=${k}&t=${s.topicIds[j.naam]}#edit`}>
                              {j.naam}
                            </Link>
                          ) : (
                            j.naam
                          )}
                          {j.namuna && <span className="adm-item-sub">{j.namuna}</span>}
                        </span>
                        <span className="adm-jawab-kab">{waqt(j.kab)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </Khana>

        <Khana
          id="raaste"
          naam="Jawab ke raaste"
          tafseel="Do jawab jinhein bot topic ke NAAM se bulata hai"
          ginti={s.raaste.filter((r) => r.mila).length + '/' + s.raaste.length}
          rang={s.raaste.every((r) => r.mila) ? 'acha' : 'bura'}
        >
          <div className="adm-list">
            {s.raaste.map((r, i) => (
              <div className="adm-item" key={i} data-off={r.mila ? undefined : '1'}>
                <span
                  className="adm-dot"
                  style={{ background: r.mila ? '#10b981' : '#f43f5e' }}
                  aria-hidden
                />
                <span className="adm-item-name">
                  {r.kaam}
                  <span className="adm-item-sub">
                    {r.topic} — {r.zariya}
                  </span>
                  {r.jhalak && <span className="adm-item-sub">{r.jhalak}...</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="adm-hint">
            Topic ka naam badal jaye to bot use dhoond nahi payega aur chup chaap purane matan par
            chala jayega. Is liye yahan hara nishan zaroori hai.
          </p>
        </Khana>

        <Khana
          id="echo"
          naam="Aap ke bheje hue message"
          tafseel="Quick reply pehchana gaya ya nahi"
          ginti={s.echo.matanWale}
        >
          <p className="adm-p">
            Ek hi matan 3 ya zyada customers ko jaye to wo <b>quick reply</b> hai aur bot chalta
            rehta hai. Sirf ek customer ko jaye to bot samajhta hai ke aap khud baat kar rahe hain
            aur khamosh ho jata hai.
          </p>
          {s.matanList.length === 0 ? (
            <p className="adm-khali">
              Abhi tak koi matan nahi mila. Ya to koi message bahar nahi gaya, ya Meta par
              smb_message_echoes ka tick nahi laga.
            </p>
          ) : (
            <div className="adm-list">
              {s.matanList.map((m, i) => (
                <div className="adm-item" key={i} data-off={m.quickReply ? undefined : '1'}>
                  <span
                    className="adm-dot"
                    style={{ background: m.quickReply ? '#10b981' : '#f59e0b' }}
                    aria-hidden
                  />
                  <span className="adm-item-name">
                    {m.matan}
                    <span className="adm-item-sub">
                      {m.quickReply
                        ? 'QUICK REPLY — bot chalta rahega'
                        : 'abhi aap ki apni likhai samjha ja raha hai (3 customers par pehchan lega)'}
                    </span>
                  </span>
                  <span className="adm-num">{m.customers}</span>
                </div>
              ))}
            </div>
          )}
          {s.echo.sirfKhabar > 0 && (
            <p className="adm-hint">
              {s.echo.sirfKhabar} message aise the jin ka matan nahi mila (tasveer, ya sirf status
              ki khabar) — in par purana ginti wala tareeqa chalta hai.
            </p>
          )}
        </Khana>

        {s.khamoshi.length > 0 && (
          <Khana
            id="khamoshi"
          naam="Abhi in par bot khamosh hai"
            tafseel="Tracking phir bhi jati rahegi — sirf aam jawab ruke hue hain"
            ginti={s.khamoshi.length}
          >
            <div className="adm-list">
              {s.khamoshi.map((p, i) => (
                <div className="adm-item" key={i}>
                  <span className="adm-item-name">
                    {p.phone}
                    <span className="adm-item-sub">{waqt(p.kabTak)} tak</span>
                  </span>
                </div>
              ))}
            </div>
          </Khana>
        )}

        {s.excel.trackingWale.length > 0 && (
          <Khana
            id="tracking-sawaal"
            naam="Tracking wale sawaal naye sawaalon mein"
            tafseel="Ye tracking ke sawaal lagte hain, lekin naye sawaalon ki list mein chale gaye"
            ginti={s.excel.trackingWale.length}
            rang="theek"
          >
            <p className="adm-p">
              Order ki khabar poochne wale sawaal Excel wali list mein nahi aane chahiyein — un
              ka apna rasta hai. Ye chand sawaal us filter se bach gaye. Do mein se ek kaam karein:
            </p>
            <ul className="adm-nukat">
              <li>
                <b>Tracking mein bhejein</b> — jumla bot ki tracking wali list mein darj ho jata
                hai, is liye aage se aise message pehchane jayenge. Ye behtar hai.
              </li>
              <li>
                <b>Remove</b> — sirf is sawaal ko list se hata dein, bot ko kuch na sikhayein.
              </li>
            </ul>

            <div className="adm-list">
              {s.excel.trackingWale.map((q) => (
                <div className="adm-sawaal" key={q.id} data-order="1">
                  <p className="adm-sawaal-matan">{q.matan}</p>
                  <div className="adm-sawaal-niche">
                    <span className="adm-sawaal-kab">{waqt(q.kab)}</span>

                    <form action="/api/admin/sawaal-action" method="POST" className="adm-sawaal-form">
                      <input type="hidden" name="key" value={adminKey} />
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="matan" value={q.matan} />
                      <input type="hidden" name="kaam" value="tracking" />
                      <button type="submit" className="adm-chota-btn">
                        Tracking mein bhejein
                      </button>
                    </form>

                    <form action="/api/admin/sawaal-action" method="POST" className="adm-sawaal-form">
                      <input type="hidden" name="key" value={adminKey} />
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="matan" value={q.matan} />
                      <input type="hidden" name="kaam" value="hatao" />
                      <button type="submit" className="adm-chota-btn adm-chota-bad">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </Khana>
        )}

        <Khana
          id="safai"
          naam="Sawaalon ki safai"
          tafseel={
            safai.dohre.length
              ? `${safai.dohre.length} sawaal ek se zyada topics mein pade hain`
              : 'Koi sawaal do topics mein nahi — yahan se dhoond kar theek bhi kar sakte hain'
          }
          ginti={safai.dohre.length}
          rang={safai.dohre.length ? 'theek' : 'acha'}
          khula={Boolean(talash) || safai.dohre.length > 0}
        >
          {/* ── Dhoondne wala khana ── */}
          <form method="GET" action="/admin/health" className="adm-talash">
            <input type="hidden" name="key" value={adminKey} />
            <input
              type="text"
              name="q"
              defaultValue={talash}
              className="adm-input"
              placeholder="Koi sawaal dhoondein — jaise: delivery charges"
            />
            <button type="submit" className="adm-btn-go">
              Dhoondein
            </button>
            {talash && (
              <Link href={`/admin/health?key=${k}#safai`} className="adm-btn-ghost">
                Saaf karein
              </Link>
            )}
          </form>

          {talash && (
            <>
              <h3 className="adm-h3">
                &quot;{talash}&quot; — {safai.mile.length} sawaal mile
              </h3>
              {safai.mile.length === 0 ? (
                <p className="adm-khali">Is se milta koi sawaal kisi topic mein nahi hai.</p>
              ) : (
                <div className="adm-list">
                  {safai.mile.map((j, i) => (
                    <SawaalRow
                      key={j.topicId + i}
                      j={j}
                      topics={safai.topics}
                      adminKey={adminKey}
                      talash={talash}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Ek hi sawaal, kai topics ── */}
          <h3 className="adm-h3">Ek hi sawaal, kai topics</h3>
          <p className="adm-p">
            Jab ek hi sawaal do topics mein pada ho to bot ka milan batt jata hai aur kabhi ghalat
            topic jeet jata hai. Jis topic mein us ka kaam nahi, wahan se nikaal dein.
          </p>

          {safai.dohre.length === 0 ? (
            <p className="adm-khali">
              Koi sawaal do topics mein nahi mila — {safai.kulSawaal} chalu sawaal saaf hain.
            </p>
          ) : (
            safai.dohre.map((d) => (
              <div className="adm-dohra" key={d.key}>
                <p className="adm-sawaal-matan">{d.matan}</p>
                <span className="adm-item-sub">
                  {d.jagahein.length} topics mein maujood hai — ek rakhein, baqi se nikaal dein
                </span>
                <div className="adm-list" style={{ marginTop: 8 }}>
                  {d.jagahein.map((j, i) => (
                    <SawaalRow
                      key={j.topicId + i}
                      j={j}
                      topics={safai.topics}
                      adminKey={adminKey}
                      talash={talash}
                    />
                  ))}
                </div>
              </div>
            ))
          )}

          <p className="adm-hint">
            Kul chalu sawaal: <b>{safai.kulSawaal}</b>. Naye sawaal har hafte AI khud parh kar
            tajweez banata hai — wo{' '}
            <Link className="adm-a" href={`/admin/qna?key=${k}`}>
              Dashboard
            </Link>{' '}
            par approve hote hain.
          </p>
        </Khana>

        <Khana
          id="safar"
          naam="Rozana ka safar"
          tafseel="Har din ka natija — har raat khud mehfooz hota hai"
          ginti={s.safar.length}
        >
          {s.safar.length === 0 ? (
            <p className="adm-khali">
              Abhi koi din mehfooz nahi hua. Pehla hisaab aaj raat 11:45 (Pakistan ka waqt) par
              banega, phir har raat.
            </p>
          ) : (
            <div className="adm-list">
              {s.safar.map((d) => (
                <div className="adm-item" key={d.din}>
                  <span className="adm-item-name">
                    {new Date(d.din + 'T00:00:00Z').toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      timeZone: 'UTC',
                    })}
                    <span className="adm-item-sub">
                      {d.jawab} jawab · {d.customers} customers
                    </span>
                  </span>
                  <span className="adm-num" style={{ color: RANG_DARJA[gradeKa(d.fisad)] }}>
                    {d.fisad}%
                  </span>
                  <span className="adm-meter">
                    <i
                      style={{
                        width: `${Math.max(d.fisad, 2)}%`,
                        background: RANG_DARJA[gradeKa(d.fisad)],
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="adm-hint">
            Ye hisaab har raat khud mehfooz hota hai, is liye aap jab bhi aayein — guzre hue din
            saamne hote hain.
          </p>
        </Khana>

        <Khana
          id="nizam"
          naam="Nizam ka andar ka haal"
          tafseel="Supabase ki tables aur settings — aam taur par haath lagane ki zaroorat nahi"
          ginti={Object.keys(s.tables).length}
          rang={Object.values(s.tables).every((t) => t.thik) ? 'acha' : 'bura'}
        >
          <h3 className="adm-h3">Naye khane</h3>
          <div className="adm-mini">
            {Object.entries(s.nayeKhane).map(([naam, ok]) => (
              <div key={naam}>
                <b style={{ color: ok ? '#10b981' : '#f43f5e' }}>{ok ? 'OK' : 'NAHI'}</b>
                <span>{naam}</span>
              </div>
            ))}
          </div>

          <h3 className="adm-h3">Tables</h3>
          <div className="adm-mini">
            {Object.entries(s.tables).map(([naam, t]) => (
              <div key={naam}>
                <b style={{ color: t.thik ? undefined : '#f43f5e' }}>
                  {t.thik ? t.rows.toLocaleString('en-US') : 'KHATA'}
                </b>
                <span>{naam}</span>
              </div>
            ))}
          </div>

          <h3 className="adm-h3">Settings</h3>
          <div className="adm-mini">
            {Object.entries(s.settings).map(([naam, val]) => (
              <div key={naam}>
                <b>{String(val)}</b>
                <span>{naam}</span>
              </div>
            ))}
          </div>
        </Khana>

        <p className="adm-foot">
          Sab kuch JSON mein chahiye to{' '}
          <a className="adm-a" href={`/api/admin/health?key=${k}`} target="_blank" rel="noreferrer">
            /api/admin/health
          </a>
        </p>
      </div>
    </main>
  )
}
