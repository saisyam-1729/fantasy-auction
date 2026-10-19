/**
 * Shared pieces of the client error log: what a report looks like, how an
 * incoming one is cleaned before it is written to the server log, and a tiny
 * rate limiter. Kept free of Next/React so it can be unit tested.
 */

export type ErrorReport = {
  message: string
  stack?: string
  /** 'window' | 'promise' | 'boundary' | 'manual' */
  source: string
  /** Page path only, never the query string. */
  path: string
  userAgent?: string
}

const MAX_MESSAGE = 500
const MAX_STACK = 2000
const MAX_FIELD = 200

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Accepts untrusted JSON and returns a bounded report, or null if it is not one. */
export function sanitizeReport(raw: unknown): ErrorReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const message = clip(r.message, MAX_MESSAGE).trim()
  if (!message) return null
  // Keep only the path: query strings and fragments can hold tokens.
  const path = clip(r.path, MAX_FIELD).split(/[?#]/)[0] || '/'
  return {
    message,
    stack: clip(r.stack, MAX_STACK) || undefined,
    source: clip(r.source, 20) || 'manual',
    path,
    userAgent: clip(r.userAgent, MAX_FIELD) || undefined,
  }
}

/** Fixed-window limiter: at most `limit` hits per key per `windowMs`. */
export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>()
  return function allow(key: string, now: number = Date.now()): boolean {
    // Drop expired entries now and then so the map cannot grow forever.
    if (hits.size > 500) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
    }
    const entry = hits.get(key)
    if (!entry || entry.reset <= now) {
      hits.set(key, { count: 1, reset: now + windowMs })
      return true
    }
    entry.count += 1
    return entry.count <= limit
  }
}
