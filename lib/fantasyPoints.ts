/**
 * Reading fantasy points from an event's points page and matching them to the
 * draft pool. Pure functions, so the nightly job and the tests share them.
 *
 * Source today: statz.ai "performance points" leader tables, e.g.
 * https://statz.ai/cricket/statz-leaders/ilt20/performance-points
 * The page is server-rendered; every player is in the HTML (the "Show all"
 * button only unhides rows), one <tr> per player.
 */

export type SourceRow = { name: string; team: string; points: number; matches: number }
export type PoolPlayer = { id: number; team: string; player_name: string }
export type MatchedRow = { player_id: number; points: number; matches: number }

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim()

/** Rows of a statz leaders table: player, team, matches and the highlighted (sorted) column. */
export function parseStatzLeaders(html: string): SourceRow[] {
  const rows: SourceRow[] = []
  for (const tr of html.match(/<tr>\s*<td class="ldl-rk">[\s\S]*?<\/tr>/g) ?? []) {
    const name = tr.match(/class="ldl-name">([^<]+)</)?.[1]
    const team = tr.match(/class="ldl-team__n">([^<]+)</)?.[1]
    const points = tr.match(/<td class="ldl-c on">([^<]*)<\/td>/)?.[1]
    const cells = [...tr.matchAll(/<td class="ldl-c(?: on)?">([^<]*)<\/td>/g)].map((m) => m[1].trim())
    if (!name || points == null) continue
    const value = Number(points.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    rows.push({
      name: decode(name),
      team: team ? decode(team) : '',
      points: value,
      // the first numeric column is matches ("Mat")
      matches: Number(cells[0]) || 0,
    })
  }
  return rows
}

/** Lower case, no accents, no punctuation, single spaces. */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Source spellings that differ from the squad sheet: normalised source name ->
 * normalised pool name. Add entries when the nightly log lists a player as unmatched.
 */
export const NAME_ALIASES: Record<string, string> = {
  // the points page also lists him as "Masood Gurbaz" next to "Masood Ul Rahman Gurbaz": the second spelling is ignored
  'masood gurbaz': 'masood ul rahman gurbaz',
}

/**
 * Match source rows to pool players: same name and team first, then the same
 * name when only one pool player has it, then (same team only) a name whose
 * words all appear in the other, e.g. "Khuzaima Tanveer" = "Khuzaima Bin Tanveer".
 * Anything else is reported as unmatched rather than guessed.
 */
export function matchPoints(source: SourceRow[], pool: PoolPlayer[]): { matched: MatchedRow[]; unmatched: SourceRow[] } {
  const byName = new Map<string, PoolPlayer[]>()
  for (const p of pool) {
    const k = normName(p.player_name)
    byName.set(k, [...(byName.get(k) ?? []), p])
  }
  const matched: MatchedRow[] = []
  const unmatched: SourceRow[] = []
  const used = new Set<number>()
  for (const r of source) {
    const n = normName(r.name)
    const candidates = byName.get(n) ?? byName.get(NAME_ALIASES[n] ?? '') ?? []
    const sameTeam = candidates.filter((p) => normName(p.team) === normName(r.team))
    let pick = sameTeam.length === 1 ? sameTeam[0] : candidates.length === 1 ? candidates[0] : null
    if (!pick && candidates.length === 0) {
      const words = n.split(' ')
      const loose = pool.filter((p) => {
        if (normName(p.team) !== normName(r.team)) return false
        const other = normName(p.player_name).split(' ')
        const within = (a: string[], b: string[]) => a.length >= 2 && a.every((w) => b.includes(w))
        return within(words, other) || within(other, words)
      })
      if (loose.length === 1) pick = loose[0]
    }
    if (pick && used.has(pick.id) && NAME_ALIASES[n]) continue // a known second spelling of a player already counted
    if (!pick || used.has(pick.id)) {
      unmatched.push(r)
      continue
    }
    used.add(pick.id)
    matched.push({ player_id: pick.id, points: r.points, matches: r.matches })
  }
  return { matched, unmatched }
}

/**
 * Refuse a page that looks broken, so a changed layout or an error page never
 * overwrites good totals. `lastRows` is how many rows the previous good update had.
 * The page may legitimately grow (more players play), but it should not shrink a lot,
 * and an update where every player is at zero after earlier non-zero totals is suspect.
 */
export function checkSourceSane(rows: SourceRow[], lastRows: number | null, lastTotal: number | null = null): void {
  if (rows.length === 0) throw new Error('The points page had no player rows (did its layout change?)')
  if (lastRows != null && lastRows >= 10 && rows.length < Math.ceil(lastRows * 0.5)) {
    throw new Error(`The points page had ${rows.length} rows, but ${lastRows} last time. Refusing to update (did its layout change?)`)
  }
  const total = rows.reduce((s, r) => s + r.points, 0)
  if (lastTotal != null && lastTotal > 0 && total === 0) throw new Error('Every player is at 0 points now. Refusing to update (did its layout change?)')
}

/** Download an event's points page and read its rows. */
export async function fetchSourceRows(url: string): Promise<SourceRow[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyAuctionPoints/1.0)', Accept: 'text/html' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Points page returned HTTP ${res.status}`)
  const rows = parseStatzLeaders(await res.text())
  if (rows.length === 0) throw new Error('No player rows found on the points page (did its layout change?)')
  return rows
}

// ---------------------------------------------------------------------------
// Leaderboard display helpers
// ---------------------------------------------------------------------------

export type LeaderboardPlayer = {
  player_id: number
  name: string
  team: string
  role: string | null
  points: number
  matches: number
  prev_points: number | null
}

export type LeaderboardRow = {
  member_id: string
  username: string
  user_id: string
  order_pos: number | null
  points: number
  rank: number
  prev_points: number | null
  prev_rank: number | null
  players: LeaderboardPlayer[]
}

export type Leaderboard = {
  synced_at: string | null
  latest_day: string | null
  previous_day: string | null
  rows: LeaderboardRow[]
}

/** Places moved since the previous day: positive = climbed. null when there is no previous day. */
export function rankMove(row: Pick<LeaderboardRow, 'rank' | 'prev_rank'>): number | null {
  return row.prev_rank == null ? null : row.prev_rank - row.rank
}

/** Points gained since the previous day. null when there is no previous day. */
export function pointsGain(row: { points: number; prev_points: number | null }): number | null {
  return row.prev_points == null ? null : Number(row.points) - Number(row.prev_points)
}

export const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

export function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
