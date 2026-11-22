import { notFound } from 'next/navigation'
import LeaderboardPreview from './LeaderboardPreview'

/** Development only: a leaderboard with sample data. /dev/leaderboard-preview?zero=1 shows the all-zero start. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-slate-100">
      <div className="mx-auto max-w-6xl px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        <LeaderboardPreview zero={sp.zero === '1'} />
      </div>
    </div>
  )
}
