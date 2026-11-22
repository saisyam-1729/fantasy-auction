/**
 * Reset a draft's fantasy score to zero from now on: points players already have
 * (e.g. a match played while the draft was running) stop counting for this draft.
 *
 *   node scripts/set-draft-baseline.cjs <room code>          show what would change
 *   node scripts/set-draft-baseline.cjs <room code> --apply  do it
 *
 * Reads SUPABASE_DB_URL from .env.local (never printed).
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const code = process.argv[2]
const apply = process.argv.includes('--apply')
if (!code || code.startsWith('--')) {
  console.error('Usage: node scripts/set-draft-baseline.cjs <room code> [--apply]')
  process.exit(1)
}
const url = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')

;(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const d = (await c.query('select id, pool from draft_rooms where room_code=$1', [code])).rows[0]
    if (!d) throw new Error(`No draft with room code ${code}`)
    const show = async (label) => {
      const rows = (await c.query('select m.username, s.points, s.rank from public._draft_current_standings($1) s join draft_members m on m.id=s.member_id order by s.rank, m.username', [d.id])).rows
      console.log(label + ': ' + rows.map((r) => `${r.rank}. ${r.username} ${Number(r.points)}`).join(' | '))
    }
    await show('Now')
    if (!apply) {
      console.log('Nothing changed. Add --apply to make current points the starting point (scores go to 0).')
      return
    }
    await c.query('begin')
    const n = (await c.query('select public.set_draft_points_baseline($1) n', [d.id])).rows[0].n
    await c.query('commit')
    console.log(`Starting points saved for ${n} players.`)
    await show('After')
  } finally {
    await c.end()
  }
})().catch((e) => {
  console.error('FAILED:', String(e.message || e).replace(url, '***'))
  process.exit(1)
})
