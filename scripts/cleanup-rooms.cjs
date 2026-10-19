/**
 * List, and optionally delete, rooms with no activity for N days.
 *
 *   npm run db:cleanup                      list rooms idle for 30+ days (nothing is deleted)
 *   npm run db:cleanup -- --days 14         change the cut-off
 *   npm run db:cleanup -- --days 14 --apply delete them (cannot be undone)
 *
 * Needs supabase/cleanup_rooms.sql applied. Reads SUPABASE_DB_URL from .env.local.
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const di = args.indexOf('--days')
const days = di >= 0 ? Number(args[di + 1]) : 30
if (!Number.isInteger(days) || days < 1) {
  console.error('--days must be a whole number, 1 or more')
  process.exit(1)
}

const m = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)
if (!m) {
  console.error('SUPABASE_DB_URL is missing from .env.local')
  process.exit(1)
}
const url = m[1].trim().replace(/^["']|["']$/g, '')

;(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    await c.connect()
    const { rows } = await c.query('select * from public.cleanup_stale_rooms($1, $2)', [days, !apply])
    if (rows.length === 0) {
      console.log(`No rooms idle for ${days}+ days.`)
    } else {
      console.log(`${apply ? 'DELETED' : 'Would delete'} ${rows.length} room(s) idle for ${days}+ days:`)
      for (const r of rows) {
        console.log(`  ${r.room_id}  last activity ${new Date(r.last_activity).toISOString().slice(0, 10)}  members ${r.members}  sold ${r.sold}`)
      }
      if (!apply) console.log('\nNothing was deleted. Add --apply to delete these.')
    }
  } catch (e) {
    console.error('FAILED:', String(e.message || e).replace(url, '***'))
    process.exitCode = 1
  } finally {
    await c.end().catch(() => {})
  }
})()
