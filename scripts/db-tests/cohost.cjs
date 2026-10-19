/**
 * Database rule test: co-hosts and host transfer.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
 * Temporary auth users are inserted, and request.jwt.claim.sub is set to act as them.
 * Reads SUPABASE_DB_URL from .env.local. Prefer a staging database.
 * Run all with: npm run db:test
 */
const fs = require('fs'), { Client } = require('pg'), crypto = require('crypto')
const env = fs.readFileSync(require('path').join(__dirname, '..', '..', '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
const u = () => crypto.randomUUID()
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
  const admin = async (ruId) => (await q('select is_admin from room_users where id=$1', [ruId])).rows[0].is_admin
  const owner = async () => (await q('select admin_user_id from rooms where id=$1', [room])).rows[0].admin_user_id
  try {
    await q('begin')
    const U = [u(), u(), u(), u()] // U[3] outsider
    for (const id of U) await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [id, 'ch-' + id.slice(0, 8) + '@example.invalid'])
    room = u(); const RU = [u(), u(), u()]
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status) values($1,'CH','CH-'||$2,'k',$3,'WAITING')`, [room, room.slice(0, 6), U[0]])
    const names = ['Owner', 'Mid', 'Last']
    for (let i = 0; i < 3; i++) await q(`insert into room_users(id,room_id,user_id,username,display_name,budget,spent,squad_count,is_admin) values($1,$2,$3,$4,$4,1000000000,0,0,$5)`, [RU[i], room, U[i], names[i], i === 0])

    let r = await call(U[1], 'select public.admin_set_cohost($1,$2,true)', [room, RU[2]]); rec('a plain member cannot appoint a co-host', /Only a host/.test(r.err || ''), r.err)
    r = await call(U[3], 'select public.admin_set_cohost($1,$2,true)', [room, RU[2]]); rec('an outsider cannot appoint a co-host', /Only a host/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.admin_set_cohost($1,$2,true)', [room, RU[1]]); rec('the host appoints a co-host', !r.err && (await admin(RU[1])) === true, r.err)

    // the co-host really holds host powers, e.g. the existing admin-only squad sizes
    r = await call(U[1], 'select public.admin_set_squad_sizes($1,3,5)', [room]); rec('a co-host can use host-only functions', !r.err, r.err)

    r = await call(U[1], 'select public.admin_set_cohost($1,$2,true)', [room, RU[2]]); rec('a co-host can appoint another co-host', !r.err && (await admin(RU[2])) === true, r.err)
    r = await call(U[1], 'select public.admin_set_cohost($1,$2,false)', [room, RU[0]]); rec('the owner cannot be demoted', /cannot be removed/.test(r.err || ''), r.err)
    r = await call(U[1], 'select public.admin_set_cohost($1,$2,false)', [room, RU[2]]); rec('a co-host can be demoted', !r.err && (await admin(RU[2])) === false, r.err)
    r = await call(U[0], 'select public.admin_set_cohost($1,$2,true)', [room, u()]); rec('unknown player is rejected', /not in this room/.test(r.err || ''), r.err)
    r = await call(null, 'select public.admin_set_cohost($1,$2,true)', [room, RU[2]]); rec('signed-out caller is rejected', /Not authenticated/.test(r.err || ''), r.err)

    // transfer
    r = await call(U[2], 'select public.admin_transfer_host($1,$2)', [room, RU[2]]); rec('a plain member cannot transfer the room', /Only a host/.test(r.err || ''), r.err)
    r = await call(U[1], 'select public.admin_transfer_host($1,$2)', [room, RU[1]]); rec('a co-host can take over when the host is gone', !r.err && (await owner()) === U[1], r.err)
    rec('previous owner stays a co-host', (await admin(RU[0])) === true)
    r = await call(U[0], 'select public.admin_set_cohost($1,$2,false)', [room, RU[1]]); rec('the new owner cannot be demoted by the old one', /cannot be removed/.test(r.err || ''), r.err)
    r = await call(U[0], 'select public.admin_transfer_host($1,$2)', [room, RU[0]]); rec('the old owner can take the room back', !r.err && (await owner()) === U[0], r.err)

    // browsers still cannot set is_admin directly
    await as(U[2]); await q('savepoint z'); let blocked = false
    try { await q('set local role authenticated'); await q('update room_users set is_admin=true where id=$1', [RU[2]]) } catch (e) { blocked = /Only ready_to_start/.test(e.message) }
    await q('rollback to savepoint z')
    rec('direct is_admin edits are still blocked', blocked)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
