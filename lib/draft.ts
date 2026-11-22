/**
 * Draft rules shared by the draft screen. The database applies the same rules
 * (supabase/draft.sql): snake order, 3 to 10 teams, picks_per_team rounds.
 */

export const DRAFT_MIN_TEAMS = 3
export const DRAFT_MAX_TEAMS = 10
export const DEFAULT_PICKS_PER_TEAM = 15
export const SMAT_POOL = 'SMAT_2026'

export type DraftStatus = 'LOBBY' | 'DRAFTING' | 'DONE'

export type DraftRoom = {
  id: string
  room_code: string
  room_key: string
  name: string
  pool: string
  owner_id: string
  status: DraftStatus
  picks_per_team: number
  max_members: number
  /** The last wheel spin; after a reset only `seq` is kept. */
  last_spin: { seq: number; member_id?: string; position?: number; last_member_id?: string | null } | null
  started_at: string | null
  /** Seconds per turn, or null for no timer. */
  pick_seconds?: number | null
  /** When the current turn began (the pick timer counts from here). */
  turn_started_at?: string | null
}

export type DraftMember = {
  id: string
  draft_id: string
  user_id: string
  username: string
  is_host: boolean
  order_pos: number | null
  joined_at: string
}

export type DraftPoolPlayer = {
  id: number
  sort_no: number
  team: string
  player_name: string
  role: string | null
  captain: string | null
  notes: string | null
}

export type DraftPick = {
  id: number
  draft_id: string
  pick_no: number
  member_id: string
  player_id: number
  picked_by: string | null
  picked_at: string
}

/** Draft position (1..n) that makes pick number `pickNo` (0-based), in snake order. */
export function snakeSlot(pickNo: number, teams: number): number {
  const round = Math.floor(pickNo / teams)
  const i = pickNo % teams
  return round % 2 === 0 ? i + 1 : teams - i
}

/** 1-based round and pick-in-round for display. */
export function roundOf(pickNo: number, teams: number): { round: number; pickInRound: number } {
  return { round: Math.floor(pickNo / teams) + 1, pickInRound: (pickNo % teams) + 1 }
}

export function totalPicks(teams: number, picksPerTeam: number): number {
  return teams * picksPerTeam
}

/** Members sorted by draft position (members without a position last, by join time). */
export function inDraftOrder(members: DraftMember[]): DraftMember[] {
  return [...members].sort((a, b) => {
    if (a.order_pos != null && b.order_pos != null) return a.order_pos - b.order_pos
    if (a.order_pos != null) return -1
    if (b.order_pos != null) return 1
    return a.joined_at.localeCompare(b.joined_at)
  })
}

/** The member who makes pick `pickNo`, or null when the order is incomplete. */
export function memberOnClock(members: DraftMember[], pickNo: number): DraftMember | null {
  const n = members.length
  if (n === 0) return null
  const slot = snakeSlot(pickNo, n)
  return members.find((m) => m.order_pos === slot) ?? null
}

/** The next `count` picks from `pickNo`, stopping at the end of the draft. */
export function upcomingPicks(
  members: DraftMember[],
  pickNo: number,
  picksPerTeam: number,
  count: number
): { pickNo: number; member: DraftMember | null }[] {
  const end = totalPicks(members.length, picksPerTeam)
  const out: { pickNo: number; member: DraftMember | null }[] = []
  for (let p = pickNo; p < end && out.length < count; p++) out.push({ pickNo: p, member: memberOnClock(members, p) })
  return out
}

export type LobbyCheck = { canSpin: boolean; canStart: boolean; reason: string | null }

/** What the host can do in the lobby, and why not. */
export function lobbyCheck(members: DraftMember[]): LobbyCheck {
  const n = members.length
  const unordered = members.filter((m) => m.order_pos == null).length
  if (n < DRAFT_MIN_TEAMS) {
    return { canSpin: false, canStart: false, reason: `Waiting for players: ${n} of at least ${DRAFT_MIN_TEAMS}` }
  }
  if (n > DRAFT_MAX_TEAMS) return { canSpin: false, canStart: false, reason: `At most ${DRAFT_MAX_TEAMS} teams` }
  if (unordered > 0) return { canSpin: true, canStart: false, reason: 'Spin the wheel to set the draft order' }
  return { canSpin: false, canStart: true, reason: null }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Plain-text summary of every team's picks, for copying into a chat. */
export function draftSummaryText(
  roomName: string,
  members: DraftMember[],
  picks: DraftPick[],
  players: Map<number, DraftPoolPlayer>
): string {
  const lines = [`${roomName} draft`]
  for (const m of inDraftOrder(members)) {
    const mine = picks.filter((p) => p.member_id === m.id).sort((a, b) => a.pick_no - b.pick_no)
    lines.push('', `${m.order_pos ?? '-'}. ${m.username} (${mine.length})`)
    mine.forEach((p, i) => {
      const pl = players.get(p.player_id)
      lines.push(`  ${i + 1}. ${pl ? `${pl.player_name} (${pl.team})` : `#${p.player_id}`}`)
    })
  }
  return lines.join('\n')
}

/** When the current turn runs out (ms since epoch), or null for an untimed or finished draft. */
export function turnDeadline(room: Pick<DraftRoom, 'status' | 'pick_seconds' | 'turn_started_at'>): number | null {
  if (room.status !== 'DRAFTING' || !room.pick_seconds || !room.turn_started_at) return null
  return new Date(room.turn_started_at).getTime() + room.pick_seconds * 1000
}

/** Move one id up or down in an ordered list; unchanged at the ends or when missing. */
export function moveInList<T>(list: T[], item: T, dir: -1 | 1): T[] {
  const i = list.indexOf(item)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

export const PICK_TIMER_OPTIONS = [
  { value: '', label: 'No timer' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '90', label: '90 seconds' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
] as const
