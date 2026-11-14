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
  naam,
  tafseel,
  ginti,
  rang,
  khula,
  children,
}: {
  naam: string
  tafseel: string
  ginti?: number | string
  rang?: 'acha' | 'theek' | 'bura'
  khula?: boolean
  children: ReactNode
}) {
  return (
    <details className="adm-fold" open={khula} data-grade={rang}>
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

  const s = await sehatLo()
  const k = encodeURIComponent(adminKey)

  const masle = s.khulasa.filter((x) => !x.theek)
  const topTopic = s.jawabBreakdown[0]
  const anjaanKul = s.jawabBreakdown.find((j) => j.qism === 'anjaan')?.kitne || 0

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
            {s.kaam.faisle === 0 && (
              <p className="adm-hint">
                Abhi koi faisla darj nahi hua — roznamcha naye messages se bharta hai.
              </p>
            )}
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
              {masle.map((x, i) => (
                <div className="adm-item" key={i} data-off="1">
                  <span className="adm-dot" style={{ background: '#f43f5e' }} aria-hidden />
                  <span className="adm-item-name" style={{ fontWeight: 500 }}>
                    {x.baat}
                  </span>
                </div>
              ))}
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
            naam="Pehchana nahi gaya"
            tafseel="Ye jawab kisi maujooda topic se nahi milte — sab se pehle yahi dekhein"
            ginti={anjaanKul}
            rang="bura"
            khula
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
                    <span className="adm-item-name">
                      {j.naam}
                      <span className="adm-item-sub">
                        {QISM_NAAM[j.qism]} · {j.customers} customers · {j.hissa}%
                      </span>
                    </span>
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
                <div className="adm-item" key={i} data-off={c.kitne >= 4 ? '1' : undefined}>
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
                  </span>
                  <span className="adm-num">{c.kitne}</span>
                </div>
              ))}
            </div>
          )}
        </Khana>

        <Khana
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

        <Khana
          naam="Excel ki list"
          tafseel={
            s.excel.orderWale === 0
              ? 'Saaf hai — koi order tracking wala sawaal nahi'
              : `${s.excel.orderWale} sawaal ab bhi order tracking wale lag rahe hain`
          }
          ginti={s.sb.naySawaal24}
          rang={s.excel.orderWale === 0 ? 'acha' : 'theek'}
        >
          <p className="adm-p">
            Pichle 7 din ke <b>{s.excel.parkhe}</b> naye sawaal parhe —{' '}
            {s.excel.orderWale === 0 ? (
              <>
                in mein <b>ek bhi</b> order tracking wala nahi.
              </>
            ) : (
              <>
                in mein <b>{s.excel.orderWale}</b> ab bhi order tracking wale lag rahe hain.
              </>
            )}
          </p>
          {s.excel.namune.length > 0 && (
            <div className="adm-list">
              {s.excel.namune.map((t, i) => (
                <div className="adm-item" key={i} data-off="1">
                  <span className="adm-item-name">{t}</span>
                </div>
              ))}
            </div>
          )}
          <p className="adm-hint">
            Aaj ke naye sawaal: <b>{s.sb.naySawaal24}</b> · Jama shuda kul:{' '}
            <b>{s.tables['unmatched_messages']?.rows ?? 0}</b> —{' '}
            <Link className="adm-a" href={`/admin/qna?key=${k}`}>
              in par AI ki tajweez chalayein
            </Link>
          </p>
        </Khana>

        <Khana
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
