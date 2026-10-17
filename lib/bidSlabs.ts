/** 1 lakh, in rupees. */
const LAKH = 100_000

/** 1 crore, in rupees. */
const CRORE = 10_000_000

const TWO_CRORE = 2 * CRORE
const FIVE_CRORE = 5 * CRORE

/**
 * Minimum raise from the current bid.
 * Under ₹2 Cr: ₹10 L (the old under-₹1 Cr and ₹1–2 Cr bands combined).
 * ₹2 Cr up to ₹5 Cr: ₹20 L.
 * ₹5 Cr and above: ₹25 L.
 */
export function slabStep(currentBid: number): number {
  if (currentBid < TWO_CRORE) return 10 * LAKH
  if (currentBid < FIVE_CRORE) return 20 * LAKH
  return 25 * LAKH
}

/**
 * The only legal next price. A step that would pass ₹2 Cr or ₹5 Cr
 * lands on that boundary so the next band starts on a clean number.
 */
export function nextBidAmount(currentBid: number): number {
  const raw = currentBid + slabStep(currentBid)
  if (currentBid < TWO_CRORE && raw > TWO_CRORE) return TWO_CRORE
  if (currentBid < FIVE_CRORE && raw > FIVE_CRORE) return FIVE_CRORE
  return raw
}

/** Rupees to add to `currentBid` to reach the next legal price. */
export function nextBidIncrement(currentBid: number): number {
  return nextBidAmount(currentBid) - currentBid
}
