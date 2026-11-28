import { notFound } from 'next/navigation'
import RecapPreview from './RecapPreview'

/** Development only: the Home recap card and its share picture, with sample data. */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-slate-100">
      <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        <RecapPreview />
      </div>
    </div>
  )
}
