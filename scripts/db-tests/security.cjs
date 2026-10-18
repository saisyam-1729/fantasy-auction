/**
 * Database rule test: RLS attacks that must fail and normal flows that must still work.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Temporary auth users are inserted, and request.jwt.claim.sub is set to act as them.
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
  // Run a statement as a signed-in browser user. Returns {rows} or {err}. Always inside a savepoint.
  const asUser = async (uid, sql, params) => {
    await q('savepoint x')
    try {
      await q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
      await q('set local role authenticated')
      const r = await q(sql, params)
      await q('reset role'); await q('release savepoint x')
      return { rows: r.rows, count: r.rowCount }
    } catch (e) {
      await q('rollback to savepoint x')
      return { err: e.message }
    }
  }
  try {
    await q('begin')
    const A = u(), B = u(), C = u() // A admin, B member, C outsider
    for (const id of [A, B, C]) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'sec-' + id.slice(0, 8) + '@example.invalid'])

    // legit flow: A creates a room as a browser user, then a room_users row, live state, players
    const room = u()
    let r = await asUser(A, `insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,max_players) values($1,'SEC','SEC-'||$2,'123456',$3,'WAITING',10)`, [room, room.slice(0, 6), A])
    rec('admin can create a room', !r.err, r.err)
    r = await asUser(A, `insert into room_users(room_id,user_id,username,display_name,is_admin,budget,spent,squad_count) values($1,$2,'a','a',true,5,0,0)`, [room, A])
    rec('admin creates own room_users row', !r.err, r.err)
    const mine = (await q('select budget::bigint b,is_admin from room_users where room_id=$1 and user_id=$2', [room, A])).rows[0]
    rec('insert budget forced to 100Cr (client sent 5)', Number(mine.b) === 1e9 && mine.is_admin === true, JSON.stringify(mine))
    r = await asUser(A, `insert into live_auction_state(room_id,is_active) values($1,false)`, [room])
    rec('admin creates live_auction_state', !r.err, r.err)
    for (let i = 0; i < 3; i++) {
      const iv = u()
      await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'SEC',$2,'P'||$3,'BAT',2000000)`, [iv, 'sec' + i + iv.slice(0, 4), i])
    }
    r = await asUser(A, `select public.initialize_room_players($1,'SEC')`, [room])
    const n1 = (await q('select count(*)::int n from room_players where room_id=$1', [room])).rows[0].n
    rec('admin initialize_room_players loads players', !r.err && n1 === 3, r.err || 'n=' + n1)
    await asUser(A, `select public.initialize_room_players($1,'SEC')`, [room])
    rec('initialize_room_players is idempotent', (await q('select count(*)::int n from room_players where room_id=$1', [room])).rows[0].n === 3)
    r = await asUser(C, `select public.initialize_room_players($1,'SEC')`, [room])
    rec('non-admin cannot initialize players', /Only room admin/.test(r.err || ''), r.err)

    // join flow
    r = await asUser(C, `select public.join_room('nope','000000')`, [])
    rec('join_room rejects wrong key', /Invalid Room ID/.test(r.err || ''), r.err)
    const rid = (await q('select room_id from rooms where id=$1', [room])).rows[0].room_id
    r = await asUser(B, `select public.join_room($1,'123456') as id`, [rid])
    rec('join_room with right key returns room uuid', r.rows?.[0]?.id === room, r.err)
    r = await asUser(B, `select public.join_room($1,'123456') as id`, [rid])
    rec('join_room again is idempotent (rejoin)', r.rows?.[0]?.id === room, r.err)
    const bru = (await q('select id,budget::bigint b,is_admin from room_users where room_id=$1 and user_id=$2', [room, B])).rows[0]
    rec('joined member: budget 100Cr, not admin', Number(bru.b) === 1e9 && bru.is_admin === false)

    // visibility
    r = await asUser(C, `select count(*)::int n from rooms where id=$1`, [room]); rec('outsider cannot read the room', r.rows?.[0]?.n === 0, JSON.stringify(r.rows))
    r = await asUser(C, `select count(*)::int n from rooms`, []); rec('outsider sees no rooms (room_key hidden)', r.rows?.[0]?.n === 0, JSON.stringify(r.rows))
    r = await asUser(C, `select count(*)::int n from room_users where room_id=$1`, [room]); rec('outsider cannot read room_users', r.rows?.[0]?.n === 0)
    r = await asUser(B, `select count(*)::int n from rooms where id=$1`, [room]); rec('member can read the room', r.rows?.[0]?.n === 1)
    r = await asUser(B, `select count(*)::int n from room_users where room_id=$1`, [room]); rec('member sees all room members', r.rows?.[0]?.n === 2, JSON.stringify(r.rows))

    // legit ready update
    r = await asUser(B, `update room_users set ready_to_start=true where id=$1`, [bru.id])
    rec('member can set own ready flag', !r.err && r.count === 1, r.err)

    // attacks
    r = await asUser(B, `update room_users set budget=999999999999 where id=$1`, [bru.id]); rec('ATTACK raise own budget blocked', /Only ready_to_start/.test(r.err || ''), r.err || 'allowed!')
    r = await asUser(B, `update room_users set spent=0, squad_count=0, is_admin=true where id=$1`, [bru.id]); rec('ATTACK self-promote to admin blocked', /Only ready_to_start/.test(r.err || ''), r.err || 'allowed!')
    r = await asUser(C, `insert into room_users(room_id,user_id,username,display_name,is_admin,budget) values($1,$2,'c','c',true,999999999999)`, [room, C])
    const cru = (await q('select budget::bigint b,is_admin from room_users where room_id=$1 and user_id=$2', [room, C])).rows[0]
    rec('ATTACK direct insert cannot grant budget/admin', !cru || (Number(cru.b) === 1e9 && cru.is_admin === false), JSON.stringify(cru))
    await q('delete from room_users where room_id=$1 and user_id=$2', [room, C])
    const prow = (await q('select id from room_players where room_id=$1 limit 1', [room])).rows[0].id
    r = await asUser(B, `insert into user_squads(room_user_id,player_id,purchase_price) values($1,$2,1)`, [bru.id, prow]); rec('ATTACK insert into user_squads blocked', !!r.err, r.err || 'allowed!')
    r = await asUser(B, `insert into bid_history(room_id,player_id,user_id,amount) values($1,$2,$3,1)`, [room, prow, bru.id]); rec('ATTACK fake bid_history blocked', !!r.err, r.err || 'allowed!')
    r = await asUser(C, `insert into live_auction_state(room_id,is_active) values($1,true)`, [u()]); rec('ATTACK non-admin live_auction_state insert blocked', !!r.err, r.err || 'allowed!')
    r = await asUser(A, `update live_auction_state set current_bid=1 where room_id=$1`, [room]); rec('ATTACK admin direct state update affects 0 rows', !r.err && r.count === 0, r.err || 'rows=' + r.count)
    r = await asUser(A, `update room_players set status='SOLD', sold_to_user_id=$2, sold_price=1 where id=$1`, [prow, bru.id]); rec('ATTACK admin direct sale affects 0 rows', !r.err && r.count === 0, r.err || 'rows=' + r.count)
    r = await asUser(C, `select public.place_auction_bid($1,1000000)`, [room]); rec('outsider bid rejected', /not in this room/i.test(r.err || ''), r.err)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
