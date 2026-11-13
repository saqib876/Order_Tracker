/**
 * Dashboard — /admin/qna?key=ADMIN_KEY
 *
 * Pehle yahan Excel download/upload hota tha. Ab wo kaam AI karta hai:
 * hafte mein ek dafa wo un messages ko parhta hai jin ka bot jawab nahi de
 * saka, aur TAJWEEZ deta hai — "ye sawaal is topic mein daal dein", ya "ye
 * naya topic bana lein".
 *
 * Aap ka kaam sirf itna: tick lagayein aur Approve. Naye topic ka jawab
 * wahin likh dein. Kuch bhi apne aap live nahi hota.
 *
 * Excel ab sirf BACKUP ke liye hai.
 */

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { aiProvider, aiMode, aiModel, aiAvailable, aajKiGinti } from '@/lib/aiTopic'
import { ThemeBoot, ThemeToggle } from '../ThemeBits'
import '../admin.css'

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
            <code>/admin/qna?key=YOUR_ADMIN_KEY</code>
          </p>
        </div>
      </main>
    )
  }

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: topics } = await supabaseAdmin
    .from('qna_topics')
    .select('topic, questions, is_active')
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

  // ── AI ka istemal: aaj, hafta, mahina ───────────────────────────────────
  // Google ka apna safha kabhi der se update hota hai, is liye apna hisaab
  // bhi rakhte hain — ye ai_call_log se seedha aata hai.
  const kabSe = (din: number) =>
    new Date(Date.now() - din * 24 * 3600 * 1000).toISOString()

  const callGinti = async (din: number) => {
    const { count } = await supabaseAdmin
      .from('ai_call_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', kabSe(din))
    return count || 0
  }

  const [aiHafta, aiMahina, cacheCount] = aiOn
    ? await Promise.all([
        callGinti(7),
        callGinti(30),
        supabaseAdmin
          .from('ai_topic_cache')
          .select('message_hash', { count: 'exact', head: true })
          .then((r) => r.count || 0),
      ])
    : [0, 0, 0]

  // Roz ka ausat — isi se andaza hota hai ke Google ki hadd ke kitne kareeb hain
  const rozAusat = Math.round(aiMahina / 30)

  const chalu = (topics || []).filter((t) => t.is_active)
  const totalQuestions = chalu.reduce(
    (a, t) =>
      a +
      String(t.questions || '')
        .split(/\r?\n/)
        .filter((x) => x.trim()).length,
    0
  )

  const exportUrl = `/api/admin/qna-export?key=${encodeURIComponent(adminKey)}&peek=1`
  const topicsHref = `/admin/topics?key=${encodeURIComponent(adminKey)}`

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
            <Link href={`/admin/qna?key=${encodeURIComponent(adminKey)}`} data-on="1">
              Dashboard
            </Link>
            <Link href={topicsHref}>Topics</Link>
            <Link href={`/admin/review?key=${encodeURIComponent(adminKey)}`}>Review</Link>
            <a href={`/api/admin/sehat?key=${encodeURIComponent(adminKey)}`} target="_blank" rel="noreferrer">
              Sehat
            </a>
            <ThemeToggle />
          </span>
        </nav>

        <h1 className="adm-title">Q&amp;A Control</h1>
        <p className="adm-sub">
          AI har hafte naye sawaal parh kar tajweez deta hai — aap sirf haan ya nahi karte hain.
        </p>

        {/* Ginti */}
        <div className="adm-stats">
          <div className="adm-stat">
            <b>{chalu.length}</b>
            <span>CHALU TOPICS</span>
          </div>
          <div className="adm-stat">
            <b>{totalQuestions}</b>
            <span>SAWAAL BANK MEIN</span>
          </div>
          <div className="adm-stat">
            <b>{suggestions.length}</b>
            <span>TAJWEEZ QATAR MEIN</span>
          </div>
          <div className="adm-stat">
            <b>{aiAaj}</b>
            <span>AAJ AI SE POOCHA</span>
          </div>
        </div>

        {/* Pichhle kaam ka natija */}
        {(one('banay') || one('juray') || one('radd') || one('chala') || one('ruke') || one('kuch')) && (
          <div className="adm-flash">
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
        <section className="adm-card adm-in" data-tone="ai">
          <h2 className="adm-h2">Message samajhne wala AI</h2>
          {aiOn ? (
            <>
            <p className="adm-p" style={{ margin: 0 }}>
              <span className="adm-badge" data-tone="on">
                CHALU
              </span>{' '}
              {aiProvider()} · <code>{aiModel()}</code> · andaz: {aiMode()}
              <br />
              <span className="adm-hint">
                AI khud jawab nahi likhta — wo sirf batata hai ke baat kis topic ki hai, aur jawab
                aap ka likha hua lafz ba lafz jata hai.
              </span>
            </p>

            <div className="adm-mini">
              <div>
                <b>{aiAaj}</b>
                <span>AAJ · hadd {aiHadd}</span>
              </div>
              <div>
                <b>{aiHafta}</b>
                <span>PICHHLE 7 DIN</span>
              </div>
              <div>
                <b>{aiMahina}</b>
                <span>PICHHLE 30 DIN</span>
              </div>
              <div>
                <b>{rozAusat}</b>
                <span>ROZ KA AUSAT</span>
              </div>
              <div>
                <b>{cacheCount}</b>
                <span>JUMLE YAAD · dobara nahi pucha jata</span>
              </div>
            </div>

            <p className="adm-hint">
              Google ki apni ginti aur limits:{' '}
              <a
                href="https://aistudio.google.com/usage"
                target="_blank"
                rel="noreferrer"
                className="adm-a"
              >
                aistudio.google.com/usage
              </a>{' '}
              — wahan “Rate limit” wale tab mein RPM / TPM / RPD dikhte hain. Limit project par
              lagti hai, key par nahi.
            </p>
            </>
          ) : (
            <p className="adm-p" style={{ margin: 0 }}>
              <span className="adm-badge" data-tone="off">
                BAND
              </span>{' '}
              Bot sirf lafz gin kar jawab dhoondta hai.
              <br />
              <span className="adm-hint">
                Chalu karne ke liye Vercel mein <code>GEMINI_API_KEY</code> daalein.
              </span>
            </p>
          )}
        </section>

        {/* ── AI ki tajweez ────────────────────────────────────────────── */}
        <h2 className="adm-h3" style={{ fontSize: 19, marginTop: 30 }}>
          AI ki tajweez{' '}
          {suggestions.length > 0 && (
            <span className="adm-badge" data-tone="count">
              {suggestions.length}
            </span>
          )}
        </h2>

        {sugError && (
          <p className="adm-error">
            Tajweez wali table abhi nahi bani: {sugError.message}
            <br />
            Supabase mein <code>qna_suggestions</code> table banana baqi hai.
          </p>
        )}

        {!sugError && suggestions.length === 0 && (
          <div className="adm-card" data-tone="quiet">
            <p className="adm-p">
              Abhi koi tajweez nahi. AI har <b>Itwar ki subah</b> khud chalta hai aur jo naye sawaal
              samajh mein aate hain un ki tajweez yahan rakh deta hai.
              {pendingCount ? <> Qatar mein abhi {pendingCount} naye sawaal hain.</> : null}
            </p>
            <form action="/api/admin/qna-suggest" method="POST">
              <input type="hidden" name="key" value={adminKey} />
              <input type="hidden" name="days" value="7" />
              <button type="submit" className="adm-btn-go">
                Abhi chalao
              </button>
            </form>
            <p className="adm-hint">
              Ek dafa chalane mein 1-2 minute lag sakte hain — safha khulne ka intezaar karein.
            </p>
          </div>
        )}

        {suggestions.length > 0 && (
          <form action="/api/admin/qna-approve" method="POST">
            <input type="hidden" name="key" value={adminKey} />

            <div className="adm-toolbar">
              <label className="adm-check" style={{ margin: 0, fontWeight: 700 }}>
                <input type="checkbox" id="sabSelect" className="adm-cb" />
                <span>Sab select karein</span>
              </label>
              <span className="adm-hint" style={{ margin: 0 }}>
                Tick lagayein, phir neeche <b>Approve</b> ya <b>Radd</b>
              </span>
            </div>

            {nayeTopics.length > 0 && (
              <>
                <h3 className="adm-h3">Naye topic ban sakte hain ({nayeTopics.length})</h3>
                <p className="adm-hint" style={{ marginBottom: 10 }}>
                  In par customers ne baar baar sawaal kiya hai lekin aap ka koi topic nahi. Jawab
                  likh kar tick lagayein — topic foran live ho jayega.
                </p>
                {nayeTopics.map((x) => (
                  <div key={x.id} className="adm-card" data-tone="new">
                    <label className="adm-check" style={{ marginTop: 0 }}>
                      <input type="checkbox" name="pick" value={x.id} className="adm-cb pick" />
                      <span className="adm-item-name" style={{ color: 'var(--ink)' }}>
                        {x.topic}
                      </span>
                      <span className="adm-item-n">{x.ask_count} dafa poocha gaya</span>
                    </label>
                    <div className="adm-q">
                      {x.questions.map((q, i) => (
                        <div key={i}>{q}</div>
                      ))}
                    </div>
                    <label className="adm-label">
                      Is topic ka jawab — lafz ba lafz customer ko jayega
                      <textarea
                        name={`ans_${x.id}`}
                        rows={4}
                        className="adm-area"
                        placeholder="Yahan jawab likhein…"
                      />
                    </label>
                  </div>
                ))}
              </>
            )}

            {nayeSawaal.length > 0 && (
              <>
                <h3 className="adm-h3">Purane topics mein naye sawaal ({nayeSawaal.length})</h3>
                <p className="adm-hint" style={{ marginBottom: 10 }}>
                  Ye jumle customers ne apne andaz mein likhe the. Topic mein jur gaye to agli dafa
                  bot inhein <b>lafzon se hi</b> pehchan lega — AI ki zaroorat nahi, yani muft aur
                  foran.
                </p>
                {nayeSawaal.map((x) => (
                  <div key={x.id} className="adm-card">
                    <label className="adm-check" style={{ marginTop: 0 }}>
                      <input type="checkbox" name="pick" value={x.id} className="adm-cb pick" />
                      <span className="adm-item-name" style={{ color: 'var(--ink)' }}>
                        {x.topic}
                      </span>
                      <span className="adm-item-n">
                        +{x.questions.length} sawaal · {x.ask_count} dafa
                      </span>
                    </label>
                    <div className="adm-q">
                      {x.questions.map((q, i) => (
                        <div key={i}>{q}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="adm-btn-row">
              <button type="submit" name="faisla" value="approve" className="adm-btn-go">
                Chune hue Approve karein
              </button>
              <button type="submit" name="faisla" value="reject" className="adm-btn-ghost">
                Chune hue Radd karein
              </button>
            </div>
            <p className="adm-hint">
              <b>Radd</b> ka matlab hamesha ke liye — wo baatein aainda kabhi tajweez nahi hongi.
            </p>
          </form>
        )}

        {suggestions.length > 0 && (
          <form action="/api/admin/qna-suggest" method="POST" style={{ marginTop: 18 }}>
            <input type="hidden" name="key" value={adminKey} />
            <input type="hidden" name="days" value="7" />
            <button type="submit" className="adm-btn-ghost">
              AI ko dobara chalao
            </button>
          </form>
        )}

        {/* ── Topics ka rasta ──────────────────────────────────────────── */}
        <section className="adm-card adm-in" style={{ marginTop: 30 }}>
          <h2 className="adm-h2">Topics</h2>
          <p className="adm-p">
            {chalu.length} topics chalu hain. Kisi bhi topic ko khol kar dekh sakte hain ke us mein
            kaun se sawaal hain, jawab kya hai — aur wahin badal ya ON/OFF kar sakte hain.
          </p>
          <Link href={topicsHref} className="adm-btn">
            Topics dekhein / badlein →
          </Link>
        </section>

        {/* ── Backup ───────────────────────────────────────────────────── */}
        <section className="adm-card adm-in" data-tone="quiet">
          <h2 className="adm-h2">Backup — Excel download</h2>
          <p className="adm-p">
            Poora Q&amp;A bank aur qatar wale sawaal ek file mein. Kabhi data zaya ho jaye to is
            file se wapas banaya ja sakta hai. <b>Download karne se kuch badalta nahi</b> — ye sirf
            nakal hai.
          </p>
          <a href={exportUrl} className="adm-btn">
            Excel download karein
          </a>
          <p className="adm-hint">Mahine mein ek dafa download kar ke apne paas rakh lein.</p>
        </section>

        <p className="adm-foot">Myzan WhatsApp Bot · Q&amp;A Control</p>
      </div>

      {/* "Sab select karein" — chhota sa kaam, chhota sa script */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "var sa=document.getElementById('sabSelect');" +
            "if(sa){sa.addEventListener('change',function(e){" +
            "var on=e.target.checked,all=document.querySelectorAll('.pick');" +
            "for(var i=0;i<all.length;i++){all[i].checked=on}})}",
        }}
      />
    </main>
  )
}
