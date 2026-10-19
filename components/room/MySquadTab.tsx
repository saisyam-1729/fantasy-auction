'use client'

import { formatMoney } from '@/lib/money'
import PlayerAvatar from './PlayerAvatar'
import type { Player } from '@/lib/roomTypes'

export default function MySquadTab({
  mySquad,
  displayName,
}: {
  mySquad: Player[]
  displayName?: string
}) {
  return (
    <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <h2 className="text-2xl font-bold text-white">My Squad</h2>
        {mySquad.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const rows = [
                ['Player', 'Team', 'Type', 'Purchase Price'],
                ...mySquad.map(p => [
                  p.player_name,
                  p.team || '',
                  p.player_type,
                  p.sold_price ? String(p.sold_price) : '0',
                ])
              ]
              const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
              const blob = new Blob([csv], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${displayName || 'squad'}_squad.csv`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-500 rounded-xl text-sm font-medium transition"
          >
            Export CSV
          </button>
        )}
      </div>

      {mySquad.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          No players yet. Start bidding!
        </div>
      ) : (
        <>
          {/* Squad composition summary */}
          <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(() => {
              const typeCounts: Record<string, number> = {}
              mySquad.forEach(p => {
                typeCounts[p.player_type] = (typeCounts[p.player_type] || 0) + 1
              })
              const totalSpent = mySquad.reduce((s, p) => s + (p.sold_price || 0), 0)
              const avgPrice = mySquad.length > 0 ? Math.round(totalSpent / mySquad.length) : 0
              return (
                <>
                  {Object.entries(typeCounts).map(([type, count]) => (
                    <div key={type} className="bg-slate-800/60 rounded-xl p-3 border border-slate-700 text-center">
                      <div className="text-xl font-bold text-white">{count}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{type}</div>
                    </div>
                  ))}
                  <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700 text-center">
                    <div className="text-lg font-bold text-yellow-400">{formatMoney(avgPrice)}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Avg price</div>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700 text-center">
                    <div className="text-lg font-bold text-red-400">{formatMoney(totalSpent)}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Total spent</div>
                  </div>
                </>
              )
            })()}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mySquad.map(player => (
              <div key={player.id} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                <div className="flex items-center gap-3">
                  <PlayerAvatar src={player.image_url} name={player.player_name} team={player.team} size={48} className="w-12 h-12 rounded-full" />
                  <div className="flex-1">
                    <div className="font-bold text-white">{player.player_name}</div>
                    <div className="text-xs text-slate-400">
                      {[player.team, player.player_type].filter(Boolean).join(' · ') || player.player_type}
                    </div>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-700 flex justify-between items-center">
                  <span className="text-xs text-slate-500">Base: {formatMoney(player.base_price)}</span>
                  <span className="text-green-400 font-bold">{formatMoney(player.sold_price || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
