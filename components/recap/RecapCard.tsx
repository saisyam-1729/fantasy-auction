'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button, Card, cx } from '@/components/ui'
import { formatPoints, MEDALS } from '@/lib/fantasyPoints'
import { recapText, type Recap } from '@/lib/recap'
import { recapBlob } from '@/lib/shareImage'

/** "Your day" after a nightly points update: where you stand, what moved, and a share button. */
export default function RecapCard({ recap, event, href, accent }: { recap: Recap; event: string; href: string; accent?: string }) {
  const [note, setNote] = useState('')

  async function share() {
    const text = recapText(event, recap)
    try {
      const blob = await recapBlob(recap, event, accent)
      if (blob) {
        const file = new File([blob], 'recap.png', { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text })
          return
        }
        // no file sharing (most laptops): save the picture and copy the line
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${event.replace(/\s+/g, '-')}-recap.png`
        a.click()
        URL.revokeObjectURL(url)
      }
      await navigator.clipboard?.writeText(text)
      setNote('Picture saved and summary copied')
    } catch (e) {
      // closing the share sheet counts as an error in some browsers
      if (!(e instanceof DOMException && e.name === 'AbortError')) setNote('Could not share. Try again.')
    }
    window.setTimeout(() => setNote(''), 3000)
  }

  const medal = recap.points > 0 ? MEDALS[recap.rank] : undefined
  return (
    <Card as="section" className={cx('overflow-hidden')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Your day · {event}</h2>
        <Link href={href} className="text-xs text-sky-300 hover:underline">
          Leaderboard →
        </Link>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-16 shrink-0 text-center text-5xl font-black text-white">{medal ?? recap.rank}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-white">{recap.teamName}</p>
          <p className="text-sm text-slate-300">
            {recap.rank} of {recap.teams} · {formatPoints(recap.points)} pts
            {recap.gain != null && (
              <span className={recap.gain > 0 ? 'text-emerald-300' : recap.gain < 0 ? 'text-red-300' : 'text-slate-400'}>
                {' '}
                · {recap.gain > 0 ? '+' : ''}
                {formatPoints(recap.gain)} today
              </span>
            )}
            {recap.move ? (
              <span className={recap.move > 0 ? 'text-emerald-400' : 'text-red-400'}>
                {' '}
                · {recap.move > 0 ? '▲' : '▼'}
                {Math.abs(recap.move)}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-sm text-slate-200">
        {recap.best && (
          <li>
            ⭐ Best: <span className="font-semibold text-white">{recap.best.name}</span> <span className="text-emerald-300">+{formatPoints(recap.best.gain)}</span>
          </li>
        )}
        {recap.overtook.length > 0 && <li>↗ You passed {recap.overtook.join(', ')}</li>}
        {recap.overtakenBy.length > 0 && <li>↘ Passed by {recap.overtakenBy.join(', ')}</li>}
        {recap.gain == null && <li className="text-slate-400">Daily changes appear after the next nightly update.</li>}
        {recap.leader && recap.rank !== 1 && (
          <li className="text-slate-400">
            Leader: {recap.leader.name} ({formatPoints(recap.leader.points)} pts)
          </li>
        )}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" tone="board" onClick={() => void share()}>
          Share recap
        </Button>
        {note && <span className="text-xs text-emerald-300">{note}</span>}
      </div>
    </Card>
  )
}
