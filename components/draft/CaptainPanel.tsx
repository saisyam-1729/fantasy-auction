'use client'

import { useMemo, useState } from 'react'
import { Button, cx } from '@/components/ui'
import { CAPTAIN_MULTIPLIER, VICE_MULTIPLIER, type CaptainChoice, type DraftPoolPlayer } from '@/lib/draft'

/**
 * Choose my Captain (2x) and Vice-captain (1.5x) from my own players. A new choice
 * is pending until the next nightly points update, so it only counts for points
 * earned after that (no switching to a player who already scored).
 */
export default function CaptainPanel({
  players,
  choice,
  busy,
  onSave,
}: {
  /** my players */
  players: DraftPoolPlayer[]
  choice: CaptainChoice | undefined
  busy: boolean
  onSave: (captainId: number, viceId: number | null) => void
}) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const name = (id: number | null | undefined) => (id != null ? (byId.get(id)?.player_name ?? 'a player') : null)
  const [captain, setCaptain] = useState<number | null>(choice?.pending_captain_id ?? choice?.captain_id ?? null)
  const [vice, setVice] = useState<number | null>(choice?.pending_vice_id ?? choice?.vice_id ?? null)

  const pending = choice?.pending_captain_id != null
  const dirty = captain !== (choice?.pending_captain_id ?? choice?.captain_id ?? null) || vice !== (choice?.pending_vice_id ?? choice?.vice_id ?? null)

  function pickCaptain(id: number) {
    setCaptain(id)
    if (vice === id) setVice(null)
  }
  function pickVice(id: number) {
    setVice(vice === id ? null : id)
    if (captain === id) setCaptain(null)
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-400">
        Captain earns {CAPTAIN_MULTIPLIER}× points and vice-captain {VICE_MULTIPLIER}×, on points scored after the choice takes effect. A change counts
        from the second nightly update after you save it.
      </p>
      <p className="text-xs text-slate-300">
        Now: <span className="font-semibold text-white">{name(choice?.captain_id) ?? 'no captain yet'}</span>
        {choice?.vice_id != null && (
          <>
            {' '}
            · VC <span className="font-semibold text-white">{name(choice.vice_id)}</span>
          </>
        )}
        {pending && (
          <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-200">
            next: {name(choice?.pending_captain_id)}
            {choice?.pending_vice_id != null ? ` / ${name(choice.pending_vice_id)}` : ''}
          </span>
        )}
      </p>
      <ul className="divide-y divide-slate-700/70 rounded-xl border border-slate-700 bg-slate-900/40">
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-slate-100">
              {p.player_name} <span className="text-xs text-slate-400">{p.team}</span>
            </span>
            <button
              type="button"
              onClick={() => pickCaptain(p.id)}
              aria-pressed={captain === p.id}
              className={cx('w-9 rounded-lg py-1 text-xs font-bold', captain === p.id ? 'bg-amber-400 text-slate-900' : 'bg-white/10 text-slate-200 hover:bg-white/20')}
            >
              C
            </button>
            <button
              type="button"
              onClick={() => pickVice(p.id)}
              aria-pressed={vice === p.id}
              className={cx('w-9 rounded-lg py-1 text-xs font-bold', vice === p.id ? 'bg-sky-400 text-slate-900' : 'bg-white/10 text-slate-200 hover:bg-white/20')}
            >
              VC
            </button>
          </li>
        ))}
      </ul>
      <Button size="sm" tone="draft" disabled={busy || captain == null || !dirty} onClick={() => captain != null && onSave(captain, vice)}>
        Save captains
      </Button>
    </div>
  )
}
