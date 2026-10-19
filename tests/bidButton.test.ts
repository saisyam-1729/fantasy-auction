import { describe, expect, it } from 'vitest'
import { bidButtonLabel, bidButtonState } from '@/lib/bidButton'

const L = 100_000
const CR = 10_000_000
const base = {
  currentBid: 30 * L,
  holdsBid: false,
  paused: false,
  offline: false,
  atCap: false,
  remaining: 50 * CR,
  freeToSpend: 49 * CR,
}
const money = (n: number) => `₹${n / L}L`

describe('bid button state', () => {
  it('is enabled with the next slab price', () => {
    const s = bidButtonState(base)
    expect(s.disabled).toBe(false)
    expect(s.nextPrice).toBe(40 * L)
    expect(bidButtonLabel(s, money)).toBe('Bid ₹40L · +₹10L')
  })

  it('explains each way it can be blocked', () => {
    expect(bidButtonState({ ...base, holdsBid: true }).reason).toBe('holding')
    expect(bidButtonState({ ...base, atCap: true }).reason).toBe('full')
    expect(bidButtonState({ ...base, paused: true }).reason).toBe('paused')
    expect(bidButtonState({ ...base, offline: true }).reason).toBe('offline')
    expect(bidButtonState({ ...base, remaining: 35 * L, freeToSpend: 0 }).reason).toBe('need_funds')
    expect(bidButtonState({ ...base, freeToSpend: 35 * L }).reason).toBe('locks_purse')
  })

  it('a full squad reads as full, not as a purse problem', () => {
    const s = bidButtonState({ ...base, atCap: true, freeToSpend: 0 })
    expect(bidButtonLabel(s, money)).toBe('Squad full')
  })
})
