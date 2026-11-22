'use client'

import { useEffect, useState } from 'react'

/** Whole seconds until `deadline` (ms since epoch), ticking once a second; null without a deadline. */
export function useSecondsLeft(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (deadline == null) return
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [deadline])
  return deadline == null ? null : left
}
