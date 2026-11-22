import { describe, expect, it } from 'vitest'
import {
  draftSummaryText,
  inDraftOrder,
  lobbyCheck,
  memberOnClock,
  ordinal,
  roundOf,
  snakeSlot,
  upcomingPicks,
  type DraftMember,
  type DraftPick,
  type DraftPoolPlayer,
} from '@/lib/draft'

const member = (id: string, order_pos: number | null, joined = '2026-11-12T10:00:00Z'): DraftMember => ({
  id,
  draft_id: 'd',
  user_id: 'u' + id,
  username: 'user' + id,
  is_host: id === 'a',
  order_pos,
  joined_at: joined,
})

describe('snakeSlot', () => {
  it('goes 1..n, then n..1, then 1.. again', () => {
    const seq = Array.from({ length: 13 }, (_, p) => snakeSlot(p, 5))
    expect(seq).toEqual([1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 1, 2, 3])
  })

  it('works for 3 and 10 teams', () => {
    expect(Array.from({ length: 7 }, (_, p) => snakeSlot(p, 3))).toEqual([1, 2, 3, 3, 2, 1, 1])
    expect(snakeSlot(9, 10)).toBe(10)
    expect(snakeSlot(10, 10)).toBe(10)
    expect(snakeSlot(19, 10)).toBe(1)
    expect(snakeSlot(20, 10)).toBe(1)
  })

  it('gives every team the same number of picks after full rounds', () => {
    const counts = new Map<number, number>()
    for (let p = 0; p < 4 * 6; p++) counts.set(snakeSlot(p, 4), (counts.get(snakeSlot(p, 4)) ?? 0) + 1)
    expect([...counts.values()]).toEqual([6, 6, 6, 6])
  })
})

describe('rounds and the clock', () => {
  const members = [member('c', 3), member('a', 1), member('b', 2)]

  it('labels rounds from 1', () => {
    expect(roundOf(0, 3)).toEqual({ round: 1, pickInRound: 1 })
    expect(roundOf(4, 3)).toEqual({ round: 2, pickInRound: 2 })
  })

  it('finds who is on the clock', () => {
    expect(memberOnClock(members, 0)?.id).toBe('a')
    expect(memberOnClock(members, 2)?.id).toBe('c')
    expect(memberOnClock(members, 3)?.id).toBe('c')
    expect(memberOnClock(members, 5)?.id).toBe('a')
  })

  it('lists upcoming picks and stops at the end', () => {
    const next = upcomingPicks(members, 4, 2, 5)
    expect(next.map((x) => x.member?.id)).toEqual(['b', 'a'])
  })

  it('sorts members by position, unplaced last by join time', () => {
    const list = [member('x', null, '2026-11-12T10:05:00Z'), member('y', 2), member('z', null, '2026-11-12T10:01:00Z'), member('w', 1)]
    expect(inDraftOrder(list).map((m) => m.id)).toEqual(['w', 'y', 'z', 'x'])
  })
})

describe('lobbyCheck', () => {
  it('needs at least 3 players', () => {
    const r = lobbyCheck([member('a', null), member('b', null)])
    expect(r.canSpin).toBe(false)
    expect(r.canStart).toBe(false)
    expect(r.reason).toMatch(/2 of at least 3/)
  })

  it('spins until everyone has a position, then starts', () => {
    expect(lobbyCheck([member('a', 1), member('b', null), member('c', null)])).toMatchObject({ canSpin: true, canStart: false })
    expect(lobbyCheck([member('a', 1), member('b', 3), member('c', 2)])).toMatchObject({ canSpin: false, canStart: true })
  })

  it('rejects more than 10', () => {
    const many = Array.from({ length: 11 }, (_, i) => member(String(i), i + 1))
    expect(lobbyCheck(many).canStart).toBe(false)
  })
})

describe('text', () => {
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ])
  })

  it('summarises picks per team in draft order', () => {
    const members = [member('b', 2), member('a', 1)]
    const players = new Map<number, DraftPoolPlayer>([
      [1, { id: 1, sort_no: 1, team: 'Delhi', player_name: 'P One', role: null, captain: null, notes: null }],
      [2, { id: 2, sort_no: 2, team: 'Bengal', player_name: 'P Two', role: null, captain: null, notes: null }],
    ])
    const picks: DraftPick[] = [
      { id: 1, draft_id: 'd', pick_no: 0, member_id: 'a', player_id: 2, picked_by: null, picked_at: '' },
      { id: 2, draft_id: 'd', pick_no: 1, member_id: 'b', player_id: 1, picked_by: null, picked_at: '' },
    ]
    expect(draftSummaryText('Friends', members, picks, players)).toBe(
      'Friends draft\n\n1. usera (1)\n  1. P Two (Bengal)\n\n2. userb (1)\n  1. P One (Delhi)'
    )
  })
})

describe('pick timer and wishlist helpers', () => {
  it('computes the turn deadline only for timed, running drafts', async () => {
    const { turnDeadline } = await import('@/lib/draft')
    const t = '2026-11-23T10:00:00Z'
    expect(turnDeadline({ status: 'DRAFTING', pick_seconds: 60, turn_started_at: t })).toBe(new Date(t).getTime() + 60_000)
    expect(turnDeadline({ status: 'DRAFTING', pick_seconds: null, turn_started_at: t })).toBeNull()
    expect(turnDeadline({ status: 'DONE', pick_seconds: 60, turn_started_at: t })).toBeNull()
    expect(turnDeadline({ status: 'DRAFTING', pick_seconds: 60, turn_started_at: null })).toBeNull()
  })

  it('moves wishlist entries up and down', async () => {
    const { moveInList } = await import('@/lib/draft')
    expect(moveInList([1, 2, 3], 3, -1)).toEqual([1, 3, 2])
    expect(moveInList([1, 2, 3], 1, 1)).toEqual([2, 1, 3])
    expect(moveInList([1, 2, 3], 1, -1)).toEqual([1, 2, 3])
    expect(moveInList([1, 2, 3], 9, 1)).toEqual([1, 2, 3])
  })
})
