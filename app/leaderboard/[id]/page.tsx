'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LeaderboardView from '@/components/leaderboard/LeaderboardView'
import { poolLabel } from '@/lib/events'

type Room = { name: string; pool: string; room_code: string }

export default function DraftLeaderboardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [userId, setUserId] = useState<string | null>(null)
  const [room, setRoom] = useState<Room | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.push('/auth')
        return
      }
      const { data: r } = await supabase.from('draft_rooms').select('name, pool, room_code').eq('id', id).maybeSingle()
      if (!live) return
      setUserId(data.user.id)
      setRoom(r as Room | null)
    })()
    return () => {
      live = false
    }
  }, [supabase, id, router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-sky-950 to-slate-900 p-3 sm:p-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4">
          <div className="flex flex-wrap gap-3 text-xs">
            <button type="button" onClick={() => router.push('/dashboard')} className="text-slate-400 hover:text-white">
              ← Dashboard
            </button>
            <button type="button" onClick={() => router.push(`/draft/${id}`)} className="text-slate-400 hover:text-white">
              Draft room
            </button>
          </div>
          <h1 className="mt-1 text-xl sm:text-2xl font-bold text-white">🏆 {room ? `${poolLabel(room.pool)} Leaderboard` : 'Leaderboard'}</h1>
          {room && (
            <p className="text-xs text-slate-300">
              {room.name} draft · <span className="font-mono">{room.room_code}</span>
            </p>
          )}
        </div>
        <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-3 sm:p-4">
          {userId && <LeaderboardView draftId={id} currentUserId={userId} />}
        </div>
      </div>
    </div>
  )
}
