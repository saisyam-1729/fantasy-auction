'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/components/shell/AppShell'
import { Badge, Button, Card, PageHeader } from '@/components/ui'
import { EVENTS, eventForInventory, poolLabel } from '@/lib/events'
import { MEDALS, formatPoints, pointsGain, rankMove, type Leaderboard } from '@/lib/fantasyPoints'
import type { DraftStatus } from '@/lib/draft'
import { useRouter } from 'next/navigation'

type RoomItem = {
  kind: 'draft' | 'auction'
  id: string
  code: string
  name: string
  event: string
  status: string
  tone: 'green' | 'yellow' | 'grey' | 'sky'
  at: string
}

type Standing = { draftId: string; event: string; name: string; rank: number; teams: number; points: number; move: number | null; gain: number | null }

const DRAFT_STATUS: Record<DraftStatus, [string, RoomItem['tone']]> = {
  LOBBY: ['Lobby', 'yellow'],
  DRAFTING: ['Drafting', 'green'],
  DONE: ['Finished', 'grey'],
}

/** Home: everything you're part of, where you stand, and how to start something new. */
export default function HomePage() {
  const router = useRouter()
  const { supabase, user, username } = useSession()
  const [rooms, setRooms] = useState<RoomItem[] | null>(null)
  const [standings, setStandings] = useState<Standing[] | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const [drafts, auctions] = await Promise.all([
        supabase.from('draft_rooms').select('id, room_code, name, pool, status, created_at').order('created_at', { ascending: false }).limit(30),
        supabase.from('rooms').select('id, room_id, room_name, player_inventory_type, created_at').order('created_at', { ascending: false }).limit(30),
      ])
      if (!live) return
      const items: RoomItem[] = [
        ...(drafts.data ?? []).map((d) => {
          const [status, tone] = DRAFT_STATUS[d.status as DraftStatus] ?? ['', 'grey']
          return { kind: 'draft' as const, id: d.id, code: d.room_code, name: d.name, event: poolLabel(d.pool), status, tone, at: d.created_at }
        }),
        ...(auctions.data ?? []).map((r) => ({
          kind: 'auction' as const,
          id: r.id,
          code: r.room_id,
          name: r.room_name,
          event: eventForInventory(r.player_inventory_type)?.name ?? r.player_inventory_type,
          status: 'Auction',
          tone: 'sky' as const,
          at: r.created_at,
        })),
      ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      setRooms(items)

      const started = (drafts.data ?? []).filter((d) => d.status !== 'LOBBY')
      const boards = await Promise.all(
        started.map(async (d) => {
          const { data } = await supabase.rpc('draft_leaderboard', { p_draft_id: d.id })
          const board = data as Leaderboard | null
          const me = board?.rows.find((r) => r.user_id === user.id)
          if (!board || !me) return null
          return {
            draftId: d.id,
            event: poolLabel(d.pool),
            name: d.name,
            rank: me.rank,
            teams: board.rows.length,
            points: Number(me.points),
            move: rankMove(me),
            gain: pointsGain(me),
          } satisfies Standing
        })
      )
      if (live) setStandings(boards.filter((b): b is Standing => b !== null))
    })()
    return () => {
      live = false
    }
  }, [supabase, user.id])

  return (
    <div>
      <PageHeader
        title={`Hi, ${username}`}
        subtitle="Your rooms, your standings, and new events."
        actions={
          <>
            <Button tone="ghost" onClick={() => router.push('/join')}>
              Join a room
            </Button>
            <Button tone="board" onClick={() => router.push('/events')}>
              + New room
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" as="section">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Your rooms</h2>
          {rooms == null ? (
            <p className="text-sm text-slate-300">Loading…</p>
          ) : rooms.length === 0 ? (
            <p className="text-sm text-slate-300">
              Nothing yet. <Link href="/events" className="text-sky-300 underline">Pick an event</Link> to create a room, or join one with a code.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {rooms.map((r) => (
                <li key={r.kind + r.id}>
                  <Link
                    href={r.kind === 'draft' ? `/draft/${r.id}` : `/room/${r.id}`}
                    className="flex h-full items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2.5 hover:bg-white/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-white">{r.event}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {r.kind === 'draft' ? 'Draft' : 'Auction'} · <span className="font-mono">{r.code}</span>
                      </span>
                    </span>
                    <Badge tone={r.tone}>{r.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card as="section">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Standings</h2>
              <Link href="/leaderboard" className="text-xs text-sky-300 hover:underline">
                All →
              </Link>
            </div>
            {standings == null ? (
              <p className="text-sm text-slate-300">Loading…</p>
            ) : standings.length === 0 ? (
              <p className="text-sm text-slate-300">Leaderboards appear here once one of your drafts starts.</p>
            ) : (
              <ul className="space-y-2">
                {standings.map((s) => (
                  <li key={s.draftId}>
                    <Link href={`/leaderboard/${s.draftId}`} className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2.5 hover:bg-white/5">
                      <span className="w-9 text-center text-xl">{s.points > 0 && MEDALS[s.rank] ? MEDALS[s.rank] : <span className="text-base font-bold text-slate-200">{s.rank}</span>}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">{s.event}</span>
                        <span className="block text-xs text-slate-400">
                          {s.rank} of {s.teams} · {s.name}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block font-bold text-white">{formatPoints(s.points)}</span>
                        <span className="block text-[11px]">
                          {s.move != null && s.move !== 0 && (
                            <span className={s.move > 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {s.move > 0 ? '▲' : '▼'}
                              {Math.abs(s.move)}{' '}
                            </span>
                          )}
                          {s.gain != null && s.gain !== 0 && <span className="text-emerald-300">+{formatPoints(s.gain)}</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card as="section">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Events</h2>
            <ul className="space-y-2">
              {EVENTS.map((e) => (
                <li key={e.id}>
                  <Link href={`/events?e=${e.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/5">
                    <span className="font-semibold text-white">{e.name}</span>
                    <span className="text-xs text-slate-400">{e.formats.map((f) => (f === 'auction' ? 'Auction' : 'Draft')).join(' · ')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
