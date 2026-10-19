import { describe, expect, it } from 'vitest'
import { DEFAULT_SLABS, describeSlabs, isValidSlabs, nextBidAmount, nextBidIncrement, parseSlabs, slabStep } from '@/lib/bidSlabs'
import { DEFAULT_FORM, parseSettingsForm } from '@/lib/roomSettings'

const L = 100_000
const CR = 10_000_000
const custom = { t1: CR, t2: 3 * CR, s1: 5 * L, s2: 10 * L, s3: 20 * L }

describe('custom bid steps', () => {
  it('use the room steps and snap to its thresholds', () => {
    expect(slabStep(20 * L, custom)).toBe(5 * L)
    expect(slabStep(CR, custom)).toBe(10 * L)
    expect(slabStep(3 * CR, custom)).toBe(20 * L)
    expect(nextBidAmount(97 * L, custom)).toBe(CR)
    expect(nextBidIncrement(97 * L, custom)).toBe(3 * L)
    expect(nextBidAmount(295 * L, custom)).toBe(3 * CR)
  })

  it('default to 10 / 20 / 25 L when no config is given', () => {
    expect(nextBidAmount(190 * L)).toBe(2 * CR)
    expect(slabStep(5 * CR)).toBe(25 * L)
  })

  it('validate like the database', () => {
    expect(isValidSlabs(custom)).toBe(true)
    expect(isValidSlabs({ ...custom, s1: 0 })).toBe(false)
    expect(isValidSlabs({ ...custom, t2: custom.t1 })).toBe(false)
    expect(isValidSlabs({ ...custom, s1: 1.5 })).toBe(false)
    expect(isValidSlabs({ t1: CR })).toBe(false)
    expect(isValidSlabs(null)).toBe(false)
  })

  it('fall back to the defaults for missing or broken saved config', () => {
    expect(parseSlabs(null)).toEqual(DEFAULT_SLABS)
    expect(parseSlabs({ t1: 'x' })).toEqual(DEFAULT_SLABS)
    expect(parseSlabs(custom)).toEqual(custom)
  })

  it('describe themselves for the hint under the bid button', () => {
    const money = (n: number) => `${n / L}L`
    expect(describeSlabs(custom, money)).toBe('Under 100L the raise is 5L. From 100L to 300L it is 10L. Above 300L it is 20L.')
  })
})

describe('settings form', () => {
  it('accepts the defaults and stores them as no custom steps', () => {
    const r = parseSettingsForm(DEFAULT_FORM)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.settings).toEqual({ budget: 100 * CR, timerSeconds: 30, slabs: null })
  })

  it('converts friendly units to rupees', () => {
    const r = parseSettingsForm({ budgetCr: '50', timerSeconds: '45', t1Cr: '1', t2Cr: '3', s1L: '5', s2L: '10', s3L: '20' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.settings).toEqual({ budget: 50 * CR, timerSeconds: 45, slabs: custom })
  })

  it('explains what is wrong', () => {
    const bad = (patch: object) => {
      const r = parseSettingsForm({ ...DEFAULT_FORM, ...patch })
      return r.ok ? '' : r.error
    }
    expect(bad({ budgetCr: '0' })).toMatch(/Budget/)
    expect(bad({ budgetCr: '' })).toMatch(/Budget/)
    expect(bad({ timerSeconds: '5' })).toMatch(/Timer/)
    expect(bad({ timerSeconds: '30.5' })).toMatch(/Timer/)
    expect(bad({ t2Cr: '1' })).toMatch(/Bid steps/)
    expect(bad({ s1L: '0' })).toMatch(/Bid steps/)
    expect(bad({ s3L: 'abc' })).toMatch(/Bid steps/)
  })
})
