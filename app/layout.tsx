import type { Metadata } from 'next'
import './globals.css'
import ErrorReporter from '@/components/ErrorReporter'

export const metadata: Metadata = {
  title: 'IPL Auction - Fantasy Cricket',
  description: 'Real-time fantasy cricket auction platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <ErrorReporter />
        {children}
        <footer className="bg-slate-900 px-4 py-3 text-center text-[11px] text-slate-500">
          Player photos from Wikipedia and Wikimedia Commons.{' '}
          <a href="/credits" className="underline hover:text-slate-300">
            Photo credits
          </a>
        </footer>
      </body>
    </html>
  )
}