/**
 * Database rule test: draft wishlists, the pick timer and auto-pick.
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
  const call = async (uid, sql, params) => {
    await as(uid); await q('savepoint k')
    try { const r = await q(sql, params); await q('release savepoint k'); return { v: r.rows[0] && Object.values(r.rows[0])[0], rows: r.rows } }
    catch (e) { await q('rollback to savepoint k'); return { err: e.message } }
  }
  try {
    await q('begin')
    for (const f of ['draft.sql', 'fantasy_points.sql', 'draft_extras.sql']) await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8'))
    const pool = 'TESTX_' + u().slice(0, 8)
    const P = []
    for (let i = 0; i < 10; i++) P.push(Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values($1,$2::int,'T','P'||$2::text) returning id`, [pool, i])).rows[0].id))
    const U = [u(), u(), u(), u()]
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'dx-' + id.slice(0, 8) + '@example.invalid'])

    let r = await call(U[0], `select * from public.create_draft_room('Timed',2,4,$1,5)`, [pool]); rec('a pick timer below 15 s is rejected', /15 to 600/.test(r.err || ''), r.err)
    r = await call(U[0], `select * from public.create_draft_room('Timed',2,4,$1,30)`, [pool])
    const d = r.rows?.[0]; const D = d?.id
    rec('a timed draft can be created', !r.err && (await q('select pick_seconds from draft_rooms where id=$1', [D])).rows[0].pick_seconds === 30, r.err)
    r = await call(U[0], `select * from public.create_draft_room('Untimed',2,4,$1)`, [pool])
    const D2 = r.rows?.[0]?.id
    rec('the timer is optional', !r.err && (await q('select pick_seconds from draft_rooms where id=$1', [D2])).rows[0].pick_seconds === null, r.err)
    for (const x of [U[1], U[2]]) await call(x, 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key])

    // wishlists
    r = await call(U[3], 'select public.draft_set_wishlist($1,$2::bigint[])', [D, [P[0]]]); rec('an outsider cannot keep a wishlist', /not in this draft/.test(r.err || ''), r.err)
    const other = Number((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values('OTHER_'||$1,0,'T','X') returning id`, [pool])).rows[0].id)
    r = await call(U[1], 'select public.draft_set_wishlist($1,$2::bigint[])', [D, [P[7], P[3], other, P[7]]])
    rec('a wishlist keeps order, drops duplicates and other pools', r.v === 2, String(r.v ?? r.err))
    await as(U[2]); await q('savepoint z'); await q('set local role authenticated')
    const peek = (await q('select count(*)::int n from draft_wishlist')).rows[0].n
    await q('rollback to savepoint z'); rec('wishlists are private', peek === 0, String(peek))
    await as(U[1]); await q('savepoint z'); await q('set local role authenticated')
    const own = (await q('select player_id::int from draft_wishlist order by rank')).rows.map((x) => x.player_id)
    await q('rollback to savepoint z'); rec('a member reads their own list in order', JSON.stringify(own) === JSON.stringify([P[7], P[3]]), JSON.stringify(own))

    // start: order members, start, the clock starts
    for (let i = 0; i < 2; i++) await call(U[0], 'select public.draft_spin_wheel($1)', [D])
    await call(U[0], 'select public.draft_start($1)', [D])
    const started = (await q('select turn_started_at from draft_rooms where id=$1', [D])).rows[0].turn_started_at
    rec('the clock starts with the draft', Boolean(started))
    const order = (await q('select m.id, m.user_id from draft_members m where draft_id=$1 order by order_pos', [D])).rows

    r = await call(U[0], 'select public.draft_auto_pick($1,0)', [D]); rec('no auto-pick before the turn runs out', /not run out/.test(r.err || ''), r.err)
    await q(`update draft_rooms set turn_started_at = now() - interval '31 seconds' where id=$1`, [D])
    r = await call(U[0], 'select public.draft_auto_pick($1,1)', [D]); rec('a stale pick number does nothing', !r.err && r.v === null, r.err)

    await call(order[0].user_id, 'select public.draft_set_wishlist($1,$2::bigint[])', [D, [P[5], P[2]]])
    r = await call(U[3], 'select public.draft_auto_pick($1,0)', [D]); rec('an outsider cannot trigger auto-pick', /not in this draft/.test(r.err || ''), r.err)
    r = await call(order[2].user_id, 'select public.draft_auto_pick($1,0)', [D])
    rec('auto-pick takes the top of the wishlist', Number(r.v) === P[5], String(r.v ?? r.err))
    const pk = (await q('select member_id, picked_by from draft_picks where draft_id=$1 and pick_no=0', [D])).rows[0]
    rec('the pick goes to the team on the clock', pk.member_id === order[0].id && pk.picked_by === null)
    // the turn was back-dated 31 s; after the pick it is "now" again (now() is fixed within this test's transaction)
    const restarted = (await q('select turn_started_at = now() as fresh from draft_rooms where id=$1', [D])).rows[0].fresh
    rec('the clock restarts after a pick', restarted === true)
    r = await call(U[0], 'select public.draft_auto_pick($1,1)', [D]); rec('the next turn has its own full time', /not run out/.test(r.err || ''), r.err)

    // second team: no wishlist, so the player with the most points
    await q(`insert into player_points(player_id,pool,points) values($1,$2,50),($3,$2,70)`, [P[8], pool, P[9]])
    await q(`update draft_rooms set turn_started_at = now() - interval '40 seconds' where id=$1`, [D])
    r = await call(U[0], 'select public.draft_auto_pick($1,1)', [D]); rec('without a wishlist, auto-pick takes the most points', Number(r.v) === P[9], String(r.v ?? r.err))

    r = await call(order[2].user_id, 'select public.draft_make_pick($1,$2,2)', [D, P[0]]); rec('manual picks still work', r.v === 2, r.err)
    r = await call(U[0], 'select public.draft_undo_pick($1)', [D]); rec('undo still works', !r.err, r.err)

    r = await call(U[0], 'select public.draft_auto_pick($1,0)', [D2]); rec('an untimed draft never auto-picks', !r.err && r.v === null, r.err)

    r = await call(U[1], 'select count(*)::int from public.draft_pool_points($1)', [D]); rec('members see pool points', r.v === 2, String(r.v ?? r.err))
    r = await call(U[3], 'select count(*)::int from public.draft_pool_points($1)', [D]); rec('outsiders see no pool points', r.v === 0, String(r.v ?? r.err))

    r = await call(U[0], 'select public.draft_delete_room($1)', [D]); rec('a draft with picks can still be deleted', !r.err, r.err)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
