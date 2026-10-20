/**
 * Second pass for players the Wikipedia pass (fetch-player-images.cjs) left without a photo.
 * Looks each one up on Wikidata (a cricketer whose label equals the name, or an alias),
 * takes its P18 image (always a Wikimedia Commons file), checks the licence is free, and
 * appends the match to data/player-images.report.json as status "exact".
 *
 *   node scripts/fetch-wikidata-images.cjs          add matches to the report, print a summary
 *
 * Then run `node scripts/fetch-player-images.cjs --download` and `--apply` as before.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const REPORT = path.join(root, 'data', 'player-images.report.json')
const UA = 'IPLAuctionPlayerImages/1.0 (https://github.com/saisyam-1729/fantasy-auction; educational hobby project)'
const WD = 'https://www.wikidata.org/w/api.php'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const THUMB = 360
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()

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

async function candidates(name) {
  const q = new URLSearchParams({ action: 'wbsearchentities', format: 'json', language: 'en', type: 'item', limit: '8', search: name })
  const j = await getJson(`${WD}?${q}`)
  return (j.search || []).filter((e) => /cricket/i.test(e.description || '') && norm(e.label || '') === norm(name))
}

async function imageOf(id) {
  const q = new URLSearchParams({ action: 'wbgetclaims', format: 'json', entity: id, property: 'P18' })
  const j = await getJson(`${WD}?${q}`)
  const claims = j.claims?.P18 || []
  const claim = claims.find((c) => c.rank === 'preferred') || claims[0]
  return claim?.mainsnak?.datavalue?.value || null
}

async function commonsInfo(fileName) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', titles: `File:${fileName}`, prop: 'imageinfo', iiurlwidth: String(THUMB),
    iiprop: 'extmetadata|url', iiextmetadatafilter: 'LicenseShortName|Artist|NonFree',
  })
  const j = await getJson(`${COMMONS}?${q}`)
  const info = Object.values(j.query?.pages || {})[0]?.imageinfo?.[0]
  if (!info) return null
  const m = info.extmetadata || {}
  const strip = (h) => (h ? h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '')
  return {
    thumb: info.thumburl || info.url,
    licence: strip(m.LicenseShortName?.value) || 'unknown',
    artist: strip(m.Artist?.value) || 'unknown',
    nonFree: String(m.NonFree?.value || '').toLowerCase() === 'true',
    source: info.descriptionurl,
  }
}

;(async () => {
  const results = JSON.parse(fs.readFileSync(REPORT, 'utf8'))
  const todo = results.filter((r) => r.status !== 'exact' && r.status !== 'skipped')
  console.log(`${todo.length} players without a photo`)
  let found = 0
  const noImage = []
  const noMatch = []
  for (const r of todo) {
    try {
      const cands = await candidates(r.name)
      if (!cands.length) {
        noMatch.push(r.name)
        continue
      }
      let hit = null
      for (const c of cands) {
        const file = await imageOf(c.id)
        if (!file) continue
        const info = await commonsInfo(file)
        if (info && !info.nonFree && info.licence !== 'unknown') {
          hit = { c, info }
          break
        }
      }
      if (!hit) {
        noImage.push(r.name)
        continue
      }
      Object.assign(r, {
        status: 'exact',
        title: hit.c.label,
        description: hit.c.description,
        thumb: hit.info.thumb,
        licence: hit.info.licence,
        artist: hit.info.artist,
        nonFree: false,
        source: hit.info.source,
      })
      found++
    } catch (e) {
      console.log('error', r.name, String(e.message || e))
    }
    await sleep(150)
  }
  fs.writeFileSync(REPORT, JSON.stringify(results, null, 2))
  console.log(`\nAdded ${found} photos. Total with photos: ${results.filter((r) => r.status === 'exact').length}/${results.length}`)
  console.log(`Matched a Wikidata cricketer but no free image: ${noImage.length}`)
  console.log(`No Wikidata match: ${noMatch.length}`)
})().catch((e) => {
  console.error('FAILED:', String(e.message || e))
  process.exit(1)
})
