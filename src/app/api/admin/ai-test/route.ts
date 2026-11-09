/**
 * AI theek chal raha hai? — /api/admin/ai-test?key=ADMIN_KEY
 *
 * Ek safha jo browser mein khol kar sab kuch ek nazar mein dikh jata hai:
 *   - key chal rahi hai ya nahi (provider se asli jawab aaya?)
 *   - Supabase ki nayi tables ban chuki hain?
 *   - Excel ke kitne topics AI ko dikhte hain?
 *   - chand asli jumlon par AI ka faisla — sahi topic chun raha hai?
 *
 * Apna jumla aazmana ho to:
 *   /api/admin/ai-test?key=ADMIN_KEY&q=mera order cancel kr dain
 *
 * Ye safha koi WhatsApp message NAHI bhejta — sirf dikhata hai ke bot kya
 * faisla karta. Har call AI ki rozana ginti mein shumar hoti hai.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  samjho,
  aiAvailable,
  aiMode,
  aiProvider,
  aajKiGinti,
  topicList,
  zaatiMaloomatHatao,
} from '@/lib/aiTopic'
import { answerForTopic } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Aap ke apne bheje hue asli jumle — inhi par bot ghalti karta tha
const NAMUNE = [
  'Nhi mujhe covered Hi chahiyye',
  'Delievery charges ko mila k?',
  'mera order cancel kr dain',
  'Alright I am waiting',
  'delivery kitne din mein ho jati hai',
]

async function tableChalti(naam: string): Promise<string> {
  const { error } = await supabaseAdmin.from(naam).select('*', { count: 'exact', head: true })
  return error ? 'NAHI — ' + error.message : 'haan'
}

export async function GET(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY set nahi hai' }, { status: 500 })
  }
  if (req.nextUrl.searchParams.get('key') !== adminKey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const provider = aiProvider()
  const keyMojood = aiAvailable()

  const tables = {
    ai_topic_cache: await tableChalti('ai_topic_cache'),
    ai_call_log: await tableChalti('ai_call_log'),
  }

  const { list } = await topicList()

  const apnaJumla = req.nextUrl.searchParams.get('q')
  const aazmane = apnaJumla ? [apnaJumla] : NAMUNE

  const natija: any[] = []
  for (const jumla of aazmane) {
    const shuru = Date.now()
    const raye = keyMojood ? await samjho(jumla) : null
    const jawab = raye && raye.topic ? await answerForTopic(raye.topic) : null
    natija.push({
      jumla,
      'AI ko bheja gaya': zaatiMaloomatHatao(jumla),
      'AI ka faisla': !keyMojood
        ? 'AI band hai'
        : !raye
        ? 'jawab nahi aaya (key ghalat, hadd paar, ya waqt khatam) — bot purane tareeqe par chalega'
        : raye.insaan
        ? 'INSAAN ke liye — bot khamosh rahega'
        : raye.topic
        ? 'topic: ' + raye.topic
        : 'koi topic nahi — bot khamosh rahega',
      'kahan se': raye ? raye.kahan : '—',
      'jawab ka pehla hissa': jawab ? jawab.slice(0, 90) : null,
      ms: Date.now() - shuru,
    })
  }

  return NextResponse.json(
    {
      'AI chalu hai': keyMojood,
      provider,
      andaz: aiMode(),
      'Excel ke topics': list.length,
      'aaj ab tak AI calls': await aajKiGinti(),
      'roz ki hadd': Number(process.env.AI_MAX_PER_DAY) || 300,
      'Supabase tables': tables,
      'aazmaye gaye jumle': natija,
      madad: 'Apna jumla aazmane ke liye URL ke aakhir mein &q=apna jumla laga dein',
    },
    { status: 200 }
  )
}
