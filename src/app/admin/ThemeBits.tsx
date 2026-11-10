/**
 * Dark / Light ka switch — bina kisi bhari library ke, bina client component.
 *
 * Do tukde hain:
 *
 *   <ThemeBoot />   safhe ke shuru mein. Paint se PEHLE chal kar aap ka
 *                   pichhla faisla <html data-theme> par laga deta hai —
 *                   warna ek lamhe ke liye ghalat rang jhalakta hai. Yahi
 *                   script button ka click bhi sunti hai (document par ek
 *                   hi listener, is liye koi client component nahi chahiye).
 *
 *   <ThemeToggle /> oopar ki patti ka chhota button.
 *
 * Kuch na chuna ho to system ki apni setting chalti hai — wo CSS mein
 * prefers-color-scheme se hoti hai.
 */

const SCRIPT = [
  '(function(){',
  'var KEY="myzan-theme";',
  'function lagao(t){document.documentElement.setAttribute("data-theme",t)}',
  // 1) Pichhla faisla — foran, paint se pehle
  'try{var t=localStorage.getItem(KEY);if(t==="light"||t==="dark"){lagao(t)}}catch(e){}',
  // 2) Button ka click — document par ek hi listener
  'document.addEventListener("click",function(e){',
  'var b=e.target&&e.target.closest?e.target.closest("#roopBtn"):null;',
  'if(!b)return;',
  'try{',
  'var d=document.documentElement;',
  'var ab=d.getAttribute("data-theme");',
  'if(!ab){ab=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}',
  'var naya=ab==="dark"?"light":"dark";',
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
    <button type="button" id="roopBtn" className="adm-theme" aria-label="Dark ya Light" title="Dark ya Light">
      <span className="moon">&#9789;</span>
      <span className="sun">&#9728;</span>
    </button>
  )
}
