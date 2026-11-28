import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { PASSWORD, USERS, type TestUser } from './users'

export type Player = { user: TestUser; context: BrowserContext; page: Page }

/** Sign in through the real login page and wait for Home. */
export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto('/auth')
  await page.getByPlaceholder('you@example.com').fill(user.email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
  await expect(page.getByText(`Hi, ${user.username}`)).toBeVisible()
}

/** One signed-in browser per user, each in its own context (own cookies). */
export async function signedInPlayers(browser: Browser, count = 3): Promise<Player[]> {
  const players: Player[] = []
  for (const user of USERS.slice(0, count)) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await login(page, user)
    players.push({ user, context, page })
  }
  return players
}

export async function closeAll(players: Player[]): Promise<void> {
  await Promise.all(players.map((p) => p.context.close()))
}

/** A short unique room name: letters and digits only. */
export function roomName(prefix = 'E2E'): string {
  return prefix + Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 6)
}
