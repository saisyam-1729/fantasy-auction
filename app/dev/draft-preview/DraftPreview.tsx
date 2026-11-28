'use client'

import { useState } from 'react'
import DraftRoomView from '@/components/draft/DraftRoomView'
import { moveInList, type CaptainChoice, type WaiverClaim } from '@/lib/draft'
import type { DraftMember, DraftPick, DraftPoolPlayer, DraftRoom } from '@/lib/draft'
import fixture from './fixture.json'

const noop = () => {}

/** Sample draft for /dev/draft-preview: 7 teams, 12 picks each, real ILT20 pool. */
export default function DraftPreview({ state, me }: { state: 'lobby' | 'drafting' | 'done'; me: number }) {
  const [wish, setWish] = useState<number[]>(() => fixture.pool.slice(40, 44).map((p) => p.id))
  const myPicks = (fixture.picks as DraftPick[]).filter((p) => p.member_id === 'm' + me)
  const captains: CaptainChoice[] = [
    { member_id: 'm' + me, captain_id: myPicks[0]?.player_id ?? null, vice_id: myPicks[1]?.player_id ?? null, pending_captain_id: myPicks[2]?.player_id ?? null, pending_vice_id: null },
  ]
  const taken = new Set((fixture.picks as DraftPick[]).map((p) => p.player_id))
  const free = fixture.pool.filter((p) => !taken.has(p.id))
  const waivers: WaiverClaim[] = [
    { id: 1, draft_id: 'd1', member_id: 'm' + me, add_player_id: free[0]?.id ?? 0, drop_player_id: myPicks[3]?.player_id ?? 0, rank: 1, status: 'PENDING', note: null, processed_at: null },
    { id: 2, draft_id: 'd1', member_id: 'm2', add_player_id: free[1]?.id ?? 0, drop_player_id: (fixture.picks as DraftPick[])[1]?.player_id ?? 0, rank: 1, status: 'WON', note: null, processed_at: '2026-11-30T20:30:00Z' },
  ]
  const points = new Map(fixture.pool.map((p) => [p.id, (p.id * 37) % 90] as const))
  const identities: Record<string, Partial<DraftMember>> = {
    m1: { team_name: 'Asha Aces', team_emoji: '🦅', team_color: '#06b6d4' },
    m4: { team_name: 'Dev Dynamos', team_emoji: '⚡', team_color: '#eab308' },
    m6: { team_name: 'Farid FC', team_emoji: '🔥', team_color: '#ef4444' },
  }
  const members = (fixture.members as DraftMember[]).map((m) => ({ ...m, ...identities[m.id] }))
  const all = fixture.picks as DraftPick[]
  const picks = state === 'lobby' ? [] : state === 'done' ? all : all.slice(0, 31)
  const room: DraftRoom = {
    id: 'd1',
    room_code: 'Preview_101',
    room_key: '123456',
    name: 'Preview',
    pool: 'ILT20_2026',
    owner_id: 'u1',
    status: state === 'lobby' ? 'LOBBY' : state === 'done' ? 'DONE' : 'DRAFTING',
    picks_per_team: 12,
    max_members: 10,
    last_spin: null,
    started_at: null,
    pick_seconds: 60,
    captains_enabled: true,
    waivers_enabled: true,
  }
  return (
    <DraftRoomView
      room={room}
      members={state === 'lobby' ? members.map((m, i) => (i < 3 ? m : { ...m, order_pos: null })) : members}
      picks={picks}
      pool={fixture.pool as DraftPoolPlayer[]}
      userId={"u" + me}
      busy={false}
      notice={null}
      wishlist={{ ids: wish, toggle: (id) => setWish(wish.includes(id) ? wish.filter((x) => x !== id) : [...wish, id]), move: (id, dir) => setWish(moveInList(wish, id, dir)) }}
      points={points}
      captains={captains}
      waivers={waivers}
      secondsLeft={state === 'drafting' ? 42 : null}
      sound={{ enabled: false, toggle: noop }}
      actions={{ spin: noop, start: noop, resetOrder: noop, removeMember: noop, pick: noop, undo: noop, deleteDraft: noop, copyInvite: noop, copyTeams: noop, saveTeam: noop, saveCaptains: noop, setCaptainsEnabled: noop, saveClaims: noop, setWaiversEnabled: noop, runWaivers: noop, replacePick: noop, addPlayer: noop, resetPoints: noop }}
    />
  )
}
