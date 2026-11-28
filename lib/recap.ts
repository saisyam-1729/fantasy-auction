/**
 * "Your day": what changed for one team at the latest nightly points update,
 * worked out from a draft's leaderboard (current and previous-day numbers).
 */
import type { Leaderboard, LeaderboardRow } from '@/lib/fantasyPoints'

export type Recap = {
  teamName: string
  rank: number
  teams: number
  points: number
  /** places gained since the previous day (negative = dropped); null without a previous day */
  move: number | null
  /** points gained since the previous day; null without a previous day */
  gain: number | null
  best: { name: string; gain: number } | null
  worst: { name: string; gain: number } | null
  /** teams that were below you yesterday and are above you now */
  overtakenBy: string[]
  /** teams that were above you yesterday and are below you now */
  overtook: string[]
  leader: { name: string; points: number } | null
}

const num = (n: number | string | null | undefined) => Number(n ?? 0)

/** `name` maps a team's row to the label to show for that team. */
export function buildRecap(board: Leaderboard, userId: string, name: (row: LeaderboardRow) => string = (r) => r.username): Recap | null {
  const me = board.rows.find((r) => r.user_id === userId)
  if (!me) return null
  const hasPrev = me.prev_rank != null && me.prev_points != null

  const gains = me.players
    .filter((p) => p.prev_points != null)
    .map((p) => ({ name: p.name, gain: num(p.points) - num(p.prev_points) }))
  const best = gains.filter((g) => g.gain > 0).sort((a, b) => b.gain - a.gain)[0] ?? null
  const lowest = gains.length > 1 ? ([...gains].sort((a, b) => a.gain - b.gain)[0] ?? null) : null
  const worst = lowest && lowest.gain <= 0 && lowest.name !== best?.name ? lowest : null

  const others = board.rows.filter((r) => r.member_id !== me.member_id && r.prev_rank != null)
  const overtakenBy = hasPrev ? others.filter((r) => r.prev_rank! > me.prev_rank! && r.rank < me.rank).map(name) : []
  const overtook = hasPrev ? others.filter((r) => r.prev_rank! < me.prev_rank! && r.rank > me.rank).map(name) : []
  const top = board.rows[0]

  return {
    teamName: name(me),
    rank: me.rank,
    teams: board.rows.length,
    points: num(me.points),
    move: hasPrev ? me.prev_rank! - me.rank : null,
    gain: hasPrev ? num(me.points) - num(me.prev_points) : null,
    best,
    worst,
    overtakenBy,
    overtook,
    leader: top ? { name: name(top), points: num(top.points) } : null,
  }
}

function ordinal(n: number): string {
  const v = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** One-line summary for sharing as text. */
export function recapText(event: string, r: Recap): string {
  const parts = [`${event}: ${r.teamName} is ${ordinal(r.rank)} of ${r.teams} with ${r.points} pts`]
  if (r.gain != null) parts.push(`${r.gain >= 0 ? '+' : ''}${r.gain} today`)
  if (r.move) parts.push(`${r.move > 0 ? '▲' : '▼'}${Math.abs(r.move)}`)
  return parts.join(' · ')
}
