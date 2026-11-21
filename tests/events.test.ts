import { describe, expect, it } from 'vitest'
import { EVENTS, EVENT_INVENTORY_TYPES, eventById, eventForInventory, eventForPool, poolLabel } from '@/lib/events'
import { teamColours } from '@/lib/teams'

describe('events', () => {
  it('lists ILT20 with both formats and SMAT as draft only', () => {
    expect(eventById('ilt20-2026')?.formats).toEqual(['auction', 'draft'])
    expect(eventById('smat-2026')?.formats).toEqual(['draft'])
  })

  it('every auction event has a player list, and ids are unique', () => {
    for (const e of EVENTS) if (e.formats.includes('auction')) expect(e.inventoryType).toBeTruthy()
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(EVENTS.length)
    expect(new Set(EVENTS.map((e) => e.pool)).size).toBe(EVENTS.length)
  })

  it('finds events by pool and inventory, and keeps IPL out of events', () => {
    expect(eventForPool('SMAT_2026')?.name).toBe('SMAT 2026')
    expect(eventForInventory('ILT20_2026')?.name).toBe('ILT20 2026')
    expect(eventForInventory('IPL')).toBeNull()
    expect(EVENT_INVENTORY_TYPES.has('ILT20_2026')).toBe(true)
    expect(EVENT_INVENTORY_TYPES.has('IPL')).toBe(false)
  })

  it('labels unknown pools readably', () => {
    expect(poolLabel('ILT20_2026')).toBe('ILT20 2026')
    expect(poolLabel('SOME_POOL')).toBe('SOME POOL')
    expect(poolLabel(null)).toBe('Draft')
  })

  it('has colours for ILT20 franchises', () => {
    expect(teamColours('MI Emirates').bg).toBe('#004BA0')
    expect(teamColours('Gulf Giants').bg).not.toBe(teamColours('Unknown XI').bg)
  })
})
