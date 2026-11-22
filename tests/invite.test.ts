import { describe, expect, it } from 'vitest'
import { inviteLink, inviteText, parseInviteHash } from '@/lib/invite'

describe('invite links', () => {
  it('puts code and key in the fragment and reads them back', () => {
    const link = inviteLink('https://app.example', 'ILT202026_405', '051862')
    expect(link).toBe('https://app.example/join#code=ILT202026_405&key=051862')
    expect(parseInviteHash(new URL(link).hash)).toEqual({ code: 'ILT202026_405', key: '051862' })
  })

  it('escapes odd characters and tolerates a missing key', () => {
    expect(parseInviteHash(new URL(inviteLink('https://a.b', 'A B&C', '1')).hash).code).toBe('A B&C')
    expect(parseInviteHash('#code=X')).toEqual({ code: 'X', key: '' })
    expect(parseInviteHash('')).toEqual({ code: '', key: '' })
  })

  it('writes an invite message with the link and the details', () => {
    expect(inviteText('https://a.b', 'ILT20 2026 draft', 'C_1', '123456')).toContain('https://a.b/join#code=C_1&key=123456')
  })
})
