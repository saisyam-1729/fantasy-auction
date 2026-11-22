'use client'

import { useEffect } from 'react'

type Sentinel = { release: () => Promise<void> }

/**
 * Keeps the screen on while `active` (e.g. during a live draft), so phones don't
 * sleep and drop the live connection. Re-acquired when the tab becomes visible
 * again (browsers release it when you switch away). Silently does nothing where
 * the Screen Wake Lock API is missing.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock
    if (!active || !api) return
    let sentinel: Sentinel | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        const s = await api.request('screen')
        if (cancelled) void s.release()
        else sentinel = s
      } catch {
        // denied (e.g. battery saver): fine, the screen may sleep
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
