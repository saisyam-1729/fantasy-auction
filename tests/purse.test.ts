import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_SQUAD, DEFAULT_MIN_SQUAD, purseLock } from '@/lib/purse'

const L = 100_000
const CR = 10_000_000
const others = Array(80).fill(20 * L)
const base = { budget: 100 * CR, minSquadSize: DEFAULT_MIN_SQUAD, maxSquadSize: DEFAULT_MAX_SQUAD, otherUnsoldBasePrices: others }

describe('purse lock', () => {
  it('reserves 11 slots at the start of a 12-minimum squad', () => {
    const p = purseLock({ ...base, spent: 0, squadCount: 0 })
    expect(p.slotsLeft).toBe(12)
    expect(p.reserved).toBe(11 * 20 * L)
    expect(p.freeToSpend).toBe(97.8 * CR)
  })

  it('stops reserving once the minimum is filled', () => {
    const p = purseLock({ ...base, spent: 20 * CR, squadCount: 12 })
    expect(p.slotsLeft).toBe(0)
    expect(p.freeToSpend).toBe(80 * CR)
  })

  it('is at cap with zero free spend at the maximum', () => {
    const p = purseLock({ ...base, spent: 15 * 20 * L, squadCount: 15 })
    expect(p.atCap).toBe(true)
    expect(p.freeToSpend).toBe(0)
    expect(purseLock({ ...base, spent: 14 * 20 * L, squadCount: 14 }).atCap).toBe(false)
  })

  it('does not reserve slots with no player left in the pool', () => {
    const p = purseLock({ ...base, spent: 0, squadCount: 0, otherUnsoldBasePrices: [20 * L, 20 * L] })
    expect(p.reserveSlots).toBe(2)
  })
})
