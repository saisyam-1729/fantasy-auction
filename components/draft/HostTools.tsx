'use client'

import { useMemo, useState } from 'react'
import { Button, cx } from '@/components/ui'
import { teamLabel, type DraftMember, type DraftPick, type DraftPoolPlayer, type DraftRoom } from '@/lib/draft'

export type HostActions = {
  undo: () => void
  deleteDraft: () => void
  replacePick: (pickNo: number, playerId: number) => void
  addPlayer: (team: string, name: string, role: string | null) => void
  resetPoints: () => void
  setCaptainsEnabled: (on: boolean) => void
}

const ROLES = ['Batter', 'WK-Batter', 'All-rounder', 'Bowler']
const field = 'w-full min-w-0 px-3 py-2 bg-slate-800/60 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

/**
 * The host's fold-away tools: undo, fix a mistaken pick, add a player missing
 * from the pool, count points only from now on, delete the draft.
 */
export default function HostTools({
  room,
  isOwner,
  picks,
  pool,
  members,
  busy,
  actions,
}: {
  room: DraftRoom
  isOwner: boolean
  picks: DraftPick[]
  pool: DraftPoolPlayer[]
  members: DraftMember[]
  busy: boolean
  actions: HostActions
}) {
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null)
  const [pickNo, setPickNo] = useState('')
  const [replacement, setReplacement] = useState('')
  const [team, setTeam] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool])
  const memberName = useMemo(() => new Map(members.map((m) => [m.id, teamLabel(m)])), [members])
  const available = useMemo(() => {
    const taken = new Set(picks.map((p) => p.player_id))
    return pool.filter((p) => !taken.has(p.id)).sort((a, b) => a.player_name.localeCompare(b.player_name))
  }, [pool, picks])
  const teams = useMemo(() => [...new Set(pool.map((p) => p.team))].sort(), [pool])
  const started = room.status !== 'LOBBY'

  return (
    <details className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-semibold text-slate-300">Host tools</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {started && (
          <section className="space-y-2">
            <h3 className="font-semibold text-white">Fix a pick</h3>
            <p className="text-xs text-slate-400">Swap the player of an earlier pick, e.g. when someone tapped the wrong name. The pick keeps its team and number.</p>
            <select value={pickNo} onChange={(e) => setPickNo(e.target.value)} className={field} aria-label="Pick to fix">
              <option value="">Choose a pick…</option>
              {[...picks].reverse().map((p) => (
                <option key={p.id} value={p.pick_no}>
                  #{p.pick_no + 1} {memberName.get(p.member_id)} · {byId.get(p.player_id)?.player_name ?? '?'}
                </option>
              ))}
            </select>
            <select value={replacement} onChange={(e) => setReplacement(e.target.value)} className={field} aria-label="Replacement player">
              <option value="">Replace with…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.player_name} ({p.team})
                </option>
              ))}
            </select>
            <Button
              size="sm"
              tone="draft"
              disabled={busy || pickNo === '' || replacement === ''}
              onClick={() => {
                actions.replacePick(Number(pickNo), Number(replacement))
                setPickNo('')
                setReplacement('')
              }}
            >
              Replace player
            </Button>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="font-semibold text-white">Add a missing player</h3>
          <p className="text-xs text-slate-400">Adds them to this event’s pool for every draft. Use the team name as it appears in the pool.</p>
          <input list="host-teams" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team" className={field} aria-label="Team" />
          <datalist id="host-teams">
            {teams.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" className={field} aria-label="Player name" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className={field} aria-label="Role">
            <option value="">Role (optional)</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            tone="draft"
            disabled={busy || team.trim().length < 2 || name.trim().length < 2}
            onClick={() => {
              actions.addPlayer(team.trim(), name.trim(), role || null)
              setName('')
            }}
          >
            Add player
          </Button>
        </section>

        {started && (
          <section className="space-y-2">
            <h3 className="font-semibold text-white">Leaderboard</h3>
            <p className="text-xs text-slate-400">
              Count only points scored from now on (e.g. a match was played during the draft). Every team goes back to 0.
            </p>
            {confirm === 'reset' ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" tone="danger" disabled={busy} onClick={() => (actions.resetPoints(), setConfirm(null))}>
                  Reset to 0
                </Button>
                <Button size="sm" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => setConfirm('reset')}>
                Reset points…
              </Button>
            )}
          </section>
        )}

        {started && (
          <section className="space-y-2">
            <h3 className="font-semibold text-white">Captains</h3>
            <p className="text-xs text-slate-400">
              Let every team pick a Captain (2× points) and Vice-captain (1.5×). Bonuses count only for points earned after each choice takes effect,
              never backwards.
            </p>
            <Button size="sm" tone={room.captains_enabled ? 'danger' : 'draft'} disabled={busy} onClick={() => actions.setCaptainsEnabled(!room.captains_enabled)}>
              {room.captains_enabled ? 'Switch captains off' : 'Switch captains on'}
            </Button>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="font-semibold text-white">Draft</h3>
          <div className="flex flex-wrap gap-2">
            {started && picks.length > 0 && (
              <Button size="sm" disabled={busy} onClick={actions.undo}>
                Undo last pick
              </Button>
            )}
            {isOwner &&
              (confirm === 'delete' ? (
                <>
                  <Button size="sm" tone="danger" disabled={busy} onClick={actions.deleteDraft}>
                    Delete for everyone
                  </Button>
                  <Button size="sm" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" tone="danger" onClick={() => setConfirm('delete')}>
                  Delete draft
                </Button>
              ))}
          </div>
          {room.status === 'DRAFTING' && <p className={cx('text-xs text-slate-400')}>To pick for a team that is away, use “Pick for …” in the pool.</p>}
        </section>
      </div>
    </details>
  )
}
