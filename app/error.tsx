'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/reportError'

/** Shown when a page crashes while rendering. The error is also sent to the server log. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, 'boundary')
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="max-w-md rounded-3xl border border-white/20 bg-white/10 p-8 text-center backdrop-blur-xl">
        <div className="mb-3 text-5xl">🏏</div>
        <h1 className="text-xl font-bold text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-300">
          The page hit a problem. It has been logged. Try again, and if it keeps happening, reload the page.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-yellow-500 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-yellow-400"
          >
            Try again
          </button>
          <a href="/dashboard" className="rounded-xl border border-slate-500 px-5 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
            Dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
