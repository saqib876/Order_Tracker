/**
 * Safha khulte waqt jo nazar aata hai.
 *
 * Ye safhay har dafa database se taza data late hain, is liye khulne mein
 * ek lamha lagta hai. Pehle us dauran screen par kuch nahi badalta tha —
 * lagta tha ke click hua hi nahi, aur user dobara daba deta tha.
 *
 * Ab click karte hi ye dikh jata hai: patti, unwan, aur khali dabbe. Us ke
 * baad asli safha un ki jagah le leta hai.
 */

import './admin.css'

export default function Loading() {
  return (
    <main className="adm">
      <div className="adm-wrap">
        <nav className="adm-bar adm-in">
          <span className="adm-brand">
            <span className="adm-cube">
              <i />
            </span>
            Myzan Bot
          </span>
          <span className="adm-nav">
            <span className="adm-loading-pill" />
          </span>
        </nav>

        <div className="adm-skel adm-skel-title" />
        <div className="adm-skel adm-skel-sub" />

        <div className="adm-stats">
          <div className="adm-stat adm-skel-box" />
          <div className="adm-stat adm-skel-box" />
          <div className="adm-stat adm-skel-box" />
          <div className="adm-stat adm-skel-box" />
        </div>

        <div className="adm-skel adm-skel-row" />
        <div className="adm-skel adm-skel-row" />
        <div className="adm-skel adm-skel-row" />

        <p className="adm-hint" style={{ marginTop: 14 }}>
          Taza hisaab lagaya ja raha hai...
        </p>
      </div>
    </main>
  )
}
