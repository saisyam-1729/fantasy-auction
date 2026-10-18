/**
 * Database rule test: bid slabs, purse lock, squad sizes, pause, squad visibility.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Temporary auth users are inserted, and request.jwt.claim.sub is set to act as them.
 * Reads SUPABASE_DB_URL from .env.local. Prefer a staging database.
 * Run all with: npm run db:test
 */
const fs = require('fs'), { Client } = require('pg'), crypto = require('crypto')
const env = fs.readFileSync(require('path').join(__dirname, '..', '..', '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
const CR = 1e7, L = 1e5, u = () => crypto.randomUUID()
const results = []
const rec = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')) }
;(async () => {
  const c = new Client({ connectionString: env, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p)
  const as = (uid) => q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`,
    [uid || '', uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : ''])
  let room
  const bid = async (uid, inc) => {
    await as(uid); await q('savepoint s')
    try { await q('select public.place_auction_bid($1,$2)', [room, inc]); await q('release savepoint s'); return null }
    catch (e) { await q('rollback to savepoint s'); return e.message }
  }
  const state = async () => { const r = (await q('select current_bid::bigint cb from live_auction_state where room_id=$1', [room])).rows[0]; return Number(r.cb) }
  const expectErr = (n, msg, sub) => rec(n, !!msg && msg.toLowerCase().includes(sub.toLowerCase()), msg || 'no error raised')
  try {
    await q('begin')
    const U = [u(), u(), u(), u()] // U[3] is an outsider
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'sim-' + id.slice(0, 8) + '@example.invalid'])
    room = u(); const RU = [u(), u(), u()]
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,min_squad_size,max_squad_size) values($1,'SIM','SIM-'||$2,'k',$3,'WAITING',3,4)`, [room, room.slice(0, 6), U[0]])
    for (let i = 0; i < 3; i++) await q(`insert into room_users(id,room_id,user_id,username,display_name,budget,spent,squad_count,is_admin) values($1,$2,$3,$4,$4,$5,0,0,$6)`, [RU[i], room, U[i], 'sim' + i, 5 * CR, i === 0])
    const rp = []
    for (let i = 0; i < 8; i++) {
      const iv = u(), r = u(); rp.push(r)
      await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'SIM',$2,$3,'BAT',$4)`, [iv, 'sim' + i + iv.slice(0, 4), 'Sim' + i, 20 * L])
      await q(`insert into room_players(id,room_id,player_inventory_id,status) values($1,$2,$3,'UNSOLD')`, [r, room, iv])
    }
    await q(`insert into live_auction_state(room_id,current_player_id,current_bid,top_bidder_id,is_active,is_paused) values($1,$2,$3,null,true,false)`, [room, rp[0], 20 * L])
    const set = (cb, top) => q(`update live_auction_state set current_bid=$2, top_bidder_id=$3 where room_id=$1`, [room, cb, top])
    const setRU = (i, f, v) => q(`update room_users set ${f}=$2 where id=$1`, [RU[i], v])

    // slab sequence from 20L, +10L each, alternating bidders
    const seq = []; let err = null
    for (let i = 0; i < 8; i++) { err = await bid(U[1 + (i % 2)], 10 * L); if (err) break; seq.push((await state()) / L) }
    rec('slab sequence from 20L', !err && seq.join() === '30,40,50,60,70,80,90,100', seq.join(',') + (err ? ' err ' + err : ''))
    expectErr('+20L rejected below 2Cr', await bid(U[0], 20 * L), 'next slab step')
    expectErr('+50L rejected', await bid(U[0], 50 * L), 'next slab step')

    await set(190 * L, null)
    rec('1.90Cr +10L -> 2.00Cr', (await bid(U[1], 10 * L)) === null && (await state()) === 2 * CR)
    rec('2.00Cr +20L -> 2.20Cr', (await bid(U[2], 20 * L)) === null && (await state()) === 220 * L)
    await set(195 * L, null)
    expectErr('1.95Cr +10L rejected (must snap +5L)', await bid(U[1], 10 * L), 'next slab step')
    rec('1.95Cr +5L -> 2.00Cr', (await bid(U[1], 5 * L)) === null && (await state()) === 2 * CR)
    await q('update room_users set budget=$2 where room_id=$1', [room, 100 * CR])
    await set(490 * L, null)
    expectErr('4.90Cr +20L rejected (would pass 5Cr)', await bid(U[1], 20 * L), 'next slab step')
    rec('4.90Cr +10L -> 5.00Cr', (await bid(U[1], 10 * L)) === null && (await state()) === 5 * CR)
    rec('5.00Cr +25L -> 5.25Cr', (await bid(U[2], 25 * L)) === null && (await state()) === 525 * L)
    expectErr('5.25Cr +20L rejected', await bid(U[1], 20 * L), 'next slab step')
    await q('update room_users set budget=$2 where room_id=$1', [room, 5 * CR])

    await set(3 * CR, RU[1])
    expectErr('top bidder cannot rebid', await bid(U[1], 20 * L), 'already hold')
    expectErr('non-member rejected', await bid(U[3], 20 * L), 'not in this room')
    expectErr('unauthenticated rejected', await bid(null, 20 * L), 'not authenticated')
    await q('update live_auction_state set is_paused=true where room_id=$1', [room])
    expectErr('paused rejects bids', await bid(U[2], 20 * L), 'paused')
    await q('update live_auction_state set is_paused=false where room_id=$1', [room])

    // purse lock: budget 5Cr, min 3, squad 0 -> reserve 2 x 20L -> top spend 4.60Cr
    await set(440 * L, RU[2])
    rec('4.40Cr -> 4.60Cr allowed (limit is 4.60Cr)', (await bid(U[1], 20 * L)) === null && (await state()) === 460 * L)
    expectErr('4.60Cr -> 4.80Cr blocked by purse lock', await bid(U[0], 20 * L), 'too little')
    await set(5 * CR, RU[2])
    expectErr('over total purse rejected', await bid(U[1], 25 * L), 'Insufficient')
    await setRU(1, 'squad_count', 3); await set(480 * L, RU[2])
    rec('minimum filled: 4.80Cr -> 5.00Cr allowed (no reserve)', (await bid(U[1], 20 * L)) === null && (await state()) === 5 * CR)
    await setRU(1, 'squad_count', 4); await set(3 * CR, RU[2])
    expectErr('squad at max rejected', await bid(U[1], 20 * L), 'Squad full')
    await setRU(1, 'squad_count', 0)

    const bh = await q('select count(*)::int n from bid_history where room_id=$1', [room])
    rec('bid_history rows written', bh.rows[0].n >= 10, 'rows=' + bh.rows[0].n)

    await q('update live_auction_state set is_active=false where room_id=$1', [room])
    const adm = async (uid, a, b) => {
      await as(uid); await q('savepoint a')
      try { await q('select public.admin_set_squad_sizes($1,$2,$3)', [room, a, b]); await q('release savepoint a'); return null }
      catch (e) { await q('rollback to savepoint a'); return e.message }
    }
    expectErr('non-admin cannot set squad sizes', await adm(U[1], 5, 6), 'Only room admin')
    expectErr('min>max rejected', await adm(U[0], 6, 5), 'Squad size must be')
    expectErr('max>30 rejected', await adm(U[0], 5, 31), 'Squad size must be')
    expectErr('min<1 rejected', await adm(U[0], 0, 5), 'Squad size must be')
    rec('admin sets 5/7', (await adm(U[0], 5, 7)) === null && (await q('select min_squad_size a from rooms where id=$1', [room])).rows[0].a === 5)
    await q('update live_auction_state set is_active=true where room_id=$1', [room])
    expectErr('squad sizes locked once active', await adm(U[0], 5, 7), 'before the auction starts')

    await q(`insert into user_squads(room_user_id,player_id,purchase_price) values($1,$2,$3)`, [RU[0], rp[1], 3 * CR])
    const vis = async (uid) => {
      await as(uid); await q('savepoint v')
      try { await q('set local role authenticated'); const r = await q('select count(*)::int n from user_squads where room_user_id=$1', [RU[0]]); await q('rollback to savepoint v'); return r.rows[0].n }
      catch (e) { await q('rollback to savepoint v'); return 'ERR ' + e.message }
    }
    const vm = await vis(U[1]), vo = await vis(U[3])
    rec('squad visible to another room member (RLS)', vm === 1, String(vm))
    rec('squad hidden from non-member (RLS)', vo === 0, String(vo))
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    const chk = room ? await c.query('select (select count(*) from rooms where id=$1)::int r', [room]) : { rows: [{ r: 'n/a' }] }
    console.log('rolled back; leftover sim rooms:', chk.rows[0].r)
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
