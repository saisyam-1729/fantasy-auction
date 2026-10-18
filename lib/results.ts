import type { Buy, Insights, TeamInsight } from './insights'

export type Standing = {
  userId: string
  name: string
  players: number
  spent: number
  remaining: number
  noKeeper: boolean
}

export type Highlight = {
  id: 'priciest' | 'premium' | 'spender'
  label: string
  team: string
  /** Player name, or empty for team-level highlights. */
  player: string
  /** Rupees: price for buys, total spent for the spender. */
  amount: number
  /** price / base, only for the premium highlight. */
  premium?: number
}

export type Results = { standings: Standing[]; highlights: Highlight[]; totalSold: number }

function allBuys(teams: TeamInsight[]): { team: TeamInsight; buy: Buy }[] {
  return teams.flatMap((team) => team.buys.map((buy) => ({ team, buy })))
}

/** Final-table numbers and highlights. Deterministic: ties break on price, then name. */
export function computeResults(insights: Insights): Results {
  const standings = insights.teams
    .map((t) => ({
      userId: t.userId,
      name: t.name,
      players: t.squadCount,
      spent: t.spent,
      remaining: t.remaining,
      noKeeper: t.noKeeper,
    }))
    .sort((a, b) => b.players - a.players || b.remaining - a.remaining || a.name.localeCompare(b.name))

  const buys = allBuys(insights.teams)
  const highlights: Highlight[] = []
  if (buys.length > 0) {
    const priciest = [...buys].sort((a, b) => b.buy.price - a.buy.price || a.buy.name.localeCompare(b.buy.name))[0]
    highlights.push({
      id: 'priciest',
      label: 'Most expensive buy',
      team: priciest.team.name,
      player: priciest.buy.name,
      amount: priciest.buy.price,
    })

    const premium = [...buys].sort(
      (a, b) => b.buy.premium - a.buy.premium || b.buy.price - a.buy.price || a.buy.name.localeCompare(b.buy.name)
    )[0]
    highlights.push({
      id: 'premium',
      label: 'Biggest premium over base',
      team: premium.team.name,
      player: premium.buy.name,
      amount: premium.buy.price,
      premium: premium.buy.premium,
    })

    const spender = [...insights.teams].sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name))[0]
    highlights.push({ id: 'spender', label: 'Biggest spender', team: spender.name, player: '', amount: spender.spent })
  }
  return { standings, highlights, totalSold: buys.length }
}

/** One row per buy, for a download. Fields are quoted. */
export function resultsCsv(insights: Insights): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const rows = [['Team', 'Player', 'Role', 'Price', 'Base price'].map(q).join(',')]
  for (const { team, buy } of allBuys(insights.teams)) {
    rows.push([team.name, buy.name, buy.role ?? '', buy.price, buy.base].map(q).join(','))
  }
  return rows.join('\n')
}
