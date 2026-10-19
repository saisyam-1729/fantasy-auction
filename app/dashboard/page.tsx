'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_MIN_SQUAD, DEFAULT_MAX_SQUAD } from '@/lib/purse'
import { DEFAULT_FORM, parseSettingsForm, type SettingsForm } from '@/lib/roomSettings'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'

type JoinableRoom = {
  id: string
  room_id: string
  room_name: string
  player_count: number
  max_players: number
  player_inventory_type: string
  status: string
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'menu' | 'create' | 'join'>('menu')
  
  // Create Room State
  const [roomName, setRoomName] = useState('')
  const [inventoryType, setInventoryType] = useState('IPL')
  const [minSquadSize, setMinSquadSize] = useState(String(DEFAULT_MIN_SQUAD))
  const [maxSquadSize, setMaxSquadSize] = useState(String(DEFAULT_MAX_SQUAD))
  const [autoHammer, setAutoHammer] = useState(false)
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(DEFAULT_FORM)
  const [creating, setCreating] = useState(false)
  const [createMessage, setCreateMessage] = useState('')
  
  // Join Room State
  const [joinRoomId, setJoinRoomId] = useState('')
  const [joinRoomKey, setJoinRoomKey] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinMessage, setJoinMessage] = useState('')
  const [joinSearch, setJoinSearch] = useState('')
  const [joinLobbyRooms, setJoinLobbyRooms] = useState<JoinableRoom[]>([])
  const [joinLobbyLoading, setJoinLobbyLoading] = useState(false)
  const [joinLobbyError, setJoinLobbyError] = useState<string | null>(null)
  const [copyToast, setCopyToast] = useState('')
  
  // Created Room Details
  // const [createdRoom, setCreatedRoom] = useState<{roomId: string, roomKey: string} | null>(null)
  const [createdRoom, setCreatedRoom] = useState<{roomId: string, roomKey: string, uuid: string} | null>(null)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    void checkUser()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once; supabase client is stable
  }, [])

  async function loadJoinableRooms() {
    setJoinLobbyLoading(true)
    setJoinLobbyError(null)
    const { data, error } = await supabase.rpc('list_joinable_rooms')
    if (error) {
      setJoinLobbyError(
        error.message +
          ' — In Supabase → SQL Editor, run `supabase/FIX_READY_BUTTON.sql` (includes list_joinable_rooms).'
      )
      setJoinLobbyRooms([])
    } else {
      setJoinLobbyRooms((data ?? []) as JoinableRoom[])
    }
    setJoinLobbyLoading(false)
  }

  useEffect(() => {
    if (view !== 'join') return
    void loadJoinableRooms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const filteredLobbyRooms = useMemo(() => {
    const q = joinSearch.trim().toLowerCase()
    if (!q) return joinLobbyRooms
    return joinLobbyRooms.filter(
      (r) =>
        r.room_id.toLowerCase().includes(q) ||
        r.room_name.toLowerCase().includes(q) ||
        r.player_inventory_type.toLowerCase().includes(q)
    )
  }, [joinLobbyRooms, joinSearch])

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyToast(`${label} copied`)
      setTimeout(() => setCopyToast(''), 2200)
    } catch {
      setCopyToast('Copy failed — select and copy manually')
      setTimeout(() => setCopyToast(''), 3000)
    }
  }

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth')
      return
    }
    setUser(user)
    setLoading(false)
  }

  async function handleCreateRoom() {
    // Validate room name
    if (!/^[a-zA-Z0-9]+$/.test(roomName)) {
      setCreateMessage('Room name must be alphanumeric only (no spaces or special characters)')
      return
    }

    if (roomName.length < 3) {
      setCreateMessage('Room name must be at least 3 characters')
      return
    }

    const minSquad = Number(minSquadSize)
    const maxSquad = Number(maxSquadSize)
    if (!Number.isInteger(minSquad) || !Number.isInteger(maxSquad) || minSquad < 1 || maxSquad > 30 || minSquad > maxSquad) {
      setCreateMessage('Squad size must be whole numbers from 1 to 30, and the minimum cannot be above the maximum.')
      return
    }

    const parsed = parseSettingsForm(settingsForm)
    if (!parsed.ok) {
      setCreateMessage(parsed.error)
      return
    }
    const roomSettings = parsed.settings

    setCreating(true)
    setCreateMessage('')

    try {
      // Generate room_id and room_key
      const randomNum = Math.floor(Math.random() * 999) + 1
      const roomId = `${roomName}_${randomNum}`
      const roomKey = Math.floor(100000 + Math.random() * 900000).toString()

      // Create room
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .insert({
          room_name: roomName,
          room_id: roomId,
          room_key: roomKey,
          admin_user_id: user?.id,
          player_inventory_type: inventoryType,
          status: 'WAITING',
          max_players: 10,
          min_squad_size: minSquad,
          max_squad_size: maxSquad,
          auto_hammer: autoHammer,
          budget: roomSettings.budget,
          bid_timer_seconds: roomSettings.timerSeconds,
          slab_config: roomSettings.slabs,
        })
        .select()
        .single()

      if (roomError) {
        if (roomError.code === '23505') { // Unique constraint violation
          setCreateMessage('Room name already exists. Try a different name.')
        } else {
          const hint = /min_squad_size|max_squad_size/i.test(roomError.message)
            ? ' Run supabase/auction_bid_slabs.sql in the Supabase SQL Editor.'
            : ''
          setCreateMessage('Error creating room: ' + roomError.message + hint)
        }
        setCreating(false)
        return
      }

      // Add user as admin in room_users
      const username = user?.user_metadata?.username || user?.email?.split('@')[0] || 'user'
      
      const { error: userError } = await supabase
        .from('room_users')
        .insert({
          room_id: room.id,
          user_id: user?.id,
          username: username,
          is_admin: true,
          display_name: `${roomId}_${username}`,
          ready_to_start: false,
        })

      if (userError) {
        setCreateMessage('Error joining room: ' + userError.message)
        setCreating(false)
        return
      }

      const { error: liveStateError } = await supabase.from('live_auction_state').insert({
        room_id: room.id,
        is_active: false,
      })
      if (liveStateError) {
        setCreateMessage('Error setting up auction: ' + liveStateError.message)
        setCreating(false)
        return
      }

      const { error: rpcError } = await supabase.rpc('initialize_room_players', {
        p_room_id: room.id,
        p_inventory_type: inventoryType
      })
      if (rpcError) {
        setCreateMessage('Error loading player list: ' + rpcError.message + ' (check SQL function `initialize_room_players` in Supabase)')
        setCreating(false)
        return
      }

      // setCreatedRoom({ roomId, roomKey })
      setCreatedRoom({ roomId, roomKey, uuid: room.id })
      setCreateMessage('Room created successfully!')
      
    } catch (error: unknown) {
      setCreateMessage('Error: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setCreating(false)
    }
  }

  async function handleJoinRoom() {
    if (!joinRoomId || !joinRoomKey) {
      setJoinMessage('Please enter both Room ID and Room Key')
      return
    }

    setJoining(true)
    setJoinMessage('')

    try {
      // The database checks the key, capacity and membership, and adds the user.
      const { data: roomUuid, error: joinError } = await supabase.rpc('join_room', {
        p_room_id: joinRoomId.trim(),
        p_room_key: joinRoomKey.trim(),
      })

      if (joinError || !roomUuid) {
        const msg = joinError?.message ?? ''
        const known = /Invalid Room ID|Room is full/i.test(msg)
        setJoinMessage(known ? msg : 'Error joining room: ' + (msg || 'unknown error'))
        setJoining(false)
        return
      }

      setJoinMessage('Joined! Opening room...')
      router.push(`/room/${roomUuid}`)
    } catch (error: unknown) {
      console.error('Catch block error:', error)
      setJoinMessage('Error: ' + (error instanceof Error ? error.message : String(error)))
      setJoining(false)
    }
  }
  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="flex justify-between items-center backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4">
          <div>
            <h1 className="text-2xl font-bold text-white">🏏 IPL Auction</h1>
            <p className="text-slate-300 text-sm">Welcome, {user?.user_metadata?.username || user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-xl hover:bg-red-500 hover:text-white transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto">
        
        {/* Menu View */}
        {view === 'menu' && !createdRoom && (
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-white mb-2">Choose an Option</h2>
              <p className="text-slate-300">Create a new room or join an existing auction</p>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => setView('create')}
                className="w-full p-6 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 rounded-2xl hover:from-yellow-400 hover:to-orange-400 transition transform hover:scale-[1.02] active:scale-[0.98] shadow-lg"
              >
                <div className="text-2xl font-bold mb-1">Create New Room</div>
                <div className="text-sm opacity-80">Start a new auction as host</div>
              </button>

              <button
                onClick={() => setView('join')}
                className="w-full p-6 backdrop-blur-xl bg-white/10 border-2 border-white/30 text-white rounded-2xl hover:bg-white/20 transition transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="text-2xl font-bold mb-1">Join Existing Room</div>
                <div className="text-sm text-slate-300">Browse open rooms or enter ID and key</div>
              </button>
            </div>
          </div>
        )}

        {/* Create Room View */}
        {view === 'create' && !createdRoom && (
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-8">
            <button
              onClick={() => setView('menu')}
              className="mb-6 text-slate-300 hover:text-white transition flex items-center gap-2"
            >
              ← Back
            </button>

            <h2 className="text-3xl font-bold text-white mb-6">Create New Room</h2>

            {createMessage && (
              <div className={`mb-6 p-4 rounded-xl text-sm font-medium ${
                createMessage.includes('success') 
                  ? 'bg-green-500/20 text-green-200 border border-green-500/50'
                  : 'bg-red-500/20 text-red-200 border border-red-500/50'
              }`}>
                {createMessage}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Room Name
                </label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. IPL2025, MyAuction"
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition"
                />
                <p className="text-xs text-slate-400 mt-1">Alphanumeric only (no spaces or special characters)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Player Inventory
                </label>
                <select
                  value={inventoryType}
                  onChange={(e) => setInventoryType(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-yellow-500 transition"
                >
                  <option value="IPL">IPL (Domestic)</option>
                  <option value="T20_WC">T20 World Cup (International)</option>
                  <option value="ODI_WC">ODI World Cup (International)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Minimum squad
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={minSquadSize}
                    onChange={(e) => setMinSquadSize(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Maximum squad
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={maxSquadSize}
                    onChange={(e) => setMaxSquadSize(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">
                Default is 12 to 15. The purse must cover the minimum. Slots above that do not lock money.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Starting budget (Cr)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={settingsForm.budgetCr}
                    onChange={(e) => setSettingsForm({ ...settingsForm, budgetCr: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Lot timer (seconds)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={settingsForm.timerSeconds}
                    onChange={(e) => setSettingsForm({ ...settingsForm, timerSeconds: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
              </div>
              <details className="rounded-xl border border-slate-600 bg-slate-800/30 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-slate-300">Bid steps (advanced)</summary>
                <p className="mt-2 text-xs text-slate-400">
                  Below the first threshold each bid raises by step 1, up to the second threshold by step 2, and above it
                  by step 3. A step that would cross a threshold lands exactly on it. The defaults are the IPL-style
                  10 L, 20 L and 25 L.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">First threshold (Cr)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={settingsForm.t1Cr}
                    onChange={(e) => setSettingsForm({ ...settingsForm, t1Cr: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Second threshold (Cr)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={settingsForm.t2Cr}
                    onChange={(e) => setSettingsForm({ ...settingsForm, t2Cr: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Step 1 (lakh)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={settingsForm.s1L}
                    onChange={(e) => setSettingsForm({ ...settingsForm, s1L: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Step 2 (lakh)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={settingsForm.s2L}
                    onChange={(e) => setSettingsForm({ ...settingsForm, s2L: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Step 3 (lakh)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={settingsForm.s3L}
                    onChange={(e) => setSettingsForm({ ...settingsForm, s3L: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                </div>
              </details>

              <label className="flex items-start gap-3 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoHammer}
                  onChange={(e) => setAutoHammer(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-yellow-500"
                />
                <span>
                  Auto-sell when the timer ends
                  <span className="block text-xs text-slate-400">
                    The lot sells to the top bidder 30 seconds after the last bid, even if the host is away.
                    Lots with no bids still wait for the host.
                  </span>
                </span>
              </label>

              <button
                onClick={handleCreateRoom}
                disabled={creating}
                className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 font-bold rounded-xl hover:from-yellow-400 hover:to-orange-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {creating ? 'Creating Room...' : 'Create Room'}
              </button>
            </div>
          </div>
        )}

        {/* Join Room View */}
        {view === 'join' && (
          <div className="max-w-4xl mx-auto w-full backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-8">
            <button
              onClick={() => {
                setView('menu')
                setJoinSearch('')
                setJoinMessage('')
              }}
              className="mb-6 text-slate-300 hover:text-white transition flex items-center gap-2"
            >
              ← Back
            </button>

            <h2 className="text-3xl font-bold text-white mb-2">Join Room</h2>
            <p className="text-slate-400 text-sm mb-6">
              Open rooms waiting for players (max 10). Tap a row to fill Room ID, then enter the key from the host.
            </p>

            {joinMessage && (
              <div className={`mb-6 p-4 rounded-xl text-sm font-medium ${
                joinMessage.includes('Success') || joinMessage.includes('Welcome') || joinMessage.includes('Selected')
                  ? 'bg-green-500/20 text-green-200 border border-green-500/50'
                  : 'bg-red-500/20 text-red-200 border border-red-500/50'
              }`}>
                {joinMessage}
              </div>
            )}

            <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <label className="block text-sm font-medium text-slate-300 sm:sr-only">
                Search rooms
              </label>
              <input
                type="search"
                value={joinSearch}
                onChange={(e) => setJoinSearch(e.target.value)}
                placeholder="Search by room ID, name, or inventory…"
                className="w-full sm:flex-1 px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
              />
              <button
                type="button"
                onClick={() => void loadJoinableRooms()}
                disabled={joinLobbyLoading}
                className="px-4 py-3 rounded-xl border border-white/20 text-white hover:bg-white/10 transition shrink-0 disabled:opacity-50"
              >
                {joinLobbyLoading ? 'Loading…' : 'Refresh list'}
              </button>
            </div>

            <div className="mb-8 max-h-64 overflow-y-auto rounded-xl border border-slate-600 bg-slate-900/40">
              {joinLobbyLoading && joinLobbyRooms.length === 0 ? (
                <div className="p-6 text-slate-400 text-center">Loading open rooms…</div>
              ) : joinLobbyError ? (
                <div className="p-4 text-red-300 text-sm">{joinLobbyError}</div>
              ) : filteredLobbyRooms.length === 0 ? (
                <div className="p-6 text-slate-400 text-center text-sm">
                  No matching open rooms. Ask the host for Room ID and key, or create a room.
                </div>
              ) : (
                <ul className="divide-y divide-slate-700">
                  {filteredLobbyRooms.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setJoinRoomId(r.room_id)
                          setJoinMessage(
                            `Selected “${r.room_name}”. Enter the 6-digit room key from the host below.`
                          )
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
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Room ID
                </label>
                <input
                  type="text"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  placeholder="e.g. IPL2025_123"
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Room Key (6 digits)
                </label>
                <input
                  type="text"
                  value={joinRoomKey}
                  onChange={(e) => setJoinRoomKey(e.target.value)}
                  placeholder="e.g. 123456"
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition"
                />
              </div>

              <button
                onClick={handleJoinRoom}
                disabled={joining}
                className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 font-bold rounded-xl hover:from-yellow-400 hover:to-orange-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {joining ? 'Joining...' : 'Join Room'}
              </button>
            </div>
          </div>
        )}

        {/* Room Created Success */}
        {createdRoom && (
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500 rounded-full mb-4">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">Room Created!</h2>
              <p className="text-slate-300">Share these details with your friends</p>
            </div>

            <div className="space-y-4 mb-6">
              <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-400 mb-1">Room ID</div>
                  <div className="text-2xl font-bold text-white font-mono break-all">{createdRoom.roomId}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText(createdRoom.roomId, 'Room ID')}
                  className="shrink-0 px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm hover:bg-white/20"
                >
                  Copy ID
                </button>
              </div>

              <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-400 mb-1">Room Key</div>
                  <div className="text-2xl font-bold text-white font-mono">{createdRoom.roomKey}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText(createdRoom.roomKey, 'Room key')}
                  className="shrink-0 px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm hover:bg-white/20"
                >
                  Copy key
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    `Join my auction room\nRoom ID: ${createdRoom.roomId}\nRoom Key: ${createdRoom.roomKey}`,
                    'Invite'
                  )
                }
                className="flex-1 py-3 rounded-xl border-2 border-yellow-500/60 text-yellow-200 font-semibold hover:bg-yellow-500/10 transition"
              >
                Copy invite (ID + key)
              </button>
            </div>
            {copyToast && (
              <p className="text-center text-green-300 text-sm mb-4">{copyToast}</p>
            )}

            <button
              onClick={() => router.push(`/room/${createdRoom.uuid}`)}
              className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 font-bold rounded-xl hover:from-yellow-400 hover:to-orange-400 transition shadow-lg"
            >
              Enter Room
            </button>
          </div>
        )}
      </div>
    </div>
  )
}