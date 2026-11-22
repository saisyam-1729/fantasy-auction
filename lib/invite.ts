/**
 * Invite links. The code and key go in the URL fragment (#...), which browsers
 * never send to the server, so they stay out of server and analytics logs.
 */
export function inviteLink(origin: string, code: string, key: string): string {
  return `${origin}/join#code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`
}

export function inviteText(origin: string, what: string, code: string, key: string): string {
  return `Join my ${what}\n${inviteLink(origin, code, key)}\n\nRoom ID: ${code}\nRoom Key: ${key}`
}

/** Read {code, key} from a fragment like "#code=X&key=Y". */
export function parseInviteHash(hash: string): { code: string; key: string } {
  const p = new URLSearchParams(hash.replace(/^#/, ''))
  return { code: (p.get('code') ?? '').trim(), key: (p.get('key') ?? '').trim() }
}
