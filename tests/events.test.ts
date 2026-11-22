import { describe, expect, it } from 'vitest'
import { EVENTS, eventById, eventForInventory, eventForPool, poolLabel } from '@/lib/events'
import { teamColours } from '@/lib/teams'

describe('events', () => {
  it('lists IPL as auction only, ILT20 with both formats and SMAT as draft only', () => {
    expect(eventById('ipl-2026')?.formats).toEqual(['auction'])
    expect(eventById('ilt20-2026')?.formats).toEqual(['auction', 'draft'])
    expect(eventById('smat-2026')?.formats).toEqual(['draft'])
  })

  it('every format has its player list, and ids are unique', () => {
    for (const e of EVENTS) {
      if (e.formats.includes('auction')) expect(e.inventoryType).toBeTruthy()
      if (e.formats.includes('draft')) expect(e.pool).toBeTruthy()
    }
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(EVENTS.length)
    const pools = EVENTS.map((e) => e.pool).filter(Boolean)
    expect(new Set(pools).size).toBe(pools.length)
  })

  it('finds events by pool and inventory', () => {
    expect(eventForPool('SMAT_2026')?.name).toBe('SMAT 2026')
    expect(eventForPool(undefined)).toBeNull()
    expect(eventForInventory('ILT20_2026')?.name).toBe('ILT20 2026')
    expect(eventForInventory('IPL')?.name).toBe('IPL 2026')
    expect(eventForInventory('T20_WC')).toBeNull()
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
