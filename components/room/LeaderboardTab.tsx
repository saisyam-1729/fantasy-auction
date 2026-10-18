'use client'

import { formatMoney } from '@/lib/money'
import type { RoomUser } from '@/lib/roomTypes'
import type { SquadBoard } from '@/lib/squadBoards'
import SquadBoards from './SquadBoards'

export default function LeaderboardTab({
  allUsers,
  currentUserId,
  minSquadSize,
  maxSquadSize,
  showHostTools,
  onReset,
  boards,
}: {
  allUsers: RoomUser[]
  currentUserId?: string
  minSquadSize: number
  maxSquadSize: number
  showHostTools: boolean
  onReset: () => void
  boards: SquadBoard[]
}) {
  return (
    <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <h2 className="text-2xl font-bold text-white">Leaderboard</h2>
        {showHostTools && (
          <button
            type="button"
            onClick={() => onReset()}
            className="shrink-0 px-4 py-2 bg-amber-950/60 text-amber-100 border border-amber-500/70 rounded-xl hover:bg-amber-900/80 transition text-sm font-semibold"
          >
            Reset auction
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="p-3 text-left">Team</th>
              <th className="p-3 text-right">Spent</th>
              <th className="p-3 text-right">Remaining</th>
              <th className="p-3 text-right">Squad (min {minSquadSize})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {allUsers.map(user => (
              <tr key={user.id} className={user.id === currentUserId ? 'bg-yellow-500/10' : ''}>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{user.display_name}</span>
                    {user.is_admin && (
                      <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded">ADMIN</span>
                    )}
                  </div>
                </td>
                <td className="p-3 text-right text-red-400">{formatMoney(user.spent)}</td>
                <td className="p-3 text-right text-green-400">{formatMoney(user.budget - user.spent)}</td>
                <td className="p-3 text-right text-white">{user.squad_count} / {maxSquadSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-8">
        <h3 className="text-sm font-bold text-white mb-3">Squads so far</h3>
        <SquadBoards boards={boards} currentUserId={currentUserId} maxSquadSize={maxSquadSize} />
      </div>
    </div>
  )
}
