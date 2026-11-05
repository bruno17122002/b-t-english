// Achievement badges grouped by tier colour, with lucide icons, progress for locked ones and unlock dates.
import { motion } from 'framer-motion'
import { Lock, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Achievement } from '@shared/types'
import { cx, EmptyState, ErrorState, LoadingBlock, Tabs } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import type { ApiError } from '@/lib/api'
import { resolveAchievementIcon } from '../lib/achievementIcons'
import { filterAchievements, sortAchievements, type AchievementFilter } from '../lib/meta'

/** Tier styling – medal colours are illustration colours; legend uses the theme accent. */
const TIERS: Record<Achievement['tier'], { label: { en: string; vi: string }; ring: string; text: string }> = {
  bronze: {
    label: { en: 'Bronze', vi: 'Đồng' },
    ring: '#b87333',
    text: '#e2a26b',
  },
  silver: {
    label: { en: 'Silver', vi: 'Bạc' },
    ring: '#a0a7b4',
    text: '#c9cfdb',
  },
  gold: {
    label: { en: 'Gold', vi: 'Vàng' },
    ring: '#d4a017',
    text: '#f5c84c',
  },
  legend: {
    label: { en: 'Legend', vi: 'Huyền thoại' },
    ring: 'var(--accent)',
    text: 'var(--accent-2)',
  },
}

function AchievementBadge({ a, index }: { a: Achievement; index: number }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const Icon = resolveAchievementIcon(a.icon)
  const unlocked = !!a.unlockedAt
  const tier = TIERS[a.tier] ?? TIERS.bronze
  return (
    <motion.li
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, delay: Math.min(0.5, index * 0.025) }}
      className={cx(
        'group relative flex flex-col items-center rounded-2xl border p-4 text-center transition',
        unlocked ? 'border-line-strong bg-surface-2/70 hover:-translate-y-0.5' : 'border-line bg-surface',
      )}
      data-testid={`achievement-${a.key}`}
      aria-label={`${tx({ en: a.title, vi: a.titleVi })} – ${tx(tier.label)} – ${unlocked ? L('unlocked', 'đã mở khóa') : L('locked', 'chưa mở khóa')}`}
    >
      <div className="relative">
        <div
          className={cx(
            'flex size-16 items-center justify-center rounded-full p-[3px]',
            !unlocked && 'opacity-40 grayscale',
          )}
          style={{
            background: tier.ring,
          }}
        >
          <div className="flex size-full items-center justify-center rounded-full bg-surface">
            <Icon className="size-7" style={{ color: unlocked ? tier.text : 'var(--faint)' }} aria-hidden />
          </div>
        </div>
        {!unlocked && (
          <span className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border border-line bg-surface-2">
            <Lock className="size-3 text-muted" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-3 text-sm leading-tight font-semibold">{tx({ en: a.title, vi: a.titleVi })}</div>
      <div className="mt-1 text-xs leading-snug text-muted">{tx({ en: a.description, vi: a.descriptionVi })}</div>
      <div className="mt-auto w-full pt-3">
        {unlocked ? (
          <div className="text-[11px] text-faint">
            <span className="font-semibold" style={{ color: tier.text }}>
              {tx(tier.label)}
            </span>{' '}
            · {fmt.date(a.unlockedAt as string, { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        ) : (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(a.progress * 100)}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-faint tabular-nums">
              {fmt.number(Math.min(a.current, a.target))}/{fmt.number(a.target)} · {tx(tier.label)}
            </div>
          </>
        )}
      </div>
    </motion.li>
  )
}

export function AchievementsGrid({
  data,
  error,
  loading,
  onRetry,
}: {
  data: Achievement[] | undefined
  error: ApiError | null
  loading: boolean
  onRetry: () => void
}) {
  const L = useL()
  const [filter, setFilter] = useState<AchievementFilter>('all')
  const sorted = useMemo(() => sortAchievements(data ?? []), [data])
  const shown = filterAchievements(sorted, filter)
  const unlockedCount = sorted.filter((a) => a.unlockedAt).length

  if (error && !data) return <ErrorState error={error} onRetry={onRetry} />
  if (!data) return loading ? <LoadingBlock rows={2} /> : null

  return (
    <div data-testid="achievements">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: L('All', 'Tất cả'), count: sorted.length },
            { value: 'unlocked', label: L('Unlocked', 'Đã mở'), count: unlockedCount },
            { value: 'locked', label: L('Locked', 'Chưa mở'), count: sorted.length - unlockedCount },
          ]}
        />
        <div className="flex items-center gap-3 text-xs text-muted">
          {(Object.keys(TIERS) as Achievement['tier'][]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: TIERS[t].ring }} />
              {L(TIERS[t].label.en, TIERS[t].label.vi)}
            </span>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title={
            filter === 'locked' && sorted.length > 0
              ? L('All unlocked!', 'Đã mở khóa tất cả!')
              : L('No badges yet', 'Chưa có huy hiệu')
          }
          body={
            !(filter === 'locked' && sorted.length > 0)
              ? L(
                  'Finish a lesson, save words or keep a streak to earn your first badge.',
                  'Hoàn thành bài học, lưu từ hoặc giữ chuỗi ngày học để nhận huy hiệu đầu tiên.',
                )
              : L('You have collected every badge. Legendary!', 'Bạn đã sưu tầm mọi huy hiệu. Thật huyền thoại!')
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((a, i) => (
            <AchievementBadge key={a.key} a={a} index={i} />
          ))}
        </ul>
      )}
    </div>
  )
}
