/**
 * Find freely licensed player photos on Wikipedia/Wikimedia Commons, store them in
 * public/players, and point player_inventory.image_url at them.
 *
 *   node scripts/fetch-player-images.cjs                 report only (writes data/player-images.report.json)
 *   node scripts/fetch-player-images.cjs --download      also download matched photos + write data/player-images.json
 *   node scripts/fetch-player-images.cjs --apply         update player_inventory.image_url from data/player-images.json
 *
 * Only photos Wikipedia marks as freely licensed are used (pilicense=free), and each
 * photo's licence and author are saved so /credits can attribute them. A match is
 * "exact" when the article title equals the player's name and the article is about a
 * cricketer. Looser matches are listed as "review" and are NOT used unless you approve
 * them in data/player-images.overrides.json: { "Player Name": "Wikipedia Article Title" }
 * (use null to skip a player).
 *
 * Reads SUPABASE_DB_URL from .env.local (never printed).
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const root = path.join(__dirname, '..')
const dataDir = path.join(root, 'data')
const outDir = path.join(root, 'public', 'players')
const REPORT = path.join(dataDir, 'player-images.report.json')
const MANIFEST = path.join(dataDir, 'player-images.json')
const OVERRIDES = path.join(dataDir, 'player-images.overrides.json')
const UA = 'IPLAuctionPlayerImages/1.0 (https://github.com/saisyam-1729/fantasy-auction; educational hobby project)'
const API = 'https://en.wikipedia.org/w/api.php'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const THUMB = 360

const args = new Set(process.argv.slice(2))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function dbUrl() {
  const m = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)
  if (!m) throw new Error('SUPABASE_DB_URL is missing from .env.local')
  return m[1].trim().replace(/^["']|["']$/g, '')
}
async function withDb(fn) {
  const url = dbUrl()
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
const slug = (s) => norm(s).replace(/\s/g, '-')

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (r.ok) return await r.json()
      if (r.status === 429 || r.status >= 500) await sleep(1500 * (i + 1))
      else throw new Error('HTTP ' + r.status)
    } catch (e) {
      if (i === tries - 1) throw e
      await sleep(800)
    }
  }
}

/** Pages whose title is `title`, with their free-licence lead photo. */
async function pageByTitle(title) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', redirects: '1', titles: title,
    prop: 'pageimages|description', piprop: 'thumbnail|name', pithumbsize: String(THUMB), pilicense: 'free',
  })
  const j = await getJson(`${API}?${q}`)
  return Object.values(j.query?.pages || {}).filter((p) => !p.missing)
}

/** Search for "<name> cricketer" and return candidate pages with their free lead photo. */
async function searchPages(name) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: `${name} cricketer`, gsrlimit: '6',
    prop: 'pageimages|description', piprop: 'thumbnail|name', pithumbsize: String(THUMB), pilicense: 'free',
  })
  const j = await getJson(`${API}?${q}`)
  return Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))
}

function tokens(s) {
  return norm(s).split(' ').filter(Boolean)
}

/** exact: same name and a cricketer. review: close but not identical. */
function classify(name, page) {
  const desc = page.description || ''
  if (!/cricket/i.test(desc)) return null
  const title = page.title.replace(/\s*\(.*?\)\s*/g, '').trim()
  if (norm(title) === norm(name)) return 'exact'
  const a = tokens(name)
  const b = tokens(title)
  const last = (t) => t[t.length - 1]
  const sameLast = a.length && b.length && last(a) === last(b)
  const firstInit = a[0] && b[0] && a[0][0] === b[0][0]
  const subset = (x, y) => x.every((t) => y.includes(t))
  if (subset(a, b) || subset(b, a) || (sameLast && firstInit)) return 'review'
  return null
}

async function licenceFor(fileName) {
  if (!fileName) return null
  const q = new URLSearchParams({
    action: 'query', format: 'json', titles: `File:${fileName}`, prop: 'imageinfo',
    iiprop: 'extmetadata|url', iiextmetadatafilter: 'LicenseShortName|Artist|NonFree|AttributionRequired',
  })
  const j = await getJson(`${COMMONS}?${q}`)
  const page = Object.values(j.query?.pages || {})[0]
  const info = page?.imageinfo?.[0]
  if (!info) return null
  const m = info.extmetadata || {}
  const strip = (h) => (h ? h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '')
  return {
    licence: strip(m.LicenseShortName?.value) || 'unknown',
    artist: strip(m.Artist?.value) || 'unknown',
    nonFree: String(m.NonFree?.value || '').toLowerCase() === 'true',
    source: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
  }
}

