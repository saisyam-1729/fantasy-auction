'use client'

export type ConnectionState = 'live' | 'reconnecting' | 'offline'

/** Shown only when the live connection is not healthy. */
export default function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state === 'live') return null
  const offline = state === 'offline'
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-50 px-4 py-2 text-center text-sm font-semibold shadow-lg ${
        offline ? 'bg-red-600 text-white' : 'bg-amber-500 text-slate-900'
      }`}
    >
      {offline
        ? "You're offline. Bids can't be placed until you reconnect."
        : 'Reconnecting to the auction…'}
    </div>
  )
}
