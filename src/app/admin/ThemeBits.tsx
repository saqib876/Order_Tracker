/**
 * Dark / Light ka switch — bina kisi bhari library ke, bina client component.
 *
 * Tareeqa
 * -------
 * Script safhe ke shuru mein chalti hai aur <html> par hamesha SAAF SAAF
 * data-theme="light" ya "dark" laga deti hai — aap ka pichhla faisla, warna
 * system ki apni setting. Is se CSS mein rangon ka ghar sirf EK jagah
 * likhna parta hai (dupliceting nahi), aur ek lamhe ke liye bhi ghalat rang
 * nahi jhalakta kyunki ye paint se pehle chal jati hai.
 *
 * Aap ne khud kuch na chuna ho to system ki setting badalne par roop bhi
 * khud badal jata hai.
 */

const SCRIPT = [
  '(function(){',
  'var KEY="myzan-theme";',
  'var d=document.documentElement;',
  'var mq=window.matchMedia("(prefers-color-scheme: light)");',
  'function lagao(t){d.setAttribute("data-theme",t)}',
  'function chuna(){try{var t=localStorage.getItem(KEY);return t==="light"||t==="dark"?t:""}catch(e){return ""}}',
  // 1) Foran — paint se pehle
  'lagao(chuna()||(mq.matches?"light":"dark"));',
  // 2) System badle aur aap ne khud kuch na chuna ho to sath hi badal jaye
  'try{mq.addEventListener("change",function(e){if(!chuna()){lagao(e.matches?"light":"dark")}})}catch(e){}',
  // 3) Button ka click — document par ek hi listener
  'document.addEventListener("click",function(e){',
  'var b=e.target&&e.target.closest?e.target.closest("#roopBtn"):null;',
  'if(!b)return;',
  'try{',
  'var naya=d.getAttribute("data-theme")==="light"?"dark":"light";',
  'lagao(naya);',
  'localStorage.setItem(KEY,naya);',
  '}catch(err){}',
  '});',
  '})()',
].join('')

export function ThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      id="roopBtn"
      className="adm-theme"
      aria-label="Dark ya Light"
      title="Dark ya Light"
    >
      <span className="moon">&#9789;</span>
      <span className="sun">&#9728;</span>
    </button>
  )
}
