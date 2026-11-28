'use client'

import { useEffect, useRef } from 'react'
import RecapCard from '@/components/recap/RecapCard'
import { recapCanvas } from '@/lib/shareImage'
import type { Recap } from '@/lib/recap'

const recap: Recap = {
  teamName: '⚡ Dev Dynamos',
  rank: 2,
  teams: 7,
  points: 454,
  move: 3,
  gain: 134,
  best: { name: 'Gudakesh Motie', gain: 70 },
  worst: { name: 'Phil Salt', gain: -2 },
  overtook: ['Gita', 'Chen'],
  overtakenBy: ['Farid'],
  leader: { name: 'Farid', points: 723 },
}

export default function RecapPreview() {
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = holder.current
    if (!el) return
    const c = recapCanvas(recap, 'ILT20 2026', '#eab308')
    c.style.width = '100%'
    c.style.height = 'auto'
    el.replaceChildren(c)
  }, [])
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <RecapCard recap={recap} event="ILT20 2026" href="#" accent="#eab308" />
      <div>
        <p className="mb-2 text-xs text-slate-400">The picture people share</p>
        <div ref={holder} className="max-w-sm overflow-hidden rounded-xl border border-white/10" />
      </div>
    </div>
  )
}
