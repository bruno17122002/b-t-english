// Recent activity feed grouped by day, with "load more" paging via progress:activity { beforeId }.
import {
  BookOpen,
  Clapperboard,
  ClipboardCheck,
  Feather,
  GraduationCap,
  Headphones,
  History,
  Leaf,
  type LucideIcon,
  MessagesSquare,
  Mic,
  Repeat,
  Shield,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityEntry } from '@shared/types'
import { localDateKey } from '@core/dates'
import { Button, EmptyState, ErrorState, LoadingBlock } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, type ApiError } from '@/lib/api'
import { actionLabel, groupByDay } from '../../lib/meta'

const PAGE = 20

const ACTION_ICONS: Record<string, LucideIcon> = {
  word_saved: Leaf,
  review_done: Repeat,
  lesson_completed: GraduationCap,
  listening_done: Headphones,
  speaking_done: Mic,
  reading_done: BookOpen,
  writing_submitted: Feather,
  grammar_done: Shield,
  cinema_scene: Clapperboard,
  story_completed: Clapperboard,
  tutor_message: MessagesSquare,
  assessment_done: ClipboardCheck,
}

export function ActivityFeed({ reloadKey }: { reloadKey: number }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const [items, setItems] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const seq = useRef(0)

  const loadFirst = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await api('progress:activity', { limit: PAGE })
      if (id !== seq.current) return
      setItems(res)
      setHasMore(res.length === PAGE)
    } catch (err) {
      if (id === seq.current) setError(toApiError(err))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFirst()
  }, [loadFirst, reloadKey])

  const loadMore = async () => {
    const last = items[items.length - 1]
    if (!last) return
    const id = seq.current
    setLoadingMore(true)
    try {
      const res = await api('progress:activity', { limit: PAGE, beforeId: last.id })
      if (id !== seq.current) return
      setItems((prev) => [...prev, ...res.filter((r) => !prev.some((p) => p.id === r.id))])
      setHasMore(res.length === PAGE)
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading && !items.length) return <LoadingBlock rows={4} />
  if (error && !items.length) return <ErrorState error={error} onRetry={() => void loadFirst()} />
  if (!items.length)
    return (
      <EmptyState
        icon={<History />}
        title={L('No activity yet', 'Chưa có hoạt động')}
        body={L(
          'Your lessons, reviews and practice sessions will show up here.',
          'Bài học, lượt ôn tập và buổi luyện tập của bạn sẽ hiện ở đây.',
        )}
      />
    )

  const groups = groupByDay(items, (iso) => localDateKey(new Date(iso)))
  const today = localDateKey()

  return (
    <div data-testid="activity-feed">
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="mb-2 text-xs font-semibold text-faint">
              {g.day === today
                ? L('Today', 'Hôm nay')
                : fmt.date(g.day, { weekday: 'long', day: 'numeric', month: 'short' })}
            </div>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {g.items.map((it) => {
                const Icon = (Object.hasOwn(ACTION_ICONS, it.action) ? ACTION_ICONS[it.action] : undefined) ?? Sparkles
                return (
                  <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                      <Icon className="size-4" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.title || tx(actionLabel(it.action))}</div>
                      <div className="text-xs text-muted">
                        {tx(actionLabel(it.action))}
                        {it.minutes > 0 && ` · ${fmt.number(it.minutes, 1)} ${L('min', 'phút')}`}
                        {` · ${fmt.time(it.createdAt)}`}
                      </div>
                    </div>
                    {it.xp > 0 && (
                      <span className="shrink-0 text-sm font-semibold text-warning">+{fmt.number(it.xp)} XP</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {error && items.length > 0 && (
        <div className="mt-3">
          <ErrorState error={error} compact />
        </div>
      )}
      <div className="mt-4 flex justify-center">
        {hasMore ? (
          <Button
            variant="secondary"
            loading={loadingMore}
            onClick={() => void loadMore()}
            data-testid="activity-load-more"
          >
            {L('Load more', 'Xem thêm')}
          </Button>
        ) : (
          <span className="text-xs text-faint">{L("That's everything so far.", 'Đã hiển thị toàn bộ.')}</span>
        )}
      </div>
    </div>
  )
}
