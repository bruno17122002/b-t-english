// Six-skill overview: CEFR per skill with progress inside the level.
import type { SkillLevel } from '@shared/types'
import { CefrBadge, ProgressBar, cx } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { SKILL_META } from '../shared'

export function SkillGrid({ skills, compact }: { skills: SkillLevel[]; compact?: boolean }) {
  const L = useL()
  const tx = useTx()
  const sourceLabel = (s: SkillLevel) =>
    s.source === 'assessment'
      ? s.estimated
        ? L('test · estimated', 'kiểm tra · ước lượng')
        : L('placement test', 'bài kiểm tra')
      : s.source === 'progress'
        ? L('from practice', 'từ luyện tập')
        : L('self-reported', 'tự đánh giá')
  return (
    <div
      className={cx('grid gap-3', compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 lg:grid-cols-3')}
      data-testid="journey-skills"
    >
      {skills.map((s) => {
        const meta = SKILL_META[s.skill]
        const Icon = meta.icon
        return (
          <div key={s.skill} className="rounded-xl border border-line bg-surface-2/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 text-accent" />
                {tx(meta.label)}
              </div>
              <CefrBadge level={s.cefr} />
            </div>
            <ProgressBar value={s.score} max={100} className="mt-2.5 h-1.5" />
            <div className="mt-1.5 flex justify-between text-[11px] text-faint">
              <span>{sourceLabel(s)}</span>
              <span className="tabular-nums">{Math.round(s.score)}%</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
