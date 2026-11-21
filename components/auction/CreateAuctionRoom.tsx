'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_MIN_SQUAD, DEFAULT_MAX_SQUAD } from '@/lib/purse'
import { DEFAULT_FORM, parseSettingsForm, type SettingsForm } from '@/lib/roomSettings'

const INVENTORY_OPTIONS = [
  { value: 'IPL', label: 'IPL (Domestic)' },
  { value: 'T20_WC', label: 'T20 World Cup (International)' },
  { value: 'ODI_WC', label: 'ODI World Cup (International)' },
]

const field =
  'w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition'
const small = 'w-full px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500'

/**
 * The "create auction room" form and the room-created screen. Used by the IPL
 * Auction tab (player list chosen here) and by events (player list fixed).
 */
export default function CreateAuctionRoom({
  inventoryType: fixedInventory,
  eventName,
  onBack,
}: {
  /** When set, the room uses this player list and the picker is hidden. */
  inventoryType?: string
  eventName?: string
  onBack: () => void
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [roomName, setRoomName] = useState('')
  const [inventoryType, setInventoryType] = useState(fixedInventory ?? 'IPL')
  const [minSquadSize, setMinSquadSize] = useState(String(DEFAULT_MIN_SQUAD))
  const [maxSquadSize, setMaxSquadSize] = useState(String(DEFAULT_MAX_SQUAD))
  const [autoHammer, setAutoHammer] = useState(false)
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(DEFAULT_FORM)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState('')
  const [created, setCreated] = useState<{ roomId: string; roomKey: string; uuid: string } | null>(null)
  const [toast, setToast] = useState('')

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setToast(`${label} copied`)
      setTimeout(() => setToast(''), 2200)
    } catch {
      setToast('Copy failed — select and copy manually')
      setTimeout(() => setToast(''), 3000)
    }
  }

  async function handleCreateRoom() {
    if (!/^[a-zA-Z0-9]+$/.test(roomName)) {
      setMessage('Room name must be alphanumeric only (no spaces or special characters)')
      return
    }
    if (roomName.length < 3) {
      setMessage('Room name must be at least 3 characters')
      return
    }
    const minSquad = Number(minSquadSize)
    const maxSquad = Number(maxSquadSize)
    if (!Number.isInteger(minSquad) || !Number.isInteger(maxSquad) || minSquad < 1 || maxSquad > 30 || minSquad > maxSquad) {
      setMessage('Squad size must be whole numbers from 1 to 30, and the minimum cannot be above the maximum.')
      return
    }
    const parsed = parseSettingsForm(settingsForm)
    if (!parsed.ok) {
      setMessage(parsed.error)
      return
    }
    const roomSettings = parsed.settings

    setCreating(true)
    setMessage('')
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth')
        return
      }
      const randomNum = Math.floor(Math.random() * 999) + 1
      const roomId = `${roomName}_${randomNum}`
      const roomKey = Math.floor(100000 + Math.random() * 900000).toString()

      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .insert({
          room_name: roomName,
          room_id: roomId,
          room_key: roomKey,
          admin_user_id: user.id,
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
        setMessage(roomError.code === '23505' ? 'Room name already exists. Try a different name.' : 'Error creating room: ' + roomError.message)
        return
      }

      const username = user.user_metadata?.username || user.email?.split('@')[0] || 'user'
      const { error: userError } = await supabase.from('room_users').insert({
        room_id: room.id,
        user_id: user.id,
        username,
        is_admin: true,
        display_name: `${roomId}_${username}`,
        ready_to_start: false,
      })
      if (userError) {
        setMessage('Error joining room: ' + userError.message)
        return
      }

      const { error: liveStateError } = await supabase.from('live_auction_state').insert({ room_id: room.id, is_active: false })
      if (liveStateError) {
        setMessage('Error setting up auction: ' + liveStateError.message)
        return
      }

      const { error: rpcError } = await supabase.rpc('initialize_room_players', { p_room_id: room.id, p_inventory_type: inventoryType })
      if (rpcError) {
        setMessage('Error loading player list: ' + rpcError.message)
        return
      }

      setCreated({ roomId, roomKey, uuid: room.id })
    } catch (error: unknown) {
      setMessage('Error: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setCreating(false)
    }
  }

  if (created) {
    return (
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
          {[
            ['Room ID', created.roomId, 'Copy ID'],
            ['Room Key', created.roomKey, 'Copy key'],
          ].map(([label, value, button]) => (
            <div key={label} className="bg-slate-800/50 border border-slate-600 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-sm text-slate-400 mb-1">{label}</div>
                <div className="text-2xl font-bold text-white font-mono break-all">{value}</div>
              </div>
              <button type="button" onClick={() => void copyText(value, label)} className="shrink-0 px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm hover:bg-white/20">
                {button}
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            void copyText(`Join my ${eventName ? eventName + ' ' : ''}auction room\nRoom ID: ${created.roomId}\nRoom Key: ${created.roomKey}`, 'Invite')
          }
          className="w-full mb-6 py-3 rounded-xl border-2 border-yellow-500/60 text-yellow-200 font-semibold hover:bg-yellow-500/10 transition"
        >
          Copy invite (ID + key)
        </button>
        {toast && <p className="text-center text-green-300 text-sm mb-4">{toast}</p>}

        <button
          type="button"
          onClick={() => router.push(`/room/${created.uuid}`)}
          className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 font-bold rounded-xl hover:from-yellow-400 hover:to-orange-400 transition shadow-lg"
        >
          Enter Room
        </button>
      </div>
    )
  }

  const settingInput = (label: string, key: keyof SettingsForm) => (
    <div>
      <label className="block text-xs font-medium text-slate-300 mb-1">{label}</label>
      <input
        type="number"
        min={0}
        step="any"
        value={settingsForm[key]}
        onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })}
        className={small}
      />
    </div>
  )

  return (
    <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-8">
      <button type="button" onClick={onBack} className="mb-6 text-slate-300 hover:text-white transition flex items-center gap-2">
        ← Back
      </button>

      <h2 className="text-3xl font-bold text-white mb-6">{eventName ? `${eventName} auction room` : 'Create New Room'}</h2>

      {message && <div className="mb-6 p-4 rounded-xl text-sm font-medium bg-red-500/20 text-red-200 border border-red-500/50">{message}</div>}

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Room Name</label>
          <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="e.g. IPL2025, MyAuction" className={field} />
          <p className="text-xs text-slate-400 mt-1">Alphanumeric only (no spaces or special characters)</p>
        </div>

        {!fixedInventory && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Player Inventory</label>
            <select value={inventoryType} onChange={(e) => setInventoryType(e.target.value)} className={field}>
              {INVENTORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Minimum squad</label>
            <input type="number" min={1} max={30} value={minSquadSize} onChange={(e) => setMinSquadSize(e.target.value)} className={field} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Maximum squad</label>
            <input type="number" min={1} max={30} value={maxSquadSize} onChange={(e) => setMaxSquadSize(e.target.value)} className={field} />
          </div>
        </div>
        <p className="text-xs text-slate-400 -mt-2">Default is 12 to 15. The purse must cover the minimum. Slots above that do not lock money.</p>

        <div className="grid grid-cols-2 gap-4">
          {settingInput('Starting budget (Cr)', 'budgetCr')}
          {settingInput('Lot timer (seconds)', 'timerSeconds')}
        </div>
        <details className="rounded-xl border border-slate-600 bg-slate-800/30 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">Bid steps (advanced)</summary>
          <p className="mt-2 text-xs text-slate-400">
            Below the first threshold each bid raises by step 1, up to the second threshold by step 2, and above it by step 3. A step that
            would cross a threshold lands exactly on it. The defaults are the IPL-style 10 L, 20 L and 25 L.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {settingInput('First threshold (Cr)', 't1Cr')}
            {settingInput('Second threshold (Cr)', 't2Cr')}
            {settingInput('Step 1 (lakh)', 's1L')}
            {settingInput('Step 2 (lakh)', 's2L')}
            {settingInput('Step 3 (lakh)', 's3L')}
          </div>
        </details>

        <label className="flex items-start gap-3 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={autoHammer} onChange={(e) => setAutoHammer(e.target.checked)} className="mt-1 h-4 w-4 accent-yellow-500" />
          <span>
            Auto-sell when the timer ends
            <span className="block text-xs text-slate-400">
              The lot sells to the top bidder 30 seconds after the last bid, even if the host is away. Lots with no bids still wait for the host.
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={() => void handleCreateRoom()}
          disabled={creating}
          className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 font-bold rounded-xl hover:from-yellow-400 hover:to-orange-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          {creating ? 'Creating Room...' : 'Create Room'}
        </button>
      </div>
    </div>
  )
}
