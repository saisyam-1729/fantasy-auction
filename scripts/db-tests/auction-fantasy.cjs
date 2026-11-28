/**
 * Database rule test: fantasy leaderboards for auction rooms (offsets at sale, ranking, daily movement).
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
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
    for (const f of ['draft.sql', 'fantasy_points.sql', 'auction_fantasy.sql']) await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8'))
    const TYPE = 'TESTAF_' + u().slice(0, 6)
    // a tiny event list: 4 auction players that also exist in the points pool
    const names = ['Alpha One', 'Bravo Two', 'Charlie Three', 'Delta Four']
    const inv = [], pp = []
    for (const nm of names) {
      inv.push((await q(`insert into player_inventory(inventory_type,player_id,player_name,player_type,base_price,team) values($1,$2,$3,'BAT',5000000,'Test XI') returning id`, [TYPE, 'af-' + nm, nm])).rows[0].id)
      pp.push(Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name,role) values($1,1,'test xi',upper($2),'Batter') returning id`, [TYPE, nm])).rows[0].id))
    }
    // one auction player with no match in the points pool
    const orphan = (await q(`insert into player_inventory(inventory_type,player_id,player_name,player_type,base_price,team) values($1,'af-x','Not In Pool','BAT',5000000,'Test XI') returning id`, [TYPE])).rows[0].id

    const U = [u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'af-' + id.slice(0, 8) + '@example.invalid'])
    const room = u()
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,player_inventory_type) values($1,'AF','AF-'||$2,'k',$3,'WAITING',$4)`, [room, room.slice(0, 6), U[0], TYPE])
    const RU = [u(), u()]
    for (let i = 0; i < 2; i++) await q(`insert into room_users(id,room_id,user_id,username,display_name,is_admin) values($1,$2,$3,$4,$4,$5)`, [RU[i], room, U[i], 'team' + i, i === 0])
    const RP = []
    for (const id of [...inv, orphan]) RP.push((await q(`insert into room_players(room_id,player_inventory_id,status) values($1,$2,'UNSOLD') returning id`, [room, id])).rows[0].id)

    const map = (await q(`select public._auction_pool_player($1) as a, public._auction_pool_player($2) as b, public._auction_pool_player($3) as o`, [RP[0], RP[3], RP[4]])).rows[0]
    rec('auction players are matched to the points pool by team and name (case-insensitive)', Number(map.a) === pp[0] && Number(map.b) === pp[3], JSON.stringify(map))
    rec('a player missing from the pool is simply unmatched', map.o === null)

    const setPts = async (arr) => { for (let i = 0; i < arr.length; i++) await q(`insert into player_points(player_id,pool,points,matches) values($1,$2,$3,1) on conflict (player_id) do update set points=excluded.points`, [pp[i], TYPE, arr[i]]) }
    const board = async (uid) => (await call(uid, 'select public.auction_leaderboard($1)', [room])).v
    const by = (b) => Object.fromEntries(b.rows.map((x) => [x.member_id, x]))

    // points exist before the sale (A=100, B=50): they must not count
    await setPts([100, 50, 30, 10])
    await q(`insert into user_squads(room_user_id,player_id,purchase_price) values($1,$2,1000),($3,$4,1000)`, [RU[0], RP[0], RU[1], RP[1]])
    await q(`insert into user_squads(room_user_id,player_id,purchase_price) values($1,$2,1000)`, [RU[1], RP[4]])
    let b = await board(U[0])
    rec('points earned before the sale do not count', Number(by(b)[RU[0]].points) === 0 && Number(by(b)[RU[1]].points) === 0, JSON.stringify(b.rows.map((x) => x.points)))
    const off = (await q('select points from auction_point_offsets where room_id=$1 and pool_player_id=$2', [room, pp[0]])).rows[0]
    rec('the offset is stored at the sale', off && Number(off.points) === 100)

    // day 1
    await q(`create or replace function public._points_day() returns date language sql stable as $$ select date '2026-12-01' $$`)
    await setPts([130, 60, 30, 10]) // A +30, B +10
    let r = await call(null, 'select public.snapshot_auction_standings($1)', [TYPE]); rec('the nightly job snapshots auction rooms', !r.err && r.v === 1, r.err || String(r.v))
    b = await board(U[0])
    rec('after the sale only new points count', Number(by(b)[RU[0]].points) === 30 && Number(by(b)[RU[1]].points) === 10, JSON.stringify(b.rows.map((x) => [x.username, x.points])))
    rec('ranks follow points', by(b)[RU[0]].rank === 1 && by(b)[RU[1]].rank === 2)
    rec('each team lists its players with points since the sale', by(b)[RU[0]].players.length === 1 && Number(by(b)[RU[0]].players[0].points) === 30 && by(b)[RU[0]].players[0].name === 'ALPHA ONE')
    rec('unmatched players are left out, not an error', by(b)[RU[1]].players.length === 1)

    // the nightly points sync also stores each player's daily total (the snapshot job runs after it)
    for (let i = 0; i < 4; i++) await q(`insert into player_points_daily(player_id, day, points) values($1, date '2026-12-01', $2)`, [pp[i], [130, 60, 30, 10][i]])

    // day 2: B overtakes A
    await q(`create or replace function public._points_day() returns date language sql stable as $$ select date '2026-12-02' $$`)
    await setPts([135, 200, 30, 10]) // A +5 (35), B +140 (150)
    await call(null, 'select public.snapshot_auction_standings($1)', [TYPE])
    b = await board(U[1])
    const a = by(b)[RU[0]], bb = by(b)[RU[1]]
    rec('rank movement is measured against the previous day', bb.rank === 1 && bb.prev_rank === 2 && a.rank === 2 && a.prev_rank === 1, JSON.stringify([a.rank, a.prev_rank, bb.rank, bb.prev_rank]))
    rec('points movement is measured against the previous day', Number(a.points) - Number(a.prev_points) === 5 && Number(bb.points) - Number(bb.prev_points) === 140, JSON.stringify([a.points, a.prev_points, bb.points, bb.prev_points]))
    rec('player points movement too', Number(a.players[0].points) - Number(a.players[0].prev_points) === 5)
    rec('the board says when points were last updated', b.latest_day === '2026-12-02' && b.previous_day === '2026-12-01')

    // access
    r = await call(U[2], 'select public.auction_leaderboard($1)', [room]); rec('an outsider cannot read the leaderboard', /not in this room/.test(r.err || ''), r.err)
    await as(U[1]); await q('savepoint z'); let denied = false
    try { await q('set local role authenticated'); await q('select public.snapshot_auction_standings($1)', [TYPE]) } catch (e) { denied = /permission denied/.test(e.message) }
    await q('rollback to savepoint z'); rec('members cannot trigger a snapshot', denied)
    await as(U[1]); await q('savepoint z'); let blocked = false
    try { await q('set local role authenticated'); await q('select * from auction_point_offsets') } catch (e) { blocked = /permission denied/.test(e.message) }
    await q('rollback to savepoint z'); rec('offset and snapshot tables are not readable directly', blocked)

    // a re-sold player (after an undo) gets a fresh offset
    await q('delete from user_squads where room_user_id=$1 and player_id=$2', [RU[0], RP[0]])
    await setPts([150, 200, 30, 10])
    await q(`insert into user_squads(room_user_id,player_id,purchase_price) values($1,$2,1000)`, [RU[1], RP[0]])
    b = await board(U[0])
    rec('a re-sold player counts only from the new sale', Number(by(b)[RU[1]].points) === 150 && Number(by(b)[RU[0]].points) === 0, JSON.stringify(b.rows.map((x) => [x.username, x.points])))
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
