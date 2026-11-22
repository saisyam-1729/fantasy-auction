import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSourceRows, matchPoints, type PoolPlayer } from '@/lib/fantasyPoints'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Nightly fantasy-points sync (Vercel Cron, see vercel.json: 18:30 UTC = midnight IST).
 * For each event in fantasy_sources: download its points page, match players to the
 * draft pool, and store totals plus today's player and standings snapshots.
 *
 * Needs on the host: CRON_SECRET (Vercel sends it as a Bearer token) and
 * SUPABASE_SERVICE_ROLE_KEY (the only role allowed to write points).
 * Run by hand locally with `node scripts/sync-points.cjs`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    console.error('[sync-points] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: sources, error } = await db.from('fantasy_sources').select('pool, url')
  if (error) {
    console.error('[sync-points] could not read sources:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const report: Record<string, unknown>[] = []
  let failed = false
  for (const src of sources ?? []) {
    try {
      const rows = await fetchSourceRows(src.url)
      const { data: pool, error: poolError } = await db.rpc('points_pool_players', { p_pool: src.pool })
      if (poolError) throw new Error(poolError.message)
      const { matched, unmatched } = matchPoints(rows, (pool ?? []) as PoolPlayer[])
      const { data: saved, error: saveError } = await db.rpc('sync_player_points', {
        p_pool: src.pool,
        p_rows: matched,
        p_source_rows: rows.length,
        p_unmatched: unmatched.map((u) => ({ name: u.name, team: u.team, points: u.points })),
      })
      if (saveError) throw new Error(saveError.message)
      const line = { pool: src.pool, rows: rows.length, matched: matched.length, unmatched: unmatched.map((u) => u.name), saved }
      console.log('[sync-points]', JSON.stringify(line))
      report.push(line)
    } catch (e) {
      failed = true
      const message = e instanceof Error ? e.message : String(e)
      console.error('[sync-points]', src.pool, 'failed:', message)
      report.push({ pool: src.pool, error: message })
    }
  }
  return NextResponse.json({ ok: !failed, report }, { status: failed ? 500 : 200 })
}
