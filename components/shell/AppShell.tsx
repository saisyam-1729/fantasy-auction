'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { cx } from '@/components/ui'

type Session = { user: User; supabase: SupabaseClient; username: string }

const SessionContext = createContext<Session | null>(null)

/** The signed-in user and a shared Supabase client. Only valid inside AppShell. */
export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession must be used inside AppShell')
  return s
}

const NAV = [
  { href: '/dashboard', label: 'Home', icon: '🏠', match: (p: string) => p === '/dashboard' },
  { href: '/events', label: 'Events', icon: '🏏', match: (p: string) => p.startsWith('/events') || p.startsWith('/draft') || p.startsWith('/room') },
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆', match: (p: string) => p.startsWith('/leaderboard') },
]

/**
 * Frame for every signed-in page: checks the session once, then renders the top
 * bar and a width that grows with the screen. Pages read the user with useSession.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const [supabase] = useState(() => createClient())
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    let live = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!live) return
      if (!data.user) {
        const next = window.location.pathname + window.location.search + window.location.hash
        router.replace(`/auth?next=${encodeURIComponent(next)}`)
        return
      }
      const u = data.user
      setSession({ user: u, supabase, username: u.user_metadata?.username || u.email?.split('@')[0] || 'you' })
    })
    return () => {
      live = false
    }
  }, [supabase, router])

  async function logout() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 sm:px-4 lg:px-6 h-14">
          <Link href="/dashboard" className="mr-1 sm:mr-4 font-black text-white whitespace-nowrap">
            🏏 <span className="hidden sm:inline">Fantasy Cricket</span>
          </Link>
          <nav className="flex flex-1 gap-1" aria-label="Main">
            {NAV.map((n) => {
              const active = n.match(pathname)
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-sm font-semibold transition',
                    active ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  )}
                >
                  <span aria-hidden>{n.icon}</span>
                  <span className={active ? 'inline' : 'hidden sm:inline'}>{n.label}</span>
                </Link>
              )
            })}
          </nav>
          {session && <span className="hidden md:block text-sm text-slate-400 truncate max-w-[12rem]">{session.username}</span>}
          <button type="button" onClick={() => void logout()} className="rounded-lg px-2.5 py-1.5 text-sm text-red-300 hover:bg-red-500/20">
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        {session ? <SessionContext.Provider value={session}>{children}</SessionContext.Provider> : <p className="py-20 text-center text-slate-300">Loading…</p>}
      </main>
    </div>
  )
}
