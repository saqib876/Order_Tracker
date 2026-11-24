/**
 * Admin ke tamam safhon ka sanjha khol.
 *
 * Yahan sirf ek kaam hota hai: theme wali script sab se pehle chala dena.
 *
 * Pehle ye script har safhe ke andar alag alag lagi hui thi. Masla ye tha
 * ke jab safha khul raha hota hai (loading wala dhancha), tab tak koi safha
 * bana hi nahi hota — is liye script chalti hi nahi thi aur ek lamhe ke
 * liye dark roop jhalak jata tha, chahe aap ne white chuna hua ho.
 *
 * Layout loading se pehle banta hai, is liye ab script wahan bhi chal
 * jati hai aur intezaar wala dhancha bhi aap hi ke roop mein nazar aata
 * hai.
 */

import type { ReactNode } from 'react'
import { ThemeBoot } from './ThemeBits'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ThemeBoot />
      {children}
    </>
  )
}
