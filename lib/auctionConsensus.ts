/** Minimum players in a room before an auction can start. */
export const MIN_PLAYERS_FOR_AUCTION = 3

/** Maximum players allowed in one auction room. */
export const MAX_PLAYERS_IN_ROOM = 10

/**
 * Strict majority: more than half of `n` (for n ≥ 1).
 * Examples: 4 → 3, 5 → 3, 6 → 4, 10 → 6
 */
export function strictMajorityCount(n: number): number {
  if (n < 1) return 0
  return Math.floor(n / 2) + 1
}

/**
 * How many "ready" votes are needed to start the auction.
 * - Exactly 3 players: everyone must be ready (unanimous).
 * - More than 3: strict majority of players must be ready.
 */
export function readyVotesNeededToStart(playerCount: number): number {
  if (playerCount < MIN_PLAYERS_FOR_AUCTION) return MIN_PLAYERS_FOR_AUCTION
  if (playerCount === MIN_PLAYERS_FOR_AUCTION) return MIN_PLAYERS_FOR_AUCTION
  return strictMajorityCount(playerCount)
}

/**
 * Same rule for future host actions (pause, resume, etc.): unanimous at 3,
 * strict majority when more than 3 participants.
 */
export function decisionVotesNeeded(participantCount: number): number {
  return readyVotesNeededToStart(participantCount)
}
