import { describe, expect, it } from 'vitest'
import { buildRecap, recapText } from '@/lib/recap'
import { captainTag, teamLabel } from '@/lib/draft'
import type { Leaderboard, LeaderboardRow } from '@/lib/fantasyPoints'

const player = (id: number, name: string, points: number, prev: number | null) => ({ player_id: id, name, team: 'T', role: null, points, matches: 1, prev_points: prev })
const row = (id: string, points: number, rank: number, prevPoints: number | null, prevRank: number | null, players = [] as ReturnType<typeof player>[]): LeaderboardRow => ({
  member_id: id,
  username: id.toUpperCase(),
  user_id: 'u-' + id,
  order_pos: null,
  points,
  rank,
  prev_points: prevPoints,
  prev_rank: prevRank,
  players,
})
const board = (rows: LeaderboardRow[]): Leaderboard => ({ synced_at: null, latest_day: '2026-11-24', previous_day: '2026-11-23', rows })

describe('buildRecap', () => {
  const b = board([
    row('d', 120, 1, 50, 4),
    row('me', 100, 2, 60, 3, [player(1, 'Star', 70, 30), player(2, 'Dud', 10, 10), player(3, 'Mid', 20, 20)]),
    row('c', 90, 3, 85, 1),
    row('a', 80, 4, 80, 2),
  ])

  it('reports places, points and the best and worst player of the day', () => {
    const r = buildRecap(b, 'u-me')!
    expect(r).toMatchObject({ rank: 2, teams: 4, points: 100, move: 1, gain: 40 })
    expect(r.best).toEqual({ name: 'Star', gain: 40 })
    expect(r.worst).toEqual({ name: 'Dud', gain: 0 })
  })

  it('names who passed you and who you passed', () => {
    const r = buildRecap(b, 'u-me')!
    expect(r.overtakenBy).toEqual(['D'])
    expect(r.overtook).toEqual(['C', 'A'])
    expect(r.leader).toEqual({ name: 'D', points: 120 })
  })

  it('has no movement without a previous day', () => {
    const r = buildRecap(board([row('me', 50, 1, null, null, [player(1, 'X', 50, null)])]), 'u-me')!
    expect(r.move).toBeNull()
    expect(r.gain).toBeNull()
    expect(r.best).toBeNull()
    expect(r.overtakenBy).toEqual([])
  })

  it('returns null for someone not on the board', () => {
    expect(buildRecap(b, 'u-nobody')).toBeNull()
  })

  it('writes a share line', () => {
    expect(recapText('ILT20 2026', buildRecap(b, 'u-me')!)).toBe('ILT20 2026: ME is 2nd of 4 with 100 pts · +40 today · ▲1')
  })
})

describe('team helpers', () => {
  it('labels teams by name and emoji, else username', () => {
    expect(teamLabel({ username: 'sai', team_name: 'Sixers', team_emoji: '🦁' })).toBe('🦁 Sixers')
    expect(teamLabel({ username: 'sai', team_name: ' Sixers ', team_emoji: null })).toBe('Sixers')
    expect(teamLabel({ username: 'sai', team_name: null, team_emoji: '🦁' })).toBe('sai')
  })

  it('tags captains', () => {
    expect(captainTag({ captain_id: 5, vice_id: 6 }, 5)).toBe('C')
    expect(captainTag({ captain_id: 5, vice_id: 6 }, 6)).toBe('VC')
    expect(captainTag({ captain_id: 5, vice_id: 6 }, 7)).toBeNull()
    expect(captainTag(undefined, 5)).toBeNull()
  })
})
