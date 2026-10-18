import { describe, expect, it } from 'vitest'
import { formatMoney } from '@/lib/money'
import type { Player, RoomUser } from '@/lib/roomTypes'
import { buildSquadBoards } from '@/lib/squadBoards'

const user = (id: string): RoomUser => ({ id, username: id, display_name: id, budget: 1, spent: 0, squad_count: 0, is_admin: false })
const sold = (id: string, type: string, to: string, at: number): Player => ({
  id, player_name: id, player_type: type, base_price: 1, image_url: null, status: 'SOLD',
  sold_price: 1, sold_to_user_id: to, purchased_at: new Date(at).toISOString(),
})

describe('squad boards', () => {
  it('counts roles, AR as ALL, and returns the two newest buys first', () => {
    const [a, b] = buildSquadBoards(
      [user('A'), user('B')],
      [sold('p1', 'BOWL', 'A', 1), sold('p2', 'BOWL', 'A', 2), sold('p3', 'AR', 'A', 3), sold('p4', 'WK', 'B', 4)]
    )
    expect(a.counts).toEqual({ WK: 0, BAT: 0, ALL: 1, BOWL: 2 })
    expect(a.lastBuys.map((p) => p.id)).toEqual(['p3', 'p2'])
    expect(b.counts.WK).toBe(1)
  })
})

describe('formatMoney', () => {
  it('formats crore, lakh and plain rupees', () => {
    expect(formatMoney(15_000_000)).toBe('₹1.50 Cr')
    expect(formatMoney(3_000_000)).toBe('₹30.00 L')
    expect(formatMoney(5000)).toBe('₹5000')
  })
})
