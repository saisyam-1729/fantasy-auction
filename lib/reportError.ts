'use client'

import type { ErrorReport } from './errorLog'

const recent = new Map<string, number>()

/** Send an error to /api/log-error. Never throws, skips repeats within 10 seconds. */
export function reportError(error: unknown, source: ErrorReport['source'] = 'manual') {
  try {
    if (typeof window === 'undefined') return
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
    const message = e.message || 'Unknown error'
    const now = Date.now()
    const last = recent.get(message)
    if (last && now - last < 10_000) return
    recent.set(message, now)

    const payload = JSON.stringify({
      message,
      stack: e.stack,
      source,
      path: window.location.pathname,
      userAgent: navigator.userAgent,
    })
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/log-error', new Blob([payload], { type: 'application/json' }))
    } else {
      void fetch('/api/log-error', { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } })
    }
  } catch {
    // reporting must never cause another error
  }
}
