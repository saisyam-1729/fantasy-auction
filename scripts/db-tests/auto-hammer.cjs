/**
 * Database rule test: server-side auto-sell.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Temporary auth users are inserted, and request.jwt.claim.sub is set to act as them.
 * Reads SUPABASE_DB_URL from .env.local. Prefer a staging database.
 * Run all with: npm run db:test
 */
const fs = require('fs'), { Client } = require('pg'), crypto = require('crypto')
const env = fs.readFileSync(require('path').join(__dirname, '..', '..', '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
const L = 1e5, u = () => crypto.randomUUID()
const results = []
const rec = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')) }
;(async () => {
  const c = new Client({ connectionString: env, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p)
  const as = (uid) => q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid || '', uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : ''])
  let room
  const call = async (uid, sql, params) => {
    await as(uid); await q('savepoint k')
    try { const r = await q(sql, params); await q('release savepoint k'); return { v: r.rows[0] && Object.values(r.rows[0])[0] } }
    catch (e) { await q('rollback to savepoint k'); return { err: e.message } }
  }
  const fin = (uid) => call(uid, 'select public.auction_finalize_expired($1)', [room])
  const st = async () => (await q('select current_player_id, current_bid::bigint cb, top_bidder_id, is_active from live_auction_state where room_id=$1', [room])).rows[0]
  const expire = (sec) => q(`update live_auction_state set last_bid_time = clock_timestamp() - ($2 || ' seconds')::interval where room_id=$1`, [room, String(sec)])
  try {
    await q('begin')
    const U = [u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'au-' + id.slice(0, 8) + '@example.invalid'])
    room = u(); const RU = [u(), u(), u()]
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,min_squad_size,max_squad_size) values($1,'AUTO','AUTO-'||$2,'k',$3,'WAITING',2,4)`, [room, room.slice(0, 6), U[0]])
    for (let i = 0; i < 3; i++) await q(`insert into room_users(id,room_id,user_id,username,display_name,budget,spent,squad_count,is_admin) values($1,$2,$3,$4,$4,1000000000,0,0,$5)`, [RU[i], room, U[i], 'au' + i, i === 0])
    const rp = []
    for (let i = 0; i < 4; i++) {
      const iv = u(), r = u(); rp.push(r)
      await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'AUTO',$2,'A'||$3,'BAT',2000000)`, [iv, 'au' + i + iv.slice(0, 4), i])
      await q(`insert into room_players(id,room_id,player_inventory_id,status) values($1,$2,$3,'UNSOLD')`, [r, room, iv])
    }
    await q(`insert into live_auction_state(room_id,current_player_id,current_bid,is_active,is_paused,last_bid_time,start_time) values($1,$2,$3,true,false,clock_timestamp(),clock_timestamp())`, [room, rp[0], 20 * L])

    // switch: off by default, admin-only, locked once active
    rec('auto_hammer defaults to off', (await q('select auto_hammer from rooms where id=$1', [room])).rows[0].auto_hammer === false)
    let r = await call(U[1], 'select public.admin_set_auto_hammer($1,true)', [room]); rec('non-admin cannot switch auto-sell', /Only room admin/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.admin_set_auto_hammer($1,true)', [room]); rec('cannot switch while auction active', /before the auction starts/.test(r.err || ''), r.err)
    await q('update live_auction_state set is_active=false where room_id=$1', [room])
    r = await call(U[0], 'select public.admin_set_auto_hammer($1,true)', [room]); rec('admin switches auto-sell on before start', !r.err, r.err)
    await q('update live_auction_state set is_active=true where room_id=$1', [room])

    // no bids yet
    await expire(60)
    rec('no bids: expired lot is NOT auto-passed', (await fin(U[1])).v === 'waiting' && (await st()).current_player_id === rp[0])
    // bid then wait
    r = await call(U[1], 'select public.place_auction_bid($1,$2)', [room, 10 * L]); rec('member bids', !r.err, r.err)
    rec('before 30s: waiting', (await fin(U[2])).v === 'waiting' && (await st()).current_player_id === rp[0])
    await q('update live_auction_state set is_paused=true where room_id=$1', [room]); await expire(40)
    rec('paused lots never expire', (await fin(U[2])).v === 'waiting')
    await q('update live_auction_state set is_paused=false where room_id=$1', [room])
    rec('outsider cannot finalize', /not in this room/i.test((await fin(u())).err || ''))
    await expire(31)
    rec('after 30s a member finalizes: sold', (await fin(U[2])).v === 'sold')
    const sold = (await q('select status,sold_price::bigint p,sold_to_user_id from room_players where id=$1', [rp[0]])).rows[0]
    rec('lot sold to top bidder at the bid price', sold.status === 'SOLD' && Number(sold.p) === 30 * L && sold.sold_to_user_id === RU[1], JSON.stringify(sold))
    const ru1 = (await q('select spent::bigint s, squad_count from room_users where id=$1', [RU[1]])).rows[0]
    rec('buyer spent and squad count updated once', Number(ru1.s) === 30 * L && ru1.squad_count === 1, JSON.stringify(ru1))
    const nxt = await st()
    rec('next lot started with no top bidder at its base', nxt.current_player_id && nxt.current_player_id !== rp[0] && nxt.top_bidder_id === null && Number(nxt.cb) === 20 * L, JSON.stringify(nxt))
    rec('second call is a no-op (no double sale)', (await fin(U[1])).v === 'waiting' && (await q('select count(*)::int n from user_squads where room_user_id=$1', [RU[1]])).rows[0].n === 1)

    // auto off => expired lot still waits
    await q('update rooms set auto_hammer=false where id=$1', [room])
    await call(U[2], 'select public.place_auction_bid($1,$2)', [room, 10 * L]); await expire(99)
    rec('auto-sell off: expired lot still waits for host', (await fin(U[1])).v === 'waiting')
    await q('update rooms set auto_hammer=true where id=$1', [room])

    // host buttons still work with permission checks
    r = await call(U[1], `select public.auction_hammer_advance($1,'sold')`, [room]); rec('non-admin hammer rejected', /Only room admin/.test(r.err || ''), r.err)
    r = await call(U[0], `select public.auction_hammer_advance($1,'sold')`, [room]); rec('host hammer still sells', !r.err, r.err)
    rec('host sale recorded', (await q(`select count(*)::int n from room_players where room_id=$1 and status='SOLD'`, [room])).rows[0].n === 2)
    r = await call(U[0], `select public.auction_hammer_advance($1,'pass')`, [room]); rec('host pass still advances', !r.err, r.err)
    // direct call to internal function is not exposed
    await as(U[0]); await q('savepoint z'); await q('set local role authenticated')
    let blocked = false
    try { await q(`select public._auction_hammer($1,'sold')`, [room]) } catch (e) { blocked = /permission denied/.test(e.message) }
    await q('rollback to savepoint z')
    rec('_auction_hammer not callable from the browser', blocked)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
