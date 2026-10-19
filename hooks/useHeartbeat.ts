'use client'

import { useEffect, useRef } from 'react'

/**
 * While an auction is live, tell the database every 10s that this browser is
 * here. The same call lets the database notice when someone else has dropped
 * and pause the auction. `onPaused` runs when the call reports a pause.
 */
export function useHeartbeat({
  active,
  beat,
  onPaused,
}: {
  active: boolean
  /** Calls auction_heartbeat and returns its result ('ok' | 'paused'). */
  beat: () => Promise<string | null>
  onPaused: () => void
}) {
  const beatRef = useRef(beat)
  const pausedRef = useRef(onPaused)
  // Keep the latest callbacks without restarting the timer.
  useEffect(() => {
    beatRef.current = beat
    pausedRef.current = onPaused
  })

  useEffect(() => {
    if (!active) return
    let stopped = false
    const run = async () => {
      try {
        const result = await beatRef.current()
        if (!stopped && result === 'paused') pausedRef.current()
      } catch {
        // a failed beat just means we are offline; the next one retries
      }
    }
    void run()
    const id = window.setInterval(run, 10000)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [active])
}
