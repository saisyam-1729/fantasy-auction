/**
 * Reads IPL-2026.xlsx → writes supabase/player_inventory_ipl2026_seed.generated.sql
 *
 * Maps into public.player_inventory:
 *   inventory_type = 'IPL'
 *   player_id      = 'ipl2026-{Sr No}'  (unique with inventory_type)
 *   player_name, player_type, base_price (bigint rupees), team, image_url, country
 *
 * "Set" column is treated as Crores (e.g. 0.2 → ₹20L stored as 2000000).
 * To change: edit SET_MULTIPLIER_RUPEES below (lakhs etc.).
 *
 * Usage:
 *   npm run import:ipl2026
 *   npm run import:ipl2026 -- "C:\\path\\to\\IPL-2026.xlsx"
 *   (PowerShell: no space after the opening quote, or the path breaks.)
 *
 * Supabase:
 *   1) Run supabase/player_inventory_add_team.sql (adds `team` — skip only if you map Team elsewhere)
 *   2) Run the generated .sql file in SQL Editor
 */

const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

/** Rupees per 1.0 unit of the spreadsheet "Set" column (crores → × 1e7) */
const SET_MULTIPLIER_RUPEES = 10_000_000

const INVENTORY_TYPE = 'IPL'
const PLAYER_ID_PREFIX = 'ipl2026-'

const outFile = path.join(
  __dirname,
  '..',
  'supabase',
  'player_inventory_ipl2026_seed.generated.sql'
)

const argPath = (process.argv[2] || '').trim()
const inputPath = path.resolve(
  argPath || path.join(process.cwd(), 'IPL-2026.xlsx')
)

if (!fs.existsSync(inputPath)) {
  console.error('File not found:', inputPath)
  console.error('Copy IPL-2026.xlsx to the project root or pass the full path as the first argument.')
  process.exit(1)
}

const wb = XLSX.readFile(inputPath)
const sheetName = wb.SheetNames[0]
const sheet = wb.Sheets[sheetName]
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

function normKey(k) {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function pick(row, candidates) {
  const map = {}
  for (const k of Object.keys(row)) {
    map[normKey(k)] = row[k]
  }
  for (const c of candidates) {
    const v = map[normKey(c)]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return ''
}

function escSql(s) {
  return String(s).trim().replace(/'/g, "''")
}

function toNum(v) {
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const tuples = []
for (const row of rows) {
  const srRaw = pick(row, ['Sr No', 'Sr. No', 'SR No', 'S.No', 'Serial', 'serial no', '#'])
  const name = pick(row, ['Player Name', 'Name', 'player'])
  const setPrice = pick(row, ['Set', 'Base Price', 'Base', 'Price'])
  const team = pick(row, ['Team', 'IPL Team', 'Franchise'])
  const ptype = pick(row, ['Player Type', 'Type', 'Role'])

  const sr = parseInt(String(srRaw).trim(), 10)
  if (!Number.isFinite(sr) || sr < 1) continue
  if (!String(name).trim()) continue

  const setCr = toNum(setPrice)
  if (setCr === null) {
    console.warn('Skipping row (bad Set/price):', sr, name)
    continue
  }

  const basePrice = Math.round(setCr * SET_MULTIPLIER_RUPEES)
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    console.warn('Skipping row (base_price):', sr, name)
    continue
  }

  tuples.push({
    playerId: `${PLAYER_ID_PREFIX}${sr}`,
    name: String(name).trim(),
    basePrice,
    team: String(team).trim() || null,
    ptype: String(ptype).trim().toUpperCase() || 'UNK',
  })
}

tuples.sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true }))

if (tuples.length === 0) {
  console.error(
    'No valid rows. Expected columns: Sr No, Player Name, Set, Team, Player Type'
  )
  process.exit(1)
}

const valueLines = tuples.map((t) => {
  const teamSql = t.team === null ? 'NULL' : `'${escSql(t.team)}'`
  return (
    `  ('${INVENTORY_TYPE}', '${escSql(t.playerId)}', '${escSql(t.name)}', '${escSql(t.ptype)}', ` +
    `${t.basePrice}, NULL, ${teamSql}, NULL)`
  )
})

const sql = `-- AUTO-GENERATED from ${path.basename(inputPath)} (${tuples.length} rows). Sheet: ${sheetName}
-- Requires column public.player_inventory.team (run supabase/player_inventory_add_team.sql once).
-- "Set" interpreted as Crores → base_price rupees (× ${SET_MULTIPLIER_RUPEES}).

INSERT INTO public.player_inventory (
  inventory_type,
  player_id,
  player_name,
  player_type,
  base_price,
  image_url,
  team,
  country
)
VALUES
${valueLines.join(',\n')}
ON CONFLICT (inventory_type, player_id) DO UPDATE SET
  player_name = EXCLUDED.player_name,
  player_type = EXCLUDED.player_type,
  base_price = EXCLUDED.base_price,
  team = EXCLUDED.team,
  image_url = COALESCE(EXCLUDED.image_url, public.player_inventory.image_url),
  country = COALESCE(EXCLUDED.country, public.player_inventory.country);
`

fs.writeFileSync(outFile, sql, 'utf8')
console.log('Wrote', outFile)
console.log('Rows:', tuples.length)
console.log('inventory_type:', INVENTORY_TYPE, '| player_id prefix:', PLAYER_ID_PREFIX)
