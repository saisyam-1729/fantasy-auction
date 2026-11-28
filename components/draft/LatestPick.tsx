'use client'

import { useState } from 'react'
import { initials, teamColours } from '@/lib/teams'
import { roundOf, teamLabel, type DraftMember, type DraftPick, type DraftPoolPlayer } from '@/lib/draft'

/**
 * The most recent pick, shown big like a sold lot in the auction: the player,
 * their team, and who picked them. A pick that arrives while the screen is open
 * pops in; the one already there when the page loaded is shown at rest.
 */
export default function LatestPick({
  pick,
  player,
  picker,
  teams,
  isMine,
}: {
  pick: DraftPick
  player: DraftPoolPlayer | undefined
  picker: DraftMember | undefined
  teams: number
  isMine: boolean
}) {
  const [seenId] = useState(pick.id)
  const fresh = pick.id !== seenId
  const { bg, fg } = teamColours(player?.team)
  const { round, pickInRound } = roundOf(pick.pick_no, Math.max(teams, 1))

  return (
    <div
      key={pick.id}
      aria-live="polite"
      className={`h-full min-w-0 rounded-2xl border-2 p-3 sm:p-4 flex items-center gap-3 sm:gap-4 ${
        isMine ? 'border-emerald-400 bg-emerald-500/15' : 'border-amber-400 bg-amber-500/10'
      } ${fresh ? 'draft-pop' : ''}`}
    >
      <div
        className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-full flex items-center justify-center text-lg sm:text-xl font-black ring-4 ring-white/20"
        style={{ background: bg, color: fg }}
        aria-hidden
      >
        {player ? initials(player.player_name) : '?'}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-bold uppercase tracking-wider ${isMine ? 'text-emerald-300' : 'text-amber-300'}`}>
          Latest pick · R{round}.{pickInRound} · #{pick.pick_no + 1}
        </p>
        <p className="text-lg sm:text-2xl font-bold text-white truncate">{player?.player_name ?? 'Unknown player'}</p>
        <p className="text-xs sm:text-sm text-slate-300 truncate">
          {player?.team}
          {player?.role ? ` · ${player.role}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11px] uppercase tracking-wider text-slate-400">Picked by</p>
        <p className={`text-base sm:text-lg font-bold ${isMine ? 'text-emerald-200' : 'text-amber-200'}`}>
          {isMine ? 'You' : picker ? teamLabel(picker) : '?'}
        </p>
      </div>
    </div>
  )
}
