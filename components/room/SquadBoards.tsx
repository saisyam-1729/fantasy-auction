'use client'

import { formatMoney } from '@/lib/money'
import { SQUAD_ROLES, squadRole } from '@/lib/roomTypes'
import type { SquadBoard } from '@/lib/squadBoards'

export default function SquadBoards({
  boards,
  currentUserId,
  maxSquadSize,
}: {
  boards: SquadBoard[]
  currentUserId?: string
  maxSquadSize: number
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {boards.map((board) => {
        const mine = board.user.id === currentUserId
        const noKeeper = board.counts.WK === 0
        return (
          <div
            key={board.user.id}
            className={`rounded-xl border px-3 py-3 ${
              mine ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-slate-700 bg-slate-900/50'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="font-semibold text-white text-sm truncate">
                  {board.user.display_name}
                  {mine ? ' · You' : ''}
                </div>
                <div className="text-[11px] text-slate-400">
                  {formatMoney(board.user.budget - board.user.spent)} left · {board.size}/{maxSquadSize}
                </div>
              </div>
              {noKeeper && (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40">
                  No WK
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {SQUAD_ROLES.map((role) => (
                <span
                  key={role}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                    role === 'WK' && board.counts[role] === 0
                      ? 'bg-amber-500/15 text-amber-200'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  {role} {board.counts[role]}
                </span>
              ))}
            </div>
            <div className="text-[11px] text-slate-400">
              {board.lastBuys.length === 0 ? (
                'No players yet'
              ) : (
                <>
                  Last:{' '}
                  {board.lastBuys.map((player, i) => (
                    <span key={player.id}>
                      {i > 0 ? ' · ' : ''}
                      <span className="text-slate-200">{player.player_name}</span>{' '}
                      {squadRole(player.player_type) || player.player_type}
                      {player.sold_price ? ` ${formatMoney(player.sold_price)}` : ''}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
