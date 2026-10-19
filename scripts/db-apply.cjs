/**
 * Apply the supabase/*.sql files in dependency order, in ONE transaction, so a
 * later file that re-defines a function (e.g. place_auction_bid) is never
 * visible half-applied.
 *
 *   npm run db:apply            apply and commit
 *   npm run db:apply -- --dry   apply, then roll back (checks the files re-run cleanly)
 *
 * Reads SUPABASE_DB_URL from .env.local (Session pooler or direct URI). Never prints it.
 * Assumes the base tables from docs/archive/DATABASE_SETUP.md already exist.
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const ORDER = [
  'player_inventory_add_team.sql',
  'consensus_and_lobby.sql',
  'auction_manual_and_filters.sql',
  'restart_room_auction.sql',
  'auction_pause.sql',
  'auction_bid_slabs.sql',
  'squad_visibility.sql',
  'security_hardening.sql',
  'auto_hammer.sql',
  'undo_last_sale.sql',
  'indexes.sql',
  'pause_close_away.sql',
  'cohost.sql',
  'cleanup_rooms.sql',
  'auction_sets.sql',
  'room_settings.sql',
]

const root = path.join(__dirname, '..')
const match = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)
if (!match) {
  console.error('SUPABASE_DB_URL is missing from .env.local')
  process.exit(1)
}
const url = match[1].trim().replace(/^["']|["']$/g, '')
const dry = process.argv.includes('--dry')

;(async () => {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
  } catch (e) {
    console.error('Could not connect:', String(e.code || e.message).replace(url, '***'))
    process.exit(2)
  }
  try {
    await client.query('begin')
    for (const file of ORDER) {
      await client.query(fs.readFileSync(path.join(root, 'supabase', file), 'utf8'))
      console.log('ok', file)
    }
    await client.query(dry ? 'rollback' : 'commit')
    console.log(dry ? 'dry run: rolled back, nothing changed' : 'committed')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    console.error('FAILED, rolled back:', e.message.replace(url, '***'))
    process.exitCode = 1
  } finally {
    await client.end()
  }
})()
