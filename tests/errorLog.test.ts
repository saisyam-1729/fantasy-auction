import { describe, expect, it } from 'vitest'
import { createLimiter, sanitizeReport } from '@/lib/errorLog'

describe('sanitizeReport', () => {
  it('keeps a good report and strips the query string from the path', () => {
    const r = sanitizeReport({ message: 'boom', stack: 'at x', source: 'window', path: '/room/1?token=abc#frag', userAgent: 'UA' })
    expect(r).toEqual({ message: 'boom', stack: 'at x', source: 'window', path: '/room/1', userAgent: 'UA' })
  })

  it('rejects things that are not reports', () => {
    expect(sanitizeReport(null)).toBeNull()
    expect(sanitizeReport('text')).toBeNull()
    expect(sanitizeReport({})).toBeNull()
    expect(sanitizeReport({ message: '   ' })).toBeNull()
    expect(sanitizeReport({ message: 42 })).toBeNull()
  })

  it('caps long fields and defaults the rest', () => {
    const r = sanitizeReport({ message: 'm'.repeat(5000), stack: 's'.repeat(9000), path: 'p'.repeat(900) })!
    expect(r.message.length).toBe(500)
    expect(r.stack!.length).toBe(2000)
    expect(r.path.length).toBe(200)
    expect(r.source).toBe('manual')
  })
})

describe('createLimiter', () => {
  it('allows the limit then blocks until the window passes', () => {
    const allow = createLimiter(2, 1000)
    expect(allow('a', 0)).toBe(true)
    expect(allow('a', 10)).toBe(true)
    expect(allow('a', 20)).toBe(false)
    expect(allow('b', 20)).toBe(true) // another caller is unaffected
    expect(allow('a', 1001)).toBe(true) // a new window
  })
})
