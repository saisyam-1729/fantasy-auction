import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Is the nightly points update healthy? 200 when every points source updated within
 * the last 30 hours, 503 when one did not (a night was missed). It returns only counts
 * and times (see supabase/points_health.sql), so it is safe to leave public.
 *
 * Point an uptime monitor at it, or let the GitHub "points watchdog" workflow call it:
 * either one emails you when it turns 503.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !anon) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 500 })
  try {
    const db = createClient(url, anon, { auth: { persistSession: false } })
    const { data, error } = await db.rpc('points_health')
    if (error) throw new Error(error.message)
    const health = data as { ok: boolean }
    return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[health/points]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 503 })
  }
}
