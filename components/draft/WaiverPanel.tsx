'use client'

import { useMemo, useState } from 'react'
import { Button, cx } from '@/components/ui'
import { formatPoints } from '@/lib/fantasyPoints'
import { moveInList, teamLabel, type DraftMember, type DraftPoolPlayer, type WaiverClaim } from '@/lib/draft'

type Draft = { add: number; drop: number }

/**
 * Free agency for a finished draft. You keep up to 3 ranked claims ("add Y, drop
 * X"). They are processed once a week (Monday's nightly update): the lowest-ranked
 * team goes first and each team gets at most one swap, its first claim that is still valid.
 */
export default function WaiverPanel({
  myPlayers,
  freeAgents,
  points,
  claims,
  members,
  playersById,
  busy,
  onSave,
}: {
  /** my current players (what I can drop) */
  myPlayers: DraftPoolPlayer[]
  /** players on no team */
  freeAgents: DraftPoolPlayer[]
  points?: Map<number, number>
  /** every claim I may see: mine (any status) and everyone's WON ones */
  claims: WaiverClaim[]
  members: DraftMember[]
  playersById: Map<number, DraftPoolPlayer>
  busy: boolean
  onSave: (adds: number[], drops: number[]) => void
}) {
  const pending = useMemo(
    () => claims.filter((c) => c.status === 'PENDING').sort((a, b) => a.rank - b.rank),
    [claims]
  )
  const [list, setList] = useState<Draft[]>(() => pending.map((c) => ({ add: c.add_player_id, drop: c.drop_player_id })))
  const [drop, setDrop] = useState('')
  const [add, setAdd] = useState('')
  const [query, setQuery] = useState('')

  const name = (id: number) => playersById.get(id)?.player_name ?? 'a player'
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    return freeAgents
      .filter((p) => !q || p.player_name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .sort((a, b) => (points?.get(b.id) ?? 0) - (points?.get(a.id) ?? 0) || a.player_name.localeCompare(b.player_name))
      .slice(0, 80)
  }, [freeAgents, query, points])

  const saved = JSON.stringify(pending.map((c) => [c.add_player_id, c.drop_player_id]))
  const dirty = JSON.stringify(list.map((x) => [x.add, x.drop])) !== saved
  const results = claims.filter((c) => c.status === 'LOST' && c.processed_at).sort((a, b) => (b.processed_at ?? '').localeCompare(a.processed_at ?? '')).slice(0, 3)
  const wins = claims.filter((c) => c.status === 'WON').sort((a, b) => (b.processed_at ?? '').localeCompare(a.processed_at ?? '')).slice(0, 10)

  function addClaim() {
    if (!add || !drop || list.length >= 3) return
    const claim = { add: Number(add), drop: Number(drop) }
    if (list.some((x) => x.add === claim.add && x.drop === claim.drop)) return
    setList([...list, claim])
    setAdd('')
  }
  const keyOf = (x: Draft) => `${x.add}:${x.drop}`
  function move(x: Draft, dir: -1 | 1) {
    const keys = moveInList(list.map(keyOf), keyOf(x), dir)
    setList(keys.map((k) => list.find((y) => keyOf(y) === k)!))
  }

  const select = 'w-full min-w-0 px-3 py-2 bg-slate-800/60 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

  return (
    <div className="space-y-5 text-sm">
      <p className="text-xs text-slate-400">
        Swap a player for a free agent. Claims are processed once a week, on Monday’s nightly update (about 2:00 am). The lowest-ranked team goes
        first, and each team gets at most one swap: its first claim that is still possible. A dropped player goes back to the pool. What they earned
        for you stays in your score; new players count from the swap.
      </p>

      <section>
        <h3 className="mb-2 font-semibold text-white">Your claims ({list.length}/3)</h3>
        {list.length === 0 ? (
          <p className="text-xs text-slate-500">None yet. Add one below.</p>
        ) : (
          <ol className="space-y-1.5">
            {list.map((x, i) => (
              <li key={keyOf(x)} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
                <span className="w-4 text-xs font-bold text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-slate-100">
                  <span className="text-emerald-300">+ {name(x.add)}</span> <span className="text-slate-500">for</span> <span className="text-red-300">− {name(x.drop)}</span>
                </span>
                <button type="button" onClick={() => move(x, -1)} disabled={i === 0} className="px-1.5 text-slate-300 disabled:opacity-30" aria-label="Move up">
                  ↑
                </button>
                <button type="button" onClick={() => move(x, 1)} disabled={i === list.length - 1} className="px-1.5 text-slate-300 disabled:opacity-30" aria-label="Move down">
                  ↓
                </button>
                <button type="button" onClick={() => setList(list.filter((y) => y !== x))} className="px-1.5 text-red-300" aria-label="Remove claim">
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}

        {list.length < 3 && (
          <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-medium text-slate-300">Add a claim</p>
            <select value={drop} onChange={(e) => setDrop(e.target.value)} className={select} aria-label="Player to drop">
              <option value="">Drop one of my players…</option>
              {myPlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.player_name} ({p.team})
                </option>
              ))}
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search free agents…" className={select} aria-label="Search free agents" />
            <select value={add} onChange={(e) => setAdd(e.target.value)} className={select} aria-label="Free agent to add">
              <option value="">Add a free agent…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.player_name} ({p.team}){points?.get(p.id) ? ` · ${formatPoints(points.get(p.id)!)} pts` : ''}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!add || !drop} onClick={addClaim}>
              Add to my list
            </Button>
          </div>
        )}

        <div className="mt-3">
          <Button size="sm" tone="draft" disabled={busy || !dirty} onClick={() => onSave(list.map((x) => x.add), list.map((x) => x.drop))}>
            Save claims
          </Button>
          {dirty && <span className="ml-2 text-xs text-amber-200">Not saved yet</span>}
        </div>
      </section>

      {results.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold text-white">Not granted</h3>
          <ul className="space-y-1 text-xs text-slate-300">
            {results.map((c) => (
              <li key={c.id}>
                + {name(c.add_player_id)} for − {name(c.drop_player_id)}: <span className="text-slate-400">{c.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-semibold text-white">Recent moves</h3>
        {wins.length === 0 ? (
          <p className="text-xs text-slate-500">No swaps yet.</p>
        ) : (
          <ul className="space-y-1">
            {wins.map((c) => {
              const m = memberById.get(c.member_id)
              return (
                <li key={c.id} className={cx('text-sm text-slate-200')}>
                  <span className="font-semibold text-white">{m ? teamLabel(m) : '?'}</span>{' '}
                  <span className="text-emerald-300">+ {name(c.add_player_id)}</span> <span className="text-red-300">− {name(c.drop_player_id)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
