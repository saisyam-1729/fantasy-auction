/**
 * Database rule test: waivers (claims, weekly processing, priority, banked points).
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
    for (const f of ['draft.sql', 'fantasy_points.sql', 'draft_extras.sql', 'draft_admin.sql', 'draft_teams.sql', 'draft_waivers.sql']) await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8'))
    const pool = 'TESTW_' + u().slice(0, 8)
    const P = []
    for (let i = 0; i < 10; i++) P.push(Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values($1,$2::int,'T','P'||$2::text) returning id`, [pool, i])).rows[0].id))
    const U = [u(), u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'dw-' + id.slice(0, 8) + '@example.invalid'])
    await as(U[0])
    const d = (await q(`select * from public.create_draft_room('Waive',2,4,$1)`, [pool])).rows[0]; const D = d.id
    for (const x of [U[1], U[2]]) await call(x, 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key])

    // a second, unfinished draft to check the "only when finished" rule
    await as(U[0])
    const d2 = (await q(`select * from public.create_draft_room('Waive2',2,4,$1)`, [pool])).rows[0]
    await call(U[0], 'select public.draft_set_waivers_enabled($1,true)', [d2.id])
    let r = await call(U[0], 'select public.draft_set_waiver_claims($1,$2::bigint[],$3::bigint[])', [d2.id, [], []]); rec('waivers open only once the draft is finished', /once the draft is finished/.test(r.err || ''), r.err)

    for (let i = 0; i < 2; i++) await call(U[0], 'select public.draft_spin_wheel($1)', [D])
    await call(U[0], 'select public.draft_start($1)', [D])
    const order = (await q('select id, user_id from draft_members where draft_id=$1 order by order_pos', [D])).rows
    const slots = [0, 1, 2, 2, 1, 0]
    for (let i = 0; i < 6; i++) await call(order[slots[i]].user_id, 'select public.draft_make_pick($1,$2,$3)', [D, P[i], i])
    const A = order[0], B = order[1], C = order[2]
    rec('the draft finished', (await q('select status from draft_rooms where id=$1', [D])).rows[0].status === 'DONE')
    // A owns P0,P5; B owns P1,P4; C owns P2,P3. Free agents: P6..P9

    const rows = (pts) => JSON.stringify(P.map((id, i) => ({ player_id: id, points: pts[i], matches: 1 })))
    const score = async () => { const lb = (await call(A.user_id, 'select public.draft_leaderboard($1)', [D])).v; return Object.fromEntries(lb.rows.map((x) => [x.member_id, Number(x.points)])) }
    // P0=10 P1=30 P2=50 P6=100 P7=40
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([10, 30, 50, 0, 0, 0, 100, 40, 0, 0])])
    let s = await score()
    rec('starting scores: A 10, B 30, C 50', s[A.id] === 10 && s[B.id] === 30 && s[C.id] === 50, JSON.stringify(s))

    // enabling and validation
    r = await call(A.user_id, 'select public.draft_set_waiver_claims($1,$2::bigint[],$3::bigint[])', [D, [P[6]], [P[0]]]); rec('claims need waivers switched on', /not switched on/.test(r.err || ''), r.err)
    const nonHost = order.find((o) => o.user_id !== U[0])
    r = await call(nonHost.user_id, 'select public.draft_set_waivers_enabled($1,true)', [D]); rec('only the host switches waivers on', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_set_waivers_enabled($1,true)', [D]); rec('the host switches waivers on', !r.err, r.err)
    const claim = (uid, adds, drops) => call(uid, 'select public.draft_set_waiver_claims($1,$2::bigint[],$3::bigint[])', [D, adds, drops])
    r = await claim(U[3], [P[6]], [P[0]]); rec('an outsider cannot claim', /not in this draft/.test(r.err || ''), r.err)
    r = await claim(A.user_id, [P[6]], [P[1]]); rec('you can only drop your own player', /own players/.test(r.err || ''), r.err)
    r = await claim(A.user_id, [P[1]], [P[0]]); rec('you cannot add a player already on a team', /already on a team/.test(r.err || ''), r.err)
    r = await claim(A.user_id, [P[6], P[7], P[8], P[9]], [P[0], P[0], P[5], P[5]]); rec('at most 3 claims', /at most 3/.test(r.err || ''), r.err)
    r = await claim(A.user_id, [P[6], P[7]], [P[0]]); rec('adds and drops must pair up', /needs a player to add and a player to drop/.test(r.err || ''), r.err)

    // claims: A wants P6 for P0 (then P7 for P5); B wants P6 for P1; C wants P6 for P2, then P8 for P3
    r = await claim(A.user_id, [P[6], P[7]], [P[0], P[5]]); rec('a team files two ranked claims', !r.err && r.v === 2, r.err)
    r = await claim(A.user_id, [P[6], P[7]], [P[0], P[5]]); rec('filing again replaces the pending list', !r.err && r.v === 2 && (await q(`select count(*)::int n from draft_waiver_claims where member_id=$1`, [A.id])).rows[0].n === 2, r.err)
    await claim(B.user_id, [P[6]], [P[1]])
    await claim(C.user_id, [P[6], P[8]], [P[2], P[3]])
    await q(`insert into draft_captains(member_id, captain_id) values($1,$2)`, [A.id, P[0]])

    // privacy
    await as(B.user_id); await q('savepoint z'); await q('set local role authenticated')
    const seeOwn = (await q('select count(*)::int n from draft_waiver_claims where member_id=$1', [B.id])).rows[0].n
    const seeOthers = (await q('select count(*)::int n from draft_waiver_claims where member_id<>$1', [B.id])).rows[0].n
    await q('rollback to savepoint z')
    rec('you see your own pending claims, not other teams', seeOwn === 1 && seeOthers === 0, `${seeOwn}/${seeOthers}`)

    // run
    r = await call(nonHost.user_id, 'select public.draft_host_run_waivers($1)', [D]); rec('only a host runs the waivers', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_host_run_waivers($1)', [D]); rec('the host runs the waivers: two swaps', !r.err && r.v === 2, String(r.v ?? r.err))
    const st = async (m) => (await q(`select add_player_id::int a, status, note from draft_waiver_claims where member_id=$1 order by rank`, [m])).rows
    const sa = await st(A.id), sb = await st(B.id), sc = await st(C.id)
    rec('lowest team goes first and wins; its second claim is dropped', sa[0].status === 'WON' && sa[1].status === 'LOST' && /Another claim/.test(sa[1].note), JSON.stringify(sa))
    rec('a team whose target is taken loses', sb[0].status === 'LOST' && /already taken/.test(sb[0].note), JSON.stringify(sb))
    rec('a team falls back to its next claim', sc[0].status === 'LOST' && sc[1].status === 'WON', JSON.stringify(sc))
    const owns = async (m) => (await q('select player_id::int p from draft_picks where draft_id=$1 and member_id=$2 order by pick_no', [D, m])).rows.map((x) => x.p)
    rec('teams hold the new players', JSON.stringify(await owns(A.id)) === JSON.stringify([P[6], P[5]]) && JSON.stringify(await owns(C.id)) === JSON.stringify([P[2], P[8]]), JSON.stringify([await owns(A.id), await owns(C.id)]))
    rec('the dropped players are free agents again', ![...(await owns(A.id)), ...(await owns(B.id)), ...(await owns(C.id))].includes(P[0]))
    rec('a dropped captain is cleared', (await q('select captain_id from draft_captains where member_id=$1', [A.id])).rows[0].captain_id === null)

    // points continuity
    s = await score()
    rec('scores do not jump at the swap (dropped points are banked)', s[A.id] === 10 && s[B.id] === 30 && s[C.id] === 50, JSON.stringify(s))
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([15, 30, 50, 0, 0, 0, 120, 40, 7, 0])]) // P0 +5 (dropped), P6 +20 (A), P8 +7 (C)
    s = await score()
    rec('new players count from the swap on; dropped players stop counting', s[A.id] === 30 && s[C.id] === 57 && s[B.id] === 30, JSON.stringify(s))

    // someone who picks up a dropped player gets only points from then on
    await claim(B.user_id, [P[0]], [P[1]])
    await call(U[0], 'select public.draft_host_run_waivers($1)', [D])
    s = await score()
    rec('a re-claimed player carries no earlier points', s[B.id] === 30, JSON.stringify(s))
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([25, 30, 50, 0, 0, 0, 120, 40, 7, 0])]) // P0 +10 now for B
    s = await score()
    rec('...and earns from the swap on', s[B.id] === 40, JSON.stringify(s))

    // leaderboard still sums players + banked; resetting clears banked
    const banked = Number((await q('select banked from draft_member_bonus where member_id=$1', [A.id])).rows[0].banked)
    rec('banked points are stored per team', banked === 10, String(banked))
    await call(null, 'select public.set_draft_points_baseline($1)', [D])
    s = await score()
    rec('a points reset clears banked points too', Object.values(s).every((x) => x === 0), JSON.stringify(s))

    // Monday processing inside the nightly sync (the date is faked inside this test)
    await q(`create or replace function public._points_day() returns date language sql stable as $$ select date '2026-12-01' $$`) // a Tuesday
    await claim(C.user_id, [P[9]], [P[2]])
    r = await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([25, 30, 50, 0, 0, 0, 120, 40, 7, 0])])
    rec('the nightly sync leaves waivers alone on a Tuesday', !r.err && r.v.waiver_swaps === 0 && (await st(C.id)).some((x) => x.status === 'PENDING'), JSON.stringify(r.v))
    await q(`create or replace function public._points_day() returns date language sql stable as $$ select date '2026-11-30' $$`) // a Monday
    r = await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([25, 30, 50, 0, 0, 0, 120, 40, 7, 0])])
    rec('...and processes them on Monday', !r.err && r.v.waiver_swaps === 1 && (await owns(C.id)).includes(P[9]), JSON.stringify(r.v))

    // switching waivers off stops the host run
    await call(U[0], 'select public.draft_set_waivers_enabled($1,false)', [D])
    r = await call(U[0], 'select public.draft_host_run_waivers($1)', [D]); rec('with waivers off nothing runs', /not switched on/.test(r.err || ''), r.err)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
