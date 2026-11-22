'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatPoints, MEDALS, pointsGain, rankMove, type Leaderboard, type LeaderboardRow } from '@/lib/fantasyPoints'

const PODIUM: Record<number, string> = {
  1: 'border-yellow-400/80 bg-gradient-to-r from-yellow-500/25 to-yellow-500/5 shadow-lg shadow-yellow-500/10',
  2: 'border-slate-300/70 bg-gradient-to-r from-slate-300/20 to-slate-300/5',
  3: 'border-orange-400/70 bg-gradient-to-r from-orange-500/20 to-orange-500/5',
}

function day(d: string | null) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function Move({ row }: { row: LeaderboardRow }) {
  const move = rankMove(row)
  if (move == null) return <span className="text-[11px] font-semibold text-sky-300">NEW</span>
  if (move === 0) return <span className="text-sm text-slate-400" aria-label="No change in position">–</span>
  const up = move > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-bold ${up ? 'text-emerald-400' : 'text-red-400'}`} aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(move)}`}>
      {up ? '▲' : '▼'}
      {Math.abs(move)}
    </span>
  )
}

function Gain({ value }: { value: number | null }) {
  if (value == null) return null
  return (
    <span className={`text-xs font-semibold ${value > 0 ? 'text-emerald-300' : value < 0 ? 'text-red-300' : 'text-slate-500'}`}>
      {value > 0 ? '+' : ''}
      {formatPoints(value)}
    </span>
  )
}

/** One draft's fantasy leaderboard: rank, movement, points and day-on-day gain; tap a team for its players. */
export default function LeaderboardView({ draftId, currentUserId }: { draftId: string; currentUserId: string | null }) {
  const [supabase] = useState(() => createClient())
  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void supabase.rpc('draft_leaderboard', { p_draft_id: draftId }).then(({ data, error: err }) => {
      if (!live) return
      if (err) setError(err.message)
      else setBoard(data as Leaderboard)
    })
    return () => {
      live = false
    }
  }, [supabase, draftId])

  if (error) return <p className="text-red-200 text-sm">{error}</p>
  if (!board) return <p className="text-slate-300 text-sm">Loading leaderboard…</p>

  return (
    <div>
      <div className="mb-3 text-xs text-slate-400">
        {board.synced_at ? (
          <>
            Points updated {new Date(board.synced_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            {board.previous_day
              ? ` · changes since ${day(board.previous_day)}`
              : ' · day-on-day changes start after the next nightly update'}
          </>
        ) : (
          'No points yet. They update every night at 12:00 am.'
        )}
      </div>

      <ol className="space-y-2">
        {board.rows.map((row) => {
          const mine = row.user_id === currentUserId
          const expanded = open === row.member_id
          const podium = PODIUM[row.rank]
          return (
            <li key={row.member_id} className={`rounded-2xl border-2 ${podium ?? (mine ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-slate-700 bg-slate-900/40')}`}>
              <button type="button" onClick={() => setOpen(expanded ? null : row.member_id)} aria-expanded={expanded} className="w-full flex items-center gap-3 px-3 py-3 text-left">
                <span className="w-10 shrink-0 text-center">
                  {MEDALS[row.rank] ? (
                    <span className="text-2xl" role="img" aria-label={`Rank ${row.rank}`}>
                      {MEDALS[row.rank]}
                    </span>
                  ) : (
                    <span className="text-lg font-bold text-slate-300">{row.rank}</span>
                  )}
                </span>
                <span className="w-9 shrink-0 text-center">
                  <Move row={row} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold ${row.rank <= 3 ? 'text-white text-base' : 'text-slate-100 text-sm'}`}>
                    {row.username}
                    {mine && <span className="ml-2 text-[10px] font-bold uppercase text-emerald-300">You</span>}
                  </span>
                  <span className="block text-[11px] text-slate-400">{row.players.length} players · tap for details</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block font-black ${row.rank <= 3 ? 'text-xl text-white' : 'text-lg text-slate-100'}`}>{formatPoints(Number(row.points))}</span>
                  <Gain value={pointsGain(row)} />
                </span>
              </button>

              {expanded && (
                <ul className="border-t border-white/10 px-3 py-2 space-y-1">
                  {row.players.map((p) => (
                    <li key={p.player_id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-100">
                        {p.name} <span className="text-xs text-slate-400">{p.team}</span>
                      </span>
                      <span className="w-12 text-right">
                        <Gain value={pointsGain(p)} />
                      </span>
                      <span className="w-10 text-right font-semibold text-white">{formatPoints(Number(p.points))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-[11px] text-slate-500">
        Points are each player’s season performance points from Statz, added up for every team. Ties share a rank.
      </p>
    </div>
  )
}
