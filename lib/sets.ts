/**
 * IPL-style auction sets. Mirrors _auction_set_rank in supabase/auction_sets.sql,
 * so the label shown here is the set the database actually picks from.
 */

export const MARQUEE_MIN_BASE = 30_000_000 // ₹3 Cr
export const EMERGING_MAX_BASE = 2_000_000 // ₹20 L

export const SET_NAMES = ['Marquee', 'Batters', 'All-rounders', 'Wicketkeepers', 'Bowlers', 'Emerging'] as const

export type SetInfo = { rank: number; name: (typeof SET_NAMES)[number] }

export function setRank(basePrice: number, playerType: string): number {
  if (basePrice >= MARQUEE_MIN_BASE) return 1
  if (basePrice <= EMERGING_MAX_BASE) return 6
  const t = playerType.toUpperCase()
  if (t === 'BAT') return 2
  if (t === 'ALL' || t === 'AR') return 3
  if (t === 'WK') return 4
  return 5
}

export function setInfo(basePrice: number, playerType: string): SetInfo {
  const rank = setRank(basePrice, playerType)
  return { rank, name: SET_NAMES[rank - 1] }
}

/** How far through the current set the auction is, e.g. "Set 2 of 6: Batters, 11 left". */
export function setProgress(
  current: { base_price: number; player_type: string } | null,
  players: { base_price: number; player_type: string; status: string; id: string }[],
  currentId: string | null
): string {
  if (!current) return ''
  const here = setInfo(current.base_price, current.player_type)
  const left = players.filter(
    (p) => p.status === 'UNSOLD' && p.id !== currentId && setRank(p.base_price, p.player_type) === here.rank
  ).length
  return `Set ${here.rank} of ${SET_NAMES.length}: ${here.name}, ${left} more in this set`
}

/** Order used for upcoming lots in 'sets' mode: set rank, then base price high to low. */
export function compareBySets(
  a: { base_price: number; player_type: string },
  b: { base_price: number; player_type: string }
): number {
  return setRank(a.base_price, a.player_type) - setRank(b.base_price, b.player_type) || b.base_price - a.base_price
}
