/**
 * Purana rasta — /admin/sehat
 *
 * Safhe ka naam ab "Health" hai. Purana link kisi ke paas mehfooz ho to
 * wo toote na, is liye yahan se seedha naye safhe par bhej dete hain.
 */

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function PuranaRasta({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const key = typeof searchParams.key === 'string' ? searchParams.key : ''
  redirect(`/admin/health${key ? `?key=${encodeURIComponent(key)}` : ''}`)
}
