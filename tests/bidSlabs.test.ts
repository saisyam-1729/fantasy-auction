import { describe, expect, it } from 'vitest'
import { nextBidAmount, nextBidIncrement, slabStep } from '@/lib/bidSlabs'

const L = 100_000
const CR = 10_000_000

describe('bid slabs', () => {
  it('steps +10L under 2Cr, +20L to 5Cr, +25L above', () => {
    expect(slabStep(30 * L)).toBe(10 * L)
    expect(slabStep(2 * CR)).toBe(20 * L)
    expect(slabStep(5 * CR)).toBe(25 * L)
  })

  it('raises 30L by 10L eight times', () => {
    let cur = 30 * L
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      expect(nextBidIncrement(cur)).toBe(10 * L)
      cur = nextBidAmount(cur)
      seen.push(cur / L)
    }
    expect(seen).toEqual([40, 50, 60, 70, 80, 90, 100, 110])
  })

  it('lands on 2Cr and 5Cr boundaries', () => {
    expect(nextBidAmount(190 * L)).toBe(2 * CR)
    expect(nextBidAmount(2 * CR)).toBe(220 * L)
    expect(nextBidAmount(195 * L)).toBe(2 * CR)
    expect(nextBidAmount(490 * L)).toBe(5 * CR)
    expect(nextBidAmount(5 * CR)).toBe(525 * L)
  })
})
