import { nextBidIncrement } from './bidSlabs'

export type BidButtonState = {
  /** Rupees to add to the current bid (the next slab step). */
  raise: number
  /** The price this bid would set. */
  nextPrice: number
  disabled: boolean
  /** Why it is disabled, or null when a bid can be placed. */
  reason:
    | 'holding'
    | 'full'
    | 'paused'
    | 'offline'
    | 'need_funds'
    | 'locks_purse'
    | null
}

/** Single source of truth for whether the Bid button works, used by every bid button. */
export function bidButtonState(args: {
  currentBid: number
  holdsBid: boolean
  paused: boolean
  offline: boolean
  atCap: boolean
  remaining: number
  freeToSpend: number
}): BidButtonState {
  const raise = nextBidIncrement(args.currentBid)
  const nextPrice = args.currentBid + raise
  let reason: BidButtonState['reason'] = null
  if (args.holdsBid) reason = 'holding'
  else if (args.atCap) reason = 'full'
  else if (args.paused) reason = 'paused'
  else if (args.offline) reason = 'offline'
  else if (nextPrice > args.remaining) reason = 'need_funds'
  else if (nextPrice > args.freeToSpend) reason = 'locks_purse'
  return { raise, nextPrice, disabled: reason !== null, reason }
}

export function bidButtonLabel(state: BidButtonState, money: (n: number) => string): string {
  switch (state.reason) {
    case 'holding':
      return 'You hold the highest bid'
    case 'full':
      return 'Squad full'
    case 'paused':
      return 'Paused'
    case 'offline':
      return 'Offline'
    case 'need_funds':
      return `Need ${money(state.nextPrice)}`
    case 'locks_purse':
      return 'Leaves the other slots short'
    default:
      return `Bid ${money(state.nextPrice)} · +${money(state.raise)}`
  }
}
