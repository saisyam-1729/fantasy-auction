'use client'

import { useMemo, useState } from 'react'
import { initials } from '@/lib/teams'
import { formatPoints } from '@/lib/fantasyPoints'
import { Segmented, cx } from '@/components/ui'
import type { DraftMember, DraftPoolPlayer } from '@/lib/draft'

/** Wishlist controls, present when the viewer is a member who can keep one. */
export type WishlistProps = {
  /** player ids, best first */
  ids: number[]
  toggle: (playerId: number) => void
  move: (playerId: number, dir: -1 | 1) => void
}

/**
 * The shared player pool. Everyone sees it; the Pick button only shows when the
 * viewer may pick (their turn, or a host picking for the team on the clock).
 * A pick needs a second tap to confirm. With a wishlist, ☆ adds a player to
 * "My list", which you can order; a timed turn that runs out picks from it.
 */
export default function DraftPool({
  players,
  pickedBy,
  latestPlayerId = null,
  canPick,
  pickLabel,
  busy,
  onPick,
  wishlist,
  points,
}: {
  players: DraftPoolPlayer[]
  /** player id -> member who picked them */
  pickedBy: Map<number, DraftMember>
  /** The most recently picked player, highlighted when picked players are shown. */
  latestPlayerId?: number | null
  canPick: boolean
  pickLabel: string
  busy: boolean
  onPick: (player: DraftPoolPlayer) => void
  wishlist?: WishlistProps
  /** player id -> fantasy points (after the draft's starting points), when known */
  points?: Map<number, number>
}) {
  const [mode, setMode] = useState<'all' | 'list'>('all')
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('')
  const [role, setRole] = useState('')
  const [sort, setSort] = useState<'pool' | 'points'>('pool')
  const [showPicked, setShowPicked] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const teams = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players])
  const roles = useMemo(() => [...new Set(players.map((p) => p.role).filter((r): r is string => Boolean(r)))].sort(), [players])
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const wished = useMemo(() => new Set(wishlist?.ids ?? []), [wishlist?.ids])
  const hasPoints = Boolean(points && points.size > 0)

  const shown = useMemo(() => {
    if (mode === 'list') return (wishlist?.ids ?? []).map((id) => byId.get(id)).filter((p): p is DraftPoolPlayer => Boolean(p))
    const q = query.trim().toLowerCase()
    const list = players.filter(
      (p) =>
        (showPicked || !pickedBy.has(p.id)) &&
        (!team || p.team === team) &&
        (!role || p.role === role) &&
        (!q || p.player_name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
    )
    return sort === 'points' && points ? [...list].sort((a, b) => (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0)) : list
  }, [mode, wishlist?.ids, byId, players, pickedBy, query, team, role, showPicked, sort, points])

  const available = players.length - pickedBy.size
  const select = 'px-3 py-2 bg-slate-800/60 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

  return (
    <div>
      {wishlist && (
        <Segmented
          className="mb-3"
          label="Pool or my list"
          value={mode}
          onChange={setMode}
          options={[
            ['all', 'All players'],
            ['list', `My list (${wishlist.ids.filter((id) => !pickedBy.has(id)).length})`],
          ]}
        />
      )}

      {mode === 'all' ? (
        <>
          <div className="flex flex-col gap-2 mb-3">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player or team…" className={`${select} w-full`} />
            <div className={cx('grid gap-2', hasPoints ? 'grid-cols-3' : 'grid-cols-2')}>
              <select value={team} onChange={(e) => setTeam(e.target.value)} className={cx(select, 'min-w-0')} aria-label="Filter by team">
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={cx(select, 'min-w-0')} aria-label="Filter by role">
                <option value="">All roles</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {hasPoints && (
                <select value={sort} onChange={(e) => setSort(e.target.value as 'pool' | 'points')} className={cx(select, 'min-w-0')} aria-label="Sort">
                  <option value="pool">By team</option>
                  <option value="points">By points</option>
                </select>
              )}
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
        </>
      ) : (
        <p className="mb-2 text-xs text-slate-400">
          Your private shortlist, best first. Use ↑ ↓ to order it. If the pick timer runs out on your turn, the top available player is picked for
          you.
        </p>
      )}

      <ul className="divide-y divide-slate-700/70 rounded-xl border border-slate-700 bg-slate-900/40 max-h-[60vh] overflow-y-auto">
        {shown.length === 0 && (
          <li className="p-5 text-center text-sm text-slate-400">{mode === 'list' ? 'Your list is empty. Tap ☆ next to a player to add them.' : 'No players match.'}</li>
        )}
        {shown.map((p, i) => {
          const owner = pickedBy.get(p.id)
          const confirming = confirmId === p.id
          const pts = points?.get(p.id)
          return (
            <li key={p.id} className={cx('flex items-center gap-2 sm:gap-3 px-3 py-2.5', p.id === latestPlayerId ? 'bg-amber-500/15' : owner && 'opacity-50')}>
              {mode === 'list' ? (
                <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-400">{i + 1}</span>
              ) : (
                <div className="w-9 h-9 shrink-0 rounded-full bg-slate-700 text-slate-100 text-xs font-bold flex items-center justify-center" aria-hidden>
                  {initials(p.player_name)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">
                  {p.player_name}
                  {p.captain && <span className="ml-2 text-[10px] font-bold uppercase text-amber-300">{p.captain === 'Captain' ? 'C' : 'VC'}</span>}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {p.team}
                  {p.role ? ` · ${p.role}` : ''}
                  {p.notes?.startsWith('Standby') ? ' · Standby' : ''}
                </div>
              </div>
              {pts != null && pts !== 0 && <span className="shrink-0 text-xs font-semibold text-sky-300">{formatPoints(pts)} pts</span>}
              {wishlist && mode === 'list' && (
                <span className="flex shrink-0 gap-0.5">
                  <button type="button" onClick={() => wishlist.move(p.id, -1)} disabled={i === 0} className="px-1.5 py-1 rounded text-slate-300 hover:bg-white/10 disabled:opacity-30" aria-label={`Move ${p.player_name} up`}>
                    ↑
                  </button>
                  <button type="button" onClick={() => wishlist.move(p.id, 1)} disabled={i === shown.length - 1} className="px-1.5 py-1 rounded text-slate-300 hover:bg-white/10 disabled:opacity-30" aria-label={`Move ${p.player_name} down`}>
                    ↓
                  </button>
                </span>
              )}
              {wishlist && !owner && (
                <button
                  type="button"
                  onClick={() => wishlist.toggle(p.id)}
                  className={cx('shrink-0 px-1.5 py-1 rounded text-base leading-none hover:bg-white/10', wished.has(p.id) ? 'text-amber-300' : 'text-slate-500')}
                  aria-pressed={wished.has(p.id)}
                  aria-label={wished.has(p.id) ? `Remove ${p.player_name} from my list` : `Add ${p.player_name} to my list`}
                >
                  {wished.has(p.id) ? '★' : '☆'}
                </button>
              )}
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
