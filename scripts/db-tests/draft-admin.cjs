/**
 * Database rule test: draft host tools (fix a pick, add a player, reset points) and sync status.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Reads SUPABASE_DB_URL from .env.local. Prefer a staging database.
 * Run all with: npm run db:test
 */
const fs = require('fs'), path = require('path'), { Client } = require('pg'), crypto = require('crypto')
const env = require('../dbUrl.cjs')()
const u = () => crypto.randomUUID()
const results = []
const rec = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')) }
;(async () => {
  const c = new Client({ connectionString: env, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p)
  const as = (uid) => q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid || '', uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : ''])
  const call = async (uid, sql, params) => {
    await as(uid); await q('savepoint k')
    try { const r = await q(sql, params); await q('release savepoint k'); return { v: r.rows[0] && Object.values(r.rows[0])[0], rows: r.rows } }
    catch (e) { await q('rollback to savepoint k'); return { err: e.message } }
  }
  try {
    await q('begin')
    for (const f of ['draft.sql', 'fantasy_points.sql', 'draft_extras.sql', 'draft_admin.sql', 'draft_teams.sql']) await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8'))
    const pool = 'TESTA_' + u().slice(0, 8)
    const P = []
    for (let i = 0; i < 8; i++) P.push(Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values($1,$2::int,'T','P'||$2::text) returning id`, [pool, i])).rows[0].id))
    const U = [u(), u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'da-' + id.slice(0, 8) + '@example.invalid'])
    const d = (await (async () => { await as(U[0]); return q(`select * from public.create_draft_room('Admin',2,4,$1)`, [pool]) })()).rows[0]
    const D = d.id
    for (const x of [U[1], U[2]]) await call(x, 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key])
    for (let i = 0; i < 2; i++) await call(U[0], 'select public.draft_spin_wheel($1)', [D])
    await call(U[0], 'select public.draft_start($1)', [D])
    const order = (await q('select user_id from draft_members where draft_id=$1 order by order_pos', [D])).rows.map((x) => x.user_id)
    await call(order[0], 'select public.draft_make_pick($1,$2,0)', [D, P[0]])
    await call(order[1], 'select public.draft_make_pick($1,$2,1)', [D, P[1]])

    // fix a pick
    r = await call(U[1] === order[0] ? U[2] : U[1], 'select public.draft_host_replace_pick($1,0,$2)', [D, P[5]])
    rec('a player cannot change a pick', /Only the host/.test(r.err || ''), r.err)
    var r = await call(U[0], 'select public.draft_host_replace_pick($1,0,$2)', [D, P[1]]); rec('cannot swap in a player already picked', /already been picked/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_host_replace_pick($1,9,$2)', [D, P[5]]); rec('cannot change a pick that does not exist', /no pick number 10/.test(r.err || ''), r.err)
    const before = (await q('select turn_started_at from draft_rooms where id=$1', [D])).rows[0].turn_started_at
    await q(`update draft_rooms set turn_started_at = now() - interval '20 seconds' where id=$1`, [D])
    r = await call(U[0], 'select public.draft_host_replace_pick($1,0,$2)', [D, P[5]])
    const now0 = (await q('select player_id::int, member_id from draft_picks where draft_id=$1 and pick_no=0', [D])).rows[0]
    rec('the host swaps the player of a pick', !r.err && now0.player_id === P[5], r.err)
    const kept = (await q(`select turn_started_at < now() - interval '19 seconds' as kept from draft_rooms where id=$1`, [D])).rows[0].kept
    rec('a swap does not restart the pick timer', kept === true, String(before))
    r = await call(U[0], 'select public.draft_make_pick($1,$2,2)', [D, P[0]]); rec('the swapped-out player is available again', /not your turn/.test(r.err || '') || r.v === 2, r.err)

    // add a player
    r = await call(U[1], `select public.draft_host_add_player($1,'Test XI','New Guy','Bowler')`, [D]); rec('a player cannot add to the pool', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], `select public.draft_host_add_player($1,'Test XI','  New   Guy ','Bowler')`, [D])
    const added = r.v
    const row = (await q('select player_name, team, role, notes, pool from draft_pool_players where id=$1', [added])).rows[0]
    rec('the host adds a missing player, tidied', !r.err && row.player_name === 'New Guy' && row.pool === pool && row.notes === 'Added by a host', r.err || JSON.stringify(row))
    r = await call(U[0], `select public.draft_host_add_player($1,'test xi','new guy',null)`, [D]); rec('no duplicates', /already in the pool/.test(r.err || ''), r.err)
    r = await call(U[0], `select public.draft_host_add_player($1,'Test XI','X','Bowler')`, [D]); rec('names are checked', /2 to 60/.test(r.err || ''), r.err)
    r = await call(U[0], `select public.draft_host_add_player($1,'Test XI','Some One','Captain')`, [D]); rec('roles are checked', /Unknown role/.test(r.err || ''), r.err)

    // reset points
    await q(`insert into player_points(player_id,pool,points) values($1,$2,40)`, [P[5], pool])
    r = await call(U[1], 'select public.draft_host_reset_points($1)', [D]); rec('a player cannot reset the points', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_host_reset_points($1)', [D]); rec('the host resets the points to zero', !r.err && r.v === 1, r.err || String(r.v))
    const lb = (await call(U[0], 'select public.draft_leaderboard($1)', [D])).v
    rec('after the reset every team is on zero', lb.rows.every((x) => Number(x.points) === 0), JSON.stringify(lb.rows.map((x) => x.points)))

    // sync status
    await q(`insert into points_sync_log(pool,day,source_rows,matched,unmatched) values($1,current_date,5,4,'[{"name":"Mystery Man"}]')`, [pool])
    r = await call(U[3], 'select public.points_sync_status($1)', [pool])
    rec('anyone signed in can see the last sync', !r.err && r.v.matched === 4 && r.v.unmatched[0].name === 'Mystery Man', r.err)
    await as(null); await q('savepoint z'); let denied = false
    try { await q('set local role anon'); await q('select public.points_sync_status($1)', [pool]) } catch (e) { denied = /permission denied/.test(e.message) }
    await q('rollback to savepoint z'); rec('signed-out callers cannot', denied)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
