import { DEFAULT_SLABS, isValidSlabs, type SlabConfig } from './bidSlabs'

const LAKH = 100_000
const CRORE = 10_000_000

export const DEFAULT_BUDGET = 100 * CRORE
export const DEFAULT_TIMER_SECONDS = 30
export const MIN_BUDGET = CRORE
export const MAX_BUDGET = 100_000 * CRORE
export const MIN_TIMER = 10
export const MAX_TIMER = 120

export type RoomSettings = {
  budget: number
  timerSeconds: number
  /** null means the default 10 L / 20 L / 25 L steps. */
  slabs: SlabConfig | null
}

export const DEFAULT_SETTINGS: RoomSettings = {
  budget: DEFAULT_BUDGET,
  timerSeconds: DEFAULT_TIMER_SECONDS,
  slabs: null,
}

/** What the create-room form holds: text boxes in friendly units (Cr, seconds, L). */
export type SettingsForm = {
  budgetCr: string
  timerSeconds: string
  t1Cr: string
  t2Cr: string
  s1L: string
  s2L: string
  s3L: string
}

export const DEFAULT_FORM: SettingsForm = {
  budgetCr: '100',
  timerSeconds: '30',
  t1Cr: '2',
  t2Cr: '5',
  s1L: '10',
  s2L: '20',
  s3L: '25',
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

/** Turn the form into settings in rupees, or return a message for the first problem. */
export function parseSettingsForm(f: SettingsForm): { ok: true; settings: RoomSettings } | { ok: false; error: string } {
  const budgetCr = num(f.budgetCr)
  if (!Number.isFinite(budgetCr) || budgetCr < 1 || budgetCr > 100_000) {
    return { ok: false, error: 'Budget must be between 1 and 100000 crore.' }
  }
  const budget = Math.round(budgetCr * CRORE)

  const timer = num(f.timerSeconds)
  if (!Number.isInteger(timer) || timer < MIN_TIMER || timer > MAX_TIMER) {
    return { ok: false, error: `Timer must be a whole number of seconds from ${MIN_TIMER} to ${MAX_TIMER}.` }
  }

  const t1 = Math.round(num(f.t1Cr) * CRORE)
  const t2 = Math.round(num(f.t2Cr) * CRORE)
  const s1 = Math.round(num(f.s1L) * LAKH)
  const s2 = Math.round(num(f.s2L) * LAKH)
  const s3 = Math.round(num(f.s3L) * LAKH)
  const candidate = { t1, t2, s1, s2, s3 }
  if (!isValidSlabs(candidate)) {
    return {
      ok: false,
      error: 'Bid steps: each step must be at least 1 lakh, and the second threshold must be above the first.',
    }
  }

  const isDefault = (Object.keys(DEFAULT_SLABS) as (keyof SlabConfig)[]).every((k) => candidate[k] === DEFAULT_SLABS[k])
  return { ok: true, settings: { budget, timerSeconds: timer, slabs: isDefault ? null : candidate } }
}
