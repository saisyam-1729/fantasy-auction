'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'draft-sound'

/**
 * A short rising chime when it becomes your turn in a draft. Off by default,
 * because browsers only allow sound after a tap, so the toggle is also the
 * permission. The choice is remembered on this device.
 */
export function useTurnSound(myTurn: boolean) {
  // Only used inside the client-only draft screen, so no server render to mismatch.
  const [enabled, setEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'on'
    } catch {
      return false
    }
  })
  const ctxRef = useRef<AudioContext | null>(null)
  const wasMyTurn = useRef(myTurn)

  const play = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = ctxRef.current ?? new Ctx()
      ctxRef.current = ctx
      void ctx.resume()
      const start = ctx.currentTime
      ;[523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        const at = start + i * 0.12
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
        osc.connect(gain).connect(ctx.destination)
        osc.start(at)
        osc.stop(at + 0.22)
      })
    } catch {
      // sound is a nicety, never break the draft for it
    }
  }, [])

  useEffect(() => {
    if (myTurn && !wasMyTurn.current && enabled) play()
    wasMyTurn.current = myTurn
  }, [myTurn, enabled, play])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
      } catch {
        // ignore
      }
      if (next) play()
      return next
    })
  }, [play])

  return { enabled, toggle }
}
