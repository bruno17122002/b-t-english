// Six skills on a CEFR radar (B2 = IELTS 6.5 target ring highlighted) plus a list with level and in-level progress.
import { GraduationCap } from 'lucide-react'
import { CEFR_LEVELS } from '@shared/content'
import { SKILLS, type SkillLevel } from '@shared/types'
import { CefrBadge, EmptyState, ProgressBar } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { RadarChart } from '../../charts'
import { cefrFraction, cefrRingFraction, SKILL_LABELS } from '../../lib/meta'

export function SkillLevelsPanel({ levels }: { levels: SkillLevel[] }) {
  const L = useL()
  const tx = useTx()
  if (!levels.length)
    return (
      <EmptyState
        icon={<GraduationCap />}
        title={L('No skill levels yet', 'Chưa có trình độ kỹ năng')}
        body={L(
          'Take the placement assessment to see your level in each skill.',
          'Làm bài đánh giá đầu vào để xem trình độ từng kỹ năng.',
        )}
      />
    )
  const ordered = SKILLS.map((s) => levels.find((l) => l.skill === s)).filter((l): l is SkillLevel => !!l)
  const target = CEFR_LEVELS.indexOf('B2')

  return (
    <div
      className="grid items-center gap-6 rounded-3xl border border-line bg-surface p-5 shadow-card md:grid-cols-[minmax(0,320px)_1fr]"
      data-testid="skill-levels"
    >
      <RadarChart
        title={L('Skill levels (CEFR)', 'Trình độ kỹ năng (CEFR)')}
        rings={CEFR_LEVELS.map((c, i) => ({ label: c, value: cefrRingFraction(i) }))}
        targetRing={target}
        targetLabel="IELTS 6.5"
        axes={ordered.map((l) => ({
          key: l.skill,
          label: tx(SKILL_LABELS[l.skill]),
          value: cefrFraction(l.cefr, l.score),
          detail: `${l.cefr} · ${Math.round(l.score)}%${l.estimated ? ` · ${L('estimated', 'ước lượng')}` : ''}`,
        }))}
      />
      <ul className="space-y-3">
        {ordered.map((l) => {
          const idx = CEFR_LEVELS.indexOf(l.cefr)
          const reached = idx >= target
          return (
            <li key={l.skill}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <CefrBadge level={l.cefr} />
                  {tx(SKILL_LABELS[l.skill])}
                  {l.estimated && (
                    <span className="text-[11px] font-normal text-faint">{L('estimated', 'ước lượng')}</span>
                  )}
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {reached
                    ? L('Target reached', 'Đạt mục tiêu')
                    : L(
                        `${Math.round(l.score)}% to ${CEFR_LEVELS[idx + 1] ?? 'C2'}`,
                        `${Math.round(l.score)}% tới ${CEFR_LEVELS[idx + 1] ?? 'C2'}`,
                      )}
                </span>
              </div>
              <ProgressBar value={l.score} max={100} tone={reached ? 'success' : 'accent'} />
            </li>
          )
        })}
        <li className="pt-1 text-xs text-faint">
          {L('Target: B2 in every skill ≈ IELTS 6.5.', 'Mục tiêu: B2 ở mọi kỹ năng ≈ IELTS 6.5.')}
        </li>
      </ul>
    </div>
  )
}
