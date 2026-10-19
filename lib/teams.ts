/** IPL franchise colours, used for the initials avatar when a player has no photo. */
const TEAM_COLOURS: Record<string, { bg: string; fg: string }> = {
  CSK: { bg: '#F9CD05', fg: '#1B1B1B' },
  MI: { bg: '#004BA0', fg: '#FFFFFF' },
  RCB: { bg: '#D1171B', fg: '#FFFFFF' },
  KKR: { bg: '#3A225D', fg: '#F2C200' },
  DC: { bg: '#17479E', fg: '#FFFFFF' },
  SRH: { bg: '#F26522', fg: '#1B1B1B' },
  RR: { bg: '#EA1A85', fg: '#FFFFFF' },
  PBKS: { bg: '#ED1B24', fg: '#FFFFFF' },
  LSG: { bg: '#00A3E0', fg: '#0B1B2B' },
  GT: { bg: '#1C2C5B', fg: '#C9A227' },
}

const NEUTRAL = { bg: '#334155', fg: '#F1F5F9' }

export function teamColours(team: string | null | undefined): { bg: string; fg: string } {
  return (team && TEAM_COLOURS[team.trim().toUpperCase()]) || NEUTRAL
}

/** Up to two letters: first and last word of the name. "Ishan Kishan" -> "IK", "Rashid" -> "R". */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s.\-']+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return (first + last).toUpperCase()
}
