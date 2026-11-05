// Dashboard ('/'): greeting, streak/XP, today's plan, quests, due cards, skills, recent activity and a tip.
import { motion } from 'framer-motion'
import {
  ArrowRight,
  CalendarCheck2,
  Compass,
  Flame,
  History,
  Layers,
  Lightbulb,
  Map,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlanLesson } from '@shared/types'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  ProgressBar,
  ProgressRing,
  Section,
  Skeleton,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { DashboardData } from '../../contract'
import { PlanList } from '../components/PlanList'
import { SkillGrid } from '../components/SkillGrid'
import { WeeklyChart } from '../components/WeeklyChart'
import { dayPartGreeting, moduleMeta } from '../shared'

export default function DashboardPage() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const profile = useApp((s) => s.profile)
  const game = useApp((s) => s.game)
  const settings = useApp((s) => s.settings)
  const dueCardsStore = useApp((s) => s.dueCards)
  const refreshGame = useApp((s) => s.refreshGame)
  const toast = useApp((s) => s.toast)

  const dash = useApi('journey:dashboard', undefined)
  const skills = useApi('learner:skills', undefined)
  const quests = useApi('progress:quests', undefined)
  const stats = useApi('progress:stats', undefined)
  const [pendingId, setPendingId] = useState<number | null>(null)

  const now = useMemo(() => new Date(), [])
  const greeting = dayPartGreeting(now.getHours())
  const name = profile?.displayName?.trim()
  const dailyGoalXp = settings?.dailyGoalXp ?? 50
  const dueCards = dash.data?.dueCards ?? dueCardsStore

  const setStatus = async (id: number, status: PlanLesson['status']) => {
    setPendingId(id)
    try {
      const res = await api('journey:planStatus', { id, status })
      // Status changes are only possible once the dashboard is loaded.
      dash.setData((prev) => ({ ...(prev as DashboardData), plan: res.plan }))
      if (res.reward) {
        void refreshGame()
        void quests.reload()
        void stats.reload()
      }
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setPendingId(null)
    }
  }

  const plan = dash.data?.plan
  const activeLessons = plan?.lessons.filter((l) => l.status !== 'skipped') ?? []
  const planPct = activeLessons.length ? (plan?.doneCount ?? 0) / activeLessons.length : 0

  return (
    <div data-testid="page-journey" className="space-y-6">
      {/* ---------- hero ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card md:p-8"
        data-testid="journey-dashboard"
      >
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-accent-2/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="text-sm text-muted">
              {fmt.date(now.toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              {tx(greeting)}
              {name ? (
                <>
                  , <span className="text-gradient">{name}</span>
                </>
              ) : null}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              {game?.streak.activeToday
                ? L(
                    'You have studied today. Keep the momentum going!',
                    'Hôm nay bạn đã học rồi. Giữ vững phong độ nhé!',
                  )
                : (game?.streak.current ?? 0) > 0
                  ? L(
                      `Study today to keep your ${game?.streak.current}-day streak alive.`,
                      `Học hôm nay để giữ chuỗi ${game?.streak.current} ngày nhé.`,
                    )
                  : L(
                      'A few focused minutes today is all it takes to start.',
                      'Chỉ cần vài phút tập trung hôm nay để bắt đầu.',
                    )}
            </p>
            {profile?.overallCefr && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <span>{L('Level now', 'Trình độ hiện tại')}</span>
                <CefrBadge level={profile.overallCefr} />
                <ArrowRight className="size-3" />
                <span>{L('target', 'mục tiêu')}</span>
                <CefrBadge level={profile.targetCefr} />
                {profile.targetIelts ? <Badge tone="accent">IELTS {profile.targetIelts.toFixed(1)}</Badge> : null}
              </div>
            )}
          </div>
          <div className="flex items-center gap-5">
            <HeroStat
              icon={<Flame className={game?.streak.activeToday ? 'size-5 text-warning' : 'size-5 text-faint'} />}
              value={game ? String(game.streak.current) : '–'}
              label={L('day streak', 'ngày liên tiếp')}
            />
            <div className="h-12 w-px bg-line" />
            <div className="flex items-center gap-3">
              <ProgressRing value={game ? game.xpIntoLevel / Math.max(1, game.xpForNextLevel) : 0} size={58}>
                <span className="font-display text-lg">{game?.level ?? 1}</span>
              </ProgressRing>
              <div>
                <div className="text-sm font-semibold">{game?.levelTitle ?? L('Explorer', 'Nhà thám hiểm')}</div>
                <div className="text-xs text-muted tabular-nums">
                  {game ? `${fmt.number(game.xpIntoLevel)} / ${fmt.number(game.xpForNextLevel)} XP` : '…'}
                </div>
              </div>
            </div>
            <div className="h-12 w-px bg-line" />
            <HeroStat
              icon={<Zap className="size-5 text-accent" />}
              value={`${game?.todayXp ?? 0}/${dailyGoalXp}`}
              label={L('XP today', 'XP hôm nay')}
            />
          </div>
        </div>
      </motion.div>

      {/* ---------- first-run guidance ---------- */}
      {dash.data && (!dash.data.lastAssessment || !dash.data.roadmap) && (
        <div className="grid gap-4 md:grid-cols-2">
          {!dash.data.lastAssessment && (
            <Card className="flex items-center gap-4 border-accent/30 bg-accent/5" data-testid="cta-assessment">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Compass className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{L('Find your real level', 'Xác định trình độ thật của bạn')}</div>
                <p className="text-sm text-muted">
                  {L(
                    'A 15-minute adaptive test sets every skill accurately.',
                    'Bài kiểm tra thích ứng 15 phút giúp xếp lớp chính xác từng kỹ năng.',
                  )}
                </p>
              </div>
              <Button variant="primary" onClick={() => navigate('/assessment')}>
                {L('Start', 'Bắt đầu')}
              </Button>
            </Card>
          )}
          {!dash.data.roadmap && (
            <Card className="flex items-center gap-4" data-testid="cta-roadmap">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-2/15 text-accent-2">
                <Map className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{L('Build your roadmap', 'Tạo lộ trình của bạn')}</div>
                <p className="text-sm text-muted">
                  {L(
                    '12 weeks planned around your goals and interests.',
                    '12 tuần được thiết kế theo mục tiêu và sở thích của bạn.',
                  )}
                </p>
              </div>
              <Button onClick={() => navigate('/journey?generate=1')}>{L('Create', 'Tạo')}</Button>
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- left column ---------- */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ProgressRing value={planPct} size={48} stroke={5}>
                  <span className="text-xs">{Math.round(planPct * 100)}%</span>
                </ProgressRing>
                <div>
                  <h2 className="font-display text-xl font-semibold">{L("Today's plan", 'Kế hoạch hôm nay')}</h2>
                  <p className="text-xs text-muted">
                    {plan
                      ? L(
                          `${plan.doneCount}/${activeLessons.length} done · about ${plan.totalMinutes} min`,
                          `Đã xong ${plan.doneCount}/${activeLessons.length} · khoảng ${plan.totalMinutes} phút`,
                        )
                      : L('Preparing…', 'Đang chuẩn bị…')}
                  </p>
                </div>
              </div>
              {dash.data?.roadmap?.weekTheme && (
                <Badge tone="accent" className="max-w-full truncate">
                  <CalendarCheck2 className="size-3" />
                  {L(`Week ${dash.data.roadmap.currentWeek}`, `Tuần ${dash.data.roadmap.currentWeek}`)} ·{' '}
                  {dash.data.roadmap.weekTheme}
                </Badge>
              )}
            </div>
            {dash.loading && !dash.data ? (
              <LoadingBlock rows={4} />
            ) : dash.error ? (
              <ErrorState error={dash.error} onRetry={dash.reload} />
            ) : plan && plan.lessons.length ? (
              <>
                <PlanList lessons={plan.lessons} pendingId={pendingId} onStatus={setStatus} />
                {plan.doneCount > 0 && plan.doneCount === activeLessons.length && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3 text-sm"
                  >
                    <Trophy className="size-5 text-success" />
                    {L(
                      'Plan complete! Great work – extra practice now is pure bonus.',
                      'Hoàn thành kế hoạch! Tuyệt vời – luyện thêm bây giờ là điểm cộng.',
                    )}
                  </motion.div>
                )}
              </>
            ) : (
              <EmptyState
                icon={<Sparkles />}
                title={L('Nothing planned yet', 'Chưa có bài nào')}
                body={L('Explore the course to pick something you enjoy.', 'Hãy mở khóa học để chọn bài bạn thích.')}
                action={<Button onClick={() => navigate('/journey/course')}>{L('Open course', 'Mở khóa học')}</Button>}
              />
            )}
          </Card>

          <Section
            title={L('Your skills', 'Kỹ năng của bạn')}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/assessment')}>
                {dash.data?.lastAssessment
                  ? L('Retake test', 'Kiểm tra lại')
                  : L('Take placement test', 'Làm bài xếp lớp')}
              </Button>
            }
          >
            {skills.data ? (
              <SkillGrid skills={skills.data} />
            ) : skills.error ? (
              <ErrorState error={skills.error} onRetry={skills.reload} compact />
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            )}
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
                <History className="size-4" /> {L('Continue where you left off', 'Tiếp tục từ lần trước')}
              </div>
              {dash.data?.continue ? (
                <button
                  className="group flex w-full items-center gap-3 rounded-xl p-1 text-left"
                  onClick={() => dash.data?.continue && navigate(dash.data.continue.route)}
                  data-testid="continue-item"
                >
                  {(() => {
                    const meta = moduleMeta(dash.data.continue.module)
                    const Icon = meta.icon
                    return (
                      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}>
                        <Icon className="size-5" />
                      </span>
                    )
                  })()}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{dash.data.continue.title}</span>
                    <span className="text-xs text-faint">
                      {tx(moduleMeta(dash.data.continue.module).label)} · {fmt.relative(dash.data.continue.at)}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-text" />
                </button>
              ) : (
                <p className="text-sm text-faint">
                  {L('Your recent lessons will appear here.', 'Bài học gần đây của bạn sẽ hiện ở đây.')}
                </p>
              )}
            </Card>
            <Card className="relative overflow-hidden">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
                <Lightbulb className="size-4 text-warning" /> {L('Tip of the day', 'Mẹo hôm nay')}
              </div>
              {dash.data ? (
                <p className="text-sm leading-relaxed">{tx(dash.data.tip)}</p>
              ) : (
                <Skeleton className="h-12" />
              )}
            </Card>
          </div>
        </div>

        {/* ---------- right column ---------- */}
        <div className="space-y-6">
          <Card className={dueCards > 0 ? 'border-accent/30' : undefined} data-testid="due-cards">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-400">
                <Layers className="size-6" />
              </div>
              <div className="flex-1">
                <div className="font-display text-2xl font-semibold tabular-nums">{dueCards}</div>
                <div className="text-xs text-muted">{L('flashcards due', 'thẻ cần ôn')}</div>
              </div>
              <Button
                variant={dueCards > 0 ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => navigate(dueCards > 0 ? '/vocabulary/review' : '/vocabulary')}
              >
                {dueCards > 0 ? L('Review', 'Ôn ngay') : L('Word bank', 'Kho từ')}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted">
                <Target className="size-4" /> {L('Daily quests', 'Nhiệm vụ hằng ngày')}
              </div>
            </div>
            {quests.data ? (
              quests.data.daily.length ? (
                <ul className="space-y-3">
                  {quests.data.daily.map((q) => {
                    const complete = q.completedAt !== null
                    return (
                      <li key={q.id}>
                        <button className="w-full text-left" onClick={() => navigate(q.route || '/')}>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className={complete ? 'text-muted line-through' : ''}>{L(q.title, q.titleVi)}</span>
                            <Badge tone={complete ? 'success' : 'accent'}>+{q.xpReward} XP</Badge>
                          </div>
                          <ProgressBar
                            value={q.progress}
                            max={q.target}
                            className="mt-1.5 h-1.5"
                            tone={complete ? 'success' : 'accent'}
                          />
                          <div className="mt-1 text-[11px] text-faint tabular-nums">
                            {q.progress}/{q.target}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-faint">{L('No quests today.', 'Hôm nay chưa có nhiệm vụ.')}</p>
              )
            ) : quests.error ? (
              <ErrorState error={quests.error} onRetry={quests.reload} compact />
            ) : (
              <LoadingBlock rows={3} />
            )}
          </Card>

          <Card>
            <div className="mb-2 text-sm font-semibold text-muted">{L('This week', 'Tuần này')}</div>
            {stats.data ? (
              <WeeklyChart days={stats.data.last7} goal={profile?.dailyMinutes ?? 20} />
            ) : stats.error ? (
              <ErrorState error={stats.error} onRetry={stats.reload} compact />
            ) : (
              <Skeleton className="h-36" />
            )}
          </Card>

          {dash.data?.roadmap && (
            <Card interactive onClick={() => navigate('/journey')}>
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-muted">
                <Map className="size-4" /> {L('Roadmap', 'Lộ trình')}
              </div>
              <div className="font-semibold">{dash.data.roadmap.headline}</div>
              <ProgressBar
                value={Math.min(dash.data.roadmap.currentWeek, dash.data.roadmap.totalWeeks)}
                max={dash.data.roadmap.totalWeeks}
                className="mt-3"
              />
              <div className="mt-1.5 text-xs text-faint">
                {L(
                  `Week ${dash.data.roadmap.currentWeek} of ${dash.data.roadmap.totalWeeks}`,
                  `Tuần ${dash.data.roadmap.currentWeek}/${dash.data.roadmap.totalWeeks}`,
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function HeroStat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1.5">
        {icon}
        <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
      </div>
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
    </div>
  )
}
