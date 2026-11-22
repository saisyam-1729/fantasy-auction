/**
 * Database rule test: ILT20 2026 player lists for both formats (auction and draft).
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
  const as = (uid) => q(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)`, [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
  try {
    await q('begin')
    for (const f of ['draft.sql', 'ilt20_2026_seed.generated.sql']) await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8'))

    const inv = (await q(`select count(*)::int n, count(distinct team)::int t, min(base_price)::bigint lo, max(base_price)::bigint hi,
                                 count(*) filter (where base_price not in (5000000,10000000,20000000))::int odd
                          from player_inventory where inventory_type='ILT20_2026'`)).rows[0]
    rec('auction list has 142 players in 6 teams', inv.n === 142 && inv.t === 6, JSON.stringify(inv))
    rec('base prices are 50 L, 1 Cr or 2 Cr', inv.odd === 0 && Number(inv.lo) === 5000000 && Number(inv.hi) === 20000000)
    const types = (await q(`select player_type, count(*)::int n from player_inventory where inventory_type='ILT20_2026' group by 1 order by 1`)).rows
    rec('roles use the auction codes', types.every((t) => ['ALL', 'BAT', 'BOWL', 'WK', 'UNK'].includes(t.player_type)), JSON.stringify(types))
    const pool = (await q(`select count(*)::int n from draft_pool_players where pool='ILT20_2026'`)).rows[0].n
    rec('draft pool has the same 142 players', pool === 142, String(pool))

    // re-running the seed does not duplicate anything
    await q(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'ilt20_2026_seed.generated.sql'), 'utf8'))
    const again = (await q(`select (select count(*) from player_inventory where inventory_type='ILT20_2026')::int a, (select count(*) from draft_pool_players where pool='ILT20_2026')::int d`)).rows[0]
    rec('the seed can be re-run safely', again.a === 142 && again.d === 142, JSON.stringify(again))

    // an auction room on the ILT20 list loads all 142 lots
    const U = u()
    await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [U, 'ev-' + U.slice(0, 8) + '@example.invalid'])
    const room = u()
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status,player_inventory_type) values($1,'EV','EV-'||$2,'k',$3,'WAITING','ILT20_2026')`, [room, room.slice(0, 6), U])
    await q(`insert into room_users(room_id,user_id,username,display_name,is_admin) values($1,$2,'ev','ev',true)`, [room, U])
    await as(U)
    await q('select public.initialize_room_players($1,$2)', [room, 'ILT20_2026'])
    const lots = (await q('select count(*)::int n from room_players where room_id=$1', [room])).rows[0].n
    rec('an ILT20 auction room gets all 142 lots', lots === 142, String(lots))

    // a draft room on the ILT20 pool
    const d = (await q(`select * from public.create_draft_room('EvDraft',5,6,'ILT20_2026')`)).rows[0]
    rec('an ILT20 draft room can be created', Boolean(d && d.id), JSON.stringify(d))
    let bad = null
    await q('savepoint s')
    try { await q(`select * from public.create_draft_room('EvDraft',5,6,'NO_SUCH_POOL')`) } catch (e) { bad = e.message }
    await q('rollback to savepoint s')
    rec('an unknown pool is rejected', /Unknown player pool/.test(bad || ''), bad)
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
