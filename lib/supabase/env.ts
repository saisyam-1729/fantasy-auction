/**
 * Public Supabase URL + anon key for browser / middleware / server helpers.
 *
 * Placeholders (URL + JWT `ref` aligned) when:
 *   - Next build phase (`NEXT_PHASE`), so prerender can run without secrets, or
 *   - `NODE_ENV === 'production'` but public env is missing (e.g. Vercel forgot to
 *     set `NEXT_PUBLIC_*` or they were not available at build time). Returning
 *     placeholders avoids a hard throw in the browser ("client-side exception").
 * In local `next dev` without env, we still throw so misconfiguration is obvious.
 */
const PLACEHOLDER_URL = 'https://build-placeholder.supabase.co'
const PLACEHOLDER_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1aWxkLXBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjEsImV4cCI6OTk5OTk5OTk5OX0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

let warnedMissingPublicEnv = false

function placeholderCredentials(): { url: string; anonKey: string } {
  return { url: PLACEHOLDER_URL, anonKey: PLACEHOLDER_ANON_KEY }
}

export function getPublicSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''

  if (url && anonKey) {
    return { url, anonKey }
  }

  const isNextBuildPhase =
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_PHASE === 'phase-development-build'

  if (isNextBuildPhase) {
    return placeholderCredentials()
  }

  if (process.env.NODE_ENV === 'production') {
    if (typeof console !== 'undefined' && !warnedMissingPublicEnv) {
      warnedMissingPublicEnv = true
      console.warn(
        '[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. ' +
          'Auth and API calls will not work until you add them on the host (e.g. Vercel env) and redeploy.'
      )
    }
    return placeholderCredentials()
  }

  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'For local dev, copy env.local.template to .env.local. ' +
      'For Vercel, add both under Project → Settings → Environment Variables (Production).'
  )
}
