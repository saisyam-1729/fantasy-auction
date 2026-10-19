/**
 * Database rule test: auction by sets, and that the older lot orders still work.
 * Runs inside ONE transaction that is always rolled back, so nothing persists.
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
  try {
    await q('begin')
    const owner = u()
    await q(`insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)`, [owner, 'st-' + owner.slice(0, 8) + '@example.invalid'])
    const room = u()
    await q(`insert into rooms(id,room_name,room_id,room_key,admin_user_id,status) values($1,'ST','ST-'||$2,'k',$3,'WAITING')`, [room, room.slice(0, 6), owner])

    // name, role, base price. Created in this order, which is the "original list order".
    const players = [
      ['Bowl20L', 'BOWL', 20 * L], ['Bowl1Cr', 'BOWL', CR], ['Bat1Cr', 'BAT', CR], ['Star4Cr', 'BOWL', 4 * CR],
      ['Ar2Cr', 'AR', 2 * CR], ['Wk1Cr', 'WK', CR], ['Bat2Cr', 'BAT', 2 * CR], ['Bat20L', 'BAT', 20 * L],
      ['Ar1Cr', 'ALL', CR], ['Marq3Cr', 'WK', 3 * CR], ['Bowl2Cr', 'BOWL', 2 * CR],
    ]
    const idByName = {}
    for (const [name, type, base] of players) {
      const iv = u()
      idByName[name] = iv
      await q(`insert into player_inventory(id,inventory_type,player_id,player_name,player_type,base_price) values($1,'ST',$2,$3,$4,$5)`, [iv, 'st' + iv.slice(0, 6), name, type, base])
      await q(`insert into room_players(room_id,player_inventory_id,status) values($1,$2,'UNSOLD')`, [room, iv])
      await new Promise((r) => setTimeout(r, 2)) // keep creation order stable
    }

    // Walk the whole order for a filter setting: pick, mark sold, pick again.
    const order = async (filters) => {
      await q('update rooms set auction_filters=$2::jsonb where id=$1', [room, JSON.stringify(filters)])
      await q(`update room_players set status='UNSOLD' where room_id=$1`, [room])
      const names = []
      for (let i = 0; i < 20; i++) {
        const r = await q(`select rp.id, pi.player_name from public.auction_pick_next_lot($1,null) l join room_players rp on rp.id=l.lot_id join player_inventory pi on pi.id=rp.player_inventory_id`, [room])
        if (r.rows.length === 0) break
        names.push(r.rows[0].player_name)
        await q(`update room_players set status='SOLD' where id=$1`, [r.rows[0].id])
      }
      return names
    }

    const sets = await order({ sort: 'sets' })
    rec('sets: Marquee (>= 3Cr) first, high to low', sets.slice(0, 3).join() === 'Star4Cr,Marq3Cr' || sets.slice(0, 2).join() === 'Star4Cr,Marq3Cr', sets.join(','))
    rec('sets: then batters, all-rounders, keepers, bowlers, emerging',
      sets.join() === 'Star4Cr,Marq3Cr,Bat2Cr,Bat1Cr,Ar2Cr,Ar1Cr,Wk1Cr,Bowl2Cr,Bowl1Cr,Bowl20L,Bat20L' ||
      sets.join() === 'Star4Cr,Marq3Cr,Bat2Cr,Bat1Cr,Ar2Cr,Ar1Cr,Wk1Cr,Bowl2Cr,Bowl1Cr,Bat20L,Bowl20L', sets.join(','))
    rec('sets: every player comes up exactly once', sets.length === players.length && new Set(sets).size === players.length)

    const desc = await order({ sort: 'base_price_desc' })
    rec('base price high to low still works', desc.slice(0, 2).join() === 'Star4Cr,Marq3Cr' && desc[desc.length - 1].endsWith('20L'), desc.join(','))
    const asc = await order({ sort: 'base_price_asc' })
    rec('base price low to high still works', asc[0].endsWith('20L') && asc[asc.length - 1] === 'Star4Cr', asc.join(','))
    const orig = await order({})
    // "Original list order" has always meant by the player's inventory id (a uuid), then room row.
    const expectedOrig = players.map((p) => p[0]).sort((x, y) => (idByName[x] < idByName[y] ? -1 : 1))
    rec('original list order still works (by inventory id, as before)', orig.join() === expectedOrig.join(), orig.join())

    const onlyBat = await order({ sort: 'sets', player_types: ['BAT'] })
    rec('sets respects the player type filter', onlyBat.join() === 'Bat2Cr,Bat1Cr,Bat20L', onlyBat.join())
    const minBase = await order({ sort: 'sets', min_base_price: 2 * CR })
    rec('sets respects the min base price filter', minBase.join() === 'Star4Cr,Marq3Cr,Bat2Cr,Ar2Cr,Bowl2Cr', minBase.join())

    const ranks = (await q(`select public._auction_set_rank(30000000,'BOWL') a, public._auction_set_rank(2000000,'BAT') b, public._auction_set_rank(10000000,'BAT') c, public._auction_set_rank(10000000,'AR') d, public._auction_set_rank(10000000,'ALL') e, public._auction_set_rank(10000000,'WK') f, public._auction_set_rank(10000000,'BOWL') g`)).rows[0]
    rec('database ranks match lib/sets.ts', JSON.stringify(ranks) === JSON.stringify({ a: 1, b: 6, c: 2, d: 3, e: 3, f: 4, g: 5 }), JSON.stringify(ranks))
  } catch (e) {
    console.log('HARNESS ERROR', e.message.replace(env, '***')); results.push(false)
  } finally {
    try { await c.query('rollback') } catch {}
    await c.end()
  }
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed')
  process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1
})()
