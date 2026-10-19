/**
 * Database rule test: stale room cleanup.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Only rooms dated far in the past are used, and the cut-off is set so that no
 * real room can match, even in the apply path.
 * Reads SUPABASE_DB_URL from .env.local. Prefer a staging database.
 * Run all with: npm run db:test
 */
const fs = require('fs'), { Client } = require('pg'), crypto = require('crypto')
const env = fs.readFileSync(require('path').join(__dirname, '..', '..', '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
const u = () => crypto.randomUUID()
const results = []
const rec = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')) }
;(async () => {
  const c = new Client({ connectionString: env, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p)
  try {
    await q('begin')
    const owner = u()
    await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [owner, 'cl-' + owner.slice(0, 8) + '@example.invalid'])
    const old = u(), fresh = u(), oldCode = 'CLOLD-' + old.slice(0, 6), freshCode = 'CLNEW-' + fresh.slice(0, 6)
    // 4000 days ago: older than any real room, so a 3000-day cut-off only matches this one
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,created_at,updated_at) values($1,'CL old',$2,'k',$3,'WAITING', now() - interval '4000 days', now() - interval '4000 days')`, [old, oldCode, owner])
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status) values($1,'CL new',$2,'k',$3,'WAITING')`, [fresh, freshCode, owner])
    const ru = u()
    await q(`insert into room_users(id,room_id,user_id,username,display_name,is_admin) values($1,$2,$3,'o','o',true)`, [ru, old, owner])
    const iv = u()
    await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'CL',$2,'CLP','BAT',1)`, [iv, 'cl' + iv.slice(0, 6)])
    await q(`insert into room_players(room_id,player_inventory_id,status) values($1,$2,'UNSOLD')`, [old, iv])
    // backdate anything the inserts stamped with now()
    await q(`update rooms set updated_at = now() - interval '4000 days' where id=$1`, [old])
    await q(`update room_users set last_seen_at = null where room_id=$1`, [old])

    const exists = async (id) => (await q('select count(*)::int n from rooms where id=$1', [id])).rows[0].n === 1

    let r = await q('select * from public.cleanup_stale_rooms(3000)')
    const codes = r.rows.map((x) => x.room_id)
    rec('dry run lists the stale room only', codes.length === 1 && codes[0] === oldCode, JSON.stringify(codes))
    rec('dry run reports it as not deleted, with its member count', r.rows[0].deleted === false && Number(r.rows[0].members) === 1)
    rec('dry run deletes nothing', (await exists(old)) && (await exists(fresh)))

    r = await q('select * from public.cleanup_stale_rooms(3000, false)')
    rec('apply reports the stale room as deleted', r.rows.length === 1 && r.rows[0].deleted === true)
    rec('the stale room is gone, the fresh room stays', !(await exists(old)) && (await exists(fresh)))
    rec('its members and players cascade away', (await q('select (select count(*) from room_users where room_id=$1)::int a, (select count(*) from room_players where room_id=$1)::int b', [old])).rows[0].a === 0)

    let msg = ''
    await q('savepoint bad')
    try { await q('select * from public.cleanup_stale_rooms(0)') } catch (e) { msg = e.message }
    await q('rollback to savepoint bad')
    rec('a cut-off under 1 day is rejected', /at least 1/.test(msg), msg)

    // not callable from the browser
    await q('savepoint z'); let blocked = false
    try { await q('set local role authenticated'); await q('select * from public.cleanup_stale_rooms(1)') } catch (e) { blocked = /permission denied/.test(e.message) }
    await q('rollback to savepoint z')
    rec('browsers cannot run the cleanup', blocked)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
