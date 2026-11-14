/**
 * BOT KA ROZNAMCHA — har faisle ka ek sutar.
 *
 * Pehle sirf ye pata chalta tha ke kaun sa matan kitni dafa gaya. Us se
 * ye to maloom ho jata tha ke "kya" bheja, lekin ye nahi ke bot ne wo
 * faisla KYUN kiya, aur jahan us ne kuch nahi bheja wahan kya soch kar
 * khamosh raha.
 *
 * Ab har message par ek sutar likha jata hai: kis qism ka faisla hua,
 * kaun sa topic chuna, lafzon se chuna ya AI se, baat guzre waqt ki thi
 * ya aane wale ki, aur message gaya ya nahi. Isi se Health ke safhe par
 * bot ki kaarkardagi (performance) nikalti hai.
 *
 * AHEM: ye likhna kabhi customer ka jawab nahi rok sakta. Koi bhi khata
 * aaye to khamoshi se nazar-andaz ho jati hai.
 */

import { supabaseAdmin } from '@/lib/supabase'

/** Faisle ki qism — Health ka safha inhi par ginti karta hai */
export type FaislaQism =
  /** Live order status bheja */
  | 'tracking'
  /** Sawaal tracking ka tha lekin order ki koi pehchan nahi mili */
  | 'tracking_na_mila'
  /** Excel ke kisi topic ka jawab bheja */
  | 'topic'
  /** Code ka apna matan (Yes Available, order number maango waghera) */
  | 'system'
  /** Team ke liye manual check mein daala */
  | 'manual'
  /** Kuch nahi bheja */
  | 'khamosh'

export interface Faisla {
  phone: string
  qism: FaislaQism
  /** Jo topic chuna gaya (ho to) */
  topic?: string | null
  /** lafz = word matching, ai = AI ne chuna, code = code ka apna faisla */
  zariya?: 'lafz' | 'ai' | 'code' | null
  /** Word matching ka score (0-1) */
  score?: number | null
  /** guzra waqt ya aane wala — 'pehle' | 'baad' | 'maloom-nahi' */
  marhala?: string | null
  /** Message waqai gaya? */
  bheja: boolean
  /** Na gaya to kyun, ya gaya to kis bina par */
  wajah?: string | null
}

export async function faislaLikho(f: Faisla): Promise<void> {
  try {
    await supabaseAdmin.from('bot_faisla').insert({
      phone: f.phone,
      qism: f.qism,
      topic: f.topic ?? null,
      zariya: f.zariya ?? null,
      score: typeof f.score === 'number' ? Number(f.score.toFixed(3)) : null,
      marhala: f.marhala ?? null,
      bheja: f.bheja,
      wajah: f.wajah ?? null,
    })
  } catch {
    // Roznamcha na likha ja saka — bot phir bhi chalta rahe
  }
}
