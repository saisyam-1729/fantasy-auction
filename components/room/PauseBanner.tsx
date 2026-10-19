'use client'

export type PauseReason = 'host' | 'away' | 'closed' | null | undefined

/** Explains, on every tab, why a live auction is not accepting bids. */
export default function PauseBanner({
  reason,
  message,
  isHost,
  onResume,
}: {
  reason: PauseReason
  message?: string | null
  isHost: boolean
  /** Host only: lifts the pause or close. */
  onResume?: () => void
}) {
  if (reason === 'closed') {
    return (
      <div role="status" aria-live="polite" className="max-w-7xl mx-auto mb-4 rounded-2xl border border-red-400/50 bg-red-950/60 px-5 py-4 text-center">
        <div className="text-lg font-bold text-red-200">🔒 Auction closed by host</div>
        {message && <p className="mt-1 whitespace-pre-wrap text-sm text-red-100/90">&ldquo;{message}&rdquo;</p>}
        <p className="mt-2 text-xs text-red-200/70">
          {isHost ? 'Press Resume when you are ready to continue.' : 'Bidding is closed. The host can resume it later.'}
        </p>
        {isHost && onResume && (
          <button
            type="button"
            onClick={onResume}
            className="mt-3 rounded-xl bg-amber-500 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-amber-400"
          >
            ▶ Resume auction
          </button>
        )}
      </div>
    )
  }
  if (reason === 'away') {
    return (
      <div role="status" aria-live="polite" className="max-w-7xl mx-auto mb-4 rounded-2xl border border-amber-400/50 bg-amber-950/50 px-5 py-3 text-center">
        <div className="font-bold text-amber-200">⏸ Auction paused: a player disconnected</div>
        {message && <p className="mt-1 text-sm text-amber-100/90">{message}</p>}
        <p className="mt-1 text-xs text-amber-200/70">
          {isHost ? 'Resume when they are back, or carry on without them.' : 'Waiting for the host to resume.'}
        </p>
        {isHost && onResume && (
          <button
            type="button"
            onClick={onResume}
            className="mt-3 rounded-xl bg-amber-500 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-amber-400"
          >
            ▶ Resume auction
          </button>
        )}
      </div>
    )
  }
  return (
    <div role="status" aria-live="polite" className="max-w-7xl mx-auto mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-center text-sm font-medium text-amber-300">
      ⏸ Auction paused. The host is taking a moment.
      {isHost && onResume && (
        <button
          type="button"
          onClick={onResume}
          className="mt-3 rounded-xl bg-amber-500 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-amber-400"
        >
          ▶ Resume auction
        </button>
      )}
    </div>
  )
}
