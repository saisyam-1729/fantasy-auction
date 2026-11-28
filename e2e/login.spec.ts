import { expect, test } from '@playwright/test'
import { login } from './helpers'
import { USERS } from './users'

test('a user can sign in, sees Home and the app shell, and can sign out', async ({ page }) => {
  await login(page, USERS[0])
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Events/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Hi, e2ea/ })).toBeVisible()

  await page.getByRole('link', { name: /Leaderboard/ }).first().click()
  await expect(page.getByRole('heading', { name: /Leaderboards/ })).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await page.waitForURL('**/auth')
})

test('signed-out visitors are sent to the login page and back after signing in', async ({ page }) => {
  await page.goto('/events')
  await page.waitForURL(/\/auth\?next=%2Fevents/)
  await page.getByPlaceholder('you@example.com').fill(USERS[0].email)
  await page.locator('input[type="password"]').fill('E2e-Password-123')
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL('**/events')
})
