'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/reportError'

/** Last-resort screen if the root layout itself crashes. Needs its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, 'boundary')
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#e2e8f0' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#94a3b8' }}>It has been logged. Try again, or reload the page.</p>
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: 16, padding: '8px 20px', borderRadius: 12, border: 0, background: '#eab308', color: '#0f172a', fontWeight: 700 }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
