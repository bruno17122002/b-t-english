// Hero banner of the Adventure page: level crest, title, animated XP bar, streak with the rest-day rule, totals.
import { motion } from 'framer-motion'
import { CalendarCheck, Flame, ShieldCheck, ShieldOff, Sparkles, Trophy } from 'lucide-react'
import type { GameState } from '@shared/types'
import { addDays, localDateKey } from '@core/dates'
import { cx } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { useApp } from '@/lib/store'
import { levelTitleBi, nextAccentUnlock, restDayRechargeDate } from '../lib/meta'

function LevelCrest({ level }: { level: number }) {
  return (
    <div className="relative size-24 shrink-0" aria-hidden>
      <svg viewBox="0 0 100 110" className="size-full">
        <path d="M50 4 L92 20 L88 62 Q84 90 50 106 Q16 90 12 62 L8 20 Z" style={{ fill: 'var(--accent)' }} />
        <path
          d="M50 13 L83 26 L80 61 Q76 83 50 96 Q24 83 20 61 L17 26 Z"
          style={{ fill: 'var(--surface)' }}
          opacity={0.88}
        />
        <path
          d="M30 30 L50 22 L70 30"
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ stroke: 'var(--accent-2)' }}
          opacity={0.7}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <span className="text-[10px] font-semiboldst text-muted">Lv</span>
        <span className="font-display text-3xl leading-none font-semibold">{level}</span>
      </div>
    </div>
  )
}

export function HeroHeader({ game }: { game: GameState }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const dailyGoal = useApp((s) => s.settings?.dailyGoalXp ?? 0)
  const pct = game.xpForNextLevel > 0 ? Math.min(100, (game.xpIntoLevel / game.xpForNextLevel) * 100) : 100
  const nextAccent = nextAccentUnlock(game.level)
  const recharge = restDayRechargeDate(game.streak.restDaysUsedRecently)
  const yesterday = addDays(localDateKey(), -1)
  const coveringYesterday = !game.streak.activeToday && game.streak.restDaysUsedRecently.includes(yesterday)
  const goalPct = dailyGoal > 0 ? Math.min(100, (game.todayXp / dailyGoal) * 100) : 0

  return (
    <section
      data-testid="game-hero"
      className="relative mb-8 overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card"
      aria-label={L('Your hero', 'Nhân vật của bạn')}
    >
      <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Level + XP */}
        <div className="flex items-center gap-5">
          <LevelCrest level={game.level} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semiboldst text-muted">
              {L('Level', 'Cấp')} {game.level}
            </div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              <span className="text-accent">{tx(levelTitleBi(game.levelTitle))}</span>
            </h2>
            <div className="mt-3">
              <div
                className="relative h-3 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label={L('XP to next level', 'XP tới cấp tiếp theo')}
                aria-valuemin={0}
                aria-valuemax={game.xpForNextLevel}
                aria-valuenow={game.xpIntoLevel}
              >
                <motion.div
                  className="h-full rounded-full bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted">
                <span>
                  <span className="font-semibold text-text">{fmt.number(game.xpIntoLevel)}</span> /{' '}
                  {fmt.number(game.xpForNextLevel)} XP
                </span>
                <span>
                  {L('Next level in', 'Lên cấp sau')} {fmt.number(Math.max(0, game.xpForNextLevel - game.xpIntoLevel))}{' '}
                  XP
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-muted">
                <Sparkles className="size-3.5 text-accent" />
                <span className="font-semibold text-text">{fmt.number(game.totalXp)}</span> {L('total XP', 'tổng XP')}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-muted">
                <CalendarCheck className="size-3.5 text-accent-2" />
                <span className="font-semibold text-text">{fmt.number(game.totalActiveDays)}</span>{' '}
                {L('active days', 'ngày đã học')}
              </span>
              {nextAccent && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-muted">
                  <Trophy className="size-3.5 text-warning" />
                  {L(
                    `Level ${nextAccent.level} unlocks the ${nextAccent.name.en} theme`,
                    `Cấp ${nextAccent.level} mở khóa giao diện ${nextAccent.name.vi}`,
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Streak + today */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface-2/70 p-4" data-testid="game-streak">
            <div className="flex items-center gap-3">
              <motion.div
                className={cx(
                  'flex size-11 items-center justify-center rounded-xl',
                  game.streak.current > 0 ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-faint',
                )}
                animate={game.streak.activeToday ? { scale: [1, 1.08, 1] } : undefined}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Flame className="size-6" />
              </motion.div>
              <div>
                <div className="font-display text-2xl leading-none font-semibold">
                  {fmt.number(game.streak.current)}{' '}
                  <span className="text-sm font-normal text-muted">{L('day streak', 'ngày liên tiếp')}</span>
                </div>
                <div className="mt-1 text-xs text-faint">
                  {L('Best', 'Kỷ lục')}: {fmt.number(game.streak.longest)} ·{' '}
                  {game.streak.activeToday ? L('done today', 'đã học hôm nay') : L('not yet today', 'hôm nay chưa học')}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-3/60 p-2.5 text-xs leading-relaxed text-muted">
              {game.streak.restDayAvailable ? (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <ShieldOff className="mt-0.5 size-4 shrink-0 text-warning" />
              )}
              <span>
                {game.streak.restDayAvailable
                  ? L(
                      'Rest-day shield ready: miss a single day and your streak is kept (once every 7 days). Two missed days in a row end it – your total active days never go down.',
                      'Khiên ngày nghỉ sẵn sàng: lỡ một ngày, chuỗi vẫn được giữ (mỗi 7 ngày một lần). Nghỉ hai ngày liền thì chuỗi kết thúc – tổng số ngày học không bao giờ bị trừ.',
                    )
                  : coveringYesterday
                    ? L(
                        'Your rest-day shield is covering yesterday. Study today to keep the streak going.',
                        'Khiên ngày nghỉ đang che cho hôm qua. Học hôm nay để giữ chuỗi nhé.',
                      )
                    : L(
                        `Rest-day shield used on ${game.streak.restDaysUsedRecently.map((d) => fmt.date(d)).join(', ')}. It recharges on ${recharge ? fmt.date(recharge) : '—'}; until then, missing a day ends the streak.`,
                        `Đã dùng khiên ngày nghỉ vào ${game.streak.restDaysUsedRecently.map((d) => fmt.date(d)).join(', ')}. Khiên hồi lại vào ${recharge ? fmt.date(recharge) : '—'}; trước đó, nghỉ một ngày sẽ mất chuỗi.`,
                      )}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface-2/70 p-4">
            <div className="text-xs font-semibold text-muted">{L('Today', 'Hôm nay')}</div>
            <div className="mt-1 font-display text-2xl font-semibold">
              +{fmt.number(game.todayXp)} <span className="text-sm font-normal text-muted">XP</span>
            </div>
            {dailyGoal > 0 && (
              <>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className={cx('h-full rounded-full', goalPct >= 100 ? 'bg-success' : 'bg-accent')}
                    initial={{ width: 0 }}
                    animate={{ width: `${goalPct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
                <div className="mt-1.5 text-xs text-faint">
                  {goalPct >= 100
                    ? L('Daily goal reached – great work!', 'Đã đạt mục tiêu ngày – tuyệt vời!')
                    : L(`Daily goal: ${dailyGoal} XP`, `Mục tiêu ngày: ${dailyGoal} XP`)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
