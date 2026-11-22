import AppShell from '@/components/shell/AppShell'

export const dynamic = 'force-dynamic'

/** Every signed-in page shares the app shell (session check, top bar, page width). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
