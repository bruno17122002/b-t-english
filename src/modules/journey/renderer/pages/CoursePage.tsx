// Course path ('/journey/course'): Sprigo-derived syllabus A1 → C2, units and lessons with completion.
import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, ChevronRight, Circle, GraduationCap, Trophy } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Cefr } from '@shared/content'
import { CEFR_LEVELS } from '@shared/content'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  ProgressRing,
  Tabs,
  cx,
} from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import type { CourseLevelView } from '../../contract'
import { CEFR_INFO } from '../shared'

export default function CoursePage() {
  const L = useL()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const course = useApi('journey:course', undefined)

  const levelParam = params.get('level')
  const selected: Cefr | null = useMemo(() => {
    if (levelParam && (CEFR_LEVELS as readonly string[]).includes(levelParam)) return levelParam as Cefr
    return course.data?.recommendedLevel ?? null
  }, [levelParam, course.data?.recommendedLevel])
  const level = course.data?.levels.find((l) => l.cefr === selected) ?? course.data?.levels[0]

  return (
    <div data-testid="page-journey">
      <button
        onClick={() => navigate('/journey')}
        className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="size-4" /> {L('Journey', 'Hành trình')}
      </button>
      <PageHeader
        icon={<GraduationCap />}
        title={L('Course path', 'Lộ trình khóa học')}
        subtitle={L(
          'A complete A1 → C2 syllabus. Tick lessons as you master them.',
          'Giáo trình đầy đủ từ A1 đến C2. Đánh dấu bài khi bạn đã nắm vững.',
        )}
        actions={
          course.data && (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2">
              <ProgressRing
                value={course.data.total ? course.data.completed / course.data.total : 0}
                size={44}
                stroke={4}
              >
                <span className="text-[11px]">
                  {course.data.total ? Math.round((course.data.completed / course.data.total) * 100) : 0}%
                </span>
              </ProgressRing>
              <div className="text-xs text-muted">
                <div className="font-semibold text-text tabular-nums">
                  {course.data.completed}/{course.data.total}
                </div>
                {L('lessons done', 'bài đã học')}
              </div>
            </div>
          )
        }
      />

      {course.loading && !course.data ? (
        <LoadingBlock rows={5} />
      ) : course.error ? (
        <ErrorState error={course.error} onRetry={course.reload} />
      ) : course.data && level ? (
        <>
          <Tabs
            className="mb-5"
            value={level.cefr}
            onChange={(v) => setParams({ level: v }, { replace: true })}
            items={course.data.levels.map((l) => ({
              value: l.cefr,
              label: (
                <span className="flex items-center gap-1.5">
                  {l.cefr}
                  {l.cefr === course.data?.recommendedLevel && (
                    <span className="size-1.5 rounded-full bg-accent" title={L('Your level', 'Trình độ của bạn')} />
                  )}
                  {l.completed === l.total && l.total > 0 && <CheckCircle2 className="size-3.5 text-success" />}
                </span>
              ),
            }))}
          />
          <LevelView
            level={level}
            recommended={level.cefr === course.data.recommendedLevel}
            onOpen={(id) => navigate(`/journey/course/${id}`)}
          />
          <p className="mt-8 text-center text-xs text-faint" data-testid="course-attribution">
            {course.data.attribution} ·{' '}
            <span className="font-mono">{course.data.sourceUrl.replace(/^https?:\/\//, '')}</span>
          </p>
        </>
      ) : null}
    </div>
  )
}

function LevelView({
  level,
  recommended,
  onOpen,
}: {
  level: CourseLevelView
  recommended: boolean
  onOpen: (lessonId: string) => void
}) {
  const L = useL()
  const tx = useTx()
  const info = CEFR_INFO[level.cefr]
  // The first unfinished lesson is where "continue" points.
  const next = level.units.flatMap((u) => u.lessons).find((l) => !l.completed)
  return (
    <motion.div key={level.cefr} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="relative mb-6 overflow-hidden p-6">
        <div className="pointer-events-none absolute -top-20 -right-16 size-60 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="flex items-center gap-2">
              <CefrBadge level={level.cefr} className="text-sm" />
              <span className="font-display text-2xl font-semibold">{level.title}</span>
              {recommended && <Badge tone="accent">{L('your level', 'trình độ của bạn')}</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted">{level.canDo ?? tx(info.can)}</p>
            <p className="mt-1 text-xs text-faint">{tx(info.can)}</p>
            {level.checkpoint && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <Trophy className="size-3.5 text-warning" /> {L('Checkpoint', 'Bài kiểm tra cuối cấp')}:{' '}
                {level.checkpoint}
              </div>
            )}
          </div>
          <div className="w-full max-w-56">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>{L('Progress', 'Tiến độ')}</span>
              <span className="tabular-nums">
                {level.completed}/{level.total}
              </span>
            </div>
            <ProgressBar value={level.completed} max={level.total} />
            {next && (
              <Button
                variant="primary"
                size="sm"
                className="mt-3 w-full"
                onClick={() => onOpen(next.id)}
                data-testid="course-continue"
              >
                {level.completed ? L('Continue', 'Học tiếp') : L('Start level', 'Bắt đầu cấp độ')}{' '}
                <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {level.units.map((u, i) => {
          const complete = u.completed === u.total
          return (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card className={cx('h-full p-4', complete && 'border-success/30')} data-testid={`course-unit-${u.id}`}>
                <div className="flex items-start gap-3">
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl"
                    aria-hidden
                  >
                    {u.icon ?? '📘'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] tracking-wide text-faint uppercase">
                      {L('Unit', 'Bài')} {u.order}
                    </div>
                    <div className="font-semibold">{u.title}</div>
                    {u.description && <div className="text-xs text-muted">{u.description}</div>}
                  </div>
                  <div className="text-right text-xs text-muted tabular-nums">
                    {Math.round((u.completed / Math.max(1, u.total)) * 100)}%
                  </div>
                </div>
                <ProgressBar
                  value={u.completed}
                  max={u.total}
                  className="mt-3 h-1.5"
                  tone={complete ? 'success' : 'accent'}
                />
                <ul className="mt-3 space-y-0.5">
                  {u.lessons.map((l) => (
                    <li key={l.id}>
                      <button
                        onClick={() => onOpen(l.id)}
                        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-surface-2"
                        data-testid={`course-lesson-${l.id}`}
                      >
                        {l.completed ? (
                          <CheckCircle2 className="size-4 shrink-0 text-success" />
                        ) : (
                          <Circle className="size-4 shrink-0 text-faint" />
                        )}
                        <span className={cx('min-w-0 flex-1 truncate', l.completed && 'text-muted')}>{l.title}</span>
                        <ChevronRight className="size-3.5 shrink-0 text-faint opacity-0 transition group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
