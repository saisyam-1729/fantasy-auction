import { purseLock } from './purse'

/** Rupees. Pure and deterministic: same squads in, same numbers out. */

export type InsightRole = 'WK' | 'BAT' | 'ALL' | 'BOWL'
export const INSIGHT_ROLES: InsightRole[] = ['WK', 'BAT', 'ALL', 'BOWL']

export type InsightUser = {
  id: string
  display_name: string
  budget: number
  spent: number
}

export type InsightPlayer = {
  id: string
  player_name: string
  player_type: string
  base_price: number
  status: string
  sold_price?: number
  sold_to_user_id?: string
  purchased_at?: string
}

export type StrategyId =
  | 'top_heavy'
  | 'keeper_first'
  | 'bowling_stock'
  | 'waiting'
  | 'balanced'
  | 'all_rounder_heavy'

/** Cutoffs for the strategy label. Constants, never model judgement. */
export const TOP_HEAVY_SHARE = 0.5
export const TOP_HEAVY_MIN_BUYS = 2
export const WAITING_AFTER_ROOM_SALES = 10
export const WAITING_MAX_SPENT_SHARE = 0.1
export const ROLE_HEAVY_SHARE = 0.5
export const ROLE_HEAVY_MIN_BUYS = 4
export const KEEPER_FIRST_WINDOW = 2
export const KEEPER_FIRST_MIN_BUYS = 3

export type Buy = {
  id: string
  name: string
  role: InsightRole | null
  price: number
  base: number
  /** price / base. 0 when base is 0. */
  premium: number
  at: number
}

export type StrategyLabel = {
  strategy_id: StrategyId
  confidence: 'high' | 'medium'
  evidence: string[]
  /** Which chart the label highlights. */
  highlight: 'concentration' | 'roles' | 'purse' | null
}

export type TeamInsight = {
  userId: string
  name: string
  budget: number
  spent: number
  remaining: number
  freeToSpend: number
  slotsToMin: number
  squadCount: number
  maxSquad: number
  atCap: boolean
  /** Remaining purse covers every slot still needed for the minimum squad. */
  canFinishMin: boolean
  roles: Record<InsightRole, number>
  noKeeper: boolean
  topTwoSpend: number
  /** Share of the purse in the two most expensive buys, 0..1. */
  topTwoShare: number
  buys: Buy[]
  /** Cumulative spend after each room sale, in sale order (length = room sales). */
  cumulative: number[]
  strategy: StrategyLabel
}

export type Insights = {
  teams: TeamInsight[]
  roomSales: number
}

