'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  MIN_PLAYERS_FOR_AUCTION,
  MAX_PLAYERS_IN_ROOM,
  readyVotesNeededToStart,
} from '@/lib/auctionConsensus'
import { useRouter, useParams } from 'next/navigation'

interface RoomUser {
  id: string
  username: string
  display_name: string
  budget: number
  spent: number
  squad_count: number
  is_admin: boolean
  ready_to_start?: boolean
  joined_at?: string
}

interface Player {
  id: string
  player_name: string
  player_type: string
  base_price: number
  image_url: string | null
  team?: string | null
  status: string
  sold_price?: number
  sold_to?: string
}

interface AuctionState {
  is_active: boolean
  current_player_id: string | null
  current_bid: number
  top_bidder_id: string | null
  start_time: string | null
  last_bid_time: string | null
  timer_type: string | null
}

interface PlayerInventoryRow {
  player_name: string
  player_type: string
  base_price: number
  image_url: string | null
  team?: string | null
}

type AuctionSortMode = 'created_asc' | 'base_price_asc' | 'base_price_desc'

const FILTER_PLAYER_TYPES = ['BAT', 'BOWL', 'AR', 'WK', 'ALL'] as const

/** PostgREST embed types often infer many-to-one as T | T[] */
function inventoryRow(
  inv: PlayerInventoryRow | PlayerInventoryRow[] | null | undefined
): PlayerInventoryRow | null {
  if (inv == null) return null
  return Array.isArray(inv) ? (inv[0] ?? null) : inv
}

