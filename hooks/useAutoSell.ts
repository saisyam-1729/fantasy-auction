'use client'

import { useEffect, useRef } from 'react'

/**
 * With auto-sell on, every member's browser asks the database to sell once the
 * lot timer has run out. The database re-checks the clock under a row lock, so
 * many callers still sell the lot exactly once. `finalize` should call the
 * auction_finalize_expired RPC and refresh any state it needs.
 */
export function useAutoSell({
  enabled,
  expired,
  active,
  paused,
  hasTopBidder,
  finalize,
}: {
  enabled: boolean
  expired: boolean
  active: boolean
  paused: boolean
  hasTopBidder: boolean
  finalize: () => Promise<void>
}) {
  const finalizeRef = useRef(finalize)
  // Keep the latest callback without restarting the timer.
  useEffect(() => {
    finalizeRef.current = finalize
  })

  useEffect(() => {
    if (!enabled || !expired || !active || paused || !hasTopBidder) return
    let busy = false
    const id = window.setInterval(async () => {
      if (busy) return
      busy = true
      try {
        await finalizeRef.current()
      } finally {
        busy = false
      }
    }, 2000)
    return () => window.clearInterval(id)
  }, [enabled, expired, active, paused, hasTopBidder])
}
