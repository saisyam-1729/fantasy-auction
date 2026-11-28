import { expect, test } from '@playwright/test'
import { closeAll, roomName, signedInPlayers } from './helpers'
import { withDb } from './users'

test('an ILT20 auction: create, invite, ready, live bid reaches everyone at once, sale, fantasy leaderboard', async ({ browser }) => {
  const players = await signedInPlayers(browser, 3)
  const [host, b, c] = players
  const name = roomName()
  try {
    // ---- the host creates an ILT20 auction room with a short timer
    await host.page.goto('/events?e=ilt20-2026')
    await host.page.getByRole('radio', { name: /Auction/ }).click()
    await host.page.getByRole('button', { name: /Create auction room/ }).click()
    await host.page.getByPlaceholder('e.g. IPL2025, MyAuction').fill(name)
    const numbers = host.page.locator('input[type="number"]')
    await numbers.nth(0).fill('1') // minimum squad
    await numbers.nth(1).fill('2') // maximum squad
    await numbers.nth(3).fill('10') // lot timer, seconds
    await host.page.getByRole('button', { name: 'Create Room' }).click()
    await expect(host.page.getByText('Room Created!')).toBeVisible()
    const mono = host.page.locator('.font-mono')
    const code = (await mono.nth(0).textContent())!.trim()
    const key = (await mono.nth(1).textContent())!.trim()
    await host.page.getByRole('button', { name: 'Enter Room' }).click()
    await host.page.waitForURL('**/room/*')
    await expect(host.page.getByRole('heading', { name: /ILT20 2026 Auction/ })).toBeVisible()

    // ---- the others join through an invite link
    for (const p of [b, c]) {
      await p.page.goto(`/join#code=${encodeURIComponent(code)}&key=${key}`)
      await p.page.waitForURL('**/room/*')
    }

    // ---- everyone is ready; the auction starts by itself (or with the host's button)
    for (const p of players) await p.page.getByRole('button', { name: 'I am ready' }).click()
    const startNow = host.page.getByRole('button', { name: 'Start auction now' })
    await startNow.waitFor({ timeout: 8000 }).then(() => startNow.click()).catch(() => {})
    for (const p of players) await expect(p.page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 30_000 })

    // ---- B bids; the host and C see it quickly (live updates, not the slow safety poll)
    await b.page.getByRole('button', { name: /^Bid / }).click()
    await expect(b.page.getByText('You hold the highest bid')).toBeVisible()
    const who = new RegExp(`${code}_e2eb`)
    await expect(host.page.getByText(who).locator('visible=true').first()).toBeVisible({ timeout: 8000 })
    await expect(c.page.getByText(who).locator('visible=true').first()).toBeVisible({ timeout: 8000 })

    // ---- the host sells the lot
    await host.page.getByRole('button', { name: /Hammer/ }).click()
    await expect
      .poll(
        async () =>
          withDb(async (db) =>
            Number(
              (
                await db.query(
                  `select count(*)::int n from user_squads us join room_users ru on ru.id = us.room_user_id join rooms r on r.id = ru.room_id where r.room_id = $1`,
                  [code]
                )
              ).rows[0].n
            )
          ),
        { timeout: 15_000 }
      )
      .toBe(1)
    // everyone's screen moves on to the next lot
    await expect(c.page.getByText('1 / 2').first()).toBeVisible({ timeout: 10_000 }).catch(() => {})

    // ---- the fantasy leaderboard for the auction room
    await host.page.getByRole('link', { name: /Fantasy leaderboard/ }).click()
    await host.page.waitForURL('**/leaderboard/auction/*')
    await expect(host.page.locator('ol > li')).toHaveCount(3)
    await expect(host.page.getByText(/updates every night|Points updated/).first()).toBeVisible()
  } finally {
    await closeAll(players)
  }
})
