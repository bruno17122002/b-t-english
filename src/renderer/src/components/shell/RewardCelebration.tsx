// Shows XP gains as a small toast and big moments (level-up, achievements, completed quests) as a
// celebration card. Driven by the 'reward' push event from the Progress kernel.
import { AnimatePresence, motion } from 'framer-motion'
import { Award, Check, PartyPopper, ScrollText, Star } from 'lucide-react'
import { useEffect } from 'react'
import { useL } from '../../i18n'
import { useApp } from '../../lib/store'
import { Button } from '../ui'

const CONFETTI_COLORS = ['var(--accent)', 'var(--accent-2)', '#fbbf24', '#f472b6', '#4ade80']

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 36 }, (_, i) => (
        <motion.span
          key={i}
          className="absolute top-1/2 left-1/2 block size-2 rounded-sm"
          style={{ background: CONFETTI_COLORS[i % CONFETTI_COLORS.length] }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: Math.cos((i / 36) * Math.PI * 2) * (120 + (i % 5) * 30),
            y: Math.sin((i / 36) * Math.PI * 2) * (90 + (i % 7) * 20) + 60,
            opacity: 0,
            rotate: 360,
          }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

export function RewardCelebration() {
  const L = useL()
  const rewards = useApp((s) => s.rewards)
  const shift = useApp((s) => s.shiftReward)
  const toast = useApp((s) => s.toast)
  const lang = useApp((s) => s.settings?.uiLanguage ?? 'vi')
  const current = rewards[0]
  const big =
    !!current &&
    (current.levelUp !== null || current.achievementsUnlocked.length > 0 || current.questsCompleted.length > 0)

  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && shift()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big, shift])

  useEffect(() => {
    if (current && !big) {
      if (current.xpGained >= 5) toast({ kind: 'xp', title: `+${current.xpGained} XP` })
      shift()
    }
  }, [current, big, shift, toast])

  return (
    <AnimatePresence>
      {current && big && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={shift}
        >
          <motion.div
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-line-strong bg-surface p-8 text-center shadow-card"
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Confetti />
            <div className="relative">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-accent text-accent-ink">
                {current.levelUp ? (
                  <PartyPopper className="size-8" />
                ) : current.achievementsUnlocked.length ? (
                  <Award className="size-8" />
                ) : (
                  <ScrollText className="size-8" />
                )}
              </div>
              {current.levelUp && (
                <h2 className="font-display text-3xl font-semibold">
                  {L('Level', 'Cấp')} <span className="text-accent">{current.levelUp}</span>!
                </h2>
              )}
              {current.achievementsUnlocked.map((a) => (
                <div key={a.key} className="mt-3">
                  <div className="text-xs font-semibold tracking-wider text-warning uppercase">
                    {L('Achievement unlocked', 'Mở khóa thành tích')}
                  </div>
                  <div className="font-display text-xl font-semibold">{lang === 'vi' ? a.titleVi : a.title}</div>
                  <div className="text-sm text-muted">{lang === 'vi' ? a.descriptionVi : a.description}</div>
                </div>
              ))}
              {current.questsCompleted.map((q) => (
                <div key={q.id} className="mt-3 text-sm">
                  <Check className="mr-1 inline size-4 text-success" /> {lang === 'vi' ? q.titleVi : q.title}{' '}
                  <span className="text-warning">+{q.xpReward} XP</span>
                </div>
              ))}
              <div className="mt-4 flex items-center justify-center gap-1 text-lg font-bold text-warning">
                <Star className="size-5 fill-warning" />+{current.xpGained} XP
              </div>
              <Button variant="primary" className="mt-6 w-full" onClick={shift} autoFocus data-testid="reward-continue">
                {L('Keep going', 'Tiếp tục')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
