// Journey ('/journey'): personalised roadmap, projection, weekly timeline, notes and goals.
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  BookMarked,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Flag,
  GraduationCap,
  Map,
  NotebookPen,
  RefreshCw,
  Sparkles,
  WifiOff,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { RoadmapSummary, RoadmapWeek } from '@shared/types'
import { AiBadge } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Section,
  Spinner,
  Textarea,
  cx,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { RoadmapView } from '../../contract'
import { GoalsPanel } from '../components/GoalsPanel'
import { SkillGrid } from '../components/SkillGrid'
import { SKILL_META, moduleMeta } from '../shared'

export default function JourneyPage() {
  const L = useL()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const toast = useApp((s) => s.toast)
  const roadmap = useApi('journey:roadmap', undefined)
  const skills = useApi('learner:skills', undefined)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<ApiError | null>(null)
  const autoRan = useRef(false)

  const generate = async (useAi: boolean) => {
    setGenerating(true)
    setGenError(null)
    try {
      const r = await api('journey:roadmapGenerate', { useAi })
      roadmap.setData(r)
      if (r.fallbackReason)
        toast({ kind: 'info', title: L('Offline roadmap created', 'Đã tạo lộ trình offline'), body: r.fallbackReason })
    } catch (err) {
      setGenError(toApiError(err))
    } finally {
      setGenerating(false)
    }
  }

  // '/journey?generate=1' (after onboarding or a placement test) builds a fresh roadmap once.
  useEffect(() => {
    if (params.get('generate') !== '1' || autoRan.current || roadmap.loading) return
    autoRan.current = true
    setParams({}, { replace: true })
    void generate(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, roadmap.loading])

  const data = roadmap.data

  return (
    <div data-testid="page-journey">
      <PageHeader
        icon={<Map />}
        title={L('Your journey', 'Hành trình của bạn')}
        subtitle={L(
          'Roadmap, weekly plan, course path and goals in one place.',
          'Lộ trình, kế hoạch tuần, khóa học và mục tiêu ở cùng một nơi.',
        )}
        actions={
          <>
            <Button
              icon={<GraduationCap className="size-4" />}
              onClick={() => navigate('/journey/course')}
              data-testid="journey-open-course"
            >
              {L('Course path', 'Lộ trình khóa học')}
            </Button>
            <Button variant="ghost" icon={<Compass className="size-4" />} onClick={() => navigate('/assessment')}>
              {L('Placement test', 'Kiểm tra trình độ')}
            </Button>
          </>
        }
      />

      {genError && (
        <div className="mb-4">
          <ErrorState error={genError} onRetry={() => void generate(true)} />
        </div>
      )}

      {generating ? (
        <Card className="flex flex-col items-center gap-4 py-16 text-center">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}>
            <Compass className="size-12 text-accent" />
          </motion.div>
          <div className="font-display text-xl font-semibold">
            {L('Designing your roadmap…', 'Đang thiết kế lộ trình của bạn…')}
          </div>
          <p className="max-w-md text-sm text-muted">
            {L(
              'Looking at your levels, goals and interests to plan the next 12 weeks.',
              'Đang xem trình độ, mục tiêu và sở thích của bạn để lên kế hoạch 12 tuần tới.',
            )}
          </p>
        </Card>
      ) : roadmap.loading && !data ? (
        <LoadingBlock rows={4} />
      ) : roadmap.error ? (
        <ErrorState error={roadmap.error} onRetry={roadmap.reload} />
      ) : !data ? (
        <EmptyState
          icon={<Map />}
          title={L('No roadmap yet', 'Chưa có lộ trình')}
          body={L(
            'Create a 12-week plan based on your levels, goals and interests. With an AI key it is written by AI; offline it uses proven rules.',
            'Tạo kế hoạch 12 tuần dựa trên trình độ, mục tiêu và sở thích. Có khóa AI thì AI sẽ soạn; offline sẽ dùng bộ quy tắc đã kiểm chứng.',
          )}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="primary"
                icon={<Sparkles className="size-4" />}
                onClick={() => void generate(true)}
                data-testid="roadmap-generate"
              >
                {L('Create my roadmap', 'Tạo lộ trình')}
              </Button>
              <Button icon={<WifiOff className="size-4" />} onClick={() => void generate(false)}>
                {L('Offline version', 'Bản offline')}
              </Button>
            </div>
          }
        />
      ) : (
        <RoadmapContent data={data} onChange={roadmap.setData} onRegenerate={generate} />
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Section title={L('Current skill levels', 'Trình độ từng kỹ năng')}>
          {skills.data ? (
            <SkillGrid skills={skills.data} compact />
          ) : skills.error ? (
            <ErrorState error={skills.error} onRetry={skills.reload} compact />
          ) : (
            <LoadingBlock rows={2} />
          )}
        </Section>
        <Section title={L('Goals', 'Mục tiêu')}>
          <GoalsPanel />
        </Section>
      </div>
    </div>
  )
}

function RoadmapContent({
  data,
  onChange,
  onRegenerate,
}: {
  data: RoadmapView
  onChange: (r: RoadmapView) => void
  onRegenerate: (useAi: boolean) => Promise<void>
}) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const s = data.summary
  const p = s.projection
  const profile = useApp((st) => st.profile)
  const totalWeeks = Math.max(1, p.estimatedWeeks)

  return (
    <div className="space-y-6" data-testid="journey-roadmap">
      {/* headline & projection */}
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {data.source === 'ai' ? (
                  <AiBadge estimated={false} />
                ) : (
                  <Badge tone="neutral">
                    <WifiOff className="size-3" /> {L('Offline plan', 'Kế hoạch offline')}
                  </Badge>
                )}
                <span className="text-xs text-faint">
                  {L('Started', 'Bắt đầu')}{' '}
                  {fmt.date(data.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{s.headline}</h2>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="size-4" />}
              onClick={() => void onRegenerate(true)}
              data-testid="roadmap-regenerate"
            >
              {L('Regenerate', 'Tạo lại')}
            </Button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Stat label={L('Now', 'Hiện tại')} value={<CefrBadge level={p.currentCefr} className="text-base" />} />
            <Stat
              label={L('Target', 'Mục tiêu')}
              value={<CefrBadge level={p.targetCefr} className="text-base" />}
              sub={profile?.targetIelts ? `IELTS ${profile.targetIelts.toFixed(1)}` : undefined}
            />
            <Stat
              label={L('Hours needed', 'Số giờ cần')}
              value={`≈ ${fmt.number(p.hoursNeeded)}`}
              sub={L('guided learning hours', 'giờ học có hướng dẫn')}
            />
            <Stat
              label={L('Estimated time', 'Thời gian ước tính')}
              value={
                p.estimatedWeeks ? L(`${p.estimatedWeeks} weeks`, `${p.estimatedWeeks} tuần`) : L('Reached!', 'Đã đạt!')
              }
              sub={L(`at ${profile?.dailyMinutes ?? 20} min/day`, `với ${profile?.dailyMinutes ?? 20} phút/ngày`)}
            />
          </div>

          {s.milestones.length > 0 && (
            <div className="mt-6">
              <div className="relative h-2 rounded-full bg-surface-3">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-accent-gradient"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (data.currentWeek / totalWeeks) * 100)}%` }}
                  transition={{ duration: 0.8 }}
                />
                {s.milestones.map((m) => (
                  <div
                    key={`${m.title}-${m.week}`}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${Math.min(100, (m.week / totalWeeks) * 100)}%` }}
                  >
                    <div
                      className="size-4 rounded-full border-2 border-accent bg-surface"
                      title={`${m.title} · ${L('week', 'tuần')} ${m.week}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                {s.milestones.map((m) => (
                  <div key={`${m.title}-${m.week}-l`} className="flex items-center gap-2 text-xs">
                    <Flag className="size-3.5 text-accent" />
                    {m.cefr && <CefrBadge level={m.cefr} />}
                    <span className="text-muted">
                      {m.title} · {L('week', 'tuần')} {m.week}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-4 flex gap-2 text-xs text-faint">
            <AlertTriangle className="size-3.5 shrink-0" />
            {p.note ||
              L(
                'Estimate based on guided learning hours per CEFR level.',
                'Ước tính theo số giờ học có hướng dẫn cho mỗi cấp CEFR.',
              )}
          </p>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <div className="mb-3 text-sm font-semibold text-muted">{L('Priority skills', 'Kỹ năng ưu tiên')}</div>
          <div className="flex flex-wrap gap-2">
            {s.prioritySkills.map((sk) => {
              const meta = SKILL_META[sk]
              return (
                <span
                  key={sk}
                  className="flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm font-medium"
                >
                  <meta.icon className="size-4 text-accent" />
                  {tx(meta.label)}
                </span>
              )
            })}
          </div>
          {s.interestThemes.length > 0 && (
            <>
              <div className="mt-5 mb-2 text-sm font-semibold text-muted">{L('Themes', 'Chủ đề')}</div>
              <div className="flex flex-wrap gap-1.5">
                {s.interestThemes.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            </>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
            <Clock className="size-4" /> {L('Daily routine', 'Thói quen mỗi ngày')}
          </div>
          <RoutineBar routine={s.dailyRoutine} />
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <GoalList title={L('Short-term goals', 'Mục tiêu ngắn hạn')} items={s.shortTermGoals} />
        <GoalList title={L('Long-term goals', 'Mục tiêu dài hạn')} items={s.longTermGoals} />
      </div>

      <Section title={L('12-week timeline', 'Lộ trình 12 tuần')}>
        <WeekTimeline key={data.id} data={data} onChange={onChange} />
      </Section>

      <NotesCard data={data} onChange={onChange} />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  )
}

function GoalList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <div className="mb-3 text-sm font-semibold text-muted">{title}</div>
      <ul className="space-y-2">
        {items.map((g) => (
          <li key={g} className="flex gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" />
            {g}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function RoutineBar({ routine }: { routine: RoadmapSummary['dailyRoutine'] }) {
  const L = useL()
  const tx = useTx()
  const total = routine.reduce((n, r) => n + r.minutes, 0) || 1
  const OPACITY = [1, 0.75, 0.55, 0.4, 0.3, 0.22]
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-3">
        {routine.map((r, i) => (
          <motion.div
            key={i}
            initial={{ width: 0 }}
            animate={{ width: `${(r.minutes / total) * 100}%` }}
            transition={{ duration: 0.6, delay: i * 0.08 }}
            style={{ background: 'var(--accent)', opacity: OPACITY[i] ?? 0.2 }}
            className="h-full border-r border-surface last:border-r-0"
          />
        ))}
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {routine.map((r, i) => {
          const meta = r.skill in SKILL_META ? SKILL_META[r.skill as keyof typeof SKILL_META] : moduleMeta(r.skill)
          return (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: 'var(--accent)', opacity: OPACITY[i] ?? 0.2 }}
              />
              <meta.icon className="size-4 text-muted" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{tx(meta.label)}</span> <span className="text-faint">· {r.activity}</span>
              </span>
              <span className="text-xs text-muted tabular-nums">
                {r.minutes} {L('min', 'phút')}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function WeekTimeline({ data, onChange }: { data: RoadmapView; onChange: (r: RoadmapView) => void }) {
  const L = useL()
  const tx = useTx()
  const toast = useApp((s) => s.toast)
  const [open, setOpen] = useState<number | null>(() => data.weeks.find((w) => w.status === 'current')?.id ?? null)
  const [pending, setPending] = useState<number | null>(null)
  const doneCount = data.weeks.filter((w) => w.status === 'done').length

  const toggle = async (w: RoadmapWeek) => {
    setPending(w.id)
    try {
      onChange(await api('journey:roadmapWeek', { weekId: w.id, status: w.status === 'done' ? 'upcoming' : 'done' }))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <div className="mb-3 text-xs text-faint">
        {L(
          `${doneCount} of ${data.weeks.length} weeks completed`,
          `Đã hoàn thành ${doneCount}/${data.weeks.length} tuần`,
        )}
        {data.currentWeek > data.weeks.length &&
          ` · ${L('Roadmap finished – time to regenerate!', 'Đã hết lộ trình – hãy tạo lộ trình mới!')}`}
      </div>
      <ol className="relative space-y-2 before:absolute before:top-4 before:bottom-4 before:left-[19px] before:w-px before:bg-line">
        {data.weeks.map((w) => {
          const isOpen = open === w.id
          const current = w.status === 'current'
          const done = w.status === 'done'
          const behind = !done && w.weekIndex < data.currentWeek
          return (
            <li key={w.id} className="relative" data-testid={`roadmap-week-${w.weekIndex}`}>
              <div
                className={cx(
                  'ml-0 flex items-start gap-3 rounded-2xl border p-3 transition',
                  current
                    ? 'border-accent/50 bg-accent/8 shadow-[0_0_0_1px_var(--accent)]'
                    : done
                      ? 'border-success/20 bg-surface'
                      : 'border-line bg-surface',
                )}
              >
                <button
                  onClick={() => void toggle(w)}
                  disabled={pending === w.id}
                  aria-label={
                    done
                      ? L('Mark week as not done', 'Đánh dấu tuần chưa xong')
                      : L('Mark week as done', 'Đánh dấu tuần đã xong')
                  }
                  className={cx(
                    'relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 font-display text-sm font-semibold transition',
                    done
                      ? 'border-success bg-success text-bg'
                      : current
                        ? 'border-accent bg-surface text-accent'
                        : 'border-line-strong bg-surface text-muted hover:border-success',
                  )}
                >
                  {pending === w.id ? (
                    <Spinner className="size-4" />
                  ) : done ? (
                    <Check className="size-5" strokeWidth={3} />
                  ) : (
                    w.weekIndex
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    className="flex w-full items-center gap-2 text-left"
                    onClick={() => setOpen(isOpen ? null : w.id)}
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-faint">
                          {L('Week', 'Tuần')} {w.weekIndex}
                        </span>
                        {current && <Badge tone="accent">{L('this week', 'tuần này')}</Badge>}
                        {behind && <Badge tone="warning">{L('catch up', 'cần bắt kịp')}</Badge>}
                      </div>
                      <div className="truncate font-semibold">{w.theme}</div>
                    </div>
                    <div className="hidden gap-1 sm:flex">
                      {w.focusSkills.map((sk) => {
                        const meta = SKILL_META[sk]
                        return (
                          <span
                            key={sk}
                            title={tx(meta.label)}
                            className="flex size-7 items-center justify-center rounded-lg bg-surface-2 text-muted"
                          >
                            <meta.icon className="size-3.5" />
                          </span>
                        )
                      })}
                    </div>
                    <ChevronDown className={cx('size-4 text-faint transition', isOpen && 'rotate-180')} />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <ul className="space-y-1.5 pt-3">
                          {w.objectives.map((o) => (
                            <li key={o} className="flex gap-2 text-sm text-muted">
                              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                              {o}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function NotesCard({ data, onChange }: { data: RoadmapView; onChange: (r: RoadmapView) => void }) {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const [notes, setNotes] = useState(data.userNotes)
  const [saving, setSaving] = useState(false)
  useEffect(() => setNotes(data.userNotes), [data.userNotes, data.id])
  const dirty = notes !== data.userNotes
  const save = async () => {
    setSaving(true)
    try {
      onChange(await api('journey:roadmapNotes', { notes }))
      toast({ kind: 'success', title: L('Notes saved', 'Đã lưu ghi chú') })
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted">
          <NotebookPen className="size-4" /> {L('My notes', 'Ghi chú của tôi')}
        </div>
        <Button
          size="sm"
          variant={dirty ? 'primary' : 'secondary'}
          disabled={!dirty}
          loading={saving}
          onClick={() => void save()}
          icon={<BookMarked className="size-4" />}
          data-testid="roadmap-notes-save"
        >
          {L('Save', 'Lưu')}
        </Button>
      </div>
      <Textarea
        value={notes}
        maxLength={5000}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={L(
          'Your reasons, reminders, exam date, what works for you…',
          'Lý do học, lời nhắc, ngày thi, cách học hiệu quả với bạn…',
        )}
        data-testid="roadmap-notes"
      />
    </Card>
  )
}
