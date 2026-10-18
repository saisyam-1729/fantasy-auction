'use client'

import { formatMoney } from '@/lib/money'
import PlayerAvatar from './PlayerAvatar'
import { purseLock } from '@/lib/purse'
import type { Player, RoomUser } from '@/lib/roomTypes'

export default function PlayersTab({
  allPlayers,
  currentUser,
  minSquadSize,
  maxSquadSize,
  playerSearch,
  onSearch,
  statusFilter,
  onStatusFilter,
}: {
  allPlayers: Player[]
  currentUser: RoomUser | null
  minSquadSize: number
  maxSquadSize: number
  playerSearch: string
  onSearch: (v: string) => void
  statusFilter: string
  onStatusFilter: (v: string) => void
}) {
  return (
    <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-bold text-white">All Players</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            placeholder="Search player or team…"
            value={playerSearch}
            onChange={e => onSearch(e.target.value)}
            className="rounded-lg bg-slate-800 border border-slate-600 px-3 py-1.5 text-white text-sm placeholder:text-slate-500 w-48"
          />
          <select
            value={statusFilter}
            onChange={e => onStatusFilter(e.target.value)}
            className="rounded-lg bg-slate-800 border border-slate-600 px-3 py-1.5 text-white text-sm"
          >
            <option value="ALL">All status</option>
            <option value="UNSOLD">Unsold</option>
            <option value="SOLD">Sold</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="p-3 text-left">Player</th>
              <th className="p-3 text-left">Team</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {allPlayers
              .filter(p => {
                const q = playerSearch.toLowerCase()
                const matchSearch = !q || p.player_name.toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q)
                const matchStatus = statusFilter === 'ALL' || p.status === statusFilter
                return matchSearch && matchStatus
              })
              .map(player => {
              const lotPurse = currentUser
                ? purseLock({
                    budget: currentUser.budget,
                    spent: currentUser.spent,
                    squadCount: currentUser.squad_count,
                    minSquadSize,
                    maxSquadSize,
                    otherUnsoldBasePrices: allPlayers
                      .filter((p) => p.status === 'UNSOLD' && p.id !== player.id)
                      .map((p) => p.base_price),
                  })
                : null
              const canAfford = player.status === 'UNSOLD' && !!lotPurse && player.base_price <= lotPurse.freeToSpend
              const tooExpensive = player.status === 'UNSOLD' && !!lotPurse && player.base_price > lotPurse.freeToSpend
              return (
              <tr key={player.id} className={tooExpensive ? 'opacity-50' : ''}>
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <PlayerAvatar src={player.image_url} name={player.player_name} size={32} className="w-8 h-8 rounded-full" />
                    <span className="text-white">{player.player_name}</span>
                  </div>
                </td>
                <td className="p-3 text-slate-300">{player.team || '—'}</td>
                <td className="p-3 text-slate-300">{player.player_type}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded ${
                    player.status === 'SOLD' ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {player.status}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {player.status === 'SOLD' ? (
                    <div>
                      <div className="text-green-400 font-bold">{formatMoney(player.sold_price || 0)}</div>
                      {player.sold_to && <div className="text-xs text-slate-400">{player.sold_to}</div>}
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={canAfford ? 'text-slate-300' : 'text-red-400'}>
                        {formatMoney(player.base_price)}
                      </span>
                      {tooExpensive && (
                        <span className="text-[10px] text-red-500">Out of budget</span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
