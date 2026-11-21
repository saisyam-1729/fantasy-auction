'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import CreateAuctionRoom from '@/components/auction/CreateAuctionRoom'
import JoinAuctionRoom from '@/components/auction/JoinAuctionRoom'
import EventsHome from '@/components/events/EventsHome'
import { EVENT_INVENTORY_TYPES } from '@/lib/events'

type DashboardTab = 'auction' | 'events'
const TAB_KEY = 'dashboard-tab'

function savedTab(): DashboardTab {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(TAB_KEY) : null
    // 'smat' was the tab's name before Events
    return v === 'events' || v === 'smat' ? 'events' : 'auction'
  } catch {
    return 'auction'
  }
}

const notEventRoom = (inventoryType: string) => !EVENT_INVENTORY_TYPES.has(inventoryType)

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'menu' | 'create' | 'join'>('menu')
  const [tab, setTabState] = useState<DashboardTab>(savedTab)
  const router = useRouter()
  const [supabase] = useState(() => createClient())

  function setTab(next: DashboardTab) {
    setTabState(next)
    try {
      window.localStorage.setItem(TAB_KEY, next)
    } catch {
      // private mode: the tab just isn't remembered
    }
  }

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/auth')
        return
      }
      setUser(data.user)
      setLoading(false)
    })
  }, [supabase, router])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="flex justify-between items-center backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4">
          <div>
            <h1 className="text-2xl font-bold text-white">🏏 {tab === 'events' ? 'Events' : 'IPL Auction'}</h1>
            <p className="text-slate-300 text-sm">Welcome, {user?.user_metadata?.username || user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-xl hover:bg-red-500 hover:text-white transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* IPL Auction / Events tabs */}
      <div className="max-w-2xl mx-auto mb-6">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-white/10 border border-white/20 p-1">
          {([
            ['auction', 'IPL Auction'],
            ['events', 'Events'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`py-2.5 rounded-xl text-sm font-semibold transition ${
                tab === id ? (id === 'events' ? 'bg-emerald-500 text-slate-900' : 'bg-yellow-500 text-slate-900') : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              {label}
              {id === 'events' && <span className="ml-1 text-xs font-normal opacity-80">ILT20 · SMAT</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === 'events' ? (
        <div className="max-w-2xl mx-auto">
          <EventsHome />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto">
          {view === 'menu' && (
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-8">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-white mb-2">Choose an Option</h2>
                <p className="text-slate-300">Create a new room or join an existing auction</p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setView('create')}
                  className="w-full p-6 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 rounded-2xl hover:from-yellow-400 hover:to-orange-400 transition transform hover:scale-[1.02] active:scale-[0.98] shadow-lg"
                >
                  <div className="text-2xl font-bold mb-1">Create New Room</div>
                  <div className="text-sm opacity-80">Start a new auction as host</div>
                </button>

                <button
                  onClick={() => setView('join')}
                  className="w-full p-6 backdrop-blur-xl bg-white/10 border-2 border-white/30 text-white rounded-2xl hover:bg-white/20 transition transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  <div className="text-2xl font-bold mb-1">Join Existing Room</div>
                  <div className="text-sm text-slate-300">Browse open rooms or enter ID and key</div>
                </button>
              </div>
            </div>
          )}

          {view === 'create' && <CreateAuctionRoom onBack={() => setView('menu')} />}
          {view === 'join' && <JoinAuctionRoom include={notEventRoom} onBack={() => setView('menu')} />}
        </div>
      )}
    </div>
  )
}
