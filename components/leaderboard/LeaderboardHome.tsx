'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { auctionHasLeaderboard, eventForInventory, poolLabel } from '@/lib/events'
import { PageHeader } from '@/components/ui'

type MyEvent = { kind: 'draft' | 'auction'; id: string; code: string; name: string; label: string; at: string }

/** The Leaderboard tab: sub-tabs (Events for now) listing the events you took part in. */
export default function LeaderboardHome() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [events, setEvents] = useState<MyEvent[] | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([
      supabase.from('draft_rooms').select('id, room_code, name, pool, status, started_at, created_at').neq('status', 'LOBBY'),
      supabase.from('rooms').select('id, room_id, room_name, player_inventory_type, created_at'),
    ]).then(([drafts, auctions]) => {
      if (!live) return
      const items: MyEvent[] = [
        ...(drafts.data ?? []).map((d) => ({
          kind: 'draft' as const,
          id: d.id as string,
          code: d.room_code as string,
          name: d.name as string,
          label: poolLabel(d.pool as string),
          at: ((d.started_at ?? d.created_at) as string) ?? '',
        })),
        ...(auctions.data ?? [])
          .filter((r) => auctionHasLeaderboard(r.player_inventory_type as string))
          .map((r) => ({
            kind: 'auction' as const,
            id: r.id as string,
            code: r.room_id as string,
            name: r.room_name as string,
            label: eventForInventory(r.player_inventory_type as string)?.name ?? (r.player_inventory_type as string),
            at: (r.created_at as string) ?? '',
          })),
      ].sort((a, b) => b.at.localeCompare(a.at))
      setEvents(items)
    })
    return () => {
      live = false
    }
  }, [supabase])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="🏆 Leaderboards" subtitle="Fantasy standings for the events you drafted in. Points update every night." />
      <div role="tablist" className="mb-4 inline-flex rounded-xl bg-white/10 p-1">
        <button type="button" role="tab" aria-selected className="px-4 py-1.5 rounded-lg bg-sky-500 text-slate-900 text-sm font-semibold">
          Events
        </button>
      </div>

      {events == null ? (
        <p className="text-slate-300 text-sm">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-slate-300 text-sm">You haven’t taken part in an event yet. Leaderboards appear here once a draft starts, or once you join an ILT20 auction.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {events.map((e) => (
            <li key={e.kind + e.id}>
              <button
                type="button"
                onClick={() => router.push(e.kind === 'draft' ? `/leaderboard/${e.id}` : `/leaderboard/auction/${e.id}`)}
                className="w-full rounded-2xl border border-slate-600 bg-slate-900/40 px-4 py-3 text-left hover:bg-white/5 transition flex items-center justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block font-bold text-white truncate">{e.label}</span>
                  <span className="block text-xs text-slate-400 truncate">
                    {e.name} {e.kind} · <span className="font-mono">{e.code}</span>
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-sky-300">Leaderboard →</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
