'use client'

import { useEffect, useState } from 'react'

/**
 * Whole seconds left after the last bid, ticking once a second.
 * null when there is no live lot. Freezes (keeps its value) while paused.
 */
export function useCountdown({
  active,
  paused,
  lastBidTime,
  seconds,
}: {
  active: boolean
  paused: boolean
  lastBidTime: string | null
  seconds: number
}): number | null {
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    if (!active || !lastBidTime) return
    if (paused) return // freeze: stop ticking but keep the last value
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(lastBidTime).getTime()) / 1000)
      setCountdown(Math.max(0, seconds - elapsed))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [active, paused, lastBidTime, seconds])

  // No live lot means no countdown, whatever the last tick was.
  return active && lastBidTime ? countdown : null
}
