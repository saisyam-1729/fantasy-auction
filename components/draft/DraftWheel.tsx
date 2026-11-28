'use client'

import { useState } from 'react'
import { ordinal, teamLabel, type DraftMember, type DraftRoom } from '@/lib/draft'

const COLOURS = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899', '#f97316', '#3b82f6']
const SPIN_MS = 3600

/**
 * The order wheel. Its segments are the members who had no draft position when
 * the last spin happened. The rotation is derived from the spin itself, so every
 * screen lands on the same name without any client deciding the result.
 */
export default function DraftWheel({ members, lastSpin }: { members: DraftMember[]; lastSpin: DraftRoom['last_spin'] }) {
  // Spins that already happened before this screen opened are shown at rest.
  const [seenSeq] = useState(() => lastSpin?.seq ?? 0)
  // after a reset only the counter is kept, with no result to show
  const spin =
    lastSpin?.member_id && lastSpin.position != null
      ? { seq: lastSpin.seq, memberId: lastSpin.member_id, position: lastSpin.position, lastMemberId: lastSpin.last_member_id ?? null }
      : null
  const fresh = Boolean(spin && spin.seq > seenSeq)

  const segments = members
    .filter((m) => m.order_pos == null || (spin != null && m.order_pos >= spin.position))
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id))

  const n = Math.max(segments.length, 1)
  const slice = 360 / n
  const chosenIdx = spin ? segments.findIndex((m) => m.id === spin.memberId) : -1
  // pointer is at the top; land the middle of the chosen segment under it
  const rotation = spin && chosenIdx >= 0 ? spin.seq * 360 * 5 - (chosenIdx * slice + slice / 2) : 0
  const chosen = chosenIdx >= 0 ? segments[chosenIdx] : null
  const lastMember = spin?.lastMemberId ? members.find((m) => m.id === spin.lastMemberId) : null

  const r = 100
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return [r + r * Math.cos(rad), r + r * Math.sin(rad)]
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-64 h-64 sm:w-72 sm:h-72">
        <div className="absolute left-1/2 -top-1 z-10 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[20px] border-l-transparent border-r-transparent border-t-white drop-shadow" />
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full drop-shadow-xl"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: fresh ? `transform ${SPIN_MS}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)` : 'none',
          }}
          role="img"
          aria-label="Draft order wheel"
        >
          {segments.length <= 1 ? (
            <circle cx={r} cy={r} r={r} fill={COLOURS[0]} />
          ) : (
            segments.map((m, i) => {
              const [x1, y1] = point(i * slice)
              const [x2, y2] = point((i + 1) * slice)
              const large = slice > 180 ? 1 : 0
              return <path key={m.id} d={`M${r},${r} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`} fill={COLOURS[i % COLOURS.length]} stroke="#0f172a" strokeWidth="1" />
            })
          )}
          {segments.map((m, i) => {
            const mid = i * slice + slice / 2
            const full = teamLabel(m)
            const name = full.length > 11 ? full.slice(0, 10) + '…' : full
            return (
              <text
                key={m.id + 't'}
                x={r}
                y={r - r * 0.62}
                transform={`rotate(${mid} ${r} ${r})`}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={segments.length > 7 ? 8 : 10}
                fontWeight={700}
                fill="#0f172a"
              >
                {name}
              </text>
            )
          })}
          <circle cx={r} cy={r} r={14} fill="#0f172a" stroke="#fff" strokeWidth="2" />
        </svg>
      </div>

      <div className="mt-4 min-h-[3.5rem] text-center" aria-live="polite">
        {chosen && spin && (
          <div key={spin.seq} className={fresh ? 'draft-reveal' : ''} style={fresh ? { animationDelay: `${SPIN_MS}ms` } : undefined}>
            <p className="text-lg font-bold text-white">
              {teamLabel(chosen)} picks {ordinal(spin.position)}
            </p>
            {lastMember && (
              <p className="text-sm text-slate-300">
                {teamLabel(lastMember)} is the last one left and picks {ordinal(spin.position + 1)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
