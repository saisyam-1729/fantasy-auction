import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getPublicSupabaseConfig } from '@/lib/supabase/env'

export async function createClient() {
  const cookieStore = await cookies()
  const { url, anonKey } = getPublicSupabaseConfig()

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as CookieOptions)
            )
          } catch {
            // Server Components cannot set cookies; middleware refreshes session.
          }
        },
      },
    }
  )
}
