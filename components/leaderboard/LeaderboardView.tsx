'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, cx } from '@/components/ui'
import { formatPoints, MEDALS, pointsGain, rankMove, type Leaderboard, type LeaderboardRow } from '@/lib/fantasyPoints'
import { captainTag, teamLabel, type CaptainChoice, type DraftMember } from '@/lib/draft'

export type TeamIdentity = Pick<DraftMember, 'username' | 'team_name' | 'team_emoji' | 'team_color'>

const PODIUM: Record<number, string> = {
  1: 'border-yellow-400/80 bg-gradient-to-r from-yellow-500/25 to-yellow-500/5 shadow-lg shadow-yellow-500/10',
  2: 'border-slate-300/70 bg-gradient-to-r from-slate-300/20 to-slate-300/5',
  3: 'border-orange-400/70 bg-gradient-to-r from-orange-500/20 to-orange-500/5',
}

function day(d: string | null) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function Move({ row }: { row: LeaderboardRow }) {
  const move = rankMove(row)
  if (move == null) return <span className="text-[11px] font-semibold text-sky-300">NEW</span>
  if (move === 0) return <span className="text-sm text-slate-400" aria-label="No change in position">–</span>
  const up = move > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-bold ${up ? 'text-emerald-400' : 'text-red-400'}`} aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(move)}`}>
      {up ? '▲' : '▼'}
      {Math.abs(move)}
    </span>
  )
}

function Gain({ value }: { value: number | null }) {
  if (value == null) return null
  return (
    <span className={`text-xs font-semibold ${value > 0 ? 'text-emerald-300' : value < 0 ? 'text-red-300' : 'text-slate-500'}`}>
      {value > 0 ? '+' : ''}
      {formatPoints(value)}
    </span>
  )
}

