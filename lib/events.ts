/**
 * Events shown on the dashboard's Events tab. Each event has its own player list
 * and the formats it can be played in:
 *   - draft:   a draft room on draft_pool_players.pool = `pool` (supabase/draft.sql)
 *   - auction: an auction room on player_inventory.inventory_type = `inventoryType`
 */

export type EventFormat = 'auction' | 'draft'

export type CricketEvent = {
  id: string
  name: string
  fullName: string
  blurb: string
  formats: EventFormat[]
  /** draft_pool_players.pool */
  pool: string
  /** player_inventory.inventory_type, when the event can be auctioned */
  inventoryType?: string
  players: number
  teams: number
}

export const EVENTS: CricketEvent[] = [
  {
    id: 'ilt20-2026',
    name: 'ILT20 2026',
    fullName: 'International League T20 2026',
    blurb: 'Six UAE franchises. Auction with ₹ base prices of 50 L, 1 Cr and 2 Cr, or draft from the same squads.',
    formats: ['auction', 'draft'],
    pool: 'ILT20_2026',
    inventoryType: 'ILT20_2026',
    players: 142,
    teams: 6,
  },
  {
    id: 'smat-2026',
    name: 'SMAT 2026',
    fullName: 'Syed Mushtaq Ali Trophy 2026-27',
    blurb: 'India’s domestic T20. Draft from 34 state squads.',
    formats: ['draft'],
    pool: 'SMAT_2026',
    players: 544,
    teams: 34,
  },
]

/** Inventory types that belong to an event, so the IPL Auction tab can leave them out. */
export const EVENT_INVENTORY_TYPES = new Set(EVENTS.map((e) => e.inventoryType).filter((t): t is string => Boolean(t)))

export function eventById(id: string | null | undefined): CricketEvent | null {
  return EVENTS.find((e) => e.id === id) ?? null
}

export function eventForPool(pool: string | null | undefined): CricketEvent | null {
  return EVENTS.find((e) => e.pool === pool) ?? null
}

export function eventForInventory(inventoryType: string | null | undefined): CricketEvent | null {
  return EVENTS.find((e) => e.inventoryType === inventoryType) ?? null
}

/** Display name for a draft pool, e.g. "SMAT 2026"; falls back to the raw key. */
export function poolLabel(pool: string | null | undefined): string {
  return eventForPool(pool)?.name ?? (pool ? pool.replace(/_/g, ' ') : 'Draft')
}
