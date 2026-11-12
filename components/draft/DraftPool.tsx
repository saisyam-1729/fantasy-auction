'use client'

import { useMemo, useState } from 'react'
import { initials } from '@/lib/teams'
import type { DraftMember, DraftPoolPlayer } from '@/lib/draft'

/**
 * The shared player pool. Everyone sees it; the Pick button only shows when the
 * viewer may pick (their turn, or a host picking for the team on the clock).
 * A pick needs a second tap to confirm.
 */
export default function DraftPool({
  players,
  pickedBy,
  canPick,
  pickLabel,
  busy,
  onPick,
}: {
  players: DraftPoolPlayer[]
  /** player id -> member who picked them */
  pickedBy: Map<number, DraftMember>
  canPick: boolean
  pickLabel: string
  busy: boolean
  onPick: (player: DraftPoolPlayer) => void
}) {
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('')
  const [role, setRole] = useState('')
  const [showPicked, setShowPicked] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const teams = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players])
  const roles = useMemo(() => [...new Set(players.map((p) => p.role).filter((r): r is string => Boolean(r)))].sort(), [players])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return players.filter(
      (p) =>
        (showPicked || !pickedBy.has(p.id)) &&
        (!team || p.team === team) &&
        (!role || p.role === role) &&
        (!q || p.player_name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
    )
  }, [players, pickedBy, query, team, role, showPicked])

  const available = players.length - pickedBy.size
  const select = 'px-3 py-2 bg-slate-800/60 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player or team…"
          className={`${select} flex-1`}
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={select} aria-label="Filter by team">
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={select} aria-label="Filter by role">
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>
          {available} of {players.length} available · showing {shown.length}
        </span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showPicked} onChange={(e) => setShowPicked(e.target.checked)} className="accent-emerald-500" />
          Show picked
        </label>
      </div>

      <ul className="divide-y divide-slate-700/70 rounded-xl border border-slate-700 bg-slate-900/40 max-h-[60vh] overflow-y-auto">
        {shown.length === 0 && <li className="p-5 text-center text-sm text-slate-400">No players match.</li>}
        {shown.map((p) => {
          const owner = pickedBy.get(p.id)
          const confirming = confirmId === p.id
          return (
            <li key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${owner ? 'opacity-50' : ''}`}>
              <div className="w-9 h-9 shrink-0 rounded-full bg-slate-700 text-slate-100 text-xs font-bold flex items-center justify-center" aria-hidden>
                {initials(p.player_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">
                  {p.player_name}
                  {p.captain && (
                    <span className="ml-2 text-[10px] font-bold uppercase text-amber-300">{p.captain === 'Captain' ? 'C' : 'VC'}</span>
                  )}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {p.team}
                  {p.role ? ` · ${p.role}` : ''}
                  {p.notes?.startsWith('Standby') ? ' · Standby' : ''}
                </div>
              </div>
              {owner ? (
                <span className="text-xs text-slate-300 shrink-0">→ {owner.username}</span>
              ) : canPick ? (
                confirming ? (
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmId(null)
                        onPick(p)
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-900 text-xs font-bold hover:bg-emerald-400 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="px-2 py-1.5 rounded-lg bg-white/10 text-white text-xs">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmId(p.id)}
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-emerald-400/70 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {pickLabel}
                  </button>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
