import { expect, test, type Page } from '@playwright/test'
import { closeAll, roomName, signedInPlayers, type Player } from './helpers'
import { withDb } from './users'

const TEAMS = 3
const PICKS_EACH = 2

/** The overall pick number shown on the "on the clock" card, e.g. "overall 3 of 6". */
async function overall(page: Page): Promise<number | null> {
  const text = await page.getByText(/overall \d+ of \d+/).first().textContent({ timeout: 2000 }).catch(() => null)
  const m = text?.match(/overall (\d+) of/)
  return m ? Number(m[1]) : null
}

/** Wait until one of the players has the clock, and return them. */
async function whoIsOnTheClock(players: Player[]): Promise<Player> {
  let found: Player | undefined
  await expect
    .poll(
      async () => {
        for (const p of players) {
          if (await p.page.getByText('Your pick!', { exact: true }).first().isVisible().catch(() => false)) {
            found = p
            return true
          }
        }
        return false
      },
      { timeout: 30_000, intervals: [300, 500, 1000] }
    )
    .toBe(true)
  return found!
}

test('a full draft: create, invite, wheel, snake picks, leaderboard, waivers, delete', async ({ browser }) => {
  const players = await signedInPlayers(browser, TEAMS)
  const [host, b, c] = players
  const name = roomName()
  try {
    // ---- the host creates an ILT20 draft room
    await host.page.goto('/events?e=ilt20-2026')
    await host.page.getByRole('radio', { name: /Draft/ }).click()
    await host.page.getByRole('button', { name: /Create draft room/ }).click()
    await host.page.getByPlaceholder('e.g. Friends2026').fill(name)
    await host.page.locator('input[type="number"]').nth(0).fill(String(PICKS_EACH))
    await host.page.locator('input[type="number"]').nth(1).fill(String(TEAMS))
    await host.page.getByRole('button', { name: /Create draft room/ }).last().click()
    await expect(host.page.getByText('Draft room created')).toBeVisible()
    const mono = host.page.locator('.font-mono')
    const code = (await mono.nth(0).textContent())!.trim()
    const key = (await mono.nth(1).textContent())!.trim()
    expect(code).toMatch(new RegExp(`^${name}_\\d+$`))
    expect(key).toMatch(/^\d{6}$/)
    await host.page.getByRole('button', { name: 'Enter draft room' }).click()
    await host.page.waitForURL('**/draft/*')
    const draftUrl = host.page.url()

    // ---- the others join through an invite link
    for (const p of [b, c]) {
      await p.page.goto(`/join#code=${encodeURIComponent(code)}&key=${key}`)
      await p.page.waitForURL('**/draft/*')
      expect(p.page.url()).toBe(draftUrl)
    }
    await expect(host.page.getByRole('heading', { name: `Teams (${TEAMS})` })).toBeVisible()

    // ---- team identity
    await b.page.getByRole('button', { name: /My team/ }).click()
    await b.page.getByLabel('Team name').fill('Bee Hive')
    await b.page.getByRole('button', { name: '🦅' }).click()
    await b.page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(host.page.getByText('🦅 Bee Hive').first()).toBeVisible()

    // ---- the wheel and the start
    const spin = host.page.getByRole('button', { name: 'Spin the wheel' })
    await spin.click()
    await expect(host.page.getByText(/picks 1st/)).toBeVisible()
    await spin.click()
    await expect(host.page.getByRole('button', { name: 'Start draft' })).toBeVisible()
    await host.page.getByRole('button', { name: 'Start draft' }).click()
    for (const p of players) await expect(p.page.getByText(/overall 1 of 6/)).toBeVisible()

    // ---- snake picks: whoever is on the clock picks the first available player
    const order: string[] = []
    for (let pick = 1; pick <= TEAMS * PICKS_EACH; pick++) {
      const actor = await whoIsOnTheClock(players)
      order.push(actor.user.username)
      await actor.page.getByRole('button', { name: 'Pick', exact: true }).first().click()
      await actor.page.getByRole('button', { name: 'Confirm' }).click()
      if (pick < TEAMS * PICKS_EACH) {
        // every screen moves on to the next pick (live updates, not a reload)
        for (const p of players) await expect.poll(() => overall(p.page), { timeout: 20_000 }).toBe(pick + 1)
      }
    }
    // snake order: 1,2,3,3,2,1 -> the middle pick of round 1 is the middle pick of round 2
    expect(order[0]).toBe(order[5])
    expect(order[1]).toBe(order[4])
    expect(order[2]).toBe(order[3])
    expect(new Set(order).size).toBe(TEAMS)
    for (const p of players) await expect(p.page.getByText('Draft complete')).toBeVisible({ timeout: 20_000 })
    await expect(host.page.getByText('Latest pick', { exact: false }).first()).toBeVisible()

    // ---- the leaderboard: everyone is on it, team identity shows
    await b.page.getByRole('link', { name: /Leaderboard/ }).last().click()
    await b.page.waitForURL('**/leaderboard/*')
    await expect(b.page.locator('ol > li')).toHaveCount(TEAMS)
    await expect(b.page.getByText('🦅 Bee Hive').first()).toBeVisible()
    await b.page.goBack()

    // ---- waivers: the host switches them on, a member files a claim, the host runs it
    await host.page.getByText('Host tools').click()
    await host.page.getByRole('button', { name: 'Switch waivers on' }).click()
    await expect(host.page.getByText('Waivers are on')).toBeVisible()

    await expect(c.page.getByRole('button', { name: /Waivers/ })).toBeVisible({ timeout: 30_000 })
    await c.page.getByRole('button', { name: /Waivers/ }).click()
    await c.page.getByLabel('Player to drop').selectOption({ index: 1 })
    await c.page.getByLabel('Free agent to add').selectOption({ index: 1 })
    await c.page.getByRole('button', { name: 'Add to my list' }).click()
    await c.page.getByRole('button', { name: 'Save claims' }).click()
    await expect(c.page.getByText('Claims saved')).toBeVisible()

    await host.page.getByRole('button', { name: 'Run claims now' }).click()
    await expect(host.page.getByText('1 swap made')).toBeVisible()
    const won = await withDb(async (db) =>
      Number(
        (
          await db.query(
            `select count(*)::int n from draft_waiver_claims w join draft_rooms d on d.id = w.draft_id where d.room_code = $1 and w.status = 'WON'`,
            [code]
          )
        ).rows[0].n
      )
    )
    expect(won).toBe(1)

    // ---- the host deletes the draft
    await host.page.getByRole('button', { name: 'Delete draft' }).click()
    await host.page.getByRole('button', { name: 'Delete for everyone' }).click()
    await host.page.waitForURL('**/dashboard')
    const left = await withDb(async (db) => Number((await db.query('select count(*)::int n from draft_rooms where room_code = $1', [code])).rows[0].n))
    expect(left).toBe(0)
  } finally {
    await closeAll(players)
  }
})
