import { CheckCircle2, Circle, Flame, Layers, MinusCircle, Trophy } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, cx, Notice, ProgressBar, SectionTitle, Spinner } from '../components/ui'
import { errorKey, useT } from '../i18n'
import { buildDeck, countDue } from '../lib/review'
import { overview } from '../lib/stats'
import { useApp } from '../store'

const MODULE_VI: Record<string, string> = {
  vocabulary: 'Từ vựng',
  listening: 'Nghe',
  speaking: 'Nói',
  reading: 'Đọc',
  writing: 'Viết',
  grammar: 'Ngữ pháp',
  cinema: 'Phim',
  tutor: 'Gia sư',
  story: 'Truyện',
}

export function Today() {
  const t = useT()
  const navigate = useNavigate()
  const cache = useApp((s) => s.cache)
  const lang = useApp((s) => s.lang)
  const error = useApp((s) => s.error)
  const syncing = useApp((s) => s.syncing)
  const data = useMemo(() => {
    if (!cache) return null
    const now = new Date()
    return { ov: overview(cache, now), due: countDue(buildDeck(cache, now), now) }
  }, [cache])

  if (!data)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  const { ov, due } = data
  const name = ov.profile?.display_name ? `, ${ov.profile.display_name}` : ''
  const empty = !cache?.lastPullAt && syncing

  return (
    <div>
      {error && error !== 'not_signed_in' && (
        <div className="mb-3">
          <Notice tone="warning">{t(errorKey(error))}</Notice>
        </div>
      )}
      <p className="mb-3 px-1 text-[15px] text-muted">{t('today.hello', { name })}</p>
      {empty && (
        <div className="mb-3 flex justify-center">
          <Spinner />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Flame className={cx('size-4', ov.streak.activeToday ? 'text-warning' : 'text-faint')} />
            {t('today.streak')}
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold">{t('today.days', { n: ov.streak.current })}</div>
          <div className="mt-1 text-xs text-faint">{ov.streak.activeToday ? t('today.done') : t('today.pending')}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Trophy className="size-4 text-accent" />
            {t('today.level', { n: ov.level })}
          </div>
          <div className="mt-1 truncate text-lg font-semibold">{ov.levelTitle}</div>
          <ProgressBar className="mt-2" value={ov.xpIntoLevel / ov.xpForNextLevel} />
          <div className="mt-1 font-mono text-[11px] text-faint">
            {t('today.xpToNext', { a: ov.xpIntoLevel, b: ov.xpForNextLevel })}
          </div>
        </Card>
      </div>

      <Card className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{t('today.minutes')}</span>
          <span className="text-xs text-faint">{t('today.goal', { n: ov.dailyGoal })}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold">{ov.todayMinutes}</span>
          <span className="text-sm text-faint">/ {ov.dailyGoal}</span>
          <span className="ml-auto font-mono text-sm text-accent">+{ov.todayXp} XP</span>
        </div>
        <ProgressBar className="mt-2" value={ov.todayMinutes / Math.max(1, ov.dailyGoal)} />
      </Card>

      <Card className="mt-3 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Layers className="size-5" />
        </div>
        <div className="flex-1">
          <div className="text-[13px] text-muted">{t('today.due')}</div>
          <div className="font-mono text-2xl font-semibold">{due}</div>
        </div>
        <Button variant={due > 0 ? 'primary' : 'secondary'} onClick={() => navigate('/review')} disabled={due === 0}>
          {t('today.reviewNow')}
        </Button>
      </Card>

      <SectionTitle>{t('today.lessons')}</SectionTitle>
      {ov.lessons.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t('today.noLessons')}</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {ov.lessons.map((l) => (
            <div key={`${l.id}-${l.position}-${l.title}`} className="flex items-start gap-3 px-4 py-3">
              {l.status === 'done' ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label={t('lesson.done')} />
              ) : l.status === 'skipped' ? (
                <MinusCircle className="mt-0.5 size-5 shrink-0 text-faint" aria-label={t('lesson.skipped')} />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-faint" aria-label={t('lesson.todo')} />
              )}
              <div className="min-w-0 flex-1">
                <div className={cx('text-[15px]', l.status !== 'todo' && 'text-muted line-through decoration-faint')}>
                  {l.title}
                </div>
                {l.description && <div className="mt-0.5 line-clamp-2 text-xs text-faint">{l.description}</div>}
              </div>
              <div className="shrink-0 text-right text-xs text-faint">
                <div>{lang === 'vi' ? (MODULE_VI[l.module] ?? l.module) : l.module}</div>
                <div className="font-mono">{t('today.min', { n: l.estimated_minutes })}</div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
