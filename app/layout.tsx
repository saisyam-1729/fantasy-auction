import type { Metadata } from 'next'
import './globals.css'

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
        {children}
      </body>
    </html>
  )
}