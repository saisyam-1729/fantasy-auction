export type GoingCall = 'none' | 'once' | 'twice' | 'sold'

/**
 * The auctioneer's call as the lot timer runs out: "going once" in the last third,
 * "going twice" in the last sixth, "sold" at zero. Only meaningful once there is a
 * bid, so a lot nobody has bid on never gets called.
 */
export function goingCall(countdown: number | null, totalSeconds: number, hasBid: boolean): GoingCall {
  if (countdown === null || !hasBid || totalSeconds <= 0) return 'none'
  if (countdown <= 0) return 'sold'
  if (countdown <= Math.ceil(totalSeconds / 6)) return 'twice'
  if (countdown <= Math.ceil(totalSeconds / 3)) return 'once'
  return 'none'
}

export function goingCallLabel(call: GoingCall): string {
  switch (call) {
    case 'once':
      return 'Going once…'
    case 'twice':
      return 'Going twice…'
    case 'sold':
      return 'Sold?'
    default:
      return ''
  }
}
