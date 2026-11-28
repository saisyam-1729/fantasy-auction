import type { FullConfig } from '@playwright/test'
import { createUsers } from './users'

/** Pages the tests open. The dev server compiles each one on first use, which can be slow. */
const WARM_UP = ['/auth', '/dashboard', '/events', '/join', '/leaderboard', '/draft/00000000-0000-0000-0000-000000000000', '/room/00000000-0000-0000-0000-000000000000', '/leaderboard/auction/00000000-0000-0000-0000-000000000000']

export default async function globalSetup(config: FullConfig) {
  await createUsers()
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3100'
  await Promise.all(WARM_UP.map((path) => fetch(base + path, { redirect: 'manual' }).catch(() => undefined)))
}
