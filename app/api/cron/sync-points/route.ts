import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkSourceSane, fetchSourceRows, matchPoints, type PoolPlayer } from '@/lib/fantasyPoints'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Nightly fantasy-points sync (Vercel Cron, see vercel.json: 20:30 UTC = 2:00 am IST).
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
      // compare with the last good update before trusting this page
      const { data: last } = await db.from('points_sync_log').select('source_rows').eq('pool', src.pool).order('ran_at', { ascending: false }).limit(1)
      const { data: totals } = await db.from('player_points').select('points').eq('pool', src.pool)
      checkSourceSane(rows, last?.[0]?.source_rows ?? null, (totals ?? []).reduce((s, t) => s + Number(t.points), 0))
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
      // standings snapshots of auction rooms that use this event's players
      const { error: auctionError } = await db.rpc('snapshot_auction_standings', { p_pool: src.pool })
      if (auctionError) throw new Error('auction snapshot: ' + auctionError.message)
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
