import { describe, expect, it } from 'vitest'
import { formatPoints, matchPoints, normName, parseStatzLeaders, pointsGain, rankMove } from '@/lib/fantasyPoints'

// Shape of one statz leaders row (trimmed): rank, player, team, Mat, Inns, points (highlighted), runs...
const row = (rank: number, name: string, team: string, mat: number, pts: string) =>
  `<tr><td class="ldl-rk">${rank}</td><td class="ldl-who"><span class="ldl-p"><a class="ldl-disc"><img alt=""></a>` +
  `<span class="ldl-id"><a href="#" class="ldl-name">${name}</a><span class="ldl-meta"><a class="ldl-team">` +
  `<span class="ldl-team__n">${team}</span><span class="ldl-team__c">X</span></a></span></span></span></td>` +
  `<td class="ldl-l3"><span><i>0*</i></span></td><td class="ldl-c">${mat}</td><td class="ldl-c">1</td>` +
  `<td class="ldl-c on">${pts}</td><td class="ldl-c">12</td></tr>`

const html = `<table><tr><th class="ldl-rk">#</th><th>Player</th></tr>${row(1, 'Chris Jordan', 'MI Emirates', 1, '80')}${row(
  2,
  'Khuzaima Tanveer',
  'Desert Vipers',
  2,
  '1,051'
)}${row(3, 'D&#039;Arcy Short', 'Gulf Giants', 1, '7.5')}</table>`

describe('parseStatzLeaders', () => {
  it('reads name, team, matches and the highlighted points column', () => {
    expect(parseStatzLeaders(html)).toEqual([
      { name: 'Chris Jordan', team: 'MI Emirates', points: 80, matches: 1 },
      { name: 'Khuzaima Tanveer', team: 'Desert Vipers', points: 1051, matches: 2 },
      { name: "D'Arcy Short", team: 'Gulf Giants', points: 7.5, matches: 1 },
    ])
  })

  it('returns nothing for a page without the table', () => {
    expect(parseStatzLeaders('<html><body>Maintenance</body></html>')).toEqual([])
  })
})

describe('matchPoints', () => {
  const pool = [
    { id: 1, team: 'MI Emirates', player_name: 'Chris Jordan' },
    { id: 2, team: 'Desert Vipers', player_name: 'Khuzaima Bin Tanveer' },
    { id: 3, team: 'Gulf Giants', player_name: "D'Arcy Short" },
    { id: 4, team: 'Dubai Capitals', player_name: 'Ali Khan' },
    { id: 5, team: 'Sharjah Warriorz', player_name: 'Ali Khan' },
  ]

  it('matches exact names, punctuation-insensitive', () => {
    const { matched } = matchPoints(parseStatzLeaders(html), pool)
    expect(matched.find((m) => m.player_id === 1)?.points).toBe(80)
    expect(matched.find((m) => m.player_id === 3)?.points).toBe(7.5)
  })

  it('matches a shorter spelling within the same team', () => {
    const { matched } = matchPoints(parseStatzLeaders(html), pool)
    expect(matched.find((m) => m.player_id === 2)?.points).toBe(1051)
  })

  it('uses the team to separate players with the same name', () => {
    const { matched, unmatched } = matchPoints([{ name: 'Ali Khan', team: 'Sharjah Warriorz', points: 9, matches: 1 }], pool)
    expect(matched).toEqual([{ player_id: 5, points: 9, matches: 1 }])
    expect(unmatched).toEqual([])
  })

  it('reports rather than guesses when it cannot tell', () => {
    const r = matchPoints(
      [
        { name: 'Ali Khan', team: 'Unknown XI', points: 9, matches: 1 },
        { name: 'Somebody New', team: 'MI Emirates', points: 4, matches: 1 },
      ],
      pool
    )
    expect(r.matched).toEqual([])
    expect(r.unmatched.map((u) => u.name)).toEqual(['Ali Khan', 'Somebody New'])
  })

  it('normalises names', () => {
    expect(normName('  Rahmanullah  Gurbaz (wk) ')).toBe('rahmanullah gurbaz wk')
    expect(normName('Dunith Wellalagé')).toBe('dunith wellalage')
  })
})

describe('leaderboard helpers', () => {
  it('counts places moved, up is positive', () => {
    expect(rankMove({ rank: 1, prev_rank: 4 })).toBe(3)
    expect(rankMove({ rank: 5, prev_rank: 2 })).toBe(-3)
    expect(rankMove({ rank: 2, prev_rank: 2 })).toBe(0)
    expect(rankMove({ rank: 2, prev_rank: null })).toBeNull()
  })

  it('counts points gained', () => {
    expect(pointsGain({ points: 120, prev_points: 75 })).toBe(45)
    expect(pointsGain({ points: 10, prev_points: null })).toBeNull()
  })

  it('formats points', () => {
    expect(formatPoints(80)).toBe('80')
    expect(formatPoints(7.5)).toBe('7.5')
  })
})
