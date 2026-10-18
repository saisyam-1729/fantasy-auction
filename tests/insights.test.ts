import { describe, expect, it } from 'vitest'
import { computeInsights, rivalsStrip, type InsightPlayer } from '@/lib/insights'

const L = 100_000
const CR = 10_000_000

const sold = (id: string, type: string, base: number, price: number, to: string, at: number): InsightPlayer => ({
  id, player_name: id, player_type: type, base_price: base, status: 'SOLD',
  sold_price: price, sold_to_user_id: to, purchased_at: new Date(at).toISOString(),
})
const unsold = (i: number): InsightPlayer => ({ id: 'u' + i, player_name: 'u' + i, player_type: 'BAT', base_price: 20 * L, status: 'UNSOLD' })

const users = [
  { id: 'A', display_name: 'A', budget: 100 * CR, spent: 60 * CR },
  { id: 'B', display_name: 'B', budget: 100 * CR, spent: 7 * CR },
  { id: 'C', display_name: 'C', budget: 100 * CR, spent: 0 },
]
const players = [
  sold('p1', 'BOWL', 20 * L, 40 * CR, 'A', 1000),
  sold('p2', 'BAT', 20 * L, 20 * CR, 'A', 2000),
  sold('p3', 'WK', 20 * L, 5 * CR, 'B', 3000),
  sold('p4', 'AR', 20 * L, 2 * CR, 'B', 4000),
  ...Array.from({ length: 80 }, (_, i) => unsold(i)),
]
const run = () => computeInsights({ users, players, minSquad: 12, maxSquad: 15 })

describe('insights', () => {
  it('counts roles, treating AR as ALL, and flags a missing keeper', () => {
    const [A, B] = run().teams
    expect(A.noKeeper).toBe(true)
    expect(B.noKeeper).toBe(false)
    expect(B.roles.ALL).toBe(1)
  })

  it('labels a team with 60% of purse on two buys as top_heavy with evidence', () => {
    const A = run().teams[0]
    expect(A.topTwoShare).toBeCloseTo(0.6)
    expect(A.strategy.strategy_id).toBe('top_heavy')
    expect(A.strategy.evidence[0]).toBe('60% of purse on 2 players')
  })

  it('computes premium as price over base price', () => {
    const B = run().teams[1]
    expect(B.buys.map((b) => b.premium)).toEqual([25, 10])
  })

  it('builds cumulative spend across every room sale', () => {
    const { teams, roomSales } = run()
    expect(roomSales).toBe(4)
    expect(teams[0].cumulative).toEqual([40 * CR, 60 * CR, 60 * CR, 60 * CR])
    expect(teams[1].cumulative).toEqual([0, 0, 5 * CR, 7 * CR])
  })

  it('reserves one fewer slot than still needed for free to spend', () => {
    expect(run().teams[0].freeToSpend).toBe(40 * CR - 9 * 20 * L)
  })

  it('is deterministic and orders equal timestamps by id', () => {
    const tied = [sold('b', 'BAT', 20 * L, CR, 'A', 5), sold('a', 'BAT', 20 * L, 2 * CR, 'A', 5)]
    const r1 = computeInsights({ users, players: tied, minSquad: 12, maxSquad: 15 })
    const r2 = computeInsights({ users, players: [...tied].reverse(), minSquad: 12, maxSquad: 15 })
    expect(r1.teams[0].cumulative).toEqual(r2.teams[0].cumulative)
  })

  it('shows no strip before the first sale and counts rivals only', () => {
    expect(rivalsStrip({ teams: [], roomSales: 0 }, 'B')).toBe('')
    expect(rivalsStrip(run(), 'B')).toBe('Rivals: 2 teams still have no keeper · 1 team is top-heavy')
  })

  it('labels waiting only after enough room sales', () => {
    const many = Array.from({ length: 10 }, (_, i) => sold('s' + i, 'BAT', 20 * L, 20 * L, 'A', 100 + i))
    const r = computeInsights({ users: [{ ...users[2] }, { ...users[0], spent: 2 * CR }], players: many, minSquad: 12, maxSquad: 15 })
    expect(r.teams[0].strategy.strategy_id).toBe('waiting')
  })
})
