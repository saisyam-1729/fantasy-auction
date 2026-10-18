/**
 * Database rule test: host undo of the last sale.
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
  const as = (uid) => q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
  let room
  const call = async (uid, sql, params) => {
    await as(uid); await q('savepoint k')
    try { const r = await q(sql, params); await q('release savepoint k'); return { v: r.rows[0] && Object.values(r.rows[0])[0] } }
    catch (e) { await q('rollback to savepoint k'); return { err: e.message } }
  }
  try {
    await q('begin')
    const U = [u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'ud-' + id.slice(0, 8) + '@example.invalid'])
    room = u(); const RU = [u(), u(), u()]
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,min_squad_size,max_squad_size) values($1,'UNDO','UNDO-'||$2,'k',$3,'WAITING',2,4)`, [room, room.slice(0, 6), U[0]])
    for (let i = 0; i < 3; i++) await q(`insert into room_users(id,room_id,user_id,username,display_name,budget,spent,squad_count,is_admin) values($1,$2,$3,$4,$4,1000000000,0,0,$5)`, [RU[i], room, U[i], 'ud' + i, i === 0])
    const rp = []
    for (let i = 0; i < 4; i++) {
      const iv = u(), r = u(); rp.push(r)
      await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'UNDO',$2,'D'||$3,'BAT',2000000)`, [iv, 'ud' + i + iv.slice(0, 4), i])
      await q(`insert into room_players(id,room_id,player_inventory_id,status) values($1,$2,$3,'UNSOLD')`, [r, room, iv])
    }
    await q(`insert into live_auction_state(room_id,current_player_id,current_bid,is_active,is_paused,last_bid_time,start_time) values($1,$2,$3,true,false,clock_timestamp(),clock_timestamp())`, [room, rp[0], 20 * L])

    let r = await call(U[0], 'select public.auction_undo_last_sale($1)', [room]); rec('nothing to undo before any sale', /Nothing to undo/.test(r.err || ''), r.err)

    await call(U[1], 'select public.place_auction_bid($1,$2)', [room, 10 * L])
    await call(U[0], `select public.auction_hammer_advance($1,'sold')`, [room])   // sells lot 1 to U1 at 30L, next lot live
    await call(U[2], 'select public.place_auction_bid($1,$2)', [room, 10 * L])    // a bid on lot 2 (will be discarded)
    await q(`update user_squads set purchased_at = clock_timestamp() where room_user_id=$1`, [RU[1]])
    const before = (await q('select spent::bigint s, squad_count from room_users where id=$1', [RU[1]])).rows[0]
    rec('sale recorded before undo', Number(before.s) === 30 * L && before.squad_count === 1, JSON.stringify(before))

    r = await call(U[1], 'select public.auction_undo_last_sale($1)', [room]); rec('non-admin cannot undo', /Only room admin/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.auction_undo_last_sale($1)', [room]); rec('admin undo succeeds', r.v === 'undone', r.err)

    const lot = (await q('select status,sold_price,sold_to_user_id from room_players where id=$1', [rp[0]])).rows[0]
    rec('lot 1 is unsold again', lot.status === 'UNSOLD' && lot.sold_price === null && lot.sold_to_user_id === null, JSON.stringify(lot))
    const ru = (await q('select spent::bigint s, squad_count from room_users where id=$1', [RU[1]])).rows[0]
    rec('buyer spend and squad count restored', Number(ru.s) === 0 && ru.squad_count === 0, JSON.stringify(ru))
    rec('squad row removed', (await q('select count(*)::int n from user_squads where room_user_id=$1', [RU[1]])).rows[0].n === 0)
    const st = (await q('select current_player_id,current_bid::bigint cb,top_bidder_id,is_active,is_paused from live_auction_state where room_id=$1', [room])).rows[0]
    rec('lot 1 reopened at 30L, same bidder, paused', st.current_player_id === rp[0] && Number(st.cb) === 30 * L && st.top_bidder_id === RU[1] && st.is_active && st.is_paused, JSON.stringify(st))
    rec('the lot that was live returns to the pool', (await q('select status from room_players where id=$1', [rp[1]])).rows[0].status === 'UNSOLD')
    r = await call(U[2], 'select public.place_auction_bid($1,$2)', [room, 10 * L]); rec('bids stay blocked while paused', /paused/i.test(r.err || ''), r.err)

    // finished auction: sell everything left then undo reopens an inactive auction
    await call(U[0], 'select public.auction_set_paused($1,false)', [room])
    await call(U[0], `select public.auction_hammer_advance($1,'sold')`, [room])
    await q(`update user_squads set purchased_at = clock_timestamp() where room_user_id=$1`, [RU[1]])
    await q('update live_auction_state set is_active=false, current_player_id=null where room_id=$1', [room])
    r = await call(U[0], 'select public.auction_undo_last_sale($1)', [room]); rec('undo works after the auction has ended', r.v === 'undone', r.err)
    rec('auction is active again', (await q('select is_active from live_auction_state where room_id=$1', [room])).rows[0].is_active === true)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
