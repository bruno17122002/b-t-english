// Design-system primitives. Modules compose these instead of styling from scratch, so the app looks
// consistent and theme/accent changes apply everywhere.
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2, Settings2, X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { Cefr } from '@shared/content'
import { useL } from '../../i18n'
import type { ApiError } from '../../lib/api'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-gradient text-accent-ink font-semibold shadow-[0_6px_24px_-8px_var(--accent)] hover:brightness-110',
  secondary: 'bg-surface-2 text-text border border-line hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
  success: 'bg-success/15 text-success border border-success/30 hover:bg-success/25',
}
const SIZES = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: keyof typeof SIZES
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-xl transition-all duration-150 select-none disabled:opacity-50 active:scale-[0.98]',
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
})

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

// ---------- Surfaces ----------
export function Card({
  className,
  children,
  interactive,
  onClick,
  ...rest
}: { className?: string; children: ReactNode; interactive?: boolean; onClick?: () => void } & Record<`data-${string}`, string>) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
      className={cx(
        'rounded-2xl border border-line bg-surface p-5 shadow-card',
        (interactive || onClick) && 'cursor-pointer transition hover:-translate-y-0.5 hover:border-line-strong',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-4">
        {icon && (
          <div className="flex size-12 items-center justify-center rounded-2xl bg-accent/15 text-accent [&>svg]:size-6">
            {icon}
          </div>
        )}
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mb-8', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

// ---------- Badges & progress ----------
const BADGE_TONES = {
  neutral: 'bg-surface-3 text-muted',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
}
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof BADGE_TONES; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE_TONES[tone], className)}>
      {children}
    </span>
  )
}

const CEFR_COLORS: Record<Cefr, string> = {
  A1: 'bg-emerald-500/15 text-emerald-400',
  A2: 'bg-teal-500/15 text-teal-400',
  B1: 'bg-sky-500/15 text-sky-400',
  B2: 'bg-indigo-500/15 text-indigo-400',
  C1: 'bg-violet-500/15 text-violet-400',
  C2: 'bg-fuchsia-500/15 text-fuchsia-400',
}
export function CefrBadge({ level, className }: { level: Cefr; className?: string }) {
  return <span className={cx('rounded-md px-1.5 py-0.5 font-mono text-xs font-bold', CEFR_COLORS[level], className)}>{level}</span>
}

export function ProgressBar({ value, max = 1, className, tone = 'accent' }: { value: number; max?: number; className?: string; tone?: 'accent' | 'success' | 'warning' }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className={cx('h-full rounded-full', tone === 'accent' ? 'bg-accent-gradient' : tone === 'success' ? 'bg-success' : 'bg-warning')}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </div>
  )
}

export function ProgressRing({ value, size = 64, stroke = 6, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-surface-3" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          className="fill-none"
          style={{ stroke: 'var(--accent)' }}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{children}</div>
    </div>
  )
}

export function StatTile({ label, value, sub, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase [&>svg]:size-4">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  )
}

// ---------- States ----------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-accent', className)} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-surface-2', className)} />
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 text-faint [&>svg]:size-10">{icon}</div>}
      <div className="font-display text-lg font-semibold">{title}</div>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Shows an API error; AI-configuration errors get a shortcut to AI Settings. */
export function ErrorState({ error, onRetry, compact }: { error: ApiError | Error | string; onRetry?: () => void; compact?: boolean }) {
  const L = useL()
  const navigate = useNavigate()
  const message = typeof error === 'string' ? error : error.message
  const needsAi = typeof error === 'object' && 'needsAiSettings' in error && (error as ApiError).needsAiSettings
  return (
    <div role="alert" className={cx('flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 text-sm', compact ? 'p-3' : 'p-4')}>
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="flex-1">
        <p className="text-text">{message}</p>
        {(needsAi || onRetry) && (
          <div className="mt-2 flex gap-2">
            {needsAi && (
              <Button size="sm" variant="secondary" icon={<Settings2 className="size-4" />} onClick={() => navigate('/settings/ai')}>
                {L('Open AI Settings', 'Mở Cài đặt AI')}
              </Button>
            )}
            {onRetry && (
              <Button size="sm" variant="ghost" onClick={onRetry}>
                {L('Try again', 'Thử lại')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Form controls ----------
const FIELD = 'w-full rounded-xl border border-line bg-surface-2 px-3 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(FIELD, 'h-10', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(FIELD, 'min-h-28 py-2.5 leading-relaxed', className)} {...rest} />
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(FIELD, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 rounded-full transition', checked ? 'bg-accent' : 'bg-surface-3')}
    >
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-5.5' : 'left-0.5')} />
    </button>
  )
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'relative rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === it.value ? 'text-text' : 'text-muted hover:text-text',
          )}
        >
          {value === it.value && <motion.span layoutId={`tab-${items.map((i) => i.value).join('')}`} className="absolute inset-0 rounded-lg bg-surface-3" />}
          <span className="relative flex items-center gap-1.5">
            {it.label}
            {it.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs text-muted">{it.count}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const L = useL()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cx('max-h-[85vh] w-full overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-card', wide ? 'max-w-3xl' : 'max-w-lg')}
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98 }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="font-display text-xl font-semibold">{title}</h2>
              <IconButton label={L('Close', 'Đóng')} onClick={onClose}>
                <X className="size-5" />
              </IconButton>
            </div>
            {children}
            {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Simple confirm dialog for destructive or irreversible actions. */
export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: { open: boolean; title: ReactNode; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const L = useL()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {L('Cancel', 'Hủy')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{body}</div>
    </Modal>
  )
}
