import { describe, expect, it } from 'vitest'
import { initials, teamColours } from '@/lib/teams'

describe('initials', () => {
  it('uses the first and last word', () => {
    expect(initials('Ishan Kishan')).toBe('IK')
    expect(initials('Mahendra Singh Dhoni')).toBe('MD')
  })
  it('handles one word, punctuation and brackets', () => {
    expect(initials('Rashid')).toBe('R')
    expect(initials('K. L. Rahul')).toBe('KR')
    expect(initials('Rahul Tripathi (c)')).toBe('RT')
    expect(initials('   ')).toBe('?')
  })
})

describe('teamColours', () => {
  it('knows the ten franchises, ignoring case, and falls back to neutral', () => {
    expect(teamColours('csk').bg).toBe('#F9CD05')
    expect(teamColours('MI').fg).toBe('#FFFFFF')
    expect(teamColours(null)).toEqual(teamColours('NOPE'))
  })
})
