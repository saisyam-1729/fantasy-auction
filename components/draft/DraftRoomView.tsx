'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import DraftWheel from '@/components/draft/DraftWheel'
import DraftPool, { type WishlistProps } from '@/components/draft/DraftPool'
import LatestPick from '@/components/draft/LatestPick'
import { Badge, Button, Card, PageHeader, Segmented, cx } from '@/components/ui'
import { poolLabel } from '@/lib/events'
import {
  inDraftOrder,
  lobbyCheck,
  memberOnClock,
  ordinal,
  roundOf,
  totalPicks,
  upcomingPicks,
  type DraftMember,
  type DraftPick,
  type DraftPoolPlayer,
  type DraftRoom,
} from '@/lib/draft'

export type DraftActions = {
  spin: () => void
  start: () => void
  resetOrder: () => void
  removeMember: (member: DraftMember) => void
  pick: (player: DraftPoolPlayer) => void
  undo: () => void
  deleteDraft: () => void
  copyInvite: () => void
  copyTeams: () => void
}

export type DraftRoomViewProps = {
  room: DraftRoom
  members: DraftMember[]
  picks: DraftPick[]
  pool: DraftPoolPlayer[]
  userId: string
  busy: boolean
  notice: { text: string; bad?: boolean } | null
  actions: DraftActions
  /** The viewer's private, ordered shortlist (members only). */
  wishlist?: WishlistProps
  /** player id -> fantasy points for this draft, when known */
  points?: Map<number, number>
  /** Seconds left on a timed turn, null without a timer. */
  secondsLeft?: number | null
  /** Turn chime on/off. */
  sound?: { enabled: boolean; toggle: () => void }
}

type Tab = 'pool' | 'teams' | 'log'

/**
 * Everything you see in a draft room, from data passed in (no fetching), so it
 * can also be previewed with sample data at /dev/draft-preview.
 *
 * Phones: one panel at a time (Pool / Teams / Picks tabs).
 * Laptop (lg): the pool sits beside the teams; Teams and Picks share the right side.
 * Wide (2xl): pool, teams and the pick feed are all visible at once.
 */
