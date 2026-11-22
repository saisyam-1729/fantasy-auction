'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from '@/components/shell/AppShell'
import DraftRoomView from '@/components/draft/DraftRoomView'
import { Button, Card } from '@/components/ui'
import { poolLabel } from '@/lib/events'
import { inviteText } from '@/lib/invite'
import {
  draftSummaryText,
  memberOnClock,
  moveInList,
  turnDeadline,
  type DraftMember,
  type DraftPick,
  type DraftPoolPlayer,
  type DraftRoom,
} from '@/lib/draft'
import { useSecondsLeft } from '@/hooks/useSecondsLeft'
import { useTurnSound } from '@/hooks/useTurnSound'
import { useWakeLock } from '@/hooks/useWakeLock'

/** Poll this often only while live updates are down; otherwise a slow safety refresh. */
const FALLBACK_POLL_MS = 4000
const SAFETY_POLL_MS = 30000

/** Draft room: loads and syncs the data and performs actions; DraftRoomView draws it. */
export default function DraftRoomPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { supabase, user } = useSession()

  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [members, setMembers] = useState<DraftMember[]>([])
  const [picks, setPicks] = useState<DraftPick[]>([])
  const [pool, setPool] = useState<DraftPoolPlayer[]>([])
  const [loadError, setLoadError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null)
  const [wishIds, setWishIds] = useState<number[]>([])
  const [points, setPoints] = useState<Map<number, number>>(new Map())

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
      return null
    }
    setLoadError('')
    setRoom(r.data as DraftRoom)
    setMembers((m.data ?? []) as DraftMember[])
    setPicks((p.data ?? []) as DraftPick[])
    return r.data as DraftRoom
  }, [supabase, id])

  const loadPool = useCallback(
    async (poolKey: string) => {
      const { data: players } = await supabase
        .from('draft_pool_players')
        .select('id, sort_no, team, player_name, role, captain, notes')
        .eq('pool', poolKey)
        .order('sort_no')
        .limit(2000)
      setPool((players ?? []) as DraftPoolPlayer[])
    },
    [supabase]
  )
  const loadPoints = useCallback(async () => {
    const { data } = await supabase.rpc('draft_pool_points', { p_draft_id: id })
    setPoints(new Map(((data ?? []) as { player_id: number; points: number }[]).map((p) => [Number(p.player_id), Number(p.points)])))
  }, [supabase, id])

  // First load: the room, then its pool (once; it only changes when a host adds a player).
  useEffect(() => {
    let live = true
    void (async () => {
      const r = await refresh()
      if (r?.pool && live) await loadPool(r.pool)
      // my wishlist (private by RLS) and the pool's fantasy points for this draft
      const [wl, pts] = await Promise.all([
        supabase.from('draft_wishlist').select('player_id, rank, draft_members!inner(draft_id)').eq('draft_members.draft_id', id).order('rank'),
        supabase.rpc('draft_pool_points', { p_draft_id: id }),
      ])
      if (!live) return
      setWishIds(((wl.data ?? []) as { player_id: number }[]).map((w) => Number(w.player_id)))
      setPoints(new Map(((pts.data ?? []) as { player_id: number; points: number }[]).map((p) => [Number(p.player_id), Number(p.points)])))
      setLoaded(true)
    })()
    return () => {
      live = false
    }
  }, [supabase, refresh, id, loadPool])

  // Live updates. Polling runs fast only while the live channel is down.
  const channelUp = useRef(false)
  useEffect(() => {
    const onChange = () => void refresh()
    const channel = supabase
      .channel(`draft_${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_rooms', filter: `id=eq.${id}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_members', filter: `draft_id=eq.${id}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${id}` }, onChange)
      .subscribe((status) => {
        const up = status === 'SUBSCRIBED'
        // catch up on anything missed while the channel was down
        if (up && !channelUp.current) onChange()
        channelUp.current = up
      })
    let lastPoll = Date.now()
    const timer = window.setInterval(() => {
      const wait = channelUp.current ? SAFETY_POLL_MS : FALLBACK_POLL_MS
      if (Date.now() - lastPoll >= wait) {
        lastPoll = Date.now()
        onChange()
      }
    }, FALLBACK_POLL_MS)
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

  const me = members.find((m) => m.user_id === user.id) ?? null
  const onClock = room?.status === 'DRAFTING' ? memberOnClock(members, picks.length) : null
  const myTurn = Boolean(onClock && me && onClock.id === me.id)

  // Pick timer: when a timed turn runs out, ask the database to auto-pick (once per
  // pick, after a small random delay so seven screens don't all ask at once).
  const deadline = room ? turnDeadline(room) : null
  const secondsLeft = useSecondsLeft(deadline)
  const autoAsked = useRef(-1)
  useEffect(() => {
    if (secondsLeft !== 0 || !room || room.status !== 'DRAFTING' || autoAsked.current === picks.length) return
    autoAsked.current = picks.length
    const pickNo = picks.length
    const t = window.setTimeout(() => {
      void supabase.rpc('draft_auto_pick', { p_draft_id: id, p_pick_no: pickNo }).then(() => refresh())
    }, 300 + Math.random() * 1500)
    return () => window.clearTimeout(t)
  }, [secondsLeft, room, picks.length, supabase, id, refresh])

  const sound = useTurnSound(myTurn)
  useWakeLock(room?.status === 'DRAFTING')

  // Wishlist: update the screen at once, then save the whole list.
  const saveWish = useCallback(
    (next: number[]) => {
      setWishIds(next)
      void supabase.rpc('draft_set_wishlist', { p_draft_id: id, p_player_ids: next }).then(({ error }) => {
        if (error) flash('Could not save your list: ' + error.message, true)
      })
    },
    [supabase, id, flash]
  )
  const wishlist = useMemo(
    () =>
      me
        ? {
            ids: wishIds,
            toggle: (playerId: number) => saveWish(wishIds.includes(playerId) ? wishIds.filter((x) => x !== playerId) : [...wishIds, playerId]),
            move: (playerId: number, dir: -1 | 1) => saveWish(moveInList(wishIds, playerId, dir)),
          }
        : undefined,
    [me, wishIds, saveWish]
  )

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
    document.title = myTurn ? `Your pick! · ${poolLabel(room?.pool)} Draft` : `${poolLabel(room?.pool)} Draft`
  }, [myTurn, room?.pool])

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

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      flash(`${label} copied`)
    } catch {
      flash('Copy failed. Select and copy it by hand.', true)
    }
  }

  if (loadError && !room) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="text-red-200 mb-4">{loadError}</p>
        <Button onClick={() => router.push('/dashboard')}>Back to Home</Button>
      </Card>
    )
  }
  if (!loaded || !room) return <p className="py-20 text-center text-slate-300">Loading draft…</p>

  const playersById = new Map(pool.map((p) => [p.id, p]))

  return (
    <DraftRoomView
      room={room}
      members={members}
      picks={picks}
      pool={pool}
      userId={user.id}
      busy={busy}
      notice={notice}
      wishlist={wishlist}
      points={points}
      secondsLeft={secondsLeft}
      sound={sound}
      actions={{
        spin: () => void call('draft_spin_wheel', { p_draft_id: id }),
        start: () => void call('draft_start', { p_draft_id: id }, 'The draft has started'),
        resetOrder: () => void call('draft_reset_order', { p_draft_id: id }, 'Order cleared'),
        removeMember: (m) =>
          void call('draft_remove_member', { p_draft_id: id, p_member_id: m.id }).then((ok) => {
            if (ok && m.user_id === user.id) router.push('/dashboard')
          }),
        pick: (player) => {
          const forWhom = onClock && me && onClock.id !== me.id ? ` for ${onClock.username}` : ''
          void call('draft_make_pick', { p_draft_id: id, p_player_id: player.id, p_pick_no: picks.length }, `Picked ${player.player_name}${forWhom}`)
        },
        undo: () => void call('draft_undo_pick', { p_draft_id: id }, 'Last pick undone'),
        deleteDraft: () =>
          void call('draft_delete_room', { p_draft_id: id }).then((ok) => {
            if (ok) router.push('/dashboard')
          }),
        copyInvite: () => void copy(inviteText(window.location.origin, `${poolLabel(room.pool)} draft`, room.room_code, room.room_key), 'Invite'),
        copyTeams: () => void copy(draftSummaryText(room.name, members, picks, playersById), 'Teams'),
        replacePick: (pickNo, playerId) =>
          void call('draft_host_replace_pick', { p_draft_id: id, p_pick_no: pickNo, p_player_id: playerId }, `Pick #${pickNo + 1} changed`),
        addPlayer: (team, name, role) =>
          void call('draft_host_add_player', { p_draft_id: id, p_team: team, p_name: name, p_role: role }, `${name} added to the pool`).then((ok) => {
            if (ok) void loadPool(room.pool)
          }),
        resetPoints: () => void call('draft_host_reset_points', { p_draft_id: id }, 'Points reset: only points from now on count').then(() => void loadPoints()),
      }}
    />
  )
}
