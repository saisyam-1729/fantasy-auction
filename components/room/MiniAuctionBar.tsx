'use client'

import { bidButtonLabel, type BidButtonState } from '@/lib/bidButton'
import PlayerAvatar from './PlayerAvatar'

/**
 * Slim live-auction strip shown on the other tabs while a lot is live, so a
 * player browsing squads or insights can still follow and bid.
 */
export default function MiniAuctionBar({
  imageUrl,
  team,
  playerName,
  role,
  currentBid,
  holderName,
  iHoldBid,
  countdown,
  paused,
  button,
  money,
  message,
  onBid,
  onOpen,
}: {
  imageUrl: string | null
  team?: string | null
  playerName: string
  role: string
  currentBid: number
  holderName: string
  iHoldBid: boolean
  countdown: number | null
  paused: boolean
  button: BidButtonState
  money: (n: number) => string
  message?: string
  onBid: () => void
  onOpen: () => void
}) {
  const urgent = countdown !== null && countdown <= 10 && !paused
  return (
    <div
      role="region"
      aria-label="Live auction"
      className="fixed inset-x-2 bottom-2 z-40 mx-auto max-w-2xl rounded-2xl border border-yellow-500/40 bg-slate-900/95 p-3 shadow-2xl shadow-black/60 backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <PlayerAvatar
            src={imageUrl}
            name={playerName}
            team={team}
            size={48}
            className="h-12 w-12 shrink-0 rounded-full border-2 border-yellow-500"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[11px] uppercase tracking-wide">
              <span className={paused ? 'text-amber-300' : 'text-red-400'}>{paused ? '⏸ Paused' : '● Live'}</span>
              {countdown !== null && (
                <span className={urgent ? 'font-bold text-red-300' : 'text-slate-400'}>
                  {paused ? '' : `${countdown}s`}
                </span>
              )}
            </span>
            <span className="block truncate text-sm font-bold text-white">
              {playerName} <span className="font-normal text-slate-400">{role}</span>
            </span>
            <span className="block truncate text-xs text-slate-300" aria-live="polite">
              <span className="font-semibold text-yellow-300">{money(currentBid)}</span>
              {' · '}
              <span className={iHoldBid ? 'text-green-400' : ''}>{iHoldBid ? 'You hold it' : holderName}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onBid}
          disabled={button.disabled}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {button.disabled ? bidButtonLabel(button, money) : `Bid ${money(button.nextPrice)}`}
        </button>
      </div>
      {message && (
        <div role="status" aria-live="polite" className="mt-2 text-center text-xs font-medium text-amber-300">
          {message}
        </div>
      )}
    </div>
  )
}
