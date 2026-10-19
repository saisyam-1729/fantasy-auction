import Link from 'next/link'
import manifest from '@/data/player-images.json'

export const metadata = { title: 'Photo credits - IPL Auction' }

type Credit = {
  name: string
  file: string
  wikipedia: string
  licence: string
  artist: string
  source: string
}

export default function CreditsPage() {
  const credits = (manifest as Credit[]).slice().sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="mx-auto max-w-4xl rounded-3xl border border-white/20 bg-white/10 p-5 backdrop-blur-xl sm:p-8">
        <h1 className="text-2xl font-bold text-white">Photo credits</h1>
        <p className="mt-2 text-sm text-slate-300">
          Player photos come from Wikipedia and Wikimedia Commons and are used under the free licences shown below,
          with thanks to the photographers. Players without a listed photo show their initials. This is an unofficial
          fan project and is not affiliated with the IPL or any franchise.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="p-2 text-left">Player</th>
                <th className="p-2 text-left">Photographer</th>
                <th className="p-2 text-left">Licence</th>
                <th className="p-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {credits.map((c) => (
                <tr key={c.name}>
                  <td className="p-2 font-semibold text-white">{c.name}</td>
                  <td className="p-2 text-slate-300">{c.artist}</td>
                  <td className="p-2 text-slate-300">{c.licence}</td>
                  <td className="p-2">
                    <a href={c.source} target="_blank" rel="noopener noreferrer" className="text-yellow-300 underline">
                      File page
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6">
          <Link href="/dashboard" className="text-sm text-yellow-300 underline">
            Back to the app
          </Link>
        </div>
      </div>
    </div>
  )
}
