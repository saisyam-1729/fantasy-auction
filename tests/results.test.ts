import { describe, expect, it } from 'vitest'
import { computeInsights, type InsightPlayer } from '@/lib/insights'
import { computeResults, resultsCsv } from '@/lib/results'

const L = 100_000
const CR = 10_000_000
const sold = (id: string, type: string, base: number, price: number, to: string, at: number): InsightPlayer => ({
  id,
  player_name: id,
  player_type: type,
  base_price: base,
  status: 'SOLD',
  sold_price: price,
  sold_to_user_id: to,
  purchased_at: new Date(at).toISOString(),
})
const users = [
  { id: 'A', display_name: 'Ann', budget: 100 * CR, spent: 15 * CR },
  { id: 'B', display_name: 'Bo "B"', budget: 100 * CR, spent: 3 * CR },
]
const players = [
  sold('Star', 'BAT', 2 * CR, 10 * CR, 'A', 1),
  sold('Keeper', 'WK', 20 * L, 5 * CR, 'A', 2),
  sold('Cheap', 'BOWL', 20 * L, 3 * CR, 'B', 3),
]
const insights = computeInsights({ users, players, minSquad: 2, maxSquad: 4 })

describe('results', () => {
  it('ranks teams by players then money left, and flags a missing keeper', () => {
    const { standings } = computeResults(insights)
    expect(standings.map((s) => s.name)).toEqual(['Ann', 'Bo "B"'])
    expect(standings[1].noKeeper).toBe(true)
  })

  it('finds the priciest buy, biggest premium and biggest spender', () => {
    const h = Object.fromEntries(computeResults(insights).highlights.map((x) => [x.id, x]))
    expect(h.priciest.player).toBe('Star')
    expect(h.premium.player).toBe('Keeper')
    expect(h.premium.premium).toBe(25)
    expect(h.spender.team).toBe('Ann')
  })

  it('has no highlights before any sale and escapes CSV quotes', () => {
    expect(computeResults(computeInsights({ users, players: [], minSquad: 2, maxSquad: 4 })).highlights).toEqual([])
    expect(resultsCsv(insights)).toContain('"Bo ""B""","Cheap","BOWL","30000000","2000000"')
  })
})
