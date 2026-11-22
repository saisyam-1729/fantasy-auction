import { notFound } from 'next/navigation'
import DraftPreview from './DraftPreview'

/**
 * Development only: the draft room with sample data, to check layouts at any
 * screen size without signing in. /dev/draft-preview?state=lobby|drafting|done&me=1..7
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const state = sp.state === 'lobby' || sp.state === 'done' ? sp.state : 'drafting'
  const me = Math.min(7, Math.max(1, Number(sp.me) || 4))
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-slate-100">
      <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        <DraftPreview state={state} me={me} />
      </div>
    </div>
  )
}
