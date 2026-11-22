'use client'

import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConnectionState } from '@/components/room/ConnectionBanner'

export type RoomSyncHandlers = {
  /** live_auction_state changed (a bid, pause, new lot…); `row` is the new row when known. */
  onAuctionState: (row: { is_active?: boolean; current_player_id?: string } | undefined) => void
  onRoomUsers: () => void
  onRoom: () => void
  /** room_players changed (a sale, pass, undo, reset). Coalesced: one call per burst. */
  onRoomPlayers: () => void
  /** Refetch everything: after a reconnect, going online, or the tab waking up. */
  resync: () => void
  /** Light refresh of the live lot (safety net). */
  pollState: () => void
  /** Heavier refresh of people, players and room settings (safety net). */
  pollData: () => void
}

/** Safety-net polling: fast only while live updates are down. */
const POLL = {
  live: { state: 15000, data: 30000 },
  down: { state: 2500, data: 10000 },
}
const TICK_MS = 2500
const PLAYERS_DEBOUNCE_MS = 400

/**
 * Keeps an auction room in sync: one realtime channel for the room's tables, a
 * catch-up on reconnect / online / tab wake, and polling that runs fast only
 * while realtime is down (previously it polled every 2.5 s regardless).
 * Returns the connection state for the banner.
 */
export function useRoomSync(supabase: SupabaseClient, roomId: string | null, enabled: boolean, handlers: RoomSyncHandlers): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>('live')
  const connectionRef = useRef<ConnectionState>('live')
  const h = useRef(handlers)
  useEffect(() => {
    h.current = handlers
  })
  useEffect(() => {
    connectionRef.current = connection
  }, [connection])

  // Realtime channel and browser events.
  useEffect(() => {
    if (!roomId) return
    let playersTimer: number | undefined
    const playersChanged = () => {
      window.clearTimeout(playersTimer)
      playersTimer = window.setTimeout(() => h.current.onRoomPlayers(), PLAYERS_DEBOUNCE_MS)
    }
    const channel = supabase
      .channel(`auction_${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_auction_state', filter: `room_id=eq.${roomId}` }, (payload) =>
        h.current.onAuctionState((payload as { new?: { is_active?: boolean; current_player_id?: string } }).new)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_users', filter: `room_id=eq.${roomId}` }, () => h.current.onRoomUsers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => h.current.onRoom())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, playersChanged)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Rejoined after a drop: catch up on anything missed.
          if (connectionRef.current !== 'live') h.current.resync()
          setConnection(navigator.onLine ? 'live' : 'offline')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection(navigator.onLine ? 'reconnecting' : 'offline')
        }
      })

    const onOffline = () => setConnection('offline')
    const onOnline = () => {
      setConnection('reconnecting')
      h.current.resync()
    }
    // A sleeping phone tab misses events; refetch when it wakes up.
    const onVisible = () => {
      if (document.visibilityState === 'visible') h.current.resync()
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(playersTimer)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [supabase, roomId])

  // Safety-net polling, fast only while live updates are down.
  useEffect(() => {
    if (!roomId || !enabled) return
    let lastState = Date.now()
    let lastData = Date.now()
    const id = window.setInterval(() => {
      const every = connectionRef.current === 'live' ? POLL.live : POLL.down
      const now = Date.now()
      if (now - lastState >= every.state) {
        lastState = now
        h.current.pollState()
      }
      if (now - lastData >= every.data) {
        lastData = now
        h.current.pollData()
      }
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [roomId, enabled])

  return connection
}
