// we normally use the SSR client helper throughout the app because it
// handles some of the cookie/session plumbing for Next.js. however, a
// few auth methods (notably `getSessionFromUrl`) are only exposed on the
// vanilla `@supabase/supabase-js` client.  to keep both available we
// export two helpers below.

import { createBrowserClient } from '@supabase/ssr'
import { createClient as makeJsClient } from '@supabase/supabase-js'

// used on pages/components that rely on the full supabase-js API
export function createJsClient() {
  return makeJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// default client for most of the app; wraps `createBrowserClient` from the
// SSR package which is suitable for use in both browser and server
// components and preserves auth state via cookies.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}