/**
 * Aap ke apne "tracking wale" jumle — database se.
 *
 * `orderIntent.ts` sirf alfaz ka kaam karti hai, us ka database se koi
 * taalluq nahi (is liye use alag se aazmaya ja sakta hai). Ye chhoti file
 * dono ko jorti hai.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { orderIntentTazaKaro } from '@/lib/orderIntent'

export async function orderIntentLoad(): Promise<void> {
  await orderIntentTazaKaro(async () => {
    const { data } = await supabaseAdmin
      .from('order_intent_extra')
      .select('matan')
      .limit(2000)
    return (data || []).map((r) => String(r.matan || '')).filter(Boolean)
  })
}
