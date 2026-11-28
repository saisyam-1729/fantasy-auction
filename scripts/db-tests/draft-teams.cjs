/**
 * Database rule test: team identity and captains (2x / 1.5x bonus, pending until the next sync).
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
    for (const f of ['draft.sql', 'fantasy_points.sql', 'draft_extras.sql', 'draft_admin.sql', 'draft_teams.sql']) await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8'))
    const pool = 'TESTT_' + u().slice(0, 8)
    const P = []
    for (let i = 0; i < 6; i++) P.push(Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values($1,$2::int,'T','P'||$2::text) returning id`, [pool, i])).rows[0].id))
    const U = [u(), u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'dt-' + id.slice(0, 8) + '@example.invalid'])
    await as(U[0])
    const d = (await q(`select * from public.create_draft_room('Teams',2,4,$1)`, [pool])).rows[0]; const D = d.id
    for (const x of [U[1], U[2]]) await call(x, 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key])

    // identity
    let r = await call(U[3], `select public.draft_set_team_identity($1,'Out Siders','🦁','#10b981')`, [D]); rec('an outsider cannot set a team identity', /not in this draft/.test(r.err || ''), r.err)
    r = await call(U[1], `select public.draft_set_team_identity($1,'X','🦁',null)`, [D]); rec('a one-letter team name is rejected', /2 to 24/.test(r.err || ''), r.err)
    r = await call(U[1], `select public.draft_set_team_identity($1,'Sai''s   Sixers','🦁','#10B981')`, [D])
    const row = (await q(`select team_name, team_emoji, team_color from draft_members where draft_id=$1 and user_id=$2`, [D, U[1]])).rows[0]
    rec('a member names their team (tidied, colour lower-cased)', !r.err && row.team_name === "Sai's Sixers" && row.team_emoji === '🦁' && row.team_color === '#10b981', r.err || JSON.stringify(row))
    r = await call(U[1], `select public.draft_set_team_identity($1,'Ok Name','🦁','green')`, [D]); rec('a bad colour is rejected', /Colour/.test(r.err || ''), r.err)
    r = await call(U[1], `select public.draft_set_team_identity($1,null,null,null)`, [D])
    rec('identity can be cleared', !r.err && (await q(`select team_name from draft_members where draft_id=$1 and user_id=$2`, [D, U[1]])).rows[0].team_name === null, r.err)
    await as(U[1]); await q('savepoint z'); let blocked = false
    try { await q('set local role authenticated'); await q(`update draft_members set team_name='hack' where draft_id=$1`, [D]) } catch (e) { blocked = /permission denied/.test(e.message) }
    await q('rollback to savepoint z'); rec('browsers cannot edit teams directly', blocked)

    // start the draft: 3 teams x 2 picks
    for (let i = 0; i < 2; i++) await call(U[0], 'select public.draft_spin_wheel($1)', [D])
    await call(U[0], 'select public.draft_start($1)', [D])
    const order = (await q('select id, user_id from draft_members where draft_id=$1 order by order_pos', [D])).rows
    const slots = [0, 1, 2, 2, 1, 0]
    for (let i = 0; i < 6; i++) await call(order[slots[i]].user_id, 'select public.draft_make_pick($1,$2,$3)', [D, P[i], i])
    // team A (order[0]) owns P0,P5; B owns P1,P4; C owns P2,P3
    const A = order[0]

    r = await call(A.user_id, 'select public.draft_set_captains($1,$2,$3)', [D, P[0], P[5]]); rec('captains must be switched on first', /not switched on/.test(r.err || ''), r.err)
    const notHost = order.find((o) => o.user_id !== U[0])
    r = await call(notHost.user_id, 'select public.draft_set_captains_enabled($1,true)', [D]); rec('only the host switches captains on', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_set_captains_enabled($1,true)', [D]); rec('the host switches captains on', !r.err, r.err)
    r = await call(A.user_id, 'select public.draft_set_captains($1,$2,null)', [D, P[1]]); rec('a captain must be on your own team', /one of your players/.test(r.err || ''), r.err)
    r = await call(A.user_id, 'select public.draft_set_captains($1,$2,$2)', [D, P[0]]); rec('captain and vice must differ', /different players/.test(r.err || ''), r.err)
    r = await call(U[3], 'select public.draft_set_captains($1,$2,null)', [D, P[0]]); rec('an outsider cannot choose captains', /not in this draft/.test(r.err || ''), r.err)

    const rows = (pts) => JSON.stringify(P.map((id, i) => ({ player_id: id, points: pts[i], matches: 1 })))
    const score = async (uid) => { const lb = (await call(uid, 'select public.draft_leaderboard($1)', [D])).v; return Object.fromEntries(lb.rows.map((x) => [x.member_id, Number(x.points)])) }
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([10, 0, 0, 0, 0, 10])])   // sync 1: baseline totals
    r = await call(A.user_id, 'select public.draft_set_captains($1,$2,$3)', [D, P[0], P[5]]); rec('a member chooses captain and vice', !r.err, r.err)
    let s = await score(A.user_id)
    rec('a choice is pending: nothing changes yet', s[A.id] === 20, JSON.stringify(s))
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([30, 0, 0, 0, 0, 10])])   // sync 2: P0 +20, but captain not active yet
    s = await score(A.user_id)
    rec('points scored before the choice is active get no bonus', s[A.id] === 40, JSON.stringify(s))
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([40, 0, 0, 0, 0, 30])])   // sync 3: P0 +10 (captain), P5 +20 (vice)
    s = await score(A.user_id)
    // players: 40+30=70; bonus: captain 10*1.0 + vice 20*0.5 = 20
    rec('captain earns 2x and vice 1.5x from the next update on', s[A.id] === 90, JSON.stringify(s))
    const bonus = Number((await q('select points from draft_member_bonus where member_id=$1', [A.id])).rows[0].points)
    rec('the bonus is stored per team', bonus === 20, String(bonus))

    // a captain no longer on the team stops earning
    await q(`delete from draft_picks where draft_id=$1 and member_id=$2 and player_id=$3`, [D, A.id, P[0]])
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([90, 0, 0, 0, 0, 30])])
    const bonus2 = Number((await q('select points from draft_member_bonus where member_id=$1', [A.id])).rows[0].points)
    rec('a captain no longer on the team earns no bonus', bonus2 === 20, String(bonus2))

    // reset to zero clears bonuses
    await call(null, 'select public.set_draft_points_baseline($1)', [D])
    const left = (await q('select count(*)::int n from draft_member_bonus where draft_id=$1', [D])).rows[0].n
    s = await score(A.user_id)
    rec('resetting points clears captain bonuses', left === 0 && Object.values(s).every((x) => x === 0), JSON.stringify(s))

    // members see everyone's choice; outsiders see none
    await as(U[2]); await q('savepoint z'); await q('set local role authenticated')
    const seen = (await q('select count(*)::int n from draft_captains')).rows[0].n
    await q('rollback to savepoint z'); rec('members can see captain choices', seen >= 1, String(seen))
    await as(U[3]); await q('savepoint z'); await q('set local role authenticated')
    const none = (await q('select count(*)::int n from draft_captains')).rows[0].n + (await q('select count(*)::int n from draft_member_bonus')).rows[0].n
    await q('rollback to savepoint z'); rec('outsiders see no captain data', none === 0, String(none))
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
