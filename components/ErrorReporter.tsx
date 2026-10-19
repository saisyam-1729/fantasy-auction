'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/reportError'

/** Mounts once and forwards uncaught browser errors to the server log. Renders nothing. */
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, 'window')
    const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason ?? 'Unhandled promise rejection', 'promise')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
