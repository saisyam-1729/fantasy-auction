/** Default squad rules for a new room. The host can change both. */
export const DEFAULT_MIN_SQUAD = 12
export const DEFAULT_MAX_SQUAD = 15

export type PurseLock = {
  /** Players still required to reach the minimum, including the one this bid would fill. */
  slotsLeft: number
  /** Other minimum slots that must still be affordable after this bid. */
  reserveSlots: number
  /** Cheapest base price among the other unsold players, in rupees. */
  minBase: number
  /** Rupees that must stay in the purse for those other minimum slots. */
  reserved: number
  /** Budget minus spent, in rupees. */
  remaining: number
  /**
   * Most that can be paid for this lot.
   * Negative when the purse is already short of the reserve.
   * Zero when the squad is already at the maximum.
   */
  freeToSpend: number
  /** True when this team cannot buy another player. */
  atCap: boolean
}

/**
 * The purse only has to finish the minimum squad.
 * This bid fills one required slot. Each other required slot keeps the
 * cheapest other unsold base price. Slots between the minimum and the
 * maximum do not lock money. Slots with no player left in the pool are not reserved.
 */
export function purseLock(args: {
  budget: number
  spent: number
  squadCount: number
  minSquadSize: number
  maxSquadSize: number
  otherUnsoldBasePrices: number[]
}): PurseLock {
  const minSquad = Math.max(1, args.minSquadSize)
  const maxSquad = Math.max(minSquad, args.maxSquadSize)
  const atCap = args.squadCount >= maxSquad
  const slotsLeft = Math.max(0, minSquad - args.squadCount)
  const reserveSlots = Math.min(
    Math.max(0, slotsLeft - 1),
    args.otherUnsoldBasePrices.length
  )
  const minBase =
    args.otherUnsoldBasePrices.length > 0
      ? Math.min(...args.otherUnsoldBasePrices)
      : 0
  const reserved = reserveSlots * minBase
  const remaining = args.budget - args.spent
  const freeToSpend = atCap ? 0 : slotsLeft === 0 ? remaining : remaining - reserved

  return {
    slotsLeft,
    reserveSlots,
    minBase,
    reserved,
    remaining,
    freeToSpend,
    atCap,
  }
}
