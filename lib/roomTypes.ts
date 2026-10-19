/** Shapes and helpers shared by the room page and its tab components. */

export interface RoomUser {
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

export interface Player {
  id: string
  player_name: string
  player_type: string
  base_price: number
  image_url: string | null
  team?: string | null
  status: string
  sold_price?: number
  sold_to?: string
  sold_to_user_id?: string
  purchased_at?: string
}

export interface AuctionState {
  is_active: boolean
  is_paused: boolean
  pause_reason?: 'host' | 'away' | 'closed' | null
  pause_message?: string | null
  current_player_id: string | null
  current_bid: number
  top_bidder_id: string | null
  start_time: string | null
  last_bid_time: string | null
  timer_type: string | null
}

export interface BidHistoryEntry {
  id: string
  amount: number
  created_at: string
  display_name: string
}

export interface PlayerInventoryRow {
  player_name: string
  player_type: string
  base_price: number
  image_url: string | null
  team?: string | null
}

export type AuctionSortMode = 'created_asc' | 'base_price_asc' | 'base_price_desc'

export const FILTER_PLAYER_TYPES = ['BAT', 'BOWL', 'AR', 'WK', 'ALL'] as const
export const SQUAD_ROLES = ['WK', 'BAT', 'ALL', 'BOWL'] as const

export function squadRole(playerType: string): (typeof SQUAD_ROLES)[number] | null {
  if (playerType === 'WK' || playerType === 'BAT' || playerType === 'BOWL') return playerType
  if (playerType === 'ALL' || playerType === 'AR') return 'ALL'
  return null
}

/** PostgREST embed types often infer many-to-one as T | T[] */
export function inventoryRow(
  inv: PlayerInventoryRow | PlayerInventoryRow[] | null | undefined
): PlayerInventoryRow | null {
  if (inv == null) return null
  return Array.isArray(inv) ? (inv[0] ?? null) : inv
}
