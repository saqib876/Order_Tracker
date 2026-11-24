/**
 * Safha khulte waqt jo nazar aata hai.
 *
 * Ye safhay har dafa database se taza hisaab lagate hain, is liye khulne
 * mein ek lamha lagta hai. Us dauran screen par kuch na badle to lagta hai
 * ke click hua hi nahi.
 *
 * Pehle yahan bare bare khali dabbe blink karte the — dekhne mein bhaddi
 * lagti thi. Ab dhancha asli safhe jaisa hai (upar ka haal, paanch chhote
 * paimane, aur band sections ki pattiyan) aur un par ek halki si roshni
 * guzarti hai. Is tarah intezaar bhara hua lagta hai, khali nahi.
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
            <span className="adm-sk adm-sk-pill" />
          </span>
        </nav>

        {/* Upar ka unwan */}
        <div className="adm-sk adm-sk-title" />
        <div className="adm-sk adm-sk-sub" />

        {/* Bara wala haal — bayein taraf number, dayein taraf do lines */}
        <div className="adm-sk-hero">
          <div className="adm-sk adm-sk-score" />
          <div className="adm-sk-hero-text">
            <div className="adm-sk adm-sk-line adm-sk-line-1" />
            <div className="adm-sk adm-sk-line adm-sk-line-2" />
          </div>
        </div>

        {/* Paanch paimane */}
        <div className="adm-sk-grid">
          <div className="adm-sk adm-sk-card" />
          <div className="adm-sk adm-sk-card" />
          <div className="adm-sk adm-sk-card" />
          <div className="adm-sk adm-sk-card" />
          <div className="adm-sk adm-sk-card" />
        </div>

        {/* Band pare hue sections */}
        <div className="adm-sk adm-sk-strip" />
        <div className="adm-sk adm-sk-strip" />
        <div className="adm-sk adm-sk-strip" />

        <p className="adm-sk-keh">
          <span className="adm-sk-ghoom" aria-hidden />
          Taza hisaab lagaya ja raha hai...
        </p>
      </div>
    </main>
  )
}
