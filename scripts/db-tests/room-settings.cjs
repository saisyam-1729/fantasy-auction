/**
 * Database rule test: per-room budget, timer length and bid steps.
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
  const as = (uid) => q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid || '', uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : ''])
  const call = async (uid, sql, params) => {
    await as(uid); await q('savepoint k')
    try { const r = await q(sql, params); await q('release savepoint k'); return { v: r.rows[0] && Object.values(r.rows[0])[0], rows: r.rows } }
    catch (e) { await q('rollback to savepoint k'); return { err: e.message } }
  }
  const tryInsert = async (sql, params) => {
    await q('savepoint ins')
    try { await q(sql, params); await q('release savepoint ins'); return null } catch (e) { await q('rollback to savepoint ins'); return e.message }
  }
  try {
    await q('begin')
    const U = [u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'rs-' + id.slice(0, 8) + '@example.invalid'])

    // ---- validation
    const mk = (extra) => `insert into rooms(id,room_name,room_id,room_key,admin_user_id,status${extra.cols}) values('${u()}','RS','RS-${u().slice(0, 6)}','k','${U[0]}','WAITING'${extra.vals})`
    const bad = async (label, cols, vals, re) => {
      const e = await tryInsert(mk({ cols, vals }))
      rec(label, !!e && re.test(e), e || 'accepted!')
    }
    await bad('timer under 10s is rejected', ',bid_timer_seconds', ',5', /rooms_settings_check/)
    await bad('timer over 120s is rejected', ',bid_timer_seconds', ',121', /rooms_settings_check/)
    await bad('budget under 1 Cr is rejected', ',budget', ',5000000', /rooms_settings_check/)
    await bad('second threshold must exceed the first', ',slab_config', `,'{"t1":50000000,"t2":20000000,"s1":1000000,"s2":2000000,"s3":2500000}'::jsonb`, /rooms_settings_check/)
    await bad('a zero bid step is rejected', ',slab_config', `,'{"t1":20000000,"t2":50000000,"s1":0,"s2":2000000,"s3":2500000}'::jsonb`, /rooms_settings_check/)
    await bad('a missing key in the bid steps is rejected', ',slab_config', `,'{"t1":20000000,"t2":50000000,"s1":1000000}'::jsonb`, /rooms_settings_check/)

    // ---- a room with custom settings, created the way the dashboard does it (as the browser user)
    const cfg = { t1: CR, t2: 3 * CR, s1: 5 * L, s2: 10 * L, s3: 20 * L }
    const room = u()
    await as(U[0]); await q('set local role authenticated')
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,budget,bid_timer_seconds,slab_config,min_squad_size,max_squad_size,auto_hammer) values($1,'RS cust','RS-'||$2,'key1',$3,'WAITING',$4,15,$5::jsonb,2,4,true)`, [room, room.slice(0, 6), U[0], 20 * CR, JSON.stringify(cfg)])
    await q(`insert into room_users(id,room_id,user_id,username,display_name,is_admin,budget) values($1,$2,$3,'host','host',true,5)`, [u(), room, U[0]])
    await q('reset role')
    const hostRow = (await q('select budget::bigint b from room_users where room_id=$1 and user_id=$2', [room, U[0]])).rows[0]
    rec('the host starts with the room budget (client value ignored)', Number(hostRow.b) === 20 * CR, String(hostRow.b))

    const code = (await q('select room_id from rooms where id=$1', [room])).rows[0].room_id
    let r = await call(U[1], `select public.join_room($1,'key1')`, [code]); rec('a joining player gets the room budget', !r.err, r.err)
    const bRow = (await q('select id,budget::bigint b from room_users where room_id=$1 and user_id=$2', [room, U[1]])).rows[0]
    rec('joined player budget is 20 Cr', Number(bRow.b) === 20 * CR, String(bRow.b))
    await call(U[2], `select public.join_room($1,'key1')`, [code])

    // a default room keeps the old defaults
    const room2 = u()
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status) values($1,'RS def','RS-'||$2,'key2',$3,'WAITING')`, [room2, room2.slice(0, 6), U[0]])
    const d = (await q('select budget::bigint b, bid_timer_seconds t, slab_config c from rooms where id=$1', [room2])).rows[0]
    rec('a default room: 100 Cr, 30 s, default steps', Number(d.b) === 1e9 && d.t === 30 && d.c === null, JSON.stringify(d))

    // ---- bid steps for the custom room
    const iv = u(), rp = u()
    await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'RS',$2,'RSP','BAT',2000000)`, [iv, 'rs' + iv.slice(0, 6)])
    await q(`insert into room_players(id,room_id,player_inventory_id,status) values($1,$2,$3,'UNSOLD')`, [rp, room, iv])
    await q(`insert into live_auction_state(room_id,current_player_id,current_bid,is_active,is_paused,last_bid_time,start_time) values($1,$2,$3,true,false,clock_timestamp(),clock_timestamp())`, [room, rp, 20 * L])
    const inc = async (cur) => Number((await q('select public._auction_slab_increment($1,$2) v', [room, cur])).rows[0].v)
    rec('below the first threshold the step is 5 L', (await inc(20 * L)) === 5 * L)
    rec('a step that would pass the first threshold snaps to it', (await inc(97 * L)) === 3 * L && (await inc(95 * L)) === 5 * L)
    rec('between thresholds the step is 10 L', (await inc(CR)) === 10 * L)
    rec('snaps to the second threshold', (await inc(295 * L)) === 5 * L)
    rec('above the second threshold the step is 20 L', (await inc(3 * CR)) === 20 * L)
    rec('a default room still uses 10 / 20 / 25 L', (await q('select public._auction_slab_increment($1,$2) v', [room2, 30 * L])).rows[0].v === '1000000' && (await q('select public._auction_slab_increment($1,$2) v', [room2, 2 * CR])).rows[0].v === '2000000' && (await q('select public._auction_slab_increment($1,$2) v', [room2, 5 * CR])).rows[0].v === '2500000')

    r = await call(U[1], 'select public.place_auction_bid($1,$2)', [room, 10 * L]); rec('the old 10 L step is rejected in the custom room', /next slab step/.test(r.err || ''), r.err)
    r = await call(U[1], 'select public.place_auction_bid($1,$2)', [room, 5 * L]); rec('the custom 5 L step is accepted', !r.err, r.err)
    const cb = Number((await q('select current_bid::bigint v from live_auction_state where room_id=$1', [room])).rows[0].v)
    rec('the bid became 25 L', cb === 25 * L, String(cb))

    // ---- the timer in the custom room is 15 s
    const fin = () => call(U[2], 'select public.auction_finalize_expired($1)', [room])
    await q(`update live_auction_state set last_bid_time = clock_timestamp() - interval '14 seconds' where room_id=$1`, [room])
    rec('at 14 s a 15 s lot has not sold', (await fin()).v === 'waiting')
    await q(`update live_auction_state set last_bid_time = clock_timestamp() - interval '16 seconds' where room_id=$1`, [room])
    rec('at 16 s a 15 s lot sells', (await fin()).v === 'sold')
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
