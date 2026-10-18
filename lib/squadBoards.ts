import { SQUAD_ROLES, squadRole, type Player, type RoomUser } from './roomTypes'

export type SquadBoard = {
  user: RoomUser
  counts: Record<(typeof SQUAD_ROLES)[number], number>
  /** The two most recent buys, newest first. */
  lastBuys: Player[]
  size: number
}

/** Group sold players by owner, count roles (AR counts as ALL), newest buys first. */
export function buildSquadBoards(users: RoomUser[], players: Player[]): SquadBoard[] {
  return users.map((user) => {
    const buys = players
      .filter((p) => p.status === 'SOLD' && p.sold_to_user_id === user.id)
      .sort((a, b) => {
        const ta = a.purchased_at ? Date.parse(a.purchased_at) : 0
        const tb = b.purchased_at ? Date.parse(b.purchased_at) : 0
        return tb - ta
      })
    const counts: SquadBoard['counts'] = { WK: 0, BAT: 0, ALL: 0, BOWL: 0 }
    for (const player of buys) {
      const role = squadRole(player.player_type)
      if (role) counts[role] += 1
    }
    return { user, counts, lastBuys: buys.slice(0, 2), size: buys.length }
  })
}
