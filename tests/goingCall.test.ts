import { describe, expect, it } from 'vitest'
import { goingCall, goingCallLabel } from '@/lib/goingCall'

describe('going call', () => {
  it('calls once at 10s, twice at 5s and sold at 0 on a 30s timer', () => {
    expect(goingCall(30, 30, true)).toBe('none')
    expect(goingCall(11, 30, true)).toBe('none')
    expect(goingCall(10, 30, true)).toBe('once')
    expect(goingCall(6, 30, true)).toBe('once')
    expect(goingCall(5, 30, true)).toBe('twice')
    expect(goingCall(1, 30, true)).toBe('twice')
    expect(goingCall(0, 30, true)).toBe('sold')
  })

  it('scales with the timer length', () => {
    expect(goingCall(6, 18, true)).toBe('once')
    expect(goingCall(3, 18, true)).toBe('twice')
    expect(goingCall(15, 45, true)).toBe('once')
    expect(goingCall(8, 45, true)).toBe('twice')
  })

  it('never calls a lot without a bid, or without a timer', () => {
    expect(goingCall(3, 30, false)).toBe('none')
    expect(goingCall(0, 30, false)).toBe('none')
    expect(goingCall(null, 30, true)).toBe('none')
  })

  it('has readable labels', () => {
    expect(goingCallLabel('once')).toBe('Going once…')
    expect(goingCallLabel('twice')).toBe('Going twice…')
    expect(goingCallLabel('none')).toBe('')
  })
})