export default function RoomPage() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<RoomUser | null>(null)
  const [allUsers, setAllUsers] = useState<RoomUser[]>([])
  const [auctionState, setAuctionState] = useState<AuctionState | null>(null)
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null)
  const [mySquad, setMySquad] = useState<Player[]>([])
  const [allPlayers, setAllPlayers] = useState<Player[]>([])
  const [activeTab, setActiveTab] = useState<'auction' | 'squad' | 'leaderboard' | 'players'>('auction')
  const [bidMessage, setBidMessage] = useState('')
  /** Set once at load: room creator or DB is_admin (survives ref edge cases when merging room_users). */
  const [canUseHostControls, setCanUseHostControls] = useState(false)
  /** Host lot order (saved to rooms.auction_filters). Empty hostTypes = all types. */
  const [hostSort, setHostSort] = useState<AuctionSortMode>('created_asc')
  const [hostTypes, setHostTypes] = useState<string[]>([])
  const [hostMinBase, setHostMinBase] = useState('')
  const [hostMaxBase, setHostMaxBase] = useState('')
  const [hostFilterMessage, setHostFilterMessage] = useState('')

  /** Avoid stale `currentUser` in realtime `fetchRoomUsers` (effect closure). */
  const myRoomUserIdRef = useRef<string | null>(null)
  const authUserIdRef = useRef<string | null>(null)
  const roomAdminAuthUserIdRef = useRef<string | null>(null)

  function mergeRoomUserRow(row: RoomUser): RoomUser {
    const creator =
      authUserIdRef.current != null &&
      roomAdminAuthUserIdRef.current != null &&
      String(roomAdminAuthUserIdRef.current) === String(authUserIdRef.current)
    return {
      ...row,
      ready_to_start: Boolean(row.ready_to_start),
      is_admin: Boolean(row.is_admin) || creator,
    }
  }

  async function initRoom() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth')
        return
      }

      const id = params.id as string
      console.log('Initializing room with ID:', id)
      setRoomId(id)

      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (roomError || !room) {
        console.error('Room not found:', roomError)
        alert('Room not found')
        router.push('/dashboard')
        return
      }

      console.log('Room found:', room.room_name)

      const rf = (room as { auction_filters?: unknown }).auction_filters
      if (rf && typeof rf === 'object' && rf !== null && !Array.isArray(rf)) {
        const f = rf as Record<string, unknown>
        const s = f.sort
        if (s === 'base_price_asc' || s === 'base_price_desc' || s === 'created_asc') {
          setHostSort(s)
        }
        const pt = f.player_types
        if (Array.isArray(pt)) {
          setHostTypes(pt.map((x) => String(x)))
        } else {
          setHostTypes([])
        }
        const mn = f.min_base_price
        setHostMinBase(
          typeof mn === 'number' && Number.isFinite(mn)
            ? String(mn)
            : mn != null && mn !== ''
              ? String(mn)
              : ''
        )
        const mx = f.max_base_price
        setHostMaxBase(
          typeof mx === 'number' && Number.isFinite(mx)
            ? String(mx)
            : mx != null && mx !== ''
              ? String(mx)
              : ''
        )
      }

      let roomUser = null
      let attempts = 0
      const maxAttempts = 5

      while (!roomUser && attempts < maxAttempts) {
        console.log(`Attempt ${attempts + 1}: Checking if user is in room...`)
        
        const { data: userData, error: userError } = await supabase
          .from('room_users')
          .select('*')
          .eq('room_id', id)
          .eq('user_id', user.id)
          .maybeSingle()

        if (userError) {
          console.error('Error checking room membership:', userError)
        }

        if (userData) {
          console.log('User found in room:', userData.display_name)
          roomUser = userData
          break
        }

        if (attempts < maxAttempts - 1) {
          console.log('User not found, waiting 1 second before retry...')
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        attempts++
      }

      if (!roomUser) {
        console.error('User not found in room after', maxAttempts, 'attempts')
        alert('You are not in this room. Please join first.')
        router.push('/dashboard')
        return
      }

      authUserIdRef.current = user.id
      roomAdminAuthUserIdRef.current = room.admin_user_id != null ? String(room.admin_user_id) : null
      myRoomUserIdRef.current = roomUser.id

      const ru = roomUser as RoomUser
      const isRoomCreator =
        room.admin_user_id != null && String(room.admin_user_id) === String(user.id)
      setCanUseHostControls(Boolean(ru.is_admin) || isRoomCreator)

      setCurrentUser(mergeRoomUserRow(ru))
      
      await Promise.all([
        fetchRoomUsers(id),
        fetchAuctionState(id),
        fetchAllPlayers(id)
      ])
      
      setLoading(false)

    } catch (error: unknown) {
      console.error('Init error:', error)
      alert('Error loading room: ' + (error instanceof Error ? error.message : String(error)))
      router.push('/dashboard')
    }
  }

  async function fetchRoomUsers(id?: string) {
    const targetRoomId = id || roomId
    if (!targetRoomId) return
    
    const { data } = await supabase
      .from('room_users')
      .select('*')
      .eq('room_id', targetRoomId)
      .order('joined_at', { ascending: true })

    if (data) {
      setAllUsers(data)
      const selfId = myRoomUserIdRef.current
      const me = selfId ? (data as RoomUser[]).find((u) => u.id === selfId) : undefined
      if (me) setCurrentUser(mergeRoomUserRow(me))
    }
  }

  async function fetchAuctionState(id?: string) {
    const targetRoomId = id || roomId
    if (!targetRoomId) return

    const { data } = await supabase
      .from('live_auction_state')
      .select('*')
      .eq('room_id', targetRoomId)
      .maybeSingle()

    if (data) {
      setAuctionState(data)
      
      if (data.current_player_id) {
        const { data: player } = await supabase
          .from('room_players')
          .select(`
            id,
            status,
            sold_price,
            player_inventory!inner (
              player_name,
              player_type,
              base_price,
              image_url,
              team
            )
          `)
          .eq('id', data.current_player_id)
          .maybeSingle()

        if (!player) {
          setCurrentPlayer(null)
        } else {
          const inv = inventoryRow(
            player.player_inventory as PlayerInventoryRow | PlayerInventoryRow[] | null
          )
          if (inv) {
            setCurrentPlayer({
              id: player.id,
              player_name: inv.player_name,
              player_type: inv.player_type,
              base_price: inv.base_price,
              image_url: inv.image_url,
              team: inv.team ?? null,
              status: player.status,
              sold_price: player.sold_price
            })
          } else {
            setCurrentPlayer(null)
          }
        }
      } else {
        setCurrentPlayer(null)
      }
    }
  }

  async function fetchAllPlayers(id?: string) {
    const targetRoomId = id || roomId
    if (!targetRoomId) return

    const { data, error } = await supabase
      .from('room_players')
      .select(`
        id,
        status,
        sold_price,
        sold_to_user_id,
        player_inventory!inner (
          player_name,
          player_type,
          base_price,
          image_url,
          team
        )
      `)
      .eq('room_id', targetRoomId)

    if (error) {
      console.error('Error fetching players:', error)
      return
    }

    if (data) {
      // Batch-fetch all sold_to display names in a single query instead of N+1
      const soldToIds = [...new Set(
        data.filter(p => p.sold_to_user_id).map(p => p.sold_to_user_id as string)
      )]
      const soldToMap: Record<string, string> = {}
      if (soldToIds.length > 0) {
        const { data: usersData } = await supabase
          .from('room_users')
          .select('id, display_name')
          .in('id', soldToIds)
        if (usersData) {
          usersData.forEach(u => { soldToMap[u.id] = u.display_name })
        }
      }

      const playerList = data.map((p) => {
        const inv = inventoryRow(
          p.player_inventory as PlayerInventoryRow | PlayerInventoryRow[] | null
        )
        if (!inv) return null
        return {
          id: p.id,
          player_name: inv.player_name,
          player_type: inv.player_type,
          base_price: inv.base_price,
          image_url: inv.image_url,
          team: inv.team ?? null,
          status: p.status,
          sold_price: p.sold_price || undefined,
          sold_to: p.sold_to_user_id ? soldToMap[p.sold_to_user_id] : undefined,
        }
      })

      setAllPlayers(playerList.filter((p): p is NonNullable<typeof p> => p != null))
    }

    const squadRoomUserId = myRoomUserIdRef.current
    if (!squadRoomUserId) return

    const { data: squadData } = await supabase
      .from('user_squads')
      .select(`
        purchase_price,
        player_id
      `)
      .eq('room_user_id', squadRoomUserId)

    if (squadData && squadData.length > 0) {
      const playerIds = squadData.map(s => s.player_id)
      
      const { data: squadPlayers } = await supabase
        .from('room_players')
        .select(`
          id,
          player_inventory!inner (
            player_name,
            player_type,
            base_price,
            image_url,
            team
          )
        `)
        .in('id', playerIds)

      if (squadPlayers) {
        setMySquad(
          squadPlayers.flatMap((p) => {
            const inv = inventoryRow(
              p.player_inventory as PlayerInventoryRow | PlayerInventoryRow[] | null
            )
            if (!inv) return []
            return [{
              id: p.id,
              player_name: inv.player_name,
              player_type: inv.player_type,
              base_price: inv.base_price,
              image_url: inv.image_url,
              team: inv.team ?? null,
              status: 'SOLD' as const,
              sold_price: squadData.find(s => s.player_id === p.id)?.purchase_price
            }]
          })
        )
      }
    }
  }

  async function startAuction(): Promise<boolean> {
    if (!roomId) return false
    const { error } = await supabase.rpc('auction_start_first_lot', { p_room_id: roomId })
    if (error) {
      console.error('startAuction:', error.message)
      alert(
        'Could not start: ' +
          error.message +
          '\n\nRun supabase/auction_manual_and_filters.sql in Supabase (adds auction_start_first_lot + filters).'
      )
      return false
    }
    return true
  }

  function toggleHostPlayerType(t: string) {
    setHostTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  async function saveHostAuctionFilters() {
    if (!roomId || (!currentUser?.is_admin && !canUseHostControls)) return
    setHostFilterMessage('')
    const minV = hostMinBase.trim() === '' ? null : Number(hostMinBase)
    const maxV = hostMaxBase.trim() === '' ? null : Number(hostMaxBase)
    if (minV != null && !Number.isFinite(minV)) {
      setHostFilterMessage('Min base price must be a number (rupees).')
      return
    }
    if (maxV != null && !Number.isFinite(maxV)) {
      setHostFilterMessage('Max base price must be a number (rupees).')
      return
    }
    if (minV != null && maxV != null && minV > maxV) {
      setHostFilterMessage('Min base price cannot be greater than max.')
      return
    }
    const payload = {
      sort: hostSort,
      player_types: hostTypes.length === 0 ? null : hostTypes,
      min_base_price: minV,
      max_base_price: maxV,
    }
    const { error } = await supabase.rpc('admin_set_auction_filters', {
      p_room_id: roomId,
      p_filters: payload,
    })
    if (error) {
      setHostFilterMessage(error.message)
      return
    }
    setHostFilterMessage('Saved. Next lots use this order & filters.')
  }

  async function hostHammer(action: 'sold' | 'pass') {
    if (!roomId || (!currentUser?.is_admin && !canUseHostControls)) return
    setHostFilterMessage('')
    const { error } = await supabase.rpc('auction_hammer_advance', {
      p_room_id: roomId,
      p_action: action,
    })
    if (error) {
      alert(error.message)
      return
    }
    await Promise.all([fetchAuctionState(roomId), fetchRoomUsers(roomId), fetchAllPlayers(roomId)])
  }

  async function toggleReady() {
    if (!roomId || !currentUser || auctionState?.is_active) return
    const next = !currentUser.ready_to_start
    // Direct update avoids PostgREST RPC signature / schema-cache issues with set_my_ready_state.
    const { data, error } = await supabase
      .from('room_users')
      .update({ ready_to_start: next })
      .eq('id', currentUser.id)
      .eq('room_id', roomId)
      .select('id')
      .maybeSingle()

    if (error) {
      alert(
        'Could not update ready state: ' +
          error.message +
          ' — In Supabase → SQL Editor, run the file supabase/FIX_READY_BUTTON.sql (one paste).'
      )
      return
    }
    if (!data) {
      alert(
        'Ready state did not save (no row updated). Run supabase/FIX_READY_BUTTON.sql in the SQL Editor.'
      )
      return
    }
    setCurrentUser(mergeRoomUserRow({ ...currentUser, ready_to_start: next }))
  }

  async function handleRestartAuction() {
    if (!roomId || (!currentUser?.is_admin && !canUseHostControls)) return
    const ok = window.confirm(
      'Reset this room’s auction completely?\n\n' +
        '• Stops the live auction\n' +
        '• All players go back to UNSOLD\n' +
        '• Clears squads, spends, and bid history for this room\n\n' +
        'Everyone stays in the room; you can start again when ready.'
    )
    if (!ok) return

    const { error } = await supabase.rpc('restart_room_auction', { p_room_id: roomId })
    if (error) {
      alert(
        'Could not reset: ' +
          error.message +
          '\n\nRun supabase/restart_room_auction.sql in the Supabase SQL Editor if this function is missing.'
      )
      return
    }

    consensusAutoStartRef.current = false
    await Promise.all([
      fetchAuctionState(roomId),
      fetchRoomUsers(roomId),
      fetchAllPlayers(roomId),
    ])
  }

  async function placeBid(amount: number) {
    if (!currentUser || !auctionState || !currentPlayer || !roomId) return

    setBidMessage('')

    const newBid = auctionState.current_bid + amount
    const remaining = currentUser.budget - currentUser.spent
    if (newBid > remaining) {
      setBidMessage('Insufficient funds!')
      return
    }

    if (currentUser.squad_count >= 25) {
      setBidMessage('Squad full (25 players max)!')
      return
    }

    if (auctionState.top_bidder_id === currentUser.id) {
      setBidMessage('You already hold the highest bid!')
      return
    }

    const { error } = await supabase.rpc('place_auction_bid', {
      p_room_id: roomId,
      p_increment: amount,
    })

    if (error) {
      setBidMessage(error.message || 'Bidding error')
      setTimeout(() => setBidMessage(''), 3000)
      return
    }

    setBidMessage('Bid placed!')
    setTimeout(() => setBidMessage(''), 2000)
    await fetchAuctionState(roomId)
  }

  function formatMoney(amount: number) {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`
    return `₹${amount}`
  }

  function getTopBidderName() {
    if (!auctionState?.top_bidder_id) return 'No Bids'
    const bidder = allUsers.find(u => u.id === auctionState.top_bidder_id)
    return bidder?.display_name || 'Unknown'
  }

  const fetchRoomUsersRef = useRef(fetchRoomUsers)
  fetchRoomUsersRef.current = fetchRoomUsers
  const fetchAuctionStateRef = useRef(fetchAuctionState)
  fetchAuctionStateRef.current = fetchAuctionState
  const fetchAllPlayersRef = useRef(fetchAllPlayers)
  fetchAllPlayersRef.current = fetchAllPlayers

  const consensusKey = useMemo(() => {
    const sig = allUsers
      .map((u) => `${u.id}:${u.ready_to_start ? 1 : 0}`)
      .sort()
      .join('|')
    return `${allUsers.length}::${sig}::${auctionState?.is_active ? '1' : '0'}`
  }, [allUsers, auctionState?.is_active])

  const consensusAutoStartRef = useRef(false)

  useEffect(() => {
    if (loading || !roomId || !auctionState) return
    if (auctionState.is_active) {
      consensusAutoStartRef.current = false
      return
    }
    const n = allUsers.length
    if (n < MIN_PLAYERS_FOR_AUCTION || n > MAX_PLAYERS_IN_ROOM) return
    const need = readyVotesNeededToStart(n)
    const readyCount = allUsers.filter((u) => u.ready_to_start).length
    if (readyCount < need) return
    if (consensusAutoStartRef.current) return
    consensusAutoStartRef.current = true
    void (async () => {
      try {
        const { data: row } = await supabase
          .from('live_auction_state')
          .select('is_active')
          .eq('room_id', roomId)
          .maybeSingle()
        if (row?.is_active) return
        const started = await startAuction()
        if (!started) consensusAutoStartRef.current = false
      } catch (e) {
        console.error(e)
        consensusAutoStartRef.current = false
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consensus snapshot in consensusKey; startAuction stable for this room
  }, [loading, roomId, consensusKey, auctionState?.is_active])

  useEffect(() => {
    void initRoom()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only room bootstrap
  }, [])

  useEffect(() => {
    if (!roomId) return

    const auctionChannel = supabase
      .channel(`auction_${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'live_auction_state',
        filter: `room_id=eq.${roomId}`
      }, () => {
        void fetchAuctionStateRef.current(roomId)
        // Refresh player/squad data so non-host users see sold players immediately
        void fetchAllPlayersRef.current(roomId)
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_users',
        filter: `room_id=eq.${roomId}`
      }, () => {
        void fetchRoomUsersRef.current(roomId)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(auctionChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- channel per roomId; handlers use refs
  }, [roomId])

  /** Backup if Realtime publication is missing: still sync lobby every few seconds. */
  useEffect(() => {
    if (!roomId || loading) return
    if (auctionState?.is_active) return

    const t = window.setInterval(() => {
      void fetchRoomUsersRef.current(roomId)
    }, 3000)

    return () => window.clearInterval(t)
  }, [roomId, loading, auctionState?.is_active])

  /** Light polling while live (realtime can miss bids). */
  useEffect(() => {
    if (!roomId || loading) return
    if (!auctionState?.is_active) return
    const id = roomId
    const i = window.setInterval(() => {
      void fetchAuctionStateRef.current(id)
    }, 2500)
    return () => window.clearInterval(i)
  }, [roomId, loading, auctionState?.is_active])

  const showHostTools = Boolean(currentUser?.is_admin || canUseHostControls)

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading room...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="max-w-7xl mx-auto mb-6">
        <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4">
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">🏏 Auction Room</h1>
                <p className="text-slate-300 text-sm flex flex-wrap items-center gap-2">
                  <span>
                    {allUsers.length} Players • {currentUser?.display_name}
                  </span>
                  {(currentUser?.is_admin || canUseHostControls) && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40">
                      Host
                    </span>
                  )}
                </p>
              </div>
              <div className="flex gap-3 items-center flex-wrap justify-end">
                <div className="text-right">
                  <div className="text-xs text-slate-400">Your Budget</div>
                  <div className="text-xl font-bold text-green-400">
                    {formatMoney((currentUser?.budget || 0) - (currentUser?.spent || 0))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-xl hover:bg-red-500 hover:text-white transition"
                >
                  Leave
                </button>
              </div>
            </div>
            {(currentUser?.is_admin || canUseHostControls) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
                <p className="text-xs text-slate-400 max-w-xl">
                  Host tools: reset clears this room&apos;s bids, squads, and sold status so you can run again.
                </p>
                <button
                  type="button"
                  onClick={() => void handleRestartAuction()}
                  className="shrink-0 px-4 py-2 bg-amber-950/60 text-amber-100 border border-amber-500/70 rounded-xl hover:bg-amber-900/80 transition text-sm font-semibold"
                >
                  Reset auction
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mb-6 flex gap-2 overflow-x-auto">
        {(['auction', 'squad', 'leaderboard', 'players'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-2 rounded-full font-medium whitespace-nowrap transition ${
              activeTab === tab
                ? 'bg-yellow-500 text-slate-900'
                : 'backdrop-blur-xl bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {tab === 'auction' && 'Live Auction'}
            {tab === 'squad' && `My Squad (${currentUser?.squad_count || 0})`}
            {tab === 'leaderboard' && 'Leaderboard'}
            {tab === 'players' && 'All Players'}
          </button>
        ))}
      </div>

      <div className="max-w-7xl mx-auto">
        {activeTab === 'auction' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {showHostTools && (
              <div className="lg:col-span-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-950/35 px-4 py-3">
                <p className="text-xs text-amber-100/90 max-w-2xl">
                  <strong className="text-amber-200">Host:</strong> full reset is also under the top header.
                  Use <strong>Reset auction</strong> to stop the live round, unsell all lots, clear squads and bid
                  history for this room.
                </p>
                <button
                  type="button"
                  onClick={() => void handleRestartAuction()}
                  className="shrink-0 px-4 py-2 bg-amber-950/60 text-amber-100 border border-amber-500/70 rounded-xl hover:bg-amber-900/80 transition text-sm font-semibold"
                >
                  Reset auction
                </button>
              </div>
            )}
            <div className="lg:col-span-2 backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8">
              {!auctionState?.is_active && allPlayers.some(p => p.status === 'SOLD') && (
                <div className="text-center py-10 px-2">
                  <div className="text-6xl mb-4">🏆</div>
                  <h2 className="text-3xl font-bold text-white mb-3">Auction Complete</h2>
                  <p className="text-slate-300 mb-6">
                    All available lots have been sold or passed. Check the Leaderboard and All Players tabs for results.
                  </p>
                  {showHostTools && (
                    <button
                      type="button"
                      onClick={() => void handleRestartAuction()}
                      className="px-8 py-3 bg-amber-600 hover:bg-amber-500 text-slate-900 font-bold rounded-xl transition"
                    >
                      Reset & run again
                    </button>
                  )}
                </div>
              )}

              {!auctionState?.is_active && !allPlayers.some(p => p.status === 'SOLD') && (
                <div className="text-center py-10 px-2">
                  <div className="text-6xl mb-4">⏳</div>
                  <h2 className="text-3xl font-bold text-white mb-3">Waiting to Start</h2>
                  <p className="text-slate-300 mb-2 max-w-xl mx-auto">
                    At least <strong className="text-yellow-200">{MIN_PLAYERS_FOR_AUCTION}</strong> players
                    and at most <strong className="text-yellow-200">{MAX_PLAYERS_IN_ROOM}</strong> in the room.
                    With exactly three players, <strong className="text-yellow-200">everyone</strong> must tap
                    Ready. With more than three, a <strong className="text-yellow-200">strict majority</strong>{' '}
                    of players must be ready to start.
                  </p>
                  <p className="text-slate-400 text-sm mb-6 max-w-lg mx-auto">
                    {allUsers.length > MAX_PLAYERS_IN_ROOM
                      ? `This room has more than ${MAX_PLAYERS_IN_ROOM} players.`
                      : allUsers.length < MIN_PLAYERS_FOR_AUCTION
                        ? `Waiting for more players (${allUsers.length} / ${MIN_PLAYERS_FOR_AUCTION} minimum). You can still mark yourself ready.`
                        : (() => {
                            const n = allUsers.length
                            const r = allUsers.filter((u) => u.ready_to_start).length
                            const need = readyVotesNeededToStart(n)
                            return `${r} of ${n} ready (${need} needed to start${n === MIN_PLAYERS_FOR_AUCTION ? ', all players' : ', strict majority'}).`
                          })()}
                  </p>

                  {showHostTools && (
                    <div className="max-w-2xl mx-auto mb-8 rounded-2xl border border-amber-500/40 bg-slate-900/60 p-5 text-left">
                      <h3 className="text-amber-200 font-bold text-sm uppercase tracking-wide mb-3">
                        Lot order & filters (host)
                      </h3>
                      <p className="text-xs text-slate-400 mb-4">
                        Only players matching the filters are offered, in the sort order. Leave types empty for
                        everyone. Base prices are in <strong className="text-slate-300">rupees</strong> (same as
                        the database).
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Sort unsold lots by</label>
                          <select
                            value={hostSort}
                            onChange={(e) => setHostSort(e.target.value as AuctionSortMode)}
                            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white text-sm"
                          >
                            <option value="created_asc">Original list order</option>
                            <option value="base_price_asc">Base price — low to high</option>
                            <option value="base_price_desc">Base price — high to low</option>
                          </select>
                        </div>
                        <div>
                          <span className="block text-xs text-slate-400 mb-2">Player types (optional)</span>
                          <div className="flex flex-wrap gap-2">
                            {FILTER_PLAYER_TYPES.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => toggleHostPlayerType(t)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                                  hostTypes.includes(t)
                                    ? 'bg-amber-500/30 border-amber-400 text-amber-100'
                                    : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                                }`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">None selected = all types</p>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Min base price (₹)</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={hostMinBase}
                            onChange={(e) => setHostMinBase(e.target.value)}
                            placeholder="e.g. 2000000"
                            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white text-sm placeholder:text-slate-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Max base price (₹)</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={hostMaxBase}
                            onChange={(e) => setHostMaxBase(e.target.value)}
                            placeholder="optional cap"
                            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white text-sm placeholder:text-slate-600"
                          />
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void saveHostAuctionFilters()}
                          className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-900 text-sm font-bold"
                        >
                          Save filters
                        </button>
                        {hostFilterMessage ? (
                          <span className="text-xs text-amber-200/90">{hostFilterMessage}</span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  <div className="max-w-md mx-auto text-left mb-8 space-y-2">
                    {allUsers.map((u) => (
                      <div
                        key={u.id}
                        className="flex justify-between items-center bg-slate-800/60 border border-slate-600 rounded-xl px-4 py-2.5"
                      >
                        <span className="text-white font-medium truncate pr-2">{u.display_name}</span>
                        <span className={u.ready_to_start ? 'text-green-400 shrink-0 font-semibold' : 'text-slate-500 shrink-0'}>
                          {u.ready_to_start ? 'Ready' : 'Not ready'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {allUsers.length <= MAX_PLAYERS_IN_ROOM && (
                    <button
                      type="button"
                      onClick={() => void toggleReady()}
                      disabled={allUsers.length > MAX_PLAYERS_IN_ROOM}
                      className="px-8 py-4 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 font-bold rounded-xl hover:from-yellow-400 hover:to-orange-400 transition shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {currentUser?.ready_to_start ? 'Cancel ready' : 'I am ready'}
                    </button>
                  )}
                </div>
              )}

              {auctionState?.is_active && currentPlayer && (
                <div>
                  <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
                    <div className="bg-red-500 text-white px-4 py-1 rounded-full text-sm font-bold animate-pulse">
                      LIVE
                    </div>
                    {showHostTools && (
                      <div className="flex flex-wrap gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => void hostHammer('sold')}
                          disabled={!auctionState.top_bidder_id}
                          className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed border border-green-400/50"
                        >
                          Hammer — sell to high bid
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              !window.confirm(
                                'Pass this player? No sale — next lot (or end) using your filters.'
                              )
                            )
                              return
                            void hostHammer('pass')
                          }}
                          className="px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-500 text-white text-sm font-semibold border border-slate-400/50"
                        >
                          Pass — no sale
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center mb-6">
                    <div className="w-40 h-40 rounded-full border-4 border-yellow-500 overflow-hidden bg-slate-800">
                      <img
                        src={currentPlayer.image_url || 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=200'}
                        alt={currentPlayer.player_name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  <h2 className="text-4xl font-bold text-white text-center mb-2">
                    {currentPlayer.player_name}
                  </h2>
                  <div className="text-center text-slate-300 mb-8">
                    {currentPlayer.team ? `${currentPlayer.team} · ` : ''}
                    {currentPlayer.player_type} • Base: {formatMoney(currentPlayer.base_price)}
                  </div>

                  <div className="bg-slate-800/50 rounded-2xl p-6 mb-6 border border-slate-700">
                    <div className="text-slate-400 text-xs uppercase text-center mb-2">Current Bid</div>
                    <div className="text-5xl font-black text-white text-center mb-2">
                      {formatMoney(auctionState.current_bid)}
                    </div>
                    <div className="text-center">
                      <span className="text-slate-400">Held by: </span>
                      <span className={`font-bold ${
                        auctionState.top_bidder_id === currentUser?.id ? 'text-green-400' : 'text-yellow-400'
                      }`}>
                        {getTopBidderName()}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <button
                      onClick={() => placeBid(2000000)}
                      disabled={auctionState.top_bidder_id === currentUser?.id}
                      className="py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      +20 L
                    </button>
                    <button
                      onClick={() => placeBid(5000000)}
                      disabled={auctionState.top_bidder_id === currentUser?.id}
                      className="py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      +50 L
                    </button>
                    <button
                      onClick={() => placeBid(10000000)}
                      disabled={auctionState.top_bidder_id === currentUser?.id}
                      className="py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition border border-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      +1 Cr
                    </button>
                  </div>

                  {bidMessage && (
                    <div className={`text-center text-sm font-medium ${
                      bidMessage.includes('success') ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {bidMessage}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-6">
              <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">
                My Stats
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Remaining Budget</div>
                  <div className="text-2xl font-bold text-green-400">
                    {formatMoney((currentUser?.budget || 0) - (currentUser?.spent || 0))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Squad Size</div>
                  <div className="text-2xl font-bold text-white">
                    {currentUser?.squad_count || 0} / 25
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Total Spent</div>
                  <div className="text-xl font-bold text-red-400">
                    {formatMoney(currentUser?.spent || 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'squad' && (
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8">
            <h2 className="text-2xl font-bold text-white mb-6">My Squad</h2>
            {mySquad.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                No players yet. Start bidding!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mySquad.map(player => (
                  <div key={player.id} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                    <div className="flex items-center gap-3">
                      <img
                        src={player.image_url || 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=80'}
                        alt={player.player_name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                      <div className="flex-1">
                        <div className="font-bold text-white">{player.player_name}</div>
                        <div className="text-xs text-slate-400">
                          {[player.team, player.player_type].filter(Boolean).join(' · ') || player.player_type}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-700 text-right">
                      <span className="text-green-400 font-bold">{formatMoney(player.sold_price || 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <h2 className="text-2xl font-bold text-white">Leaderboard</h2>
              {showHostTools && (
                <button
                  type="button"
                  onClick={() => void handleRestartAuction()}
                  className="shrink-0 px-4 py-2 bg-amber-950/60 text-amber-100 border border-amber-500/70 rounded-xl hover:bg-amber-900/80 transition text-sm font-semibold"
                >
                  Reset auction
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="p-3 text-left">Team</th>
                    <th className="p-3 text-right">Spent</th>
                    <th className="p-3 text-right">Remaining</th>
                    <th className="p-3 text-right">Squad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {allUsers.map(user => (
                    <tr key={user.id} className={user.id === currentUser?.id ? 'bg-yellow-500/10' : ''}>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{user.display_name}</span>
                          {user.is_admin && (
                            <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded">ADMIN</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right text-red-400">{formatMoney(user.spent)}</td>
                      <td className="p-3 text-right text-green-400">{formatMoney(user.budget - user.spent)}</td>
                      <td className="p-3 text-right text-white">{user.squad_count} / 25</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'players' && (
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8">
            <h2 className="text-2xl font-bold text-white mb-6">All Players</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="p-3 text-left">Player</th>
                    <th className="p-3 text-left">Team</th>
                    <th className="p-3 text-left">Type</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {allPlayers.map(player => (
                    <tr key={player.id}>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={player.image_url || 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=40'}
                            alt={player.player_name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                          <span className="text-white">{player.player_name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-300">{player.team || '—'}</td>
                      <td className="p-3 text-slate-300">{player.player_type}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-1 rounded ${
                          player.status === 'SOLD' ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                        }`}>
                          {player.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {player.status === 'SOLD' ? (
                          <div>
                            <div className="text-green-400 font-bold">{formatMoney(player.sold_price || 0)}</div>
                            {player.sold_to && <div className="text-xs text-slate-400">{player.sold_to}</div>}
                          </div>
                        ) : (
                          <span className="text-slate-400">{formatMoney(player.base_price)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}