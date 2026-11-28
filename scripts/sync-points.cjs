/**
 * Run the nightly fantasy-points sync by hand (the same work as the Vercel cron
 * route app/api/cron/sync-points), straight against the database.
 *
 *   node scripts/sync-points.cjs          fetch, match, write points and today's snapshots
 *   node scripts/sync-points.cjs --dry    fetch and match only; print what would be written
 *
 * Reads SUPABASE_DB_URL from .env.local (never printed).
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
const jiti = require('jiti')(__filename)
const { checkSourceSane, fetchSourceRows, matchPoints } = jiti('../lib/fantasyPoints.ts')

const root = path.join(__dirname, '..')
const url = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
const dry = process.argv.includes('--dry')

;(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (const src of (await c.query('select pool, url from fantasy_sources order by pool')).rows) {
      const source = await fetchSourceRows(src.url)
      const last = (await c.query('select source_rows from points_sync_log where pool=$1 order by ran_at desc limit 1', [src.pool])).rows[0]
      const total = Number((await c.query('select coalesce(sum(points),0) t from player_points where pool=$1', [src.pool])).rows[0].t)
      checkSourceSane(source, last ? last.source_rows : null, total)
      const pool = (await c.query('select id::int, team, player_name from draft_pool_players where pool=$1', [src.pool])).rows
      const { matched, unmatched } = matchPoints(source, pool)
      console.log(`${src.pool}: ${source.length} rows on the page, ${matched.length} matched, ${unmatched.length} unmatched`)
      for (const u of unmatched) console.log(`  unmatched: ${u.name} (${u.team}) ${u.points}`)
      if (dry) continue
      const r = await c.query('select public.sync_player_points($1,$2,$3,$4) as r', [
        src.pool,
        JSON.stringify(matched),
        source.length,
        JSON.stringify(unmatched.map((u) => ({ name: u.name, team: u.team, points: u.points }))),
      ])
      console.log('  saved', JSON.stringify(r.rows[0].r))
      const snap = await c.query('select public.snapshot_auction_standings($1) n', [src.pool])
      console.log('  auction rooms snapshotted:', snap.rows[0].n)
    }
  } finally {
    await c.end()
  }
})().catch((e) => {
  console.error('FAILED:', String(e.message || e).replace(url, '***'))
  process.exit(1)
})
