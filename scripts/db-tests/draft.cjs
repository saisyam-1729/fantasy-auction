/**
 * Database rule test: draft rooms (join, wheel, snake order, picks, undo, security).
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Temporary auth users are inserted, and request.jwt.claim.sub is set to act as them.
 * Reads SUPABASE_DB_URL from .env.local. Prefer a staging database.
 * Run all with: npm run db:test
 */
const fs = require('fs'), { Client } = require('pg'), crypto = require('crypto')
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
    // load the draft schema and seed inside this transaction, so the test also covers them
    for (const f of ['draft.sql', 'draft_pool_smat2026_seed.generated.sql', 'fantasy_points.sql', 'draft_extras.sql']) await q(fs.readFileSync(require('path').join(__dirname, '..', '..', 'supabase', f), 'utf8'))
    const U = Array.from({ length: 6 }, u) // U[0] host, U[1..3] players, U[4] outsider, U[5] late
    for (const id of U) await q(`insert into auth.users(id,aud,role,email,raw_user_meta_data) values($1,'authenticated','authenticated',$2,$3)`, [id, 'dr-' + id.slice(0, 8) + '@example.invalid', JSON.stringify({ username: 'p' + id.slice(0, 4) })])
    // a small private pool so the test does not depend on the seed
    const pool = 'TEST_' + u().slice(0, 8)
    const P = []
    for (let i = 0; i < 12; i++) P.push((await q(`insert into draft_pool_players(pool,sort_no,team,player_name) values($1,$2::int,'T','Player '||$2::text) returning id`, [pool, i])).rows[0].id)

    let r = await call(null, `select * from public.create_draft_room('Test1',2,4,$1)`, [pool]); rec('signed-out caller cannot create', /Not authenticated/.test(r.err || ''), r.err)
    r = await call(U[0], `select * from public.create_draft_room('bad name',2,4,$1)`, [pool]); rec('room name is checked', /letters or digits/.test(r.err || ''), r.err)
    r = await call(U[0], `select * from public.create_draft_room('Test1',2,11,$1)`, [pool]); rec('more than 10 teams is rejected', /3 to 10/.test(r.err || ''), r.err)
    r = await call(U[0], `select * from public.create_draft_room('Test1',2,4,$1)`, [pool])
    const d = r.rows?.[0]
    rec('host creates a draft', !r.err && d && /^Test1_\d+$/.test(d.room_code) && /^\d{6}$/.test(d.room_key), r.err)
    const D = d.id

    r = await call(U[1], 'select public.join_draft_room($1,$2)', [d.room_code, '000000x']); rec('wrong key is rejected', /Invalid/.test(r.err || ''), r.err)
    r = await call(U[1], 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key]); rec('a player joins', r.v === D, r.err)
    r = await call(U[1], 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key]); rec('joining twice is harmless', r.v === D && (await q('select count(*)::int n from draft_members where draft_id=$1', [D])).rows[0].n === 2, r.err)

    r = await call(U[0], 'select public.draft_spin_wheel($1)', [D]); rec('the wheel needs 3 players', /at least 3/.test(r.err || ''), r.err)
    r = await call(U[2], 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key]); rec('a third player joins', r.v === D, r.err)
    r = await call(U[1], 'select public.draft_spin_wheel($1)', [D]); rec('only the host spins the wheel', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_start($1)', [D]); rec('cannot start before the order is set', /Spin the wheel/.test(r.err || ''), r.err)

    r = await call(U[0], 'select public.draft_spin_wheel($1)', [D])
    rec('first spin gives position 1 and leaves two on the wheel', !r.err && r.v.position === 1 && r.v.last_member_id === null, r.err)
    r = await call(U[0], 'select public.draft_spin_wheel($1)', [D])
    rec('second spin gives position 2 and the last one gets 3', !r.err && r.v.position === 2 && r.v.last_member_id !== null && r.v.seq === 2, r.err)
    let pos = (await q('select order_pos from draft_members where draft_id=$1 order by order_pos', [D])).rows.map((x) => x.order_pos)
    rec('positions are 1,2,3', JSON.stringify(pos) === '[1,2,3]', JSON.stringify(pos))
    r = await call(U[0], 'select public.draft_spin_wheel($1)', [D]); rec('no spin once everyone is placed', /already has/.test(r.err || ''), r.err)

    r = await call(U[0], 'select public.draft_reset_order($1)', [D])
    const spin = (await q('select last_spin from draft_rooms where id=$1', [D])).rows[0].last_spin
    rec('reset clears the order and keeps the spin counter', !r.err && spin.seq === 2 && !spin.member_id && (await q('select count(*)::int n from draft_members where draft_id=$1 and order_pos is null', [D])).rows[0].n === 3, r.err)

    // a 4th joins, then the room is full (max 4)
    r = await call(U[3], 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key]); rec('a fourth player joins', r.v === D, r.err)
    r = await call(U[5], 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key]); rec('a full room is rejected', /full/.test(r.err || ''), r.err)

    // remove a member: only host, and order clears
    const m3 = (await q('select id from draft_members where draft_id=$1 and user_id=$2', [D, U[3]])).rows[0].id
    r = await call(U[1], 'select public.draft_remove_member($1,$2)', [D, m3]); rec('a player cannot remove someone else', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[3], 'select public.draft_remove_member($1,$2)', [D, m3]); rec('a player can leave the lobby', !r.err, r.err)
    const hostMember = (await q('select id from draft_members where draft_id=$1 and user_id=$2', [D, U[0]])).rows[0].id
    r = await call(U[0], 'select public.draft_remove_member($1,$2)', [D, hostMember]); rec('the host cannot leave their own draft', /cannot leave/.test(r.err || ''), r.err)

    // set the order: spin twice
    await call(U[0], 'select public.draft_spin_wheel($1)', [D]); await call(U[0], 'select public.draft_spin_wheel($1)', [D])
    const order = (await q('select id, user_id from draft_members where draft_id=$1 order by order_pos', [D])).rows
    const userAt = (slot) => order[slot - 1].user_id
    r = await call(U[1], 'select public.draft_start($1)', [D]); rec('only the host starts', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_start($1)', [D]); rec('host starts with 3 players and a full order', !r.err, r.err)
    r = await call(U[5], 'select public.join_draft_room($1,$2)', [d.room_code, d.room_key]); rec('no joining after the start', /already started/.test(r.err || ''), r.err)

    // snake: 3 teams x 2 picks = 1,2,3,3,2,1
    const slots = [1, 2, 3, 3, 2, 1]
    const wrong = (slot) => order.find((o, i) => i + 1 !== slot && o.user_id !== U[0]).user_id
    r = await call(wrong(1), 'select public.draft_make_pick($1,$2,0)', [D, P[0]]); rec('a player cannot pick out of turn', /not your turn/.test(r.err || '') || userAt(1) === wrong(1), r.err)
    r = await call(U[4], 'select public.draft_make_pick($1,$2,0)', [D, P[0]]); rec('an outsider cannot pick', /not in this draft/.test(r.err || ''), r.err)
    r = await call(userAt(1), 'select public.draft_make_pick($1,$2,1)', [D, P[0]]); rec('a stale pick number is rejected', /already been taken/.test(r.err || ''), r.err)
    r = await call(userAt(1), 'select public.draft_make_pick($1,$2,0)', [D, P[0]]); rec('pick 1 by position 1', r.v === 0, r.err)
    r = await call(userAt(2), 'select public.draft_make_pick($1,$2,1)', [D, P[0]]); rec('a picked player cannot be picked again', /already been picked/.test(r.err || ''), r.err)
    r = await call(userAt(2), `select public.draft_make_pick($1,(select id from draft_pool_players where pool='SMAT_2026' limit 1),1)`, [D]); rec('a player from another pool is rejected', /not in this pool/.test(r.err || '') || /null/.test(r.err || ''), r.err)
    let ok = true
    for (let p = 1; p < 6; p++) {
      const slot = slots[p]
      // the host picks for position 2 on pick 5 to test picking on behalf
      const by = p === 4 ? U[0] : userAt(slot)
      r = await call(by, 'select public.draft_make_pick($1,$2,$3)', [D, P[p], p])
      if (r.err) { ok = false; console.log('  pick', p, r.err) }
    }
    rec('the rest of the snake 2,3,3,2,1 goes through (host picks once on behalf)', ok)
    const made = (await q('select p.pick_no, m.order_pos from draft_picks p join draft_members m on m.id=p.member_id where p.draft_id=$1 order by pick_no', [D])).rows.map((x) => x.order_pos)
    rec('picks follow snake order', JSON.stringify(made) === JSON.stringify(slots), JSON.stringify(made))
    rec('the draft finishes after the last round', (await q('select status from draft_rooms where id=$1', [D])).rows[0].status === 'DONE')
    r = await call(userAt(1), 'select public.draft_make_pick($1,$2,6)', [D, P[7]]); rec('no picks after the end', /over/.test(r.err || ''), r.err)

    r = await call(U[1], 'select public.draft_undo_pick($1)', [D]); rec('only the host can undo', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_undo_pick($1)', [D])
    rec('host undo removes the last pick and reopens the draft', !r.err && (await q('select count(*)::int n from draft_picks where draft_id=$1', [D])).rows[0].n === 5 && (await q('select status from draft_rooms where id=$1', [D])).rows[0].status === 'DRAFTING', r.err)

    // direct writes are blocked for browsers
    await as(U[0]); await q('savepoint z'); let blocked = false
    try { await q('set local role authenticated'); await q('insert into draft_picks(draft_id,pick_no,member_id,player_id) values($1,99,$2,$3)', [D, order[0].id, P[9]]) } catch (e) { blocked = /permission denied|row-level security/.test(e.message) }
    await q('rollback to savepoint z'); rec('browsers cannot insert picks directly', blocked)
    await as(U[1]); await q('savepoint z'); blocked = false
    try { await q('set local role authenticated'); await q('update draft_members set is_host=true where draft_id=$1', [D]) } catch (e) { blocked = /permission denied/.test(e.message) }
    await q('rollback to savepoint z'); rec('browsers cannot make themselves host', blocked)

    // RLS: outsiders see nothing
    await as(U[4]); await q('savepoint z'); await q('set local role authenticated')
    const seen = (await q('select count(*)::int n from draft_rooms where id=$1', [D])).rows[0].n + (await q('select count(*)::int n from draft_picks where draft_id=$1', [D])).rows[0].n
    await q('rollback to savepoint z'); rec('an outsider cannot read the draft', seen === 0, String(seen))
    await as(U[1]); await q('savepoint z'); await q('set local role authenticated')
    const mine = (await q('select count(*)::int n from draft_picks where draft_id=$1', [D])).rows[0].n
    await q('rollback to savepoint z'); rec('a member can read the picks', mine === 5, String(mine))

    r = await call(U[1], 'select public.draft_delete_room($1)', [D]); rec('only the owner can delete', /Only the host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.draft_delete_room($1)', [D]); rec('the owner deletes the draft and its picks', !r.err && (await q('select count(*)::int n from draft_picks where draft_id=$1', [D])).rows[0].n === 0, r.err)

    const seeded = (await q(`select count(*)::int n from draft_pool_players where pool='SMAT_2026'`)).rows[0].n
    rec('SMAT 2026 pool is seeded', seeded === 544, String(seeded))
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