export default function DraftRoomView({ room, members, picks, pool, userId, busy, notice, actions, wishlist, points, secondsLeft = null, sound }: DraftRoomViewProps) {
  const [tab, setTab] = useState<Tab>('pool')
  const [rightTab, setRightTab] = useState<'teams' | 'log'>('teams')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ordered = useMemo(() => inDraftOrder(members), [members])
  const me = members.find((m) => m.user_id === userId) ?? null
  const isHost = Boolean(me?.is_host)
  const isOwner = room.owner_id === userId
  const n = members.length
  const pickNo = picks.length
  const total = totalPicks(n, room.picks_per_team)
  const onClock = room.status === 'DRAFTING' ? memberOnClock(members, pickNo) : null
  const myTurn = Boolean(onClock && me && onClock.id === me.id)
  const playersById = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool])
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const pickedBy = useMemo(() => {
    const map = new Map<number, DraftMember>()
    for (const p of picks) {
      const m = membersById.get(p.member_id)
      if (m) map.set(p.player_id, m)
    }
    return map
  }, [picks, membersById])

  const event = poolLabel(room.pool)
  const lobby = lobbyCheck(members)
  const { round, pickInRound } = roundOf(pickNo, Math.max(n, 1))
  const next = room.status === 'DRAFTING' ? upcomingPicks(members, pickNo + 1, room.picks_per_team, Math.min(n * 2, 12)) : []
  const myNext = me && !myTurn ? upcomingPicks(members, pickNo + 1, room.picks_per_team, total).findIndex((x) => x.member?.id === me.id) : -1
  const canPick = room.status === 'DRAFTING' && (myTurn || isHost)
  const lastPick = picks[picks.length - 1]
  const statusBadge =
    room.status === 'DRAFTING' ? <Badge tone="green">Drafting</Badge> : room.status === 'DONE' ? <Badge tone="grey">Finished</Badge> : <Badge tone="yellow">Lobby</Badge>

  const header = (
    <PageHeader
      title={
        <span className="flex items-center gap-3">
          <span className="truncate">
            {room.name} · {event} Draft
          </span>
          {statusBadge}
        </span>
      }
      subtitle={
        <>
          <span className="font-mono">{room.room_code}</span> · {n}/{room.max_members} teams · {room.picks_per_team} picks each
          {me ? ` · you are ${me.username}` : ''}
          {room.status === 'LOBBY' && (
            <>
              {' '}
              · key <span className="font-mono text-white">{room.room_key}</span>
            </>
          )}
        </>
      }
      actions={
        <>
          {sound && room.status !== 'DONE' && (
            <Button size="sm" onClick={sound.toggle} aria-pressed={sound.enabled} title="Play a sound when it is your turn">
              {sound.enabled ? '🔔 Sound on' : '🔕 Sound off'}
            </Button>
          )}
          {room.status === 'LOBBY' && (
            <Button size="sm" onClick={actions.copyInvite}>
              Copy invite link
            </Button>
          )}
          {room.pick_seconds && room.status === 'LOBBY' && <Badge tone="sky">⏱ {room.pick_seconds}s per pick</Badge>}
          {room.status !== 'LOBBY' && (
            <Link href={`/leaderboard/${room.id}`} className="rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-sky-400">
              🏆 Leaderboard
            </Link>
          )}
        </>
      }
    />
  )

  const noticeBar = notice && (
    <div
      role="status"
      className={cx(
        'mb-4 p-3 rounded-xl text-sm font-medium border',
        notice.bad ? 'bg-red-500/20 text-red-100 border-red-500/50' : 'bg-emerald-500/20 text-emerald-100 border-emerald-500/50'
      )}
    >
      {notice.text}
    </div>
  )

  const hostTools = isHost && (
    <details className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-semibold text-slate-300">Host tools</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {room.status !== 'LOBBY' && picks.length > 0 && (
          <Button size="sm" disabled={busy} onClick={actions.undo}>
            Undo last pick
          </Button>
        )}
        {isOwner &&
          (confirmDelete ? (
            <>
              <Button size="sm" tone="danger" disabled={busy} onClick={actions.deleteDraft}>
                Delete for everyone
              </Button>
              <Button size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" tone="danger" onClick={() => setConfirmDelete(true)}>
              Delete draft
            </Button>
          ))}
      </div>
      {room.status === 'DRAFTING' && <p className="mt-2 text-xs text-slate-400">To pick for a team that is away, use “Pick for …” in the pool.</p>}
    </details>
  )

  // ------------------------------------------------------------------ lobby
  if (room.status === 'LOBBY') {
    return (
      <div>
        {header}
        {noticeBar}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <h2 className="text-lg font-bold text-white mb-1">Draft order</h2>
            <p className="text-xs text-slate-300 mb-4">
              The host spins the wheel. Each spin gives the next pick position to one of the players still on the wheel, until one is
              left. Then picks snake: 1, 2, 3 … then back 3, 2, 1.
            </p>
            <DraftWheel members={members} lastSpin={room.last_spin} />
            {isHost && (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button tone="draft" disabled={busy || !lobby.canSpin} onClick={actions.spin}>
                  Spin the wheel
                </Button>
                {lobby.canStart && (
                  <Button tone="auction" disabled={busy} onClick={actions.start}>
                    Start draft
                  </Button>
                )}
                {members.some((m) => m.order_pos != null) && (
                  <Button disabled={busy} onClick={actions.resetOrder}>
                    Reset order
                  </Button>
                )}
              </div>
            )}
            {lobby.reason && <p className="mt-3 text-center text-sm text-slate-300">{lobby.reason}</p>}
            {!lobby.reason && !isHost && <p className="mt-3 text-center text-sm text-slate-300">Order is set. Waiting for the host to start.</p>}
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-white mb-3">Teams ({n})</h2>
            <ul className="space-y-2">
              {ordered.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl bg-slate-900/40 border border-slate-700 px-3 py-2">
                  <span className={cx('w-9 text-center text-sm font-bold', m.order_pos ? 'text-emerald-300' : 'text-slate-500')}>{m.order_pos ? ordinal(m.order_pos) : '—'}</span>
                  <span className="flex-1 truncate text-white text-sm">
                    {m.username}
                    {m.user_id === userId && <span className="text-slate-400"> (you)</span>}
                  </span>
                  {m.user_id === room.owner_id && <span className="text-[10px] font-bold uppercase text-yellow-300">Host</span>}
                  {m.user_id !== room.owner_id && (isHost || m.user_id === userId) && (
                    <button type="button" disabled={busy} onClick={() => actions.removeMember(m)} className="text-xs text-red-300 hover:text-red-200">
                      {m.user_id === userId ? 'Leave' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">Removing or leaving clears the order, so the wheel is spun again.</p>
          </Card>

          <Card className="md:col-span-2 xl:col-span-1">
            <h2 className="mb-3 text-lg font-bold text-white">Player pool</h2>
            <DraftPool players={pool} pickedBy={pickedBy} canPick={false} pickLabel="" busy={false} onPick={() => {}} wishlist={wishlist} points={points} />
          </Card>
        </div>
        {hostTools}
      </div>
    )
  }

  // -------------------------------------------------------- drafting / done
  const clock =
    room.status === 'DRAFTING' && onClock ? (
      <div className={cx('h-full rounded-2xl p-4 border', myTurn ? 'bg-emerald-500/25 border-emerald-400 shadow-lg shadow-emerald-500/20' : 'bg-white/10 border-white/20')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-slate-300">
              Round {round} · pick {pickInRound} of {n} · overall {pickNo + 1} of {total}
            </p>
            <p className="text-xl font-bold text-white">{myTurn ? 'Your pick!' : `${onClock.username} is picking`}</p>
          </div>
          {secondsLeft != null && (
            <span
              className={cx(
                'shrink-0 rounded-xl px-3 py-1.5 font-mono text-lg font-black tabular-nums',
                secondsLeft <= 10 ? 'bg-red-500/30 text-red-100 animate-pulse' : 'bg-slate-900/60 text-white'
              )}
              aria-label={`${secondsLeft} seconds left`}
            >
              ⏱ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-300">
          {myTurn
            ? secondsLeft != null
              ? 'Choose a player. When time runs out, the top of your list is picked for you.'
              : 'Choose a player from the pool.'
            : myNext >= 0
              ? `Your next pick is in ${myNext + 1} ${myNext === 0 ? 'pick' : 'picks'}.`
              : isHost
                ? 'As host you can pick for them if they are away.'
                : ''}
        </p>
        {next.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            <span className="text-xs text-slate-400 self-center shrink-0">Next:</span>
            {next.map((x) => (
              <span key={x.pickNo} className={cx('shrink-0 text-xs px-2 py-1 rounded-lg', x.member?.id === me?.id ? 'bg-emerald-500/30 text-emerald-100' : 'bg-slate-800/70 text-slate-200')}>
                {x.member?.username ?? '?'}
              </span>
            ))}
          </div>
        )}
      </div>
    ) : (
      <div className="h-full rounded-2xl p-4 border bg-emerald-500/15 border-emerald-500/40">
        <p className="text-xl font-bold text-white">Draft complete</p>
        <p className="text-sm text-slate-200">All {total} picks are in.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/leaderboard/${room.id}`} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-sky-400">
            🏆 Leaderboard
          </Link>
          <Button tone="draft" onClick={actions.copyTeams}>
            Copy all teams
          </Button>
        </div>
      </div>
    )

  const poolPanel = (
    <DraftPool
      players={pool}
      pickedBy={pickedBy}
      latestPlayerId={lastPick?.player_id ?? null}
      canPick={canPick}
      pickLabel={myTurn ? 'Pick' : `Pick for ${onClock?.username ?? ''}`}
      busy={busy}
      onPick={actions.pick}
      wishlist={wishlist}
      points={points}
    />
  )

  const teamsPanel = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {ordered.map((m) => {
        const mine = picks.filter((p) => p.member_id === m.id)
        const justPicked = lastPick?.member_id === m.id
        return (
          <div
            key={m.id}
            className={cx(
              'rounded-xl border-2 p-3',
              onClock?.id === m.id ? 'border-emerald-400 bg-emerald-500/10' : justPicked ? 'border-amber-400 bg-amber-500/10' : 'border-slate-700 bg-slate-900/40'
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold text-white truncate">
                {m.order_pos}. {m.username}
                {m.user_id === userId && <span className="text-slate-400 font-normal"> (you)</span>}
              </span>
              {onClock?.id === m.id ? (
                <span className="shrink-0 text-[10px] font-bold uppercase text-emerald-300">On the clock</span>
              ) : justPicked ? (
                <span className="shrink-0 text-[10px] font-bold uppercase text-amber-300">Just picked</span>
              ) : (
                <span className="shrink-0 text-xs text-slate-400">
                  {mine.length}/{room.picks_per_team}
                </span>
              )}
            </div>
            {mine.length === 0 ? (
              <p className="text-xs text-slate-500">No picks yet</p>
            ) : (
              <ol className="space-y-1">
                {mine.map((p) => {
                  const pl = playersById.get(p.player_id)
                  return (
                    <li
                      key={p.id}
                      className={cx('text-sm flex justify-between gap-2 rounded px-1 -mx-1', p.id === lastPick?.id ? 'bg-amber-500/20 text-amber-100 font-semibold' : 'text-slate-100')}
                    >
                      <span className="truncate">{pl?.player_name ?? '?'}</span>
                      <span className="text-xs text-slate-400 shrink-0 truncate max-w-[45%]">{pl?.team}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )

  const logPanel = (
    <ol className="divide-y divide-slate-700/70">
      {picks.length === 0 && <li className="py-4 text-center text-sm text-slate-400">No picks yet.</li>}
      {[...picks].reverse().map((p) => {
        const pl = playersById.get(p.player_id)
        const who = membersById.get(p.member_id)
        const rr = roundOf(p.pick_no, n)
        return (
          <li key={p.id} className={cx('py-2 flex items-center gap-3 text-sm', p.id === lastPick?.id && 'bg-amber-500/15 -mx-2 px-2 rounded-lg font-semibold')}>
            <span className="w-12 shrink-0 text-xs text-slate-400">
              R{rr.round}.{rr.pickInRound}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-white">{pl?.player_name ?? '?'}</span>
              <span className="block truncate text-xs text-slate-400">
                <span className="text-slate-200">{who?.username}</span> · {pl?.team}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )

  return (
    <div>
      {header}
      {noticeBar}

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {lastPick ? (
          <LatestPick pick={lastPick} player={playersById.get(lastPick.player_id)} picker={membersById.get(lastPick.member_id)} teams={n} isMine={lastPick.member_id === me?.id} />
        ) : (
          <div className="hidden lg:flex h-full items-center justify-center rounded-2xl border border-dashed border-white/15 text-sm text-slate-400">The first pick will show here.</div>
        )}
        {clock}
      </div>

      {/* phones and tablets: one panel at a time */}
      <Segmented
        className="mb-3 lg:hidden"
        label="Draft panels"
        value={tab}
        onChange={setTab}
        options={[
          ['pool', 'Pool'],
          ['teams', 'Teams'],
          ['log', `Picks (${picks.length})`],
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,4fr)]">
        <Card className={cx(tab === 'pool' ? '' : 'hidden', 'lg:block lg:sticky lg:top-20 lg:self-start')}>
          <h2 className="mb-3 hidden lg:block text-sm font-semibold uppercase tracking-wide text-slate-400">Player pool</h2>
          {poolPanel}
        </Card>

        <div className={cx(tab === 'pool' ? 'hidden lg:block' : '')}>
          <Segmented
            className="mb-3 hidden lg:grid 2xl:hidden"
            label="Teams or picks"
            value={rightTab}
            onChange={setRightTab}
            options={[
              ['teams', 'Teams'],
              ['log', `Picks (${picks.length})`],
            ]}
          />
          <div className="2xl:grid 2xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] 2xl:gap-4">
            <Card className={cx(tab === 'teams' ? '' : 'hidden', rightTab === 'teams' ? 'lg:block' : 'lg:hidden', '2xl:block')}>
              <h2 className="mb-3 hidden 2xl:block text-sm font-semibold uppercase tracking-wide text-slate-400">Teams</h2>
              {teamsPanel}
            </Card>
            <Card className={cx(tab === 'log' ? '' : 'hidden', rightTab === 'log' ? 'lg:block' : 'lg:hidden', '2xl:block 2xl:self-start 2xl:sticky 2xl:top-20')}>
              <h2 className="mb-2 hidden 2xl:block text-sm font-semibold uppercase tracking-wide text-slate-400">Picks ({picks.length})</h2>
              <div className="2xl:max-h-[calc(100vh-9rem)] 2xl:overflow-y-auto">{logPanel}</div>
            </Card>
          </div>
        </div>
      </div>

      {hostTools}
    </div>
  )
}
