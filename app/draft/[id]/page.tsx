'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import DraftWheel from '@/components/draft/DraftWheel'
import DraftPool from '@/components/draft/DraftPool'
import {
  draftSummaryText,
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

type Tab = 'pool' | 'teams' | 'log'

const card = 'backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4 sm:p-5'
const btn = 'px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed'

export default function DraftRoomPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [supabase] = useState(() => createClient())

  const [user, setUser] = useState<User | null>(null)
  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [members, setMembers] = useState<DraftMember[]>([])
  const [picks, setPicks] = useState<DraftPick[]>([])
  const [pool, setPool] = useState<DraftPoolPlayer[]>([])
  const [loadError, setLoadError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null)
  const [tab, setTab] = useState<Tab>('pool')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const flash = useCallback((text: string, bad = false) => {
    setNotice({ text, bad })
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 3500)
  }, [])

  const refresh = useCallback(async () => {
    const [r, m, p] = await Promise.all([
      supabase.from('draft_rooms').select('*').eq('id', id).maybeSingle(),
      supabase.from('draft_members').select('*').eq('draft_id', id),
      supabase.from('draft_picks').select('*').eq('draft_id', id).order('pick_no'),
    ])
    if (r.error || !r.data) {
      setLoadError(r.error?.message ?? 'This draft does not exist, or you are not in it.')
      return
    }
    setLoadError('')
    setRoom(r.data as DraftRoom)
    setMembers((m.data ?? []) as DraftMember[])
    setPicks((p.data ?? []) as DraftPick[])
  }, [supabase, id])

  // First load: who am I, the room, and the pool.
  useEffect(() => {
    let live = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.push('/auth')
        return
      }
      if (!live) return
      setUser(data.user)
      await refresh()
      const r = await supabase.from('draft_rooms').select('pool').eq('id', id).maybeSingle()
      if (r.data?.pool) {
        const { data: players } = await supabase
          .from('draft_pool_players')
          .select('id, sort_no, team, player_name, role, captain, notes')
          .eq('pool', r.data.pool)
          .order('sort_no')
          .limit(2000)
        if (live) setPool((players ?? []) as DraftPoolPlayer[])
      }
      if (live) setLoaded(true)
    })()
    return () => {
      live = false
    }
  }, [supabase, id, router, refresh])

  // Live updates, with a slow poll as a safety net for missed events.
  useEffect(() => {
    const onChange = () => void refresh()
    const channel = supabase
      .channel(`draft_${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_rooms', filter: `id=eq.${id}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_members', filter: `draft_id=eq.${id}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${id}` }, onChange)
      .subscribe()
    const timer = window.setInterval(onChange, 4000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') onChange()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [supabase, id, refresh])

  const ordered = useMemo(() => inDraftOrder(members), [members])
  const me = members.find((m) => m.user_id === user?.id) ?? null
  const isHost = Boolean(me?.is_host)
  const isOwner = Boolean(room && user && room.owner_id === user.id)
  const n = members.length
  const pickNo = picks.length
  const total = room ? totalPicks(n, room.picks_per_team) : 0
  const onClock = room?.status === 'DRAFTING' ? memberOnClock(members, pickNo) : null
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

  // Tell the player when it becomes their turn.
  const wasMyTurn = useRef(false)
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      try {
        navigator.vibrate?.([120, 60, 120])
      } catch {
        // vibration is optional
      }
    }
    wasMyTurn.current = myTurn
    document.title = myTurn ? 'Your pick! · SMAT Draft' : 'SMAT 2026 Draft'
  }, [myTurn])

  async function call(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) {
      flash(error.message, true)
      await refresh()
      return false
    }
    if (ok) flash(ok)
    await refresh()
    return true
  }

  async function pick(player: DraftPoolPlayer) {
    const forWhom = onClock && me && onClock.id !== me.id ? ` for ${onClock.username}` : ''
    await call('draft_make_pick', { p_draft_id: id, p_player_id: player.id, p_pick_no: pickNo }, `Picked ${player.player_name}${forWhom}`)
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      flash(`${label} copied`)
    } catch {
      flash('Copy failed. Select and copy it by hand.', true)
    }
  }

  async function deleteDraft() {
    if (await call('draft_delete_room', { p_draft_id: id })) router.push('/dashboard')
  }

  if (loadError && !room) {
    return (
      <Shell>
        <div className={`${card} text-center`}>
          <p className="text-red-200 mb-4">{loadError}</p>
          <button type="button" onClick={() => router.push('/dashboard')} className={`${btn} bg-white/10 text-white`}>
            Back to dashboard
          </button>
        </div>
      </Shell>
    )
  }
  if (!loaded || !room) {
    return (
      <Shell>
        <p className="text-center text-white">Loading draft…</p>
      </Shell>
    )
  }

  const lobby = lobbyCheck(members)
  const { round, pickInRound } = roundOf(pickNo, Math.max(n, 1))
  const next = room.status === 'DRAFTING' ? upcomingPicks(members, pickNo + 1, room.picks_per_team, Math.min(n * 2, 12)) : []
  const canPick = room.status === 'DRAFTING' && (myTurn || isHost)
  const lastPick = picks[picks.length - 1]

  return (
    <Shell>
      {/* Header */}
      <div className={`${card} mb-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={() => router.push('/dashboard')} className="text-xs text-slate-400 hover:text-white mb-1">
              ← Dashboard
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">🏏 {room.name} · SMAT 2026 Draft</h1>
            <p className="text-xs text-slate-300 mt-1">
              <span className="font-mono">{room.room_code}</span> · {n}/{room.max_members} teams · {room.picks_per_team} picks each
              {me ? ` · you are ${me.username}` : ''}
            </p>
          </div>
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full ${
              room.status === 'DRAFTING' ? 'bg-emerald-500/20 text-emerald-200' : room.status === 'DONE' ? 'bg-slate-500/30 text-slate-200' : 'bg-yellow-500/20 text-yellow-200'
            }`}
          >
            {room.status === 'LOBBY' ? 'Lobby' : room.status === 'DRAFTING' ? 'Drafting' : 'Finished'}
          </span>
        </div>
        {room.status === 'LOBBY' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span>
              Key <span className="font-mono text-white">{room.room_key}</span>
            </span>
            <button
              type="button"
              onClick={() => void copy(`Join my SMAT 2026 draft\nRoom ID: ${room.room_code}\nRoom Key: ${room.room_key}`, 'Invite')}
              className="px-2 py-1 rounded-lg bg-white/10 border border-white/20 text-white hover:bg-white/20"
            >
              Copy invite
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={`mb-4 p-3 rounded-xl text-sm font-medium border ${notice.bad ? 'bg-red-500/20 text-red-100 border-red-500/50' : 'bg-emerald-500/20 text-emerald-100 border-emerald-500/50'}`}
        >
          {notice.text}
        </div>
      )}

      {room.status === 'LOBBY' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className={card}>
            <h2 className="text-lg font-bold text-white mb-1">Draft order</h2>
            <p className="text-xs text-slate-300 mb-4">
              The host spins the wheel. Each spin gives the next pick position to one of the players still on the wheel,
              until one is left. Then picks snake: 1, 2, 3 … then back 3, 2, 1.
            </p>
            <DraftWheel members={members} lastSpin={room.last_spin} />
            {isHost ? (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button type="button" disabled={busy || !lobby.canSpin} onClick={() => void call('draft_spin_wheel', { p_draft_id: id })} className={`${btn} bg-emerald-500 text-slate-900 hover:bg-emerald-400`}>
                  Spin the wheel
                </button>
                {lobby.canStart && (
                  <button type="button" disabled={busy} onClick={() => void call('draft_start', { p_draft_id: id }, 'The draft has started')} className={`${btn} bg-yellow-500 text-slate-900 hover:bg-yellow-400`}>
                    Start draft
                  </button>
                )}
                {members.some((m) => m.order_pos != null) && (
                  <button type="button" disabled={busy} onClick={() => void call('draft_reset_order', { p_draft_id: id }, 'Order cleared')} className={`${btn} bg-white/10 text-white hover:bg-white/20`}>
                    Reset order
                  </button>
                )}
              </div>
            ) : null}
            {lobby.reason && <p className="mt-3 text-center text-sm text-slate-300">{isHost ? lobby.reason : lobby.canStart ? 'Waiting for the host to start' : lobby.reason}</p>}
            {!lobby.reason && !isHost && <p className="mt-3 text-center text-sm text-slate-300">Order is set. Waiting for the host to start.</p>}
          </div>

          <div className={card}>
            <h2 className="text-lg font-bold text-white mb-3">Teams ({n})</h2>
            <ul className="space-y-2">
              {ordered.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl bg-slate-900/40 border border-slate-700 px-3 py-2">
                  <span className={`w-9 text-center text-sm font-bold ${m.order_pos ? 'text-emerald-300' : 'text-slate-500'}`}>{m.order_pos ? ordinal(m.order_pos) : '—'}</span>
                  <span className="flex-1 truncate text-white text-sm">
                    {m.username}
                    {m.user_id === user?.id && <span className="text-slate-400"> (you)</span>}
                  </span>
                  {m.user_id === room.owner_id && <span className="text-[10px] font-bold uppercase text-yellow-300">Host</span>}
                  {m.user_id !== room.owner_id && (isHost || m.user_id === user?.id) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void call('draft_remove_member', { p_draft_id: id, p_member_id: m.id }).then((ok) => ok && m.user_id === user?.id && router.push('/dashboard'))}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      {m.user_id === user?.id ? 'Leave' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">Removing or leaving clears the order, so the wheel is spun again.</p>
            <h3 className="mt-6 mb-2 text-sm font-semibold text-white">Player pool preview</h3>
            <DraftPool players={pool} pickedBy={pickedBy} canPick={false} pickLabel="" busy={false} onPick={() => {}} />
          </div>
        </div>
      ) : (
        <>
          {/* On the clock */}
          {room.status === 'DRAFTING' && onClock ? (
            <div className={`mb-4 rounded-2xl p-4 border ${myTurn ? 'bg-emerald-500/25 border-emerald-400 shadow-lg shadow-emerald-500/20' : 'bg-white/10 border-white/20'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-300">
                    Round {round} · pick {pickInRound} of {n} · overall {pickNo + 1} of {total}
                  </p>
                  <p className="text-xl font-bold text-white">{myTurn ? 'Your pick!' : `${onClock.username} is picking`}</p>
                  {!myTurn && isHost && <p className="text-xs text-slate-300">As host you can pick for them if they are away.</p>}
                </div>
                {lastPick && (
                  <p className="text-sm text-slate-200">
                    Last: <span className="font-semibold">{playersById.get(lastPick.player_id)?.player_name ?? '?'}</span> → {membersById.get(lastPick.member_id)?.username}
                  </p>
                )}
              </div>
              {next.length > 0 && (
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                  <span className="text-xs text-slate-400 self-center shrink-0">Next:</span>
                  {next.map((x) => (
                    <span key={x.pickNo} className={`shrink-0 text-xs px-2 py-1 rounded-lg ${x.member?.id === me?.id ? 'bg-emerald-500/30 text-emerald-100' : 'bg-slate-800/70 text-slate-200'}`}>
                      {x.member?.username ?? '?'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mb-4 rounded-2xl p-4 border bg-emerald-500/15 border-emerald-500/40">
              <p className="text-xl font-bold text-white">Draft complete</p>
              <p className="text-sm text-slate-200">All {total} picks are in.</p>
              <button
                type="button"
                onClick={() => void copy(draftSummaryText(room.name, members, picks, playersById), 'Teams')}
                className={`${btn} mt-3 bg-emerald-500 text-slate-900 hover:bg-emerald-400`}
              >
                Copy all teams
              </button>
            </div>
          )}

          <div role="tablist" className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-white/10 p-1">
            {([
              ['pool', 'Pool'],
              ['teams', 'Teams'],
              ['log', `Picks (${picks.length})`],
            ] as const).map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`py-2 rounded-lg text-sm font-semibold ${tab === t ? 'bg-emerald-500 text-slate-900' : 'text-slate-200 hover:bg-white/10'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className={card}>
            {tab === 'pool' && (
              <DraftPool
                players={pool}
                pickedBy={pickedBy}
                canPick={canPick}
                pickLabel={myTurn ? 'Pick' : `Pick for ${onClock?.username ?? ''}`}
                busy={busy}
                onPick={(p) => void pick(p)}
              />
            )}

            {tab === 'teams' && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ordered.map((m) => {
                  const mine = picks.filter((p) => p.member_id === m.id)
                  return (
                    <div key={m.id} className={`rounded-xl border p-3 ${onClock?.id === m.id ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-700 bg-slate-900/40'}`}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-semibold text-white truncate">
                          {m.order_pos}. {m.username}
                          {m.user_id === user?.id && <span className="text-slate-400 font-normal"> (you)</span>}
                        </span>
                        <span className="text-xs text-slate-400">
                          {mine.length}/{room.picks_per_team}
                        </span>
                      </div>
                      {mine.length === 0 ? (
                        <p className="text-xs text-slate-500">No picks yet</p>
                      ) : (
                        <ol className="space-y-1">
                          {mine.map((p) => {
                            const pl = playersById.get(p.player_id)
                            return (
                              <li key={p.id} className="text-sm text-slate-100 flex justify-between gap-2">
                                <span className="truncate">{pl?.player_name ?? '?'}</span>
                                <span className="text-xs text-slate-400 shrink-0">{pl?.team}</span>
                              </li>
                            )
                          })}
                        </ol>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'log' && (
              <ol className="divide-y divide-slate-700/70">
                {picks.length === 0 && <li className="py-4 text-center text-sm text-slate-400">No picks yet.</li>}
                {[...picks].reverse().map((p) => {
                  const pl = playersById.get(p.player_id)
                  const who = membersById.get(p.member_id)
                  const rr = roundOf(p.pick_no, n)
                  return (
                    <li key={p.id} className="py-2 flex items-center gap-3 text-sm">
                      <span className="w-14 shrink-0 text-xs text-slate-400">
                        R{rr.round}.{rr.pickInRound}
                      </span>
                      <span className="flex-1 truncate text-white">
                        {pl?.player_name ?? '?'} <span className="text-slate-400">({pl?.team})</span>
                      </span>
                      <span className="shrink-0 text-slate-200">{who?.username}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </>
      )}

      {/* Host tools */}
      {isHost && (
        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          {room.status !== 'LOBBY' && picks.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void call('draft_undo_pick', { p_draft_id: id }, 'Last pick undone')} className={`${btn} bg-white/10 text-white hover:bg-white/20`}>
              Undo last pick
            </button>
          )}
          {isOwner &&
            (confirmDelete ? (
              <>
                <button type="button" disabled={busy} onClick={() => void deleteDraft()} className={`${btn} bg-red-600 text-white hover:bg-red-500`}>
                  Delete for everyone
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className={`${btn} bg-white/10 text-white`}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className={`${btn} bg-red-500/20 text-red-200 border border-red-500/50 hover:bg-red-500/30`}>
                Delete draft
              </button>
            ))}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 p-3 sm:p-4">
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  )
}
