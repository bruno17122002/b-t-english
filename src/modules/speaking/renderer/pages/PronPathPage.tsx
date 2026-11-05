// Pronunciation Path (Cadence pack): 10 modules of theory/practice/exam lessons plus the phoneme catalogue.
import { motion } from 'framer-motion'
import { ArrowLeft, AudioLines, BookOpen, CheckCircle2, Dumbbell, GraduationCap, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PhonemeEntry } from '@shared/packs'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  Section,
  Tabs,
  cx,
} from '@/components/ui'
import { useL } from '@/i18n'
import { useApi } from '@/lib/api'
import type { PronLessonSummary } from '../../contract'
import { CadenceAttribution, PhonemeCard, PhonemeModal } from '../components/Pronunciation'

const LESSON_ICON = { theory: BookOpen, practice: Dumbbell, exam: GraduationCap }

export default function PronPathPage() {
  const L = useL()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi('speaking:pronOverview', undefined, [])
  const [tab, setTab] = useState<'path' | 'phonemes'>('path')
  const [open, setOpen] = useState<PhonemeEntry | null>(null)

  const byCategory = useMemo(() => {
    const map = new Map<string, PhonemeEntry[]>()
    for (const p of data?.phonemes ?? []) map.set(p.category, [...(map.get(p.category) ?? []), p])
    return [...map.entries()]
  }, [data])

  const all = data?.modules.flatMap((m) => m.lessons) ?? []
  const doneCount = all.filter((l) => l.completed).length
  const next = all.find((l) => l.id === data?.nextLessonId)

  return (
    <div data-testid="page-speaking">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="size-4" />}
        onClick={() => navigate('/speaking')}
        className="mb-4"
      >
        {L('Speaking Studio', 'Phòng nói')}
      </Button>
      <PageHeader
        icon={<AudioLines />}
        title={L('Pronunciation Path', 'Lộ trình phát âm')}
        subtitle={L(
          'Learn how each sound is made, practise it in words, then pass the module exam.',
          'Học cách tạo từng âm, luyện trong từ, rồi vượt qua bài kiểm tra của chặng.',
        )}
        actions={
          next && (
            <Button
              variant="primary"
              icon={<Play className="size-4" />}
              onClick={() => navigate(`/speaking/pronunciation/${next.id}`)}
              data-testid="pron-continue"
            >
              {L('Continue', 'Học tiếp')}: {next.title}
            </Button>
          )
        }
      />
      {loading && !data ? (
        <LoadingBlock rows={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'path', label: L('Path', 'Lộ trình') },
                { value: 'phonemes', label: L('Sound catalogue', 'Bảng âm'), count: data.phonemes.length },
              ]}
            />
            <div className="flex min-w-60 flex-1 items-center gap-3">
              <ProgressBar value={doneCount} max={all.length} className="flex-1" />
              <span className="text-sm text-muted tabular-nums">
                {doneCount}/{all.length}
              </span>
            </div>
          </div>

          {tab === 'path' ? (
            <div className="relative space-y-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-2 before:w-0.5 before:bg-line">
              {data.modules.map((m, i) => {
                const complete = m.completedLessons === m.lessons.length
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="relative"
                  >
                    <span
                      className={cx(
                        'absolute top-6 -left-[22px] size-3.5 rounded-full border-2 border-bg',
                        complete ? 'bg-success' : m.completedLessons ? 'bg-accent' : 'bg-surface-3',
                      )}
                    />
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-muted">
                            {L('Module', 'Chặng')} {m.order}
                          </div>
                          <h3 className="font-display text-lg font-semibold">{m.title}</h3>
                          <p className="mt-0.5 text-sm text-muted">{m.description}</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {m.focusSymbols.map((s) => (
                            <span key={s} className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-sm text-accent">
                              /{s}/
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {m.lessons.map((l) => (
                          <LessonTile
                            key={l.id}
                            l={l}
                            highlight={l.id === data.nextLessonId}
                            onOpen={() => navigate(`/speaking/pronunciation/${l.id}`)}
                          />
                        ))}
                      </div>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-6">
              {byCategory.map(([cat, list]) => (
                <Section key={cat} title={data.categories[cat] ?? cat.replace(/_/g, ' ')}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {list.map((p) => (
                      <PhonemeCard key={p.symbol} p={p} onOpen={() => setOpen(p)} />
                    ))}
                  </div>
                </Section>
              ))}
            </div>
          )}
          <PhonemeModal p={open} onClose={() => setOpen(null)} />
          <CadenceAttribution attribution={data.attribution} />
        </>
      ) : null}
    </div>
  )
}

function LessonTile({ l, highlight, onOpen }: { l: PronLessonSummary; highlight: boolean; onOpen: () => void }) {
  const L = useL()
  const Icon = LESSON_ICON[l.type]
  return (
    <button
      onClick={onOpen}
      className={cx(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:border-line-strong',
        highlight ? 'border-accent/60 bg-accent/5' : 'border-line bg-surface-2',
      )}
      data-testid={`pron-lesson-${l.id}`}
    >
      <Icon className={cx('size-4 shrink-0', l.completed ? 'text-success' : 'text-muted')} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{l.title}</div>
        <div className="text-xs text-faint">
          {l.type === 'theory'
            ? L('Theory', 'Lý thuyết')
            : l.type === 'practice'
              ? L(`Practice · ${l.wordCount} words`, `Luyện · ${l.wordCount} từ`)
              : L('Exam', 'Kiểm tra')}
        </div>
      </div>
      {l.completed ? (
        <CheckCircle2 className="size-4 shrink-0 text-success" />
      ) : l.bestScore !== null ? (
        <Badge tone="warning">{Math.round(l.bestScore * 100)}%</Badge>
      ) : null}
    </button>
  )
}