export function insightRole(playerType: string): InsightRole | null {
  if (playerType === 'WK' || playerType === 'BAT' || playerType === 'BOWL') return playerType
  if (playerType === 'ALL' || playerType === 'AR') return 'ALL'
  return null
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`
}

export function pickStrategy(t: {
  budget: number
  spent: number
  roles: Record<InsightRole, number>
  buys: Buy[]
  topTwoShare: number
  slotsToMin: number
  roomSales: number
}): StrategyLabel {
  const n = t.buys.length
  const balanced: StrategyLabel = {
    strategy_id: 'balanced',
    confidence: 'medium',
    evidence: [],
    highlight: null,
  }

  if (n >= TOP_HEAVY_MIN_BUYS && t.topTwoShare >= TOP_HEAVY_SHARE) {
    return {
      strategy_id: 'top_heavy',
      confidence: t.topTwoShare >= 0.65 ? 'high' : 'medium',
      evidence: [
        `${pct(t.topTwoShare)} of purse on 2 players`,
        `${n} player${n === 1 ? '' : 's'} bought so far`,
      ],
      highlight: 'concentration',
    }
  }

  const spentShare = t.budget > 0 ? t.spent / t.budget : 0
  if (t.roomSales >= WAITING_AFTER_ROOM_SALES && spentShare <= WAITING_MAX_SPENT_SHARE) {
    return {
      strategy_id: 'waiting',
      confidence: 'high',
      evidence: [
        `${pct(spentShare)} of purse spent after ${t.roomSales} sales in the room`,
        `${n} player${n === 1 ? '' : 's'} bought`,
      ],
      highlight: 'purse',
    }
  }

  const early = [...t.buys].sort((a, b) => a.at - b.at).slice(0, KEEPER_FIRST_WINDOW)
  if (n >= KEEPER_FIRST_MIN_BUYS && early.some((b) => b.role === 'WK')) {
    return {
      strategy_id: 'keeper_first',
      confidence: 'medium',
      evidence: [`WK among first ${KEEPER_FIRST_WINDOW} buys`, `${t.roles.WK} WK in ${n} buys`],
      highlight: 'roles',
    }
  }

  if (n >= ROLE_HEAVY_MIN_BUYS) {
    if (t.roles.BOWL / n >= ROLE_HEAVY_SHARE) {
      return {
        strategy_id: 'bowling_stock',
        confidence: 'medium',
        evidence: [`${t.roles.BOWL} of ${n} buys are bowlers`, `${t.roles.WK} WK`],
        highlight: 'roles',
      }
    }
    if (t.roles.ALL / n >= ROLE_HEAVY_SHARE) {
      return {
        strategy_id: 'all_rounder_heavy',
        confidence: 'medium',
        evidence: [`${t.roles.ALL} of ${n} buys are all-rounders`, `${t.roles.WK} WK`],
        highlight: 'roles',
      }
    }
  }

  return balanced
}

export function computeInsights(args: {
  users: InsightUser[]
  players: InsightPlayer[]
  minSquad: number
  maxSquad: number
}): Insights {
  const { users, players, minSquad, maxSquad } = args
  const sold = players
    .filter((p) => p.status === 'SOLD' && p.sold_to_user_id)
    .map((p) => ({ p, at: p.purchased_at ? Date.parse(p.purchased_at) : 0 }))
    // Stable order: time, then id, so equal timestamps never reorder between renders.
    .sort((a, b) => a.at - b.at || a.p.id.localeCompare(b.p.id))

  const unsoldBase = players.filter((p) => p.status === 'UNSOLD').map((p) => p.base_price)
  const minBase = unsoldBase.length > 0 ? Math.min(...unsoldBase) : 0

  const teams = users.map((u): TeamInsight => {
    const roles: Record<InsightRole, number> = { WK: 0, BAT: 0, ALL: 0, BOWL: 0 }
    const buys: Buy[] = []
    const cumulative: number[] = []
    let running = 0
    for (const { p, at } of sold) {
      if (p.sold_to_user_id === u.id) {
        const price = p.sold_price ?? 0
        const role = insightRole(p.player_type)
        if (role) roles[role] += 1
        running += price
        buys.push({
          id: p.id,
          name: p.player_name,
          role,
          price,
          base: p.base_price,
          premium: p.base_price > 0 ? price / p.base_price : 0,
          at,
        })
      }
      cumulative.push(running)
    }

    const lock = purseLock({
      budget: u.budget,
      spent: u.spent,
      squadCount: buys.length,
      minSquadSize: minSquad,
      maxSquadSize: maxSquad,
      // The next lot is unknown, so every unsold player may still be "another" slot.
      otherUnsoldBasePrices: unsoldBase,
    })
    const needed = Math.min(lock.slotsLeft, unsoldBase.length)
    const topTwoSpend = [...buys]
      .sort((a, b) => b.price - a.price)
      .slice(0, 2)
      .reduce((s, b) => s + b.price, 0)
    const topTwoShare = u.budget > 0 ? topTwoSpend / u.budget : 0
    const roomSales = sold.length

    const base = {
      userId: u.id,
      name: u.display_name,
      budget: u.budget,
      spent: u.spent,
      remaining: lock.remaining,
      freeToSpend: Math.max(0, lock.freeToSpend),
      slotsToMin: lock.slotsLeft,
      squadCount: buys.length,
      maxSquad,
      atCap: lock.atCap,
      canFinishMin: lock.remaining >= needed * minBase,
      roles,
      noKeeper: roles.WK === 0,
      topTwoSpend,
      topTwoShare,
      buys,
      cumulative,
    }
    return {
      ...base,
      strategy: pickStrategy({
        budget: u.budget,
        spent: u.spent,
        roles,
        buys,
        topTwoShare,
        slotsToMin: lock.slotsLeft,
        roomSales,
      }),
    }
  })

  return { teams, roomSales: sold.length }
}

/** One-line strip for the live screen. Counts rivals only. Empty until the first sale. */
export function rivalsStrip(insights: Insights, myUserId: string | undefined): string {
  if (insights.roomSales === 0) return ''
  const rivals = insights.teams.filter((t) => t.userId !== myUserId)
  const noKeeper = rivals.filter((t) => t.noKeeper).length
  const topHeavy = rivals.filter((t) => t.strategy.strategy_id === 'top_heavy').length
  const parts: string[] = []
  if (noKeeper > 0) parts.push(`${noKeeper} team${noKeeper === 1 ? '' : 's'} still ha${noKeeper === 1 ? 's' : 've'} no keeper`)
  if (topHeavy > 0) parts.push(`${topHeavy} team${topHeavy === 1 ? ' is' : 's are'} top-heavy`)
  return parts.length > 0 ? `Rivals: ${parts.join(' · ')}` : ''
}
