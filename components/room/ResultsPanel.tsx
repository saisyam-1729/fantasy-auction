'use client'

import type { Insights } from '@/lib/insights'
import { computeResults, resultsCsv } from '@/lib/results'

export default function ResultsPanel({
  insights,
  money,
  myUserId,
}: {
  insights: Insights
  money: (n: number) => string
  myUserId?: string
}) {
  const { standings, highlights, totalSold } = computeResults(insights)

  function download() {
    const blob = new Blob([resultsCsv(insights)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'auction_results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="text-left">
      <div className="text-center mb-6">
        <div className="text-5xl mb-2">🏆</div>
        <h2 className="text-2xl sm:text-3xl font-bold text-white">Auction Complete</h2>
        <p className="text-slate-300 text-sm">{totalSold} players sold</p>
      </div>

      {highlights.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 mb-6">
          {highlights.map((h) => (
            <div key={h.id} className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3">
              <div className="text-[11px] uppercase tracking-wide text-yellow-300">{h.label}</div>
              <div className="font-bold text-white truncate">{h.player || h.team}</div>
              <div className="text-xs text-slate-300">
                {h.player ? `${h.team} · ` : ''}
                {money(h.amount)}
                {h.premium ? ` · ${h.premium.toFixed(1)}x base` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">Team</th>
              <th className="p-2 text-right">Players</th>
              <th className="p-2 text-right">Spent</th>
              <th className="p-2 text-right">Left</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {standings.map((t, i) => (
              <tr key={t.userId} className={t.userId === myUserId ? 'bg-yellow-500/10' : ''}>
                <td className="p-2 text-slate-400">{i + 1}</td>
                <td className="p-2 text-white font-semibold">
                  {t.name}
                  {t.noKeeper && (
                    <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40">
                      No WK
                    </span>
                  )}
                </td>
                <td className="p-2 text-right text-white">{t.players}</td>
                <td className="p-2 text-right text-red-400">{money(t.spent)}</td>
                <td className="p-2 text-right text-green-400">{money(t.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={download}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-500 rounded-xl text-sm font-medium transition"
        >
          Download results (CSV)
        </button>
      </div>
    </div>
  )
}
