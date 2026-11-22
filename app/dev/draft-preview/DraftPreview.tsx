'use client'

import { useState } from 'react'
import DraftRoomView from '@/components/draft/DraftRoomView'
import { moveInList } from '@/lib/draft'
import type { DraftMember, DraftPick, DraftPoolPlayer, DraftRoom } from '@/lib/draft'
import fixture from './fixture.json'

const noop = () => {}

/** Sample draft for /dev/draft-preview: 7 teams, 12 picks each, real ILT20 pool. */
export default function DraftPreview({ state, me }: { state: 'lobby' | 'drafting' | 'done'; me: number }) {
  const [wish, setWish] = useState<number[]>(() => fixture.pool.slice(40, 44).map((p) => p.id))
  const points = new Map(fixture.pool.map((p) => [p.id, (p.id * 37) % 90] as const))
  const members = fixture.members as DraftMember[]
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
      secondsLeft={state === 'drafting' ? 42 : null}
      sound={{ enabled: false, toggle: noop }}
      actions={{ spin: noop, start: noop, resetOrder: noop, removeMember: noop, pick: noop, undo: noop, deleteDraft: noop, copyInvite: noop, copyTeams: noop, replacePick: noop, addPlayer: noop, resetPoints: noop }}
    />
  )
}