function Players({ row, choice }: { row: LeaderboardRow; choice?: CaptainChoice }) {
  return (
    <ul className="space-y-1">
      {row.players.map((p) => (
        <li key={p.player_id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-slate-100">
            {p.name}
            {captainTag(choice, p.player_id) && (
              <span className={`ml-1.5 rounded px-1 text-[10px] font-bold text-slate-900 ${captainTag(choice, p.player_id) === 'C' ? 'bg-amber-400' : 'bg-sky-400'}`}>
                {captainTag(choice, p.player_id)}
              </span>
            )}{' '}
            <span className="text-xs text-slate-400">{p.team}</span>
          </span>
          <span className="w-12 text-right">
            <Gain value={pointsGain(p)} />
          </span>
          <span className="w-10 text-right font-semibold text-white">{formatPoints(Number(p.points))}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A draft's leaderboard drawn from data (no fetching). Phones: tap a team to
 * expand its players. Laptops: the selected team's players show in a side panel.
 */
export type SyncStatus = { ran_at: string; source_rows: number; matched: number; unmatched: { name: string; team?: string }[] }

/** Older than this, the nightly update probably didn't run. */
const STALE_MS = 30 * 60 * 60 * 1000

export function LeaderboardBoard({
  board,
  currentUserId,
  sync = null,
  now = null,
  teams,
  captains = [],
  bonus,
  banked,
}: {
  board: Leaderboard
  currentUserId: string | null
  sync?: SyncStatus | null
  /** Current time (ms) for the staleness check; omit to skip it. */
  now?: number | null
  /** member id -> team identity (name, emoji, colour) */
  teams?: Map<string, TeamIdentity>
  captains?: CaptainChoice[]
  /** member id -> captain bonus included in their points */
  bonus?: Map<string, number>
  /** member id -> points banked from players they dropped (included in their points) */
  banked?: Map<string, number>
}) {
  const labelOf = (row: LeaderboardRow) => {
    const t = teams?.get(row.member_id)
    return t ? teamLabel(t) : row.username
  }
  const colourOf = (row: LeaderboardRow) => teams?.get(row.member_id)?.team_color ?? undefined
  const [open, setOpen] = useState<string | null>(null)
  const stale = Boolean(sync && now != null && now - new Date(sync.ran_at).getTime() > STALE_MS)
  const unmatched = sync?.unmatched ?? []
  const mine = board.rows.find((r) => r.user_id === currentUserId)
  const detail = board.rows.find((r) => r.member_id === open) ?? mine ?? board.rows[0]

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="mb-3 text-xs text-slate-400">
          {board.synced_at ? (
            <>
              Points updated {new Date(board.synced_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              {board.previous_day ? ` · changes since ${day(board.previous_day)}` : ' · day-on-day changes start after the next nightly update'}
            </>
          ) : (
            'No points yet. They update every night at about 2:00 am.'
          )}
        </div>
        {(stale || unmatched.length > 0) && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {stale && <p>⚠ The last points update was more than a day ago, so tonight’s update may have failed. Points may be behind.</p>}
            {unmatched.length > 0 && (
              <p>
                ⚠ {unmatched.length} player{unmatched.length === 1 ? '' : 's'} on the points page couldn’t be matched to the pool, so their points aren’t
                counted: {unmatched.map((u) => u.name).join(', ')}. A host can add a missing player from the draft room’s host tools.
              </p>
            )}
          </div>
        )}

        <div className="mb-1 hidden sm:grid grid-cols-[2.5rem_2.25rem_minmax(0,1fr)_5rem] gap-3 px-3 text-[11px] uppercase tracking-wide text-slate-500">
          <span className="text-center">Rank</span>
          <span className="text-center">Move</span>
          <span>Team</span>
          <span className="text-right">Points</span>
        </div>
        <ol className="space-y-2">
          {board.rows.map((row) => {
            const isMe = row.user_id === currentUserId
            const expanded = open === row.member_id
            // medals only once a team has scored, so an all-zero board has no winners
            const scored = Number(row.points) > 0
            const podium = scored ? PODIUM[row.rank] : undefined
            const medal = scored ? MEDALS[row.rank] : undefined
            const selected = detail?.member_id === row.member_id
            return (
              <li
                key={row.member_id}
                className={cx(
                  'rounded-2xl border-2',
                  podium ?? (isMe ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-slate-700 bg-slate-900/40'),
                  selected && 'lg:ring-2 lg:ring-sky-400/70'
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : row.member_id)}
                  aria-expanded={expanded}
                  className="w-full grid grid-cols-[2.5rem_2.25rem_minmax(0,1fr)_5rem] items-center gap-3 px-3 py-3 text-left"
                >
                  <span className="text-center">
                    {medal ? (
                      <span className="text-2xl" role="img" aria-label={`Rank ${row.rank}`}>
                        {medal}
                      </span>
                    ) : (
                      <span className="text-lg font-bold text-slate-300">{row.rank}</span>
                    )}
                  </span>
                  <span className="text-center">
                    <Move row={row} />
                  </span>
                  <span className="min-w-0">
                    <span className={cx('block truncate font-semibold', podium ? 'text-white text-base' : 'text-slate-100 text-sm')} style={colourOf(row) ? { color: colourOf(row) } : undefined}>
                      {labelOf(row)}
                      {isMe && <span className="ml-2 text-[10px] font-bold uppercase text-emerald-300">You</span>}
                    </span>
                    <span className="block text-[11px] text-slate-400">
                      {teams?.get(row.member_id)?.team_name ? row.username + ' · ' : ''}
                      {row.players.length} players<span className="lg:hidden"> · tap for details</span>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={cx('block font-black', podium ? 'text-xl text-white' : 'text-lg text-slate-100')}>{formatPoints(Number(row.points))}</span>
                    <Gain value={pointsGain(row)} />
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-white/10 px-3 py-2 lg:hidden">
                    <Players row={row} choice={captains.find((c) => c.member_id === row.member_id)} />
                    {(bonus?.get(row.member_id) ?? 0) !== 0 && (
                      <p className="mt-1 text-xs text-amber-200">Includes +{formatPoints(bonus!.get(row.member_id)!)} captain bonus</p>
                    )}
                    {(banked?.get(row.member_id) ?? 0) !== 0 && (
                      <p className="mt-1 text-xs text-slate-300">Includes {formatPoints(banked!.get(row.member_id)!)} from dropped players</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        <p className="mt-4 text-[11px] text-slate-500">
          Points are each player’s Statz performance points scored after the draft, added up for every team. Ties share a rank.
        </p>
      </div>

      {detail && (
        <Card className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="truncate text-lg font-bold text-white" style={colourOf(detail) ? { color: colourOf(detail) } : undefined}>
              {labelOf(detail)}
              {detail.user_id === currentUserId && <span className="ml-2 text-xs font-bold uppercase text-emerald-300">You</span>}
            </h2>
            <span className="shrink-0 text-sm text-slate-300">
              {formatPoints(Number(detail.points))} pts · rank {detail.rank}
            </span>
          </div>
          <div className="mb-2 flex justify-end gap-2 text-[11px] uppercase tracking-wide text-slate-500">
            <span className="w-12 text-right">Today</span>
            <span className="w-10 text-right">Total</span>
          </div>
          <Players row={detail} choice={captains.find((c) => c.member_id === detail.member_id)} />
          {(bonus?.get(detail.member_id) ?? 0) !== 0 && (
            <p className="mt-3 text-xs text-amber-200">Includes +{formatPoints(bonus!.get(detail.member_id)!)} captain bonus</p>
          )}
          {(banked?.get(detail.member_id) ?? 0) !== 0 && (
            <p className="mt-1 text-xs text-slate-300">Includes {formatPoints(banked!.get(detail.member_id)!)} from dropped players</p>
          )}
        </Card>
      )}
    </div>
  )
}

/** Loads one draft's leaderboard (and, given its pool, the last points update) and draws it. */
export default function LeaderboardView({
  draftId,
  currentUserId,
  pool,
  kind = 'draft',
}: {
  /** the draft's id, or the auction room's id when kind is 'auction' */
  draftId: string
  currentUserId: string | null
  pool?: string
  kind?: 'draft' | 'auction'
}) {
  const [supabase] = useState(() => createClient())
  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [now, setNow] = useState<number | null>(null)
  const [teams, setTeams] = useState<Map<string, TeamIdentity>>(new Map())
  const [captains, setCaptains] = useState<CaptainChoice[]>([])
  const [bonus, setBonus] = useState<Map<string, number>>(new Map())
  const [banked, setBanked] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const request = kind === 'auction' ? supabase.rpc('auction_leaderboard', { p_room_id: draftId }) : supabase.rpc('draft_leaderboard', { p_draft_id: draftId })
    void request.then(({ data, error: err }) => {
      if (!live) return
      if (err) setError(err.message)
      else setBoard(data as Leaderboard)
      setNow(Date.now())
    })
    return () => {
      live = false
    }
  }, [supabase, draftId, kind])

  useEffect(() => {
    if (kind === 'auction') return // team names, captains and bonuses are draft features
    let live = true
    void Promise.all([
      supabase.from('draft_members').select('id, username, team_name, team_emoji, team_color').eq('draft_id', draftId),
      supabase.from('draft_captains').select('member_id, captain_id, vice_id, pending_captain_id, pending_vice_id, draft_members!inner(draft_id)').eq('draft_members.draft_id', draftId),
      supabase.from('draft_member_bonus').select('member_id, points, banked').eq('draft_id', draftId),
    ]).then(([m, c, b]) => {
      if (!live) return
      setTeams(new Map(((m.data ?? []) as (TeamIdentity & { id: string })[]).map((x) => [x.id, x])))
      const n = (v: unknown) => (v == null ? null : Number(v))
      setCaptains(
        ((c.data ?? []) as Record<string, unknown>[]).map((x) => ({
          member_id: String(x.member_id),
          captain_id: n(x.captain_id),
          vice_id: n(x.vice_id),
          pending_captain_id: n(x.pending_captain_id),
          pending_vice_id: n(x.pending_vice_id),
        }))
      )
      const rows = (b.data ?? []) as { member_id: string; points: number; banked: number }[]
      setBonus(new Map(rows.map((x) => [x.member_id, Number(x.points)])))
      setBanked(new Map(rows.map((x) => [x.member_id, Number(x.banked)])))
    })
    return () => {
      live = false
    }
  }, [supabase, draftId, kind])

  useEffect(() => {
    if (!pool) return
    let live = true
    void supabase.rpc('points_sync_status', { p_pool: pool }).then(({ data }) => {
      if (live) setSync((data as SyncStatus | null) ?? null)
    })
    return () => {
      live = false
    }
  }, [supabase, pool])

  if (error) return <p className="text-red-200 text-sm">{error}</p>
  if (!board) return <p className="text-slate-300 text-sm">Loading leaderboard…</p>
  return <LeaderboardBoard board={board} currentUserId={currentUserId} sync={sync} now={now} teams={teams} captains={captains} bonus={bonus} banked={banked} />
}
