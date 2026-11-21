'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type JoinableRoom = {
  id: string
  room_id: string
  room_name: string
  player_count: number
  max_players: number
  player_inventory_type: string
  status: string
}

const field =
  'w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition'

/**
 * Join an auction room: a list of open lobbies plus Room ID and key. `include`
 * limits the list to some player lists (an event shows only its own rooms).
 */
export default function JoinAuctionRoom({
  include,
  title = 'Join Room',
  onBack,
}: {
  include?: (inventoryType: string) => boolean
  title?: string
  onBack: () => void
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [roomId, setRoomId] = useState('')
  const [roomKey, setRoomKey] = useState('')
  const [joining, setJoining] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [rooms, setRooms] = useState<JoinableRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    void supabase.rpc('list_joinable_rooms').then(({ data, error: err }) => {
      if (!live) return
      setError(err ? err.message : null)
      setRooms(err ? [] : ((data ?? []) as JoinableRoom[]))
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [supabase, reload])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rooms.filter(
      (r) =>
        (!include || include(r.player_inventory_type)) &&
        (!q || r.room_id.toLowerCase().includes(q) || r.room_name.toLowerCase().includes(q) || r.player_inventory_type.toLowerCase().includes(q))
    )
  }, [rooms, search, include])

  async function join() {
    if (!roomId || !roomKey) {
      setMessage('Please enter both Room ID and Room Key')
      return
    }
    setJoining(true)
    setMessage('')
    // The database checks the key, capacity and membership, and adds the user.
    const { data: roomUuid, error: joinError } = await supabase.rpc('join_room', { p_room_id: roomId.trim(), p_room_key: roomKey.trim() })
    if (joinError || !roomUuid) {
      const msg = joinError?.message ?? ''
      setMessage(/Invalid Room ID|Room is full/i.test(msg) ? msg : 'Error joining room: ' + (msg || 'unknown error'))
      setJoining(false)
      return
    }
    setMessage('Joined! Opening room...')
    router.push(`/room/${roomUuid}`)
  }

  const good = /Joined|Selected/.test(message)

  return (
    <div className="max-w-4xl mx-auto w-full backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-8">
      <button type="button" onClick={onBack} className="mb-6 text-slate-300 hover:text-white transition flex items-center gap-2">
        ← Back
      </button>

      <h2 className="text-3xl font-bold text-white mb-2">{title}</h2>
      <p className="text-slate-400 text-sm mb-6">Open rooms waiting for players (max 10). Tap a row to fill Room ID, then enter the key from the host.</p>

      {message && (
        <div
          className={`mb-6 p-4 rounded-xl text-sm font-medium ${
            good ? 'bg-green-500/20 text-green-200 border border-green-500/50' : 'bg-red-500/20 text-red-200 border border-red-500/50'
          }`}
        >
          {message}
        </div>
      )}

      <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <label className="block text-sm font-medium text-slate-300 sm:sr-only">Search rooms</label>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by room ID or name…"
          className="w-full sm:flex-1 px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
        />
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            setReload((n) => n + 1)
          }}
          disabled={loading}
          className="px-4 py-3 rounded-xl border border-white/20 text-white hover:bg-white/10 transition shrink-0 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh list'}
        </button>
      </div>

      <div className="mb-8 max-h-64 overflow-y-auto rounded-xl border border-slate-600 bg-slate-900/40">
        {loading && rooms.length === 0 ? (
          <div className="p-6 text-slate-400 text-center">Loading open rooms…</div>
        ) : error ? (
          <div className="p-4 text-red-300 text-sm">{error}</div>
        ) : shown.length === 0 ? (
          <div className="p-6 text-slate-400 text-center text-sm">No matching open rooms. Ask the host for Room ID and key, or create a room.</div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {shown.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setRoomId(r.room_id)
                    setMessage(`Selected “${r.room_name}”. Enter the 6-digit room key from the host below.`)
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-white/5 transition flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="font-mono font-semibold text-yellow-300">{r.room_id}</span>
                  <span className="text-slate-300 text-sm">{r.room_name}</span>
                  <span className="text-slate-500 text-xs ml-auto">
                    {r.player_count}/{r.max_players} · {r.player_inventory_type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Room ID</label>
          <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="e.g. IPL2025_123" className={field} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Room Key (6 digits)</label>
          <input type="text" value={roomKey} onChange={(e) => setRoomKey(e.target.value)} placeholder="e.g. 123456" maxLength={6} className={field} />
        </div>
        <button
          type="button"
          onClick={() => void join()}
          disabled={joining}
          className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 font-bold rounded-xl hover:from-yellow-400 hover:to-orange-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          {joining ? 'Joining...' : 'Join Room'}
        </button>
      </div>
    </div>
  )
}
