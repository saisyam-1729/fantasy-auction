/**
 * Database rule test: pause reasons, host Close with message, away auto-pause.
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
  const st = async () => (await q('select is_active,is_paused,pause_reason,pause_message,resumed_at from live_auction_state where room_id=$1', [room])).rows[0]
  const seen = (ruId, secondsAgo) => q(`update room_users set last_seen_at = clock_timestamp() - ($2 || ' seconds')::interval where id=$1`, [ruId, String(secondsAgo)])
  const hb = (uid) => call(uid, 'select public.auction_heartbeat($1)', [room])
  try {
    await q('begin')
    const U = [u(), u(), u(), u()] // U[3] outsider
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'pc-' + id.slice(0, 8) + '@example.invalid'])
    room = u(); const RU = [u(), u(), u()]
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,min_squad_size,max_squad_size,auto_hammer) values($1,'PC','PC-'||$2,'k',$3,'WAITING',2,4,true)`, [room, room.slice(0, 6), U[0]])
    const names = ['Hosty', 'Awayo', 'Stayo']
    for (let i = 0; i < 3; i++) await q(`insert into room_users(id,room_id,user_id,username,display_name,budget,spent,squad_count,is_admin) values($1,$2,$3,$4,$4,1000000000,0,0,$5)`, [RU[i], room, U[i], names[i], i === 0])
    const iv = u(), rp = u()
    await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'PC',$2,'PCP','BAT',2000000)`, [iv, 'pc' + iv.slice(0, 6)])
    await q(`insert into room_players(id,room_id,player_inventory_id,status) values($1,$2,$3,'UNSOLD')`, [rp, room, iv])
    await q(`insert into live_auction_state(room_id,current_player_id,current_bid,is_active,is_paused,last_bid_time,start_time,resumed_at) values($1,$2,$3,true,false,clock_timestamp(),clock_timestamp() - interval '5 minutes',clock_timestamp() - interval '5 minutes')`, [room, rp, 20 * L])

    // ---- Close
    let r = await call(U[1], `select public.auction_close($1,'hello')`, [room]); rec('non-admin cannot close', /Only room admin/.test(r.err || ''), r.err)
    const long = ('word ').repeat(100)
    r = await call(U[0], 'select public.auction_close($1,$2)', [room, '  ' + long + '  ']); rec('admin closes the auction', !r.err, r.err)
    let s = await st()
    rec('closed: paused with reason', s.is_paused === true && s.pause_reason === 'closed')
    rec('message is trimmed and capped at 280 chars', typeof s.pause_message === 'string' && s.pause_message.length <= 280 && !/^\s|\s$/.test(s.pause_message), 'len=' + (s.pause_message || '').length)
    r = await call(U[1], 'select public.place_auction_bid($1,$2)', [room, 10 * L]); rec('bids blocked while closed', /paused/i.test(r.err || ''), r.err)
    r = await call(U[0], `select public.auction_close($1,null)`, [room]); rec('closing again is harmless and keeps it closed', !r.err && (await st()).pause_reason === 'closed')
    r = await call(U[0], 'select public.auction_set_paused($1,false)', [room]); rec('host resumes', !r.err, r.err)
    s = await st()
    rec('resume clears reason and message, stamps resumed_at', s.is_paused === false && s.pause_reason === null && s.pause_message === null && s.resumed_at && Date.now() - new Date(s.resumed_at).getTime() < 60000)
    r = await call(U[0], `select public.auction_close($1,null)`, [room]); const empty = await st()
    rec('close without a message stores no message', !r.err && empty.pause_message === null)
    await call(U[0], 'select public.auction_set_paused($1,false)', [room])

    // ---- Host pause default reason
    await call(U[0], 'select public.auction_set_paused($1,true)', [room])
    rec('plain host pause has reason host', (await st()).pause_reason === 'host')
    await call(U[0], 'select public.auction_set_paused($1,false)', [room])

    // ---- Away detection
    await q(`update live_auction_state set resumed_at = clock_timestamp() - interval '5 minutes' where room_id=$1`, [room])
    await seen(RU[1], 100)   // Awayo was seen after the resume, then went quiet
    r = await hb(U[2]); rec('heartbeat from a present member pauses for an away member', r.v === 'paused', r.err)
    s = await st()
    rec('pause reason is away and names the missing player', s.is_paused && s.pause_reason === 'away' && /Awayo/.test(s.pause_message) && !/Stayo/.test(s.pause_message), s.pause_message)
    rec('second heartbeat while paused is a no-op', (await hb(U[2])).v === 'ok')
    const fin = await call(U[2], 'select public.auction_finalize_expired($1)', [room]); rec('auto-sell does not fire while away-paused', fin.v === 'waiting')

    // host resumes while Awayo is still gone: not paused again
    await call(U[0], 'select public.auction_set_paused($1,false)', [room])
    r = await hb(U[2]); rec('host can carry on without the missing player', r.v === 'ok' && (await st()).is_paused === false, r.err)

    // someone who was never seen (no heartbeat yet) is not "away"
    await q('update room_users set last_seen_at = null where room_id=$1', [room])
    await q(`update live_auction_state set resumed_at = clock_timestamp() - interval '5 minutes' where room_id=$1`, [room])
    rec('members with no heartbeat yet are ignored', (await hb(U[2])).v === 'ok')

    // access rules
    rec('outsider heartbeat rejected', /not in this room/i.test((await hb(U[3])).err || ''))
    rec('signed-out heartbeat rejected', /Not authenticated/.test((await hb(null)).err || ''))

    // a new auction clears any old pause details
    await q(`update live_auction_state set is_paused=true, pause_reason='closed', pause_message='old' where room_id=$1`, [room])
    await q('update live_auction_state set is_active=false where room_id=$1', [room])
    await q('update live_auction_state set is_active=true, is_paused=false where room_id=$1', [room])
    s = await st(); rec('starting clears old reason and message', s.pause_reason === null && s.pause_message === null && !!s.resumed_at)

    r = await call(U[0], `select public.auction_close($1,'x')`, [room]); await q('update live_auction_state set is_active=false where room_id=$1', [room])
    r = await call(U[0], `select public.auction_close($1,'x')`, [room]); rec('cannot close when no auction is active', /No active auction/.test(r.err || ''), r.err)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
