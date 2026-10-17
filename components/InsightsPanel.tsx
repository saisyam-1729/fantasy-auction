'use client'

import { INSIGHT_ROLES, type Insights, type StrategyId, type TeamInsight } from '@/lib/insights'

const STRATEGY_TITLES: Record<StrategyId, string> = {
  top_heavy: 'Top-heavy',
  keeper_first: 'Keeper first',
  bowling_stock: 'Bowling stock',
  waiting: 'Waiting',
  balanced: 'Balanced',
  all_rounder_heavy: 'All-rounder heavy',
}

const LINE_COLORS = ['#facc15', '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#2dd4bf', '#f87171']
/** Premium bars stop here so a ₹20 L player at ₹8 Cr does not flatten everything else. */
const PREMIUM_CAP = 10

function Card({ title, question, children }: { title: string; question: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <p className="text-[11px] text-slate-400 mb-3">{question}</p>
      {children}
    </section>
  )
}

function PurseVsSlots({ teams, money }: { teams: TeamInsight[]; money: (n: number) => string }) {
  return (
    <div className="space-y-3">
      {teams.map((t) => {
        const spentPct = t.budget > 0 ? (t.spent / t.budget) * 100 : 0
        const freePct = t.budget > 0 ? (t.freeToSpend / t.budget) * 100 : 0
        const lockedPct = Math.max(0, 100 - spentPct - freePct)
        return (
          <div key={t.userId}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-200 font-semibold truncate pr-2">{t.name}</span>
              <span className={t.canFinishMin ? 'text-slate-400' : 'text-red-400 font-semibold'}>
                {t.atCap
                  ? 'Squad full'
                  : t.slotsToMin === 0
                    ? 'Minimum filled'
                    : `${t.slotsToMin} to minimum${t.canFinishMin ? '' : ' · short of purse'}`}
              </span>
            </div>
            <div className="flex h-3 overflow-hidden rounded bg-slate-800" role="img"
              aria-label={`${t.name}: ${money(t.spent)} spent, ${money(t.freeToSpend)} free, rest reserved`}>
              <div className="bg-red-400/80" style={{ width: `${spentPct}%` }} />
              <div className="bg-slate-500/70" style={{ width: `${lockedPct}%` }} />
              <div className="bg-green-400/80" style={{ width: `${freePct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-400">
              <span>Spent {money(t.spent)}</span>
              <span>Free {money(t.freeToSpend)}</span>
            </div>
          </div>
        )
      })}
      <div className="flex gap-3 text-[10px] text-slate-400">
        <span><i className="inline-block w-2 h-2 rounded-sm bg-red-400/80 mr-1" />Spent</span>
        <span><i className="inline-block w-2 h-2 rounded-sm bg-slate-500/70 mr-1" />Reserved for minimum</span>
        <span><i className="inline-block w-2 h-2 rounded-sm bg-green-400/80 mr-1" />Free to spend</span>
      </div>
    </div>
  )
}

const ROLE_COLORS = { WK: 'bg-amber-400', BAT: 'bg-sky-400', ALL: 'bg-purple-400', BOWL: 'bg-emerald-400' } as const

function RoleStrip({ teams }: { teams: TeamInsight[] }) {
  return (
    <div className="space-y-3">
      {teams.map((t) => (
        <div key={t.userId}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-200 font-semibold truncate pr-2">{t.name}</span>
            {t.noKeeper && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40">
                No WK
              </span>
            )}
          </div>
          <div className="flex h-5 overflow-hidden rounded bg-slate-800">
            {INSIGHT_ROLES.map((r) =>
              t.roles[r] > 0 ? (
                <div
                  key={r}
                  className={`${ROLE_COLORS[r]} text-[10px] font-bold text-slate-900 flex items-center justify-center`}
                  style={{ flexGrow: t.roles[r], flexBasis: 0 }}
                >
                  {r} {t.roles[r]}
                </div>
              ) : null
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Concentration({ teams }: { teams: TeamInsight[] }) {
  return (
    <div className="space-y-2">
      {[...teams].sort((a, b) => b.topTwoShare - a.topTwoShare).map((t) => (
        <div key={t.userId} className="text-xs">
          <div className="flex justify-between mb-0.5">
            <span className="text-slate-200 font-semibold truncate pr-2">{t.name}</span>
            <span className="text-slate-400">
              {t.buys.length < 2 ? 'fewer than 2 buys' : `${Math.round(t.topTwoShare * 100)}% of purse on top 2`}
            </span>
          </div>
          <div className="h-2.5 rounded bg-slate-800 overflow-hidden">
            <div className="h-full bg-yellow-400/90" style={{ width: `${Math.min(100, t.topTwoShare * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Premium({ teams }: { teams: TeamInsight[] }) {
  return (
    <div className="space-y-3">
      {teams.map((t) => (
        <div key={t.userId}>
          <div className="text-xs text-slate-200 font-semibold mb-1">{t.name}</div>
          {t.buys.length === 0 ? (
            <div className="text-[11px] text-slate-500">No players yet</div>
          ) : (
            <div className="space-y-1">
              {t.buys.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-28 truncate text-slate-300">{b.name}</span>
                  <div className="flex-1 h-2 rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-pink-400/90"
                      style={{ width: `${(Math.min(b.premium, PREMIUM_CAP) / PREMIUM_CAP) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-slate-400">
                    {b.premium >= PREMIUM_CAP ? `${PREMIUM_CAP}x+` : `${b.premium.toFixed(1)}x`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Timeline({ teams, roomSales, money }: { teams: TeamInsight[]; roomSales: number; money: (n: number) => string }) {
  const W = 520
  const H = 180
  const PAD = 28
  const maxY = Math.max(1, ...teams.map((t) => t.cumulative[t.cumulative.length - 1] ?? 0))
  const x = (i: number) => PAD + (roomSales <= 1 ? 0 : (i / (roomSales - 1)) * (W - PAD * 2))
  const y = (v: number) => H - PAD - (v / maxY) * (H - PAD * 2)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cumulative spend per team after each sale">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#475569" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#475569" />
        <text x={PAD - 4} y={PAD + 4} textAnchor="end" fontSize="9" fill="#94a3b8">{money(maxY)}</text>
        <text x={PAD - 4} y={H - PAD + 3} textAnchor="end" fontSize="9" fill="#94a3b8">0</text>
        <text x={W - PAD} y={H - 8} textAnchor="end" fontSize="9" fill="#94a3b8">sale {roomSales}</text>
        <text x={PAD} y={H - 8} fontSize="9" fill="#94a3b8">sale 1</text>
        {teams.map((t, idx) => (
          <polyline
            key={t.userId}
            fill="none"
            stroke={LINE_COLORS[idx % LINE_COLORS.length]}
            strokeWidth="2"
            points={t.cumulative.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-300">
        {teams.map((t, idx) => (
          <span key={t.userId}>
            <i className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: LINE_COLORS[idx % LINE_COLORS.length] }} />
            {t.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function InsightsPanel({
  insights,
  money,
  myUserId,
}: {
  insights: Insights
  money: (n: number) => string
  myUserId?: string
}) {
  if (insights.roomSales === 0) {
    return <div className="text-center py-12 text-slate-400">Insights appear after the first player is sold.</div>
  }
  const labelled = insights.teams.filter((t) => t.strategy.strategy_id !== 'balanced')
  return (
    <div className="space-y-4">
      {labelled.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {labelled.map((t) => (
            <div key={t.userId} className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2">
              <div className="text-xs font-bold text-yellow-300">
                {t.name}{t.userId === myUserId ? ' · You' : ''}: {STRATEGY_TITLES[t.strategy.strategy_id]}
              </div>
              <ul className="text-[11px] text-slate-300 list-disc ml-4">
                {t.strategy.evidence.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Purse vs slots" question="Can each team still finish the minimum squad, and how much is free to spend?">
          <PurseVsSlots teams={insights.teams} money={money} />
        </Card>
        <Card title="Role strip" question="Who has no keeper, and where is each squad heavy?">
          <RoleStrip teams={insights.teams} />
        </Card>
        <Card title="Spend concentration" question="Star-heavy or spread: how much of the purse sits in the two biggest buys?">
          <Concentration teams={insights.teams} />
        </Card>
        <Card title="Premium" question={`Price paid divided by base price (bars stop at ${PREMIUM_CAP}x).`}>
          <Premium teams={insights.teams} />
        </Card>
        <div className="lg:col-span-2">
          <Card title="Squad timeline" question="Cumulative spend after every sale in the room.">
            <Timeline teams={insights.teams} roomSales={insights.roomSales} money={money} />
          </Card>
        </div>
      </div>
    </div>
  )
}
