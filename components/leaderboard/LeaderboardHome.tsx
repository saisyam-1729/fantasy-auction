'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { poolLabel } from '@/lib/events'
import type { DraftStatus } from '@/lib/draft'

type MyEvent = { id: string; room_code: string; name: string; pool: string; status: DraftStatus; started_at: string | null }

const card = 'backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-5 sm:p-6'

/** The Leaderboard tab: sub-tabs (Events for now) listing the events you took part in. */
export default function LeaderboardHome() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [events, setEvents] = useState<MyEvent[] | null>(null)

  useEffect(() => {
    let live = true
    void supabase
      .from('draft_rooms')
      .select('id, room_code, name, pool, status, started_at')
      .neq('status', 'LOBBY')
      .order('started_at', { ascending: false })
      .then(({ data }) => {
        if (live) setEvents((data ?? []) as MyEvent[])
      })
    return () => {
      live = false
    }
  }, [supabase])

  return (
    <div className={card}>
      <div role="tablist" className="mb-5 inline-flex rounded-xl bg-slate-900/50 p-1">
        <button type="button" role="tab" aria-selected className="px-4 py-1.5 rounded-lg bg-sky-500 text-slate-900 text-sm font-semibold">
          Events
        </button>
      </div>

      {events == null ? (
        <p className="text-slate-300 text-sm">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-slate-300 text-sm">You haven’t taken part in an event draft yet. Leaderboards appear here once a draft starts.</p>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => router.push(`/leaderboard/${e.id}`)}
                className="w-full rounded-2xl border border-slate-600 bg-slate-900/40 px-4 py-3 text-left hover:bg-white/5 transition flex items-center justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block font-bold text-white truncate">{poolLabel(e.pool)}</span>
                  <span className="block text-xs text-slate-400 truncate">
                    {e.name} draft · <span className="font-mono">{e.room_code}</span>
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
