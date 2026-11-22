'use client'

import { useSyncExternalStore } from 'react'
import { LeaderboardBoard } from '@/components/leaderboard/LeaderboardView'
import type { Leaderboard, LeaderboardRow } from '@/lib/fantasyPoints'
import fixture from '../draft-preview/fixture.json'

/** Sample leaderboard built from the draft preview's teams with made-up points. */
export default function LeaderboardPreview({ zero }: { zero: boolean }) {
  // browser only, like the real page (dates are formatted in the viewer's locale)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const byId = new Map(fixture.pool.map((p) => [p.id, p]))
  const rows: LeaderboardRow[] = fixture.members.map((m, i) => {
    const players = fixture.picks
      .filter((p) => p.member_id === m.id)
      .map((p, j) => {
        const pl = byId.get(p.player_id)!
        const points = zero ? 0 : ((p.player_id * 37 + j * 11) % 90) - 5
        return { player_id: pl.id, name: pl.player_name, team: pl.team, role: pl.role, points, matches: 2, prev_points: zero ? null : Math.max(0, points - ((i + j) % 4) * 12) }
      })
    const points = players.reduce((s, p) => s + p.points, 0)
    const prev = players.reduce((s, p) => s + (p.prev_points ?? 0), 0)
    return { member_id: m.id, username: m.username, user_id: m.user_id, order_pos: m.order_pos, points, rank: 0, prev_points: zero ? null : prev, prev_rank: null, players }
  })
  const rank = (key: 'points' | 'prev_points') => {
    const sorted = [...rows].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0))
    return (r: LeaderboardRow) => 1 + sorted.filter((x) => Number(x[key] ?? 0) > Number(r[key] ?? 0)).length
  }
  const now = rank('points')
  const before = rank('prev_points')
  for (const r of rows) {
    r.rank = now(r)
    r.prev_rank = zero ? null : before(r)
  }
  rows.sort((a, b) => a.rank - b.rank)
  const board: Leaderboard = { synced_at: '2026-11-23T20:35:00Z', latest_day: '2026-11-24', previous_day: zero ? null : '2026-11-23', rows }
  const sync = { ran_at: '2026-11-21T20:35:00Z', source_rows: 30, matched: 29, unmatched: [{ name: 'Mystery Man' }] }
  return mounted ? <LeaderboardBoard board={board} currentUserId="u4" sync={sync} now={Date.parse('2026-11-23T10:00:00Z')} /> : null
}
