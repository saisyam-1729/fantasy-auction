/**
 * Public Supabase URL + anon key for browser / middleware / server helpers.
 *
 * Placeholders are used only when vars are missing during a Next.js build phase
 * (`NEXT_PHASE`), so `next build` prerender can finish without real env.
 * At runtime (browser / Vercel serverless), missing public env throws so you never
 * ship a silent fake client. Set `NEXT_PUBLIC_SUPABASE_*` on Vercel and `.env.local`.
 */
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
    const placeholderUrl = 'https://build-placeholder.supabase.co'
    const placeholderAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1aWxkLXBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjEsImV4cCI6OTk5OTk5OTk5OX0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    return { url: placeholderUrl, anonKey: placeholderAnonKey }
  }

  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'For local dev, copy env.local.template to .env.local. ' +
      'For Vercel, add both under Project → Settings → Environment Variables (Production).'
  )
}
