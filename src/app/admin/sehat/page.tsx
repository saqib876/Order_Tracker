/**
 * Bot ki Sehat — /admin/sehat?key=ADMIN_KEY
 *
 * Ek nazar mein pata chal jata hai ke sab theek chal raha hai ya nahi:
 *   - har cheez ka hara / laal nishan
 *   - AAJ kaun sa jawab kitni dafa gaya (sab se zaroori hissa)
 *   - aap ka quick reply bot ne pehchana ya nahi
 *   - Excel ki list saaf hai ya nahi
 *
 * Ye safha koi message nahi bhejta aur AI ko call nahi karta — sirf dekhta
 * hai. Jitni dafa marzi kholein.
 */

import { unstable_noStore as noStore } from 'next/cache'
import Link from 'next/link'
import { sehatLo } from '@/lib/sehat'
import { ThemeBoot, ThemeToggle } from '../ThemeBits'
import '../admin.css'

export const dynamic = 'force-dynamic'

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

export default async function SehatPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  // Har dafa taza data - Next ka koi cache beech mein na aaye
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
            <code>/admin/sehat?key=YOUR_ADMIN_KEY</code>
          </p>
        </div>
      </main>
    )
  }

  const s = await sehatLo()
  const k = encodeURIComponent(adminKey)

  const sabTheek = s.khulasa.every((x) => x.theek)
  const topTopic = s.jawabBreakdown[0]

  const waqtLocal = new Date(s.waqt).toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour12: true,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

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
            <Link href={`/admin/sehat?key=${k}`} data-on="1">
              Sehat
            </Link>
            <ThemeToggle />
          </span>
        </nav>

        <h1 className="adm-title">Bot ki Sehat</h1>
        <p className="adm-sub">
          {waqtLocal} tak ka haal (Pakistan ka waqt) — ye safha koi message nahi bhejta.
        </p>

        {/* ── Sab se upar: hara ya laal ───────────────────────────────── */}
        <div className="adm-card" data-tone={sabTheek ? 'new' : 'quiet'}>
          <div className="adm-card-top">
            <h2 className="adm-h2">{sabTheek ? 'Sab theek chal raha hai' : 'Dekhne wali baatein'}</h2>
            <a className="adm-btn-ghost" href={`/admin/sehat?key=${k}&t=${Date.now()}`}>
              Dobara check karein
            </a>
          </div>
          <div className="adm-list adm-khulasa">
            {s.khulasa.map((x, i) => (
              <div className="adm-item" key={i} data-off={x.theek ? undefined : '1'}>
                <span
                  className="adm-dot"
                  style={{ background: x.theek ? '#10b981' : '#f43f5e' }}
                  aria-hidden
                />
                <span className="adm-item-name" style={{ fontWeight: 500 }}>
                  {x.baat}
                </span>
              </div>
            ))}
          </div>
        </div>

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

        {/* ── ASAL CHEEZ: kaun sa jawab kitni dafa gaya ────────────────── */}
        <div className="adm-sec">
          <div className="adm-sec-head">
            <h2>Aaj kaun sa jawab kitni dafa gaya</h2>
            <p>
              Pichle 24 ghante ke <b>{s.sb.jawab24}</b> jawab — kis topic ke, kitne customers ko.
              Koi faltu jawab ja raha ho to yahin nazar aa jayega.
            </p>
            <span className="adm-sec-n">{s.jawabBreakdown.length}</span>
          </div>

          {s.jawabBreakdown.length === 0 ? (
            <p className="adm-khali">Pichle 24 ghante mein koi jawab nahi gaya.</p>
          ) : (
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
          )}

          {topTopic && (
            <p className="adm-hint">
              Sab se zyada <b>{topTopic.naam}</b> gaya — {topTopic.kitne} dafa, yaani har{' '}
              {Math.max(1, Math.round(100 / Math.max(topTopic.hissa, 1)))} mein se ek jawab.
            </p>
          )}
        </div>

        {/* Jawab ke raaste */}
        <div className="adm-sec">
          <div className="adm-sec-head">
            <h2>Jawab ke raaste</h2>
            <p>
              Ye do jawab customer ke alfaz se nahi chune jate — bot inhein naam se bulata hai.
              Topic ka naam theek hona zaroori hai, warna bot purane matan par chala jata hai.
            </p>
            <span className="adm-sec-n">{s.raaste.length}</span>
          </div>
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
        </div>

        {/* Kis customer ko kitne jawab */}
        <div className="adm-sec">
          <div className="adm-sec-head">
            <h2>Kis customer ko kitne jawab gaye</h2>
            <p>
              Aam tor par ek customer ko ek ya do jawab jate hain. Kisi ko{' '}
              <b>{s.settings.MAX_REPLIES_PER_DAY}</b> ya us se zyada chale jayein to bot khud ruk
              jata hai. Yahan sirf wo customers hain jin ko ek se zyada jawab gaye.
            </p>
            <span className="adm-sec-n">{s.zyadaJawab.length}</span>
          </div>

          {s.zyadaJawab.length === 0 ? (
            <p className="adm-khali">
              Har customer ko sirf ek jawab gaya - koi message dohraya nahi gaya.
            </p>
          ) : (
            <div className="adm-list">
              {s.zyadaJawab.map((c, i) => (
                <div className="adm-item" key={i} data-off={c.kitne >= 4 ? '1' : undefined}>
                  <span
                    className="adm-dot"
                    style={{ background: c.kitne >= 4 ? '#f43f5e' : c.kitne >= 3 ? '#f59e0b' : '#10b981' }}
                    aria-hidden
                  />
                  <span className="adm-item-name">
                    {c.phone}
                    <span className="adm-item-sub">
                      {c.kitne >= 4
                        ? 'rozana ki had par - bot is se aage khamosh ho jata hai'
                        : c.kitne >= 3
                        ? 'thore zyada - ek dafa chat dekh lein'
                        : 'aam baat'}
                    </span>
                  </span>
                  <span className="adm-num">{c.kitne}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Aap ke apne bheje message ────────────────────────────────── */}
        <div className="adm-sec">
          <div className="adm-sec-head">
            <h2>Aap ke bheje hue message</h2>
            <p>
              Bot un ka matan dekh kar faisla karta hai: ek hi matan 3 ya zyada customers ko jaye to
              wo <b>quick reply</b> hai aur bot chalta rehta hai. Sirf ek customer ko jaye to bot
              samajhta hai ke aap khud baat kar rahe hain aur khamosh ho jata hai.
            </p>
            <span className="adm-sec-n">{s.echo.matanWale}</span>
          </div>

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
                        : `abhi aap ki apni likhai samjha ja raha hai (3 customers par pehchan lega)`}
                    </span>
                  </span>
                  <span className="adm-num">{m.customers}</span>
                </div>
              ))}
            </div>
          )}

          {s.echo.sirfKhabar > 0 && (
            <p className="adm-hint">
              {s.echo.sirfKhabar} message aise the jin ka matan nahi mila (tasveer, ya sirf status ki
              khabar) — in par purana ginti wala tareeqa chalta hai.
            </p>
          )}
        </div>

        {/* ── Abhi khamoshi kis par ────────────────────────────────────── */}
        {s.khamoshi.length > 0 && (
          <div className="adm-sec">
            <div className="adm-sec-head">
              <h2>Abhi in par bot khamosh hai</h2>
              <p>Tracking phir bhi jati rahegi — sirf aam jawab ruke hue hain.</p>
              <span className="adm-sec-n">{s.khamoshi.length}</span>
            </div>
            <div className="adm-list">
              {s.khamoshi.map((p, i) => (
                <div className="adm-item" key={i}>
                  <span className="adm-item-name">
                    {p.phone}
                    <span className="adm-item-sub">
                      {new Date(p.kabTak).toLocaleString('en-GB', {
                        timeZone: 'Asia/Karachi',
                        hour12: true,
                        hour: '2-digit',
                        minute: '2-digit',
                        day: '2-digit',
                        month: 'short',
                      })}{' '}
                      tak
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Excel ki list ────────────────────────────────────────────── */}
        <div className="adm-card" data-tone={s.excel.orderWale ? 'quiet' : 'new'}>
          <div className="adm-card-top">
            <h2 className="adm-h2">Excel ki list saaf hai?</h2>
            <Link className="adm-btn-ghost" href={`/admin/qna?key=${k}`}>
              Naye sawaal dekhein
            </Link>
          </div>
          <p className="adm-p">
            Pichle 7 din ke <b>{s.excel.parkhe}</b> naye sawaal parhe —{' '}
            {s.excel.orderWale === 0 ? (
              <>in mein <b>ek bhi</b> order tracking wala nahi. List saaf hai.</>
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
            <b>{s.tables['unmatched_messages']?.rows ?? 0}</b> — in par AI ki tajweez chalayein to
            bot aur zyada sawaal samajhne lagega.
          </p>
        </div>

        {/* ── Nizam ka andar ka haal ───────────────────────────────────── */}
        <div className="adm-sec">
          <div className="adm-sec-head">
            <h2>Nizam ka andar ka haal</h2>
            <p>Supabase ki tables aur settings — in ko aam taur par haath lagane ki zaroorat nahi.</p>
          </div>

          <div className="adm-mini">
            {Object.entries(s.nayeKhane).map(([naam, ok]) => (
              <div key={naam}>
                <b style={{ color: ok ? '#10b981' : '#f43f5e' }}>{ok ? 'OK' : 'NAHI'}</b>
                <span>{naam}</span>
              </div>
            ))}
          </div>

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

          <div className="adm-mini">
            {Object.entries(s.settings).map(([naam, val]) => (
              <div key={naam}>
                <b>{String(val)}</b>
                <span>{naam}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="adm-foot">
          Sab kuch JSON mein chahiye to{' '}
          <a className="adm-a" href={`/api/admin/sehat?key=${k}`} target="_blank" rel="noreferrer">
            /api/admin/sehat
          </a>
        </p>
      </div>
    </main>
  )
}
