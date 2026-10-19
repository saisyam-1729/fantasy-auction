'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoingCall } from '@/lib/goingCall'

const STORAGE_KEY = 'auction-sound'

type Beep = { freq: number; at: number; length: number }

const PATTERNS: Record<Exclude<GoingCall, 'none'>, Beep[]> = {
  once: [{ freq: 660, at: 0, length: 0.14 }],
  twice: [
    { freq: 784, at: 0, length: 0.12 },
    { freq: 784, at: 0.22, length: 0.12 },
  ],
  sold: [{ freq: 196, at: 0, length: 0.35 }],
}

/**
 * Plays a short tone when the auctioneer's call changes. Off by default, because
 * browsers only allow sound after a tap, so the toggle is also the permission.
 * The choice is remembered on this device.
 */
export function useCallSound(call: GoingCall) {
  // Read once on first render. This hook only runs inside the client-only room
  // screen (after its loading state), so there is no server render to mismatch.
  const [enabled, setEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'on'
    } catch {
      return false // storage can be blocked; sound simply starts off
    }
  })
  const ctxRef = useRef<AudioContext | null>(null)
  const lastRef = useRef<GoingCall>('none')

  const play = useCallback((which: Exclude<GoingCall, 'none'>) => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = ctxRef.current ?? new Ctx()
      ctxRef.current = ctx
      void ctx.resume()
      const start = ctx.currentTime
      for (const b of PATTERNS[which]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = which === 'sold' ? 'triangle' : 'sine'
        osc.frequency.value = b.freq
        gain.gain.setValueAtTime(0.0001, start + b.at)
        gain.gain.exponentialRampToValueAtTime(0.25, start + b.at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + b.at + b.length)
        osc.connect(gain).connect(ctx.destination)
        osc.start(start + b.at)
        osc.stop(start + b.at + b.length + 0.05)
      }
    } catch {
      // sound is a nicety, never break the auction for it
    }
  }, [])

  useEffect(() => {
    if (call !== lastRef.current && call !== 'none' && enabled) play(call)
    lastRef.current = call
  }, [call, enabled, play])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
      } catch {
        // ignore
      }
      if (next) play('once') // a tap, so audio is allowed; also a preview
      return next
    })
  }, [play])

  return { enabled, toggle }
}
