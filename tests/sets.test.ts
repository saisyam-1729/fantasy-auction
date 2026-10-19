import { describe, expect, it } from 'vitest'
import { compareBySets, setInfo, setProgress, setRank } from '@/lib/sets'

const CR = 10_000_000
const L = 100_000

describe('set rank', () => {
  it('puts ₹3 Cr and above in Marquee whatever the role', () => {
    expect(setRank(5 * CR, 'BOWL')).toBe(1)
    expect(setRank(3 * CR, 'WK')).toBe(1)
  })

  it('puts ₹20 L and below in Emerging whatever the role', () => {
    expect(setRank(20 * L, 'BAT')).toBe(6)
    expect(setRank(20 * L, 'BOWL')).toBe(6)
  })

  it('splits the middle by role, with AR counted as all-rounder', () => {
    expect(setRank(CR, 'BAT')).toBe(2)
    expect(setRank(CR, 'ALL')).toBe(3)
    expect(setRank(CR, 'AR')).toBe(3)
    expect(setRank(CR, 'WK')).toBe(4)
    expect(setRank(CR, 'BOWL')).toBe(5)
    expect(setInfo(CR, 'bat').name).toBe('Batters')
  })

  it('sorts by set, then price high to low', () => {
    const lots = [
      { id: 'a', base_price: 20 * L, player_type: 'BOWL' },
      { id: 'b', base_price: CR, player_type: 'BOWL' },
      { id: 'c', base_price: 4 * CR, player_type: 'BAT' },
      { id: 'd', base_price: 2 * CR, player_type: 'BAT' },
      { id: 'e', base_price: CR, player_type: 'BAT' },
    ]
    expect([...lots].sort(compareBySets).map((l) => l.id)).toEqual(['c', 'd', 'e', 'b', 'a'])
  })

  it('describes progress through the current set', () => {
    const players = [
      { id: '1', base_price: CR, player_type: 'BAT', status: 'UNSOLD' },
      { id: '2', base_price: CR, player_type: 'BAT', status: 'UNSOLD' },
      { id: '3', base_price: CR, player_type: 'BAT', status: 'SOLD' },
      { id: '4', base_price: CR, player_type: 'BOWL', status: 'UNSOLD' },
    ]
    expect(setProgress(players[0], players, '1')).toBe('Set 2 of 6: Batters, 1 more in this set')
    expect(setProgress(null, players, null)).toBe('')
  })
})
