import { formatMoney } from '@/lib/money'
import type { BidHistoryEntry } from '@/lib/roomTypes'

/** The auction tab's side panel: my purse and squad, and the live lot's bids. */
export default function MyStatsPanel({
  remaining,
  purseText,
  squadCount,
  minSquadSize,
  maxSquadSize,
  spent,
  bidHistory,
}: {
  remaining: number
  /** e.g. "₹12 Cr free · 3 slots to fill"; omitted before the purse is known */
  purseText: string | null
  squadCount: number
  minSquadSize: number
  maxSquadSize: number
  spent: number
  /** bids on the live lot, newest first; null when no lot is live */
  bidHistory: BidHistoryEntry[] | null
}) {
  return (
    <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-6 flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">My Stats</h3>
        <div className="space-y-4">
          <div>
            <div className="text-xs text-slate-400 mb-1">Remaining Budget</div>
            <div className="text-2xl font-bold text-green-400">{formatMoney(remaining)}</div>
            {purseText && <div className="text-xs text-slate-300 mt-1">{purseText}</div>}
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Squad Size</div>
            <div className="text-2xl font-bold text-white">
              {squadCount} / {maxSquadSize}
            </div>
            <div className="text-xs text-slate-400 mt-1">Minimum {minSquadSize}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Total Spent</div>
            <div className="text-xl font-bold text-red-400">{formatMoney(spent)}</div>
          </div>
        </div>
      </div>

      {bidHistory && (
        <div>
          <h3 className="text-sm font-bold text-white mb-3 border-b border-slate-700 pb-2">Bid History</h3>
          {bidHistory.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">No bids yet</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {bidHistory.map((b, i) => (
                <div
                  key={b.id}
                  className={`flex justify-between items-center rounded-lg px-3 py-2 text-xs ${i === 0 ? 'bg-yellow-500/20 border border-yellow-500/40' : 'bg-slate-800/60'}`}
                >
                  <span className={`font-semibold truncate pr-2 ${i === 0 ? 'text-yellow-300' : 'text-slate-300'}`}>{b.display_name}</span>
                  <span className={`shrink-0 font-bold ${i === 0 ? 'text-yellow-400' : 'text-slate-400'}`}>{formatMoney(b.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
