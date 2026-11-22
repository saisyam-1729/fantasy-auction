'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from '@/components/shell/AppShell'
import LeaderboardView from '@/components/leaderboard/LeaderboardView'
import { PageHeader } from '@/components/ui'
import { poolLabel } from '@/lib/events'

type Room = { name: string; pool: string; room_code: string }

export default function DraftLeaderboardPage() {
  const { id } = useParams<{ id: string }>()
  const { supabase, user } = useSession()
  const [room, setRoom] = useState<Room | null>(null)

  useEffect(() => {
    let live = true
    void supabase
      .from('draft_rooms')
      .select('name, pool, room_code')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setRoom(data as Room | null)
      })
    return () => {
      live = false
    }
  }, [supabase, id])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`🏆 ${room ? `${poolLabel(room.pool)} Leaderboard` : 'Leaderboard'}`}
        subtitle={
          room && (
            <>
              {room.name} draft · <span className="font-mono">{room.room_code}</span>
            </>
          )
        }
        actions={
          <Link href={`/draft/${id}`} className="rounded-xl bg-white/10 border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
            Draft room
          </Link>
        }
      />
      <LeaderboardView draftId={id} currentUserId={user.id} />
    </div>
  )
}
