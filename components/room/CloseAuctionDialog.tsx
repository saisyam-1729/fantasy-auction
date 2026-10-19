'use client'

import { useState } from 'react'

export const CLOSE_MESSAGE_MAX = 280

/** Host closes the auction and may leave a note that every player sees. */
export default function CloseAuctionDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (message: string) => void
}) {
  const [message, setMessage] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Close auction">
      <div className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl">
        <h3 className="text-lg font-bold text-white">Close the auction for now?</h3>
        <p className="mt-1 text-sm text-slate-300">
          Bidding stops for everyone and the lot timer freezes. You can resume later from this room. Add a note
          for the players if you like.
        </p>
        <label className="mt-4 block text-xs text-slate-300">
          Message to all players (optional)
          <textarea
            value={message}
            maxLength={CLOSE_MESSAGE_MAX}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. Dinner break, back at 9:30 PM"
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
        </label>
        <div className="mt-1 text-right text-[11px] text-slate-500">
          {message.length}/{CLOSE_MESSAGE_MAX}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-500 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(message)}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500"
          >
            Close auction
          </button>
        </div>
      </div>
    </div>
  )
}
