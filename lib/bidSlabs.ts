/** 1 lakh, in rupees. */
const LAKH = 100_000

/** 1 crore, in rupees. */
const CRORE = 10_000_000

/**
 * A room's bid steps: below `t1` raise by `s1`, from `t1` to `t2` by `s2`, from `t2`
 * up by `s3`. A step that would pass `t1` or `t2` lands exactly on it. Mirrors
 * rooms.slab_config and _auction_slab_increment in supabase/room_settings.sql.
 */
export type SlabConfig = { t1: number; t2: number; s1: number; s2: number; s3: number }

/** ₹2 Cr and ₹5 Cr thresholds; ₹10 L, ₹20 L and ₹25 L steps. */
export const DEFAULT_SLABS: SlabConfig = {
  t1: 2 * CRORE,
  t2: 5 * CRORE,
  s1: 10 * LAKH,
  s2: 20 * LAKH,
  s3: 25 * LAKH,
}

/** Same rules as the database CHECK: whole rupees, steps of at least ₹1 L, t2 above t1. */
export function isValidSlabs(c: unknown): c is SlabConfig {
  if (!c || typeof c !== 'object') return false
  const v = c as Record<string, unknown>
  const keys = ['t1', 't2', 's1', 's2', 's3'] as const
  if (!keys.every((k) => typeof v[k] === 'number' && Number.isInteger(v[k]))) return false
  const { t1, t2, s1, s2, s3 } = v as SlabConfig
  return (
    t1 >= LAKH && t2 > t1 && t2 <= 100_000_000_000 &&
    s1 >= LAKH && s2 >= LAKH && s3 >= LAKH &&
    s1 <= 1_000_000_000 && s2 <= 1_000_000_000 && s3 <= 1_000_000_000
  )
}

/** Read a room's saved config; anything missing or invalid means the defaults. */
export function parseSlabs(raw: unknown): SlabConfig {
  return isValidSlabs(raw) ? raw : DEFAULT_SLABS
}

/** Minimum raise from the current bid. */
export function slabStep(currentBid: number, c: SlabConfig = DEFAULT_SLABS): number {
  if (currentBid < c.t1) return c.s1
  if (currentBid < c.t2) return c.s2
  return c.s3
}

/**
 * The only legal next price. A step that would pass a threshold lands on that
 * threshold so the next band starts on a clean number.
 */
export function nextBidAmount(currentBid: number, c: SlabConfig = DEFAULT_SLABS): number {
  const raw = currentBid + slabStep(currentBid, c)
  if (currentBid < c.t1 && raw > c.t1) return c.t1
  if (currentBid < c.t2 && raw > c.t2) return c.t2
  return raw
}

/** Rupees to add to `currentBid` to reach the next legal price. */
export function nextBidIncrement(currentBid: number, c: SlabConfig = DEFAULT_SLABS): number {
  return nextBidAmount(currentBid, c) - currentBid
}

/** "Under ₹2 Cr the raise is ₹10 L. From ₹2 Cr to ₹5 Cr it is ₹20 L. Above ₹5 Cr it is ₹25 L." */
export function describeSlabs(c: SlabConfig, money: (n: number) => string): string {
  return (
    `Under ${money(c.t1)} the raise is ${money(c.s1)}. ` +
    `From ${money(c.t1)} to ${money(c.t2)} it is ${money(c.s2)}. ` +
    `Above ${money(c.t2)} it is ${money(c.s3)}.`
  )
}
