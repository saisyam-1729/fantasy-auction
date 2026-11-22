'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/shell/AppShell'
import { Button, Card, PageHeader, inputClass } from '@/components/ui'
import { parseInviteHash } from '@/lib/invite'

/**
 * One place to join any room: draft or auction. An invite link
 * (/join#code=...&key=...) fills the form and joins straight away.
 */
export default function JoinPage() {
  const router = useRouter()
  const { supabase } = useSession()
  const [code, setCode] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const tried = useRef(false)

  async function join(c: string, k: string) {
    if (!c || !k) {
      setMessage('Enter both the Room ID and the Room Key.')
      return
    }
    setBusy(true)
    setMessage('')
    // Room codes are unique per kind, so try a draft first, then an auction room.
    const draft = await supabase.rpc('join_draft_room', { p_room_code: c, p_room_key: k })
    if (!draft.error && draft.data) {
      router.push(`/draft/${draft.data}`)
      return
    }
    const auction = await supabase.rpc('join_room', { p_room_id: c, p_room_key: k })
    if (!auction.error && auction.data) {
      router.push(`/room/${auction.data}`)
      return
    }
    // Prefer the message that explains something specific (full, started) over "invalid".
    const msgs = [draft.error?.message, auction.error?.message].filter(Boolean) as string[]
    setMessage(msgs.find((m) => !/Invalid Room ID/i.test(m)) ?? msgs[0] ?? 'Could not join.')
    setBusy(false)
  }

  useEffect(() => {
    if (tried.current) return
    tried.current = true
    const fromLink = parseInviteHash(window.location.hash)
    if (fromLink.code) {
      // keep the key out of the address bar and history once read
      window.history.replaceState(null, '', '/join')
      setCode(fromLink.code)
      setKey(fromLink.key)
      if (fromLink.key) void join(fromLink.code, fromLink.key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on arrival
  }, [])

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Join a room" subtitle="Drafts and auctions. Paste the Room ID and key from the host, or open their invite link." />
      <Card>
        {message && <div className="mb-4 p-3 rounded-xl text-sm bg-red-500/20 text-red-100 border border-red-500/50">{message}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2" htmlFor="join-code">Room ID</label>
            <input id="join-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. Friends2026_42" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2" htmlFor="join-key">Room Key (6 digits)</label>
            <input id="join-key" value={key} onChange={(e) => setKey(e.target.value)} inputMode="numeric" maxLength={6} placeholder="e.g. 123456" className={inputClass} />
          </div>
          <Button tone="board" size="lg" className="w-full" disabled={busy} onClick={() => void join(code.trim(), key.trim())}>
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
