/**
 * Database rule test: fantasy points sync, daily snapshots and the draft leaderboard.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Reads SUPABASE_DB_URL from .env.local. Prefer a staging database.
 * Run all with: npm run db:test
 */
const fs = require('fs'), path = require('path'), { Client } = require('pg'), crypto = require('crypto')
const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
const u = () => crypto.randomUUID()
const results = []
const rec = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')) }
;(async () => {
  const c = new Client({ connectionString: env, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p)
  const as = (uid) => q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid || '', uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : ''])
  const call = async (uid, sql, params, role) => {
    await as(uid); await q('savepoint k')
    try {
      if (role) await q(`set local role ${role}`)
      const r = await q(sql, params); await q('release savepoint k'); return { v: r.rows[0] && Object.values(r.rows[0])[0] }
    } catch (e) { await q('rollback to savepoint k'); return { err: e.message } }
  }
  try {
    await q('begin')
    for (const f of ['draft.sql', 'fantasy_points.sql']) await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8'))

    const pool = 'TESTFP_' + u().slice(0, 8)
    const P = []
    for (let i = 0; i < 6; i++) P.push(Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values($1,$2::int,'T','P'||$2::text) returning id`, [pool, i])).rows[0].id))
    const U = [u(), u(), u(), u()] // U[3] outsider
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'fp-' + id.slice(0, 8) + '@example.invalid'])
    const D = u()
    await q(`insert into draft_rooms(id,room_code,room_key,name,pool,owner_id,status,picks_per_team) values($1,'FP_'||$2,'123456','FP',$3,$4,'DONE',2)`, [D, D.slice(0, 6), pool, U[0]])
    const M = [u(), u(), u()]
    for (let i = 0; i < 3; i++) await q(`insert into draft_members(id,draft_id,user_id,username,is_host,order_pos) values($1,$2,$3,$4,$5,$6)`, [M[i], D, U[i], 'm' + i, i === 0, i + 1])
    // A: P0,P5  B: P1,P4  C: P2,P3
    const owner = [0, 1, 2, 2, 1, 0]
    for (let i = 0; i < 6; i++) await q(`insert into draft_picks(draft_id,pick_no,member_id,player_id) values($1,$2,$3,$4)`, [D, i, M[owner[i]], P[i]])

    const rows = (pts) => JSON.stringify(pts.map((p, i) => ({ player_id: P[i], points: p, matches: 1 })))
    let r = await call(U[0], 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([10, 20, 30, 0, 0, 0])], 'authenticated')
    rec('a signed-in player cannot run the sync', /permission denied/.test(r.err || ''), r.err)

    // day 1 (pretend yesterday): A=10, B=20, C=30
    r = await call(null, 'select public.sync_player_points($1,$2::jsonb,6)', [pool, rows([10, 20, 30, 0, 0, 0])])
    rec('the job syncs points', !r.err && r.v.matched === 6 && r.v.drafts === 1, r.err || JSON.stringify(r.v))
    await q(`update draft_standings_daily set day = day - 1 where draft_id=$1`, [D])
    await q(`update player_points_daily set day = day - 1 where player_id = any($1::bigint[])`, [P])

    // day 2 (today): A=10+50=60, B=20+5=25, C=30
    r = await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([10, 20, 30, 0, 5, 50])])
    rec('a second day syncs', !r.err, r.err)
    const snaps = (await q(`select count(distinct day)::int n from draft_standings_daily where draft_id=$1`, [D])).rows[0].n
    rec('standings are kept per day', snaps === 2, String(snaps))

    r = await call(U[3], 'select public.draft_leaderboard($1)', [D]); rec('an outsider cannot read the leaderboard', /not in this draft/.test(r.err || ''), r.err)
    r = await call(U[1], 'select public.draft_leaderboard($1)', [D])
    const lb = r.v
    const by = Object.fromEntries((lb?.rows || []).map((x) => [x.username, x]))
    rec('a member reads the leaderboard', !r.err && lb.rows.length === 3, r.err)
    rec('current points are summed from picks', Number(by.m0.points) === 60 && Number(by.m1.points) === 25 && Number(by.m2.points) === 30, JSON.stringify(lb.rows.map((x) => [x.username, x.points])))
    rec('ranks are by points', by.m0.rank === 1 && by.m2.rank === 2 && by.m1.rank === 3)
    rec('previous day points and rank are included', Number(by.m0.prev_points) === 10 && by.m0.prev_rank === 3 && by.m2.prev_rank === 1, JSON.stringify([by.m0.prev_points, by.m0.prev_rank, by.m2.prev_rank]))
    rec('rows come in rank order', lb.rows.map((x) => x.username).join() === 'm0,m2,m1')
    const p5 = by.m0.players.find((p) => p.player_id === P[5])
    rec('each team lists its players with today and yesterday points', by.m0.players.length === 2 && Number(p5.points) === 50 && Number(p5.prev_points) === 0, JSON.stringify(p5))
    rec('the leaderboard knows when points were last synced', Boolean(lb.synced_at) && lb.previous_day < lb.latest_day)

    // ties share a rank
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([30, 30, 30, 0, 0, 0])])
    r = await call(U[0], 'select public.draft_leaderboard($1)', [D])
    rec('tied teams share a rank', r.v.rows.every((x) => x.rank === 1), JSON.stringify(r.v.rows.map((x) => x.rank)))

    // a player from another pool is ignored
    const other = Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values('OTHER_'||$1,0,'T','X') returning id`, [pool])).rows[0].id)
    r = await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, JSON.stringify([{ player_id: other, points: 99 }])])
    rec('players from another pool are ignored', !r.err && r.v.matched === 0, r.err)

    await as(U[1]); await q('savepoint z'); let blocked = false
    try { await q('set local role authenticated'); await q('update player_points set points=999 where player_id=$1', [P[1]]) } catch (e) { blocked = /permission denied/.test(e.message) }
    await q('rollback to savepoint z'); rec('browsers cannot edit points', blocked)

    // starting points: reset the draft to zero, then only new points count
    r = await call(U[0], 'select public.set_draft_points_baseline($1)', [D], 'authenticated')
    rec('a player cannot reset the scores', /permission denied/.test(r.err || ''), r.err)
    r = await call(null, 'select public.set_draft_points_baseline($1)', [D])
    rec('the baseline is saved', !r.err && r.v === 3, r.err || String(r.v))
    r = await call(U[0], 'select public.draft_leaderboard($1)', [D])
    rec('after the reset every team is on zero', r.v.rows.every((x) => Number(x.points) === 0 && x.players.every((p) => Number(p.points) === 0)), JSON.stringify(r.v.rows.map((x) => x.points)))
    const today = (await q('select count(*)::int n from draft_standings_daily where draft_id=$1 and day=public._points_day() and points=0', [D])).rows[0].n
    rec("today's snapshot is redone at zero", today === 3, String(today))
    await call(null, 'select public.sync_player_points($1,$2::jsonb)', [pool, rows([40, 30, 30, 7, 0, 0])]) // A +10, C +7
    r = await call(U[0], 'select public.draft_leaderboard($1)', [D])
    const after = Object.fromEntries(r.v.rows.map((x) => [x.username, Number(x.points)]))
    rec('only points scored after the reset count', after.m0 === 10 && after.m2 === 7 && after.m1 === 0, JSON.stringify(after))

    const src = (await q(`select url from fantasy_sources where pool='ILT20_2026'`)).rows[0]
    rec('ILT20 points source is configured', /statz\.ai/.test(src?.url || ''), src?.url)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
