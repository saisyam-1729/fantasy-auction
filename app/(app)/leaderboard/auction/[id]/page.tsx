'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from '@/components/shell/AppShell'
import LeaderboardView from '@/components/leaderboard/LeaderboardView'
import { PageHeader } from '@/components/ui'
import { eventForInventory } from '@/lib/events'

type Room = { room_name: string; room_id: string; player_inventory_type: string }

/** Fantasy leaderboard of an auction room: each team's bought players scored from the moment of the sale. */
export default function AuctionLeaderboardPage() {
  const { id } = useParams<{ id: string }>()
  const { supabase, user } = useSession()
  const [room, setRoom] = useState<Room | null>(null)

  useEffect(() => {
    let live = true
    void supabase
      .from('rooms')
      .select('room_name, room_id, player_inventory_type')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setRoom(data as Room | null)
      })
    return () => {
      live = false
    }
  }, [supabase, id])

  const event = eventForInventory(room?.player_inventory_type)
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`🏆 ${event ? `${event.name} Auction Leaderboard` : 'Auction Leaderboard'}`}
        subtitle={
          room && (
            <>
              {room.room_name} auction · <span className="font-mono">{room.room_id}</span>
            </>
          )
        }
        actions={
          <Link href={`/room/${id}`} className="rounded-xl bg-white/10 border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
            Auction room
          </Link>
        }
      />
      <LeaderboardView kind="auction" draftId={id} currentUserId={user.id} pool={room?.player_inventory_type} />
    </div>
  )
}
