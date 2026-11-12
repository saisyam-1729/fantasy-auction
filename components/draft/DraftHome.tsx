'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_PICKS_PER_TEAM,
  DRAFT_MAX_TEAMS,
  DRAFT_MIN_TEAMS,
  SMAT_POOL,
  type DraftStatus,
} from '@/lib/draft'

type MyDraft = { id: string; room_code: string; name: string; status: DraftStatus; created_at: string }
type OpenDraft = { id: string; room_code: string; name: string; member_count: number; max_members: number }

const input =
  'w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500'
const primary =
  'w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-900 font-bold rounded-xl hover:from-emerald-400 hover:to-teal-400 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg'
const card = 'backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-6 sm:p-8'

const STATUS_LABEL: Record<DraftStatus, string> = { LOBBY: 'In lobby', DRAFTING: 'Drafting', DONE: 'Finished' }

/** The SMAT 2026 tab on the dashboard: your drafts, create a draft, join a draft. */
export default function DraftHome() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [view, setView] = useState<'menu' | 'create' | 'join'>('menu')
  const [mine, setMine] = useState<MyDraft[]>([])
  const [mineLoading, setMineLoading] = useState(true)

  const [name, setName] = useState('')
  const [picksPerTeam, setPicksPerTeam] = useState(String(DEFAULT_PICKS_PER_TEAM))
  const [maxTeams, setMaxTeams] = useState(String(DRAFT_MAX_TEAMS))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [created, setCreated] = useState<{ id: string; code: string; key: string } | null>(null)
  const [toast, setToast] = useState('')

  const [open, setOpen] = useState<OpenDraft[]>([])
  const [code, setCode] = useState('')
  const [key, setKey] = useState('')

  useEffect(() => {
    let live = true
    void supabase
      .from('draft_rooms')
      .select('id, room_code, name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!live) return
        setMine((data ?? []) as MyDraft[])
        setMineLoading(false)
      })
    return () => {
      live = false
    }
  }, [supabase])

  useEffect(() => {
    if (view !== 'join') return
    let live = true
    void supabase.rpc('list_open_draft_rooms').then(({ data }) => {
      if (live) setOpen((data ?? []) as OpenDraft[])
    })
    return () => {
      live = false
    }
  }, [view, supabase])

  function go(next: 'menu' | 'create' | 'join') {
    setMessage('')
    setView(next)
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setToast(`${label} copied`)
    } catch {
      setToast('Copy failed. Select and copy it by hand.')
    }
    setTimeout(() => setToast(''), 2200)
  }

  async function create() {
    if (!/^[A-Za-z0-9]{3,30}$/.test(name)) {
      setMessage('Room name must be 3 to 30 letters or digits, no spaces.')
      return
    }
    const picks = Number(picksPerTeam)
    const teams = Number(maxTeams)
    if (!Number.isInteger(picks) || picks < 1 || picks > 30) {
      setMessage('Picks per team must be a whole number from 1 to 30.')
      return
    }
    if (!Number.isInteger(teams) || teams < DRAFT_MIN_TEAMS || teams > DRAFT_MAX_TEAMS) {
      setMessage(`Maximum teams must be from ${DRAFT_MIN_TEAMS} to ${DRAFT_MAX_TEAMS}.`)
      return
    }
    setBusy(true)
    setMessage('')
    const { data, error } = await supabase.rpc('create_draft_room', {
      p_name: name,
      p_picks_per_team: picks,
      p_max_members: teams,
      p_pool: SMAT_POOL,
    })
    setBusy(false)
    const row = Array.isArray(data) ? data[0] : null
    if (error || !row) {
      setMessage(error?.message ?? 'Could not create the draft.')
      return
    }
    setCreated({ id: row.id, code: row.room_code, key: row.room_key })
  }

  async function join() {
    if (!code.trim() || !key.trim()) {
      setMessage('Enter both the Room ID and the Room Key.')
      return
    }
    setBusy(true)
    setMessage('')
    const { data, error } = await supabase.rpc('join_draft_room', { p_room_code: code.trim(), p_room_key: key.trim() })
    if (error || !data) {
      setBusy(false)
      setMessage(error?.message ?? 'Could not join.')
      return
    }
    router.push(`/draft/${data}`)
  }

  if (created) {
    return (
      <div className={card}>
        <h2 className="text-2xl font-bold text-white mb-1 text-center">Draft room created</h2>
        <p className="text-slate-300 text-center mb-6 text-sm">Share these with the other teams (3 to 10 in total).</p>
        {[
          ['Room ID', created.code],
          ['Room Key', created.key],
        ].map(([label, value]) => (
          <div key={label} className="mb-3 bg-slate-800/50 border border-slate-600 rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">{label}</div>
              <div className="text-xl font-bold text-white font-mono break-all">{value}</div>
            </div>
            <button type="button" onClick={() => void copy(value, label)} className="shrink-0 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm hover:bg-white/20">
              Copy
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => void copy(`Join my SMAT 2026 draft\nRoom ID: ${created.code}\nRoom Key: ${created.key}`, 'Invite')}
          className="w-full mb-4 py-3 rounded-xl border-2 border-emerald-500/60 text-emerald-200 font-semibold hover:bg-emerald-500/10 transition"
        >
          Copy invite (ID + key)
        </button>
        {toast && <p className="text-center text-green-300 text-sm mb-3">{toast}</p>}
        <button type="button" onClick={() => router.push(`/draft/${created.id}`)} className={primary}>
          Enter draft room
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className="p-4 rounded-xl text-sm font-medium bg-red-500/20 text-red-200 border border-red-500/50">{message}</div>
      )}

      {view === 'menu' && (
        <div className={card}>
          <div className="text-center mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">SMAT 2026 Draft</h2>
            <p className="text-slate-300 text-sm">
              No money, no bidding. Everyone sees the same pool of Syed Mushtaq Ali Trophy players and takes turns
              picking in snake order (1, 2, 3 … 3, 2, 1 …). The host spins a wheel to set the order.
            </p>
          </div>
          <div className="space-y-4">
            <button type="button" onClick={() => go('create')} className="w-full p-5 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-900 rounded-2xl hover:from-emerald-400 hover:to-teal-400 transition shadow-lg">
              <div className="text-xl font-bold">Create draft room</div>
              <div className="text-sm opacity-80">You host and spin the order wheel</div>
            </button>
            <button type="button" onClick={() => go('join')} className="w-full p-5 bg-white/10 border-2 border-white/30 text-white rounded-2xl hover:bg-white/20 transition">
              <div className="text-xl font-bold">Join draft room</div>
              <div className="text-sm text-slate-300">With the Room ID and key from the host</div>
            </button>
          </div>

          <h3 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Your drafts</h3>
          {mineLoading ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : mine.length === 0 ? (
            <p className="text-slate-400 text-sm">None yet.</p>
          ) : (
            <ul className="divide-y divide-slate-700 rounded-xl border border-slate-600 bg-slate-900/40">
              {mine.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => router.push(`/draft/${d.id}`)} className="w-full px-4 py-3 text-left hover:bg-white/5 flex items-center justify-between gap-3">
                    <span className="font-mono font-semibold text-emerald-300 truncate">{d.room_code}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.status === 'DRAFTING' ? 'bg-emerald-500/20 text-emerald-200' : d.status === 'DONE' ? 'bg-slate-500/30 text-slate-300' : 'bg-yellow-500/20 text-yellow-200'}`}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'create' && (
        <div className={card}>
          <button type="button" onClick={() => go('menu')} className="mb-5 text-slate-300 hover:text-white">← Back</button>
          <h2 className="text-2xl font-bold text-white mb-5">Create draft room</h2>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Room name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SMATFriends" className={input} />
              <p className="text-xs text-slate-400 mt-1">Letters and digits only.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Picks per team</label>
                <input type="number" min={1} max={30} value={picksPerTeam} onChange={(e) => setPicksPerTeam(e.target.value)} className={input} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Maximum teams</label>
                <input type="number" min={DRAFT_MIN_TEAMS} max={DRAFT_MAX_TEAMS} value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} className={input} />
              </div>
            </div>
            <p className="text-xs text-slate-400 -mt-2">
              The draft needs at least {DRAFT_MIN_TEAMS} teams to start, and takes up to {DRAFT_MAX_TEAMS}. It ends when every
              team has made its picks.
            </p>
            <button type="button" onClick={() => void create()} disabled={busy} className={primary}>
              {busy ? 'Creating…' : 'Create draft room'}
            </button>
          </div>
        </div>
      )}

      {view === 'join' && (
        <div className={card}>
          <button type="button" onClick={() => go('menu')} className="mb-5 text-slate-300 hover:text-white">← Back</button>
          <h2 className="text-2xl font-bold text-white mb-2">Join draft room</h2>
          <p className="text-slate-400 text-sm mb-4">Open lobbies. Tap one to fill the Room ID, then enter the key from the host.</p>
          <div className="mb-6 max-h-56 overflow-y-auto rounded-xl border border-slate-600 bg-slate-900/40">
            {open.length === 0 ? (
              <p className="p-5 text-center text-sm text-slate-400">No open draft lobbies right now.</p>
            ) : (
              <ul className="divide-y divide-slate-700">
                {open.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setCode(d.room_code)} className="w-full px-4 py-3 text-left hover:bg-white/5 flex items-center justify-between gap-3">
                      <span className="font-mono font-semibold text-emerald-300 truncate">{d.room_code}</span>
                      <span className="text-xs text-slate-400 shrink-0">{d.member_count}/{d.max_members} teams</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Room ID</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SMATFriends_42" className={input} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Room Key (6 digits)</label>
              <input value={key} onChange={(e) => setKey(e.target.value)} maxLength={6} inputMode="numeric" placeholder="e.g. 123456" className={input} />
            </div>
            <button type="button" onClick={() => void join()} disabled={busy} className={primary}>
              {busy ? 'Joining…' : 'Join draft'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