async function findFor(name, overrides) {
  const override = overrides[name]
  if (override === null) return { name, status: 'skipped' }
  let pages
  let kind
  if (typeof override === 'string') {
    pages = await pageByTitle(override)
    kind = 'override'
  } else {
    pages = await searchPages(name)
  }
  let best = null
  for (const p of pages) {
    const cls = kind === 'override' ? 'exact' : classify(name, p)
    if (!cls) continue
    const hasPhoto = Boolean(p.thumbnail?.source)
    if (!best || (cls === 'exact' && best.cls !== 'exact') || (cls === best.cls && hasPhoto && !best.hasPhoto)) {
      best = { cls, hasPhoto, page: p }
    }
  }
  if (!best) return { name, status: 'none' }
  const p = best.page
  if (!p.thumbnail?.source) return { name, status: 'no_photo', title: p.title }
  const lic = await licenceFor(p.pageimage)
  if (!lic || lic.nonFree) return { name, status: 'no_free_photo', title: p.title }
  return {
    name,
    status: best.cls === 'exact' ? 'exact' : 'review',
    title: p.title,
    description: p.description,
    thumb: p.thumbnail.source,
    ...lic,
  }
}

async function report() {
  fs.mkdirSync(dataDir, { recursive: true })
  const overrides = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {}
  const players = await withDb(async (c) => (await c.query(`select distinct player_name name, team from player_inventory where inventory_type='IPL' order by 1`)).rows)
  const results = []
  let i = 0
  for (const p of players) {
    i++
    try {
      const r = await findFor(p.name, overrides)
      results.push({ ...r, team: p.team })
    } catch (e) {
      results.push({ name: p.name, team: p.team, status: 'error', error: String(e.message || e) })
    }
    if (i % 25 === 0) console.log(`  ${i}/${players.length}`)
    await sleep(120)
  }
  fs.writeFileSync(REPORT, JSON.stringify(results, null, 2))
  const by = {}
  for (const r of results) by[r.status] = (by[r.status] || 0) + 1
  console.log('\nResult:', JSON.stringify(by))
  for (const s of ['review', 'no_photo', 'no_free_photo', 'error']) {
    const list = results.filter((r) => r.status === s)
    if (list.length) console.log(`\n${s} (${list.length}):\n` + list.map((r) => `  ${r.name}${r.title ? '  ->  ' + r.title : ''}${r.error ? '  ' + r.error : ''}`).join('\n'))
  }
  console.log('\nReport written to data/player-images.report.json')
  return results
}

async function download() {
  const results = fs.existsSync(REPORT) && !args.has('--refresh') ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : await report()
  fs.mkdirSync(outDir, { recursive: true })
  const manifest = []
  for (const r of results.filter((x) => x.status === 'exact')) {
    const ext = (r.thumb.split('?')[0].match(/\.(jpe?g|png|webp)$/i) || [, 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg')
    const file = `${slug(r.name)}.${ext}`
    const res = await fetch(r.thumb, { headers: { 'User-Agent': UA } })
    if (!res.ok) {
      console.log('download failed', r.name, res.status)
      await sleep(500)
      continue
    }
    fs.writeFileSync(path.join(outDir, file), Buffer.from(await res.arrayBuffer()))
    manifest.push({ name: r.name, team: r.team, file: `/players/${file}`, wikipedia: r.title, licence: r.licence, artist: r.artist, source: r.source })
    await sleep(250)
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  console.log(`Downloaded ${manifest.length} photos to public/players and wrote data/player-images.json`)
}

async function apply() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  await withDb(async (c) => {
    await c.query('begin')
    let n = 0
    for (const m of manifest) {
      const r = await c.query(`update player_inventory set image_url=$2 where inventory_type='IPL' and player_name=$1`, [m.name, m.file])
      n += r.rowCount
    }
    await c.query('commit')
    console.log(`Updated image_url on ${n} player rows from ${manifest.length} photos`)
  })
}

;(async () => {
  if (args.has('--apply')) await apply()
  else if (args.has('--download')) await download()
  else await report()
})().catch((e) => {
  console.error('FAILED:', String(e.message || e))
  process.exit(1)
})
