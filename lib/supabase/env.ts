/**
 * Public Supabase URL + anon key for browser / middleware / server helpers.
 *
 * Placeholders are used only when vars are missing and either:
 *   - Next is in a production/development build phase (`NEXT_PHASE`), or
 *   - `VERCEL` is set (Vercel build or serverless) so `next build` prerender can finish.
 * Set real `NEXT_PUBLIC_SUPABASE_*` on Vercel and in `.env.local` so auth and DB work.
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

  // Vercel runs `next build` with VERCEL=1; prerender may run before/without injected public env.
  const onVercelWithoutPublicEnv = Boolean(process.env.VERCEL) && (!url || !anonKey)

  if (isNextBuildPhase || onVercelWithoutPublicEnv) {
    return {
      url: 'https://build-placeholder.supabase.co',
      anonKey:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.build-placeholder-not-for-real-requests',
    }
  }

  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'For local dev, copy env.local.template to .env.local. ' +
      'For Vercel, add both under Project → Settings → Environment Variables (Production).'
  )
}
