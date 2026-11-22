/**
 * Shared building blocks, so pages don't restyle cards, buttons and tabs by hand.
 * Tailwind only; no state except Segmented's click handler.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Card({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' }) {
  return <Tag className={cx('backdrop-blur-xl bg-white/[0.07] border border-white/15 rounded-2xl p-4 sm:p-5', className)}>{children}</Tag>
}

type Tone = 'primary' | 'auction' | 'draft' | 'board' | 'ghost' | 'danger'
const TONES: Record<Tone, string> = {
  primary: 'bg-white text-slate-900 hover:bg-slate-200',
  auction: 'bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 hover:from-yellow-400 hover:to-orange-400',
  draft: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-900 hover:from-emerald-400 hover:to-teal-400',
  board: 'bg-sky-500 text-slate-900 hover:bg-sky-400',
  ghost: 'bg-white/10 text-white border border-white/20 hover:bg-white/20',
  danger: 'bg-red-500/20 text-red-200 border border-red-500/50 hover:bg-red-500/30',
}

export function Button({
  tone = 'ghost',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-3 text-base' }
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed',
        sizes[size],
        TONES[tone],
        className
      )}
    />
  )
}

/** A row of mutually exclusive tabs. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  tone = 'draft',
  className,
  label,
}: {
  value: T
  options: readonly (readonly [T, ReactNode])[]
  onChange: (v: T) => void
  tone?: 'draft' | 'auction' | 'board'
  className?: string
  label?: string
}) {
  const on = { draft: 'bg-emerald-500 text-slate-900', auction: 'bg-yellow-500 text-slate-900', board: 'bg-sky-500 text-slate-900' }[tone]
  return (
    <div role="tablist" aria-label={label} className={cx('grid gap-1 rounded-xl bg-white/10 p-1', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cx('py-2 rounded-lg text-sm font-semibold transition', value === v ? on : 'text-slate-200 hover:bg-white/10')}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

const BADGES = {
  green: 'bg-emerald-500/20 text-emerald-200',
  yellow: 'bg-yellow-500/20 text-yellow-200',
  sky: 'bg-sky-500/20 text-sky-200',
  grey: 'bg-slate-500/30 text-slate-200',
  amber: 'bg-amber-500/20 text-amber-200',
}

export function Badge({ children, tone = 'grey', className }: { children: ReactNode; tone?: keyof typeof BADGES; className?: string }) {
  return <span className={cx('inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', BADGES[tone], className)}>{children}</span>
}

/** Page title row: title, optional subtitle and actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{title}</h1>
        {subtitle && <div className="mt-0.5 text-xs sm:text-sm text-slate-300">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export const inputClass =
  'w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition'
