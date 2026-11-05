// Small Fluent-style primitives for the PWA (patterns copied from the desktop renderer UI, no Electron code).
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink font-semibold active:opacity-80',
  secondary: 'bg-surface-2 text-text border border-line active:bg-surface-3',
  ghost: 'text-muted active:bg-surface-2',
  danger: 'bg-danger/15 text-danger border border-danger/30 active:bg-danger/25',
  success: 'bg-success/15 text-success border border-success/30 active:bg-success/25',
}
const SIZES = { sm: 'h-9 px-3 text-sm gap-1.5', md: 'h-11 px-4 text-[15px] gap-2', lg: 'h-12 px-5 text-base gap-2' }

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: keyof typeof SIZES
  loading?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md transition-colors duration-100 select-none disabled:border-transparent disabled:bg-surface-3 disabled:text-faint',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl border border-line bg-surface p-4 shadow-card', className)}>{children}</div>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold text-muted">{children}</h2>
      {action}
    </div>
  )
}

export function Input({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[13px] text-muted">{label}</span>}
      <input
        className={cx(
          'h-11 w-full rounded-md border border-line border-b-line-strong bg-surface-2 px-3 text-[15px] text-text outline-none placeholder:text-faint focus:border-b-accent focus:border-b-2',
          className,
        )}
        {...rest}
      />
    </label>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-md border border-line bg-surface-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-9 flex-1 rounded-[3px] text-sm transition-colors',
            o.value === value ? 'bg-surface font-semibold text-text shadow-card ring-1 ring-line-strong' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="max-w-xs text-sm text-muted">{children}</p>
      {action}
    </Card>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const tones = {
    info: 'border-info/30 bg-info/10 text-text',
    warning: 'border-warning/40 bg-warning/10 text-text',
    danger: 'border-danger/40 bg-danger/10 text-text',
  }
  return <div className={cx('rounded-xl border px-3 py-2.5 text-sm', tones[tone])}>{children}</div>
}

export function Spinner() {
  return <Loader2 className="size-5 animate-spin text-muted" />
}

/** Plain SVG bar chart: flat accent bars (current period solid), HTML labels underneath so text never stretches. */
export function BarChart({
  data,
  height = 120,
  format = (v: number) => String(v),
  showEvery = 1,
}: {
  data: { label: string; value: number; highlight?: boolean }[]
  height?: number
  format?: (v: number) => string
  /** Show every n-th axis label (dense daily charts). */
  showEvery?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const n = Math.max(1, data.length)
  const colW = 10
  return (
    <div>
      <div className="mb-1 flex justify-end text-[11px] text-faint">
        <span className="font-mono">max {format(max)}</span>
      </div>
      <svg
        viewBox={`0 0 ${n * colW} 100`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join(', ')}
      >
        <line
          x1="0"
          x2={n * colW}
          y1="100"
          y2="100"
          stroke="var(--line-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(2, (d.value / max) * 96) : 0
          return (
            <rect
              key={`${d.label}-${i}`}
              x={i * colW + colW * 0.2}
              y={100 - h}
              width={colW * 0.6}
              height={h}
              fill={d.highlight ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 50%, transparent)'}
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div
        className="mt-1 grid text-center text-[10px] text-faint"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {data.map((d, i) => (
          <span key={`${d.label}-${i}`} className={cx('truncate', d.highlight && 'font-semibold text-muted')}>
            {i % showEvery === 0 || i === n - 1 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
