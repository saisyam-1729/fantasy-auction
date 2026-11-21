'use client'

import { useState } from 'react'
import DraftHome from '@/components/draft/DraftHome'
import CreateAuctionRoom from '@/components/auction/CreateAuctionRoom'
import JoinAuctionRoom from '@/components/auction/JoinAuctionRoom'
import { EVENTS, eventById, type EventFormat } from '@/lib/events'

const card = 'backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl shadow-2xl p-6 sm:p-8'
const FORMAT_LABEL: Record<EventFormat, string> = { auction: 'Auction', draft: 'Draft' }

/**
 * The Events tab: a list of events (ILT20, SMAT, …). Opening one shows its
 * formats; an event with both lets the host choose Auction or Draft.
 */
export default function EventsHome() {
  const [eventId, setEventId] = useState<string | null>(null)
  const [format, setFormat] = useState<EventFormat>('draft')
  const [auctionView, setAuctionView] = useState<'menu' | 'create' | 'join'>('menu')
  const event = eventById(eventId)

  function open(id: string) {
    const e = eventById(id)
    setEventId(id)
    setFormat(e?.formats[0] ?? 'draft')
    setAuctionView('menu')
  }

  if (!event) {
    return (
      <div className="space-y-4">
        {EVENTS.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => open(e.id)}
            className="w-full text-left backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-5 sm:p-6 hover:bg-white/15 transition"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-2xl font-bold text-white">{e.name}</div>
                <div className="text-sm text-slate-300">{e.fullName}</div>
              </div>
              <div className="flex gap-1.5">
                {e.formats.map((f) => (
                  <span
                    key={f}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${f === 'auction' ? 'bg-yellow-500/20 text-yellow-200' : 'bg-emerald-500/20 text-emerald-200'}`}
                  >
                    {FORMAT_LABEL[f]}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-300">{e.blurb}</p>
            <p className="mt-2 text-xs text-slate-400">
              {e.players} players · {e.teams} teams
            </p>
          </button>
        ))}
      </div>
    )
  }

  const both = event.formats.length > 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setEventId(null)} className="text-slate-300 hover:text-white text-sm">
          ← All events
        </button>
        <span className="text-sm font-semibold text-white">{event.name}</span>
      </div>

      {both && (
        <div className={`${card} !p-4`}>
          <p className="text-sm text-slate-300 mb-2">How do you want to play {event.name}?</p>
          <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-900/50 p-1">
            {event.formats.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                onClick={() => {
                  setFormat(f)
                  setAuctionView('menu')
                }}
                className={`py-2.5 rounded-lg text-sm font-semibold transition ${
                  format === f ? (f === 'auction' ? 'bg-yellow-500 text-slate-900' : 'bg-emerald-500 text-slate-900') : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {FORMAT_LABEL[f]}
                <span className="block text-[11px] font-normal opacity-80">
                  {f === 'auction' ? 'Bid against a purse' : 'Take turns picking'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {format === 'draft' && <DraftHome key={event.id} event={event} />}

      {format === 'auction' && event.inventoryType && (
        <>
          {auctionView === 'menu' && (
            <div className={card}>
              <div className="text-center mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">{event.name} Auction</h2>
                <p className="text-slate-300 text-sm">
                  The same live auction as the IPL rooms (purse, bid steps, squad sizes, timer), with the {event.players}{' '}
                  {event.name} players and their base prices.
                </p>
              </div>
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setAuctionView('create')}
                  className="w-full p-5 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 rounded-2xl hover:from-yellow-400 hover:to-orange-400 transition shadow-lg"
                >
                  <div className="text-xl font-bold">Create auction room</div>
                  <div className="text-sm opacity-80">You host the auction</div>
                </button>
                <button
                  type="button"
                  onClick={() => setAuctionView('join')}
                  className="w-full p-5 bg-white/10 border-2 border-white/30 text-white rounded-2xl hover:bg-white/20 transition"
                >
                  <div className="text-xl font-bold">Join auction room</div>
                  <div className="text-sm text-slate-300">Open {event.name} rooms, or enter the ID and key</div>
                </button>
              </div>
            </div>
          )}
          {auctionView === 'create' && (
            <CreateAuctionRoom inventoryType={event.inventoryType} eventName={event.name} onBack={() => setAuctionView('menu')} />
          )}
          {auctionView === 'join' && (
            <JoinAuctionRoom
              title={`Join ${event.name} auction`}
              include={(t) => t === event.inventoryType}
              onBack={() => setAuctionView('menu')}
            />
          )}
        </>
      )}
    </div>
  )
}
