// Grammar topic page: bilingual explanation, pattern cards, examples with audio, common mistakes and the drill.
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Castle,
  Languages,
  ListChecks,
  Swords,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { optionOrder, shuffled } from '@core/shuffle'
import { AiBadge, SpeakButton } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  ProgressRing,
  Section,
  Tabs,
} from '@/components/ui'
import { useFormat, useL } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'
import type { GrammarExercise } from '../../contract'
import { Stars } from '../components/art'
import { Drill } from '../components/Drill'

type Mode = 'learn' | 'practice'

export default function TopicPage() {
  const { id = '' } = useParams()
  const L = useL()
  const fmt = useFormat()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi('grammar:topic', { id }, [id])
  const [mode, setMode] = useState<Mode>('learn')
  const [drill, setDrill] = useState<{ key: number; exercises: GrammarExercise[]; ai: boolean } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<ApiError | null>(null)

  // Every run (and every "try again") shuffles the exercises and the multiple-choice options; grading is by
  // the option text, so the order does not matter to the server.
  const startDrill = (exercises: GrammarExercise[], ai = false) => {
    const mixed = shuffled(exercises).map((ex) =>
      ex.type === 'mcq' ? { ...ex, options: optionOrder(ex.options).map((i) => ex.options[i] ?? '') } : ex,
    )
    setDrill({ key: Date.now(), exercises: mixed, ai })
    setMode('practice')
  }

  const generate = async () => {
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await api('grammar:generate', { topicId: id })
      if (res.exercises.length) startDrill(res.exercises, true)
      else
        setAiError(
          toApiError(
            new Error(
              L('The AI returned no usable exercises. Try again.', 'AI chưa tạo được bài tập phù hợp. Hãy thử lại.'),
            ),
          ),
        )
    } catch (err) {
      setAiError(toApiError(err))
    } finally {
      setAiLoading(false)
    }
  }

  if (loading && !data)
    return (
      <div data-testid="page-grammar">
        <LoadingBlock rows={5} />
      </div>
    )
  if (error || !data)
    return (
      <div data-testid="page-grammar">
        {error?.code === 'not_found' ? (
          <EmptyState
            icon={<Castle />}
            title={L('Topic not found', 'Không tìm thấy chủ điểm')}
            action={<Button onClick={() => navigate('/grammar')}>{L('Back to the kingdom', 'Về vương quốc')}</Button>}
          />
        ) : (
          <ErrorState error={error ?? L('Could not load this topic.', 'Không tải được chủ điểm.')} onRetry={reload} />
        )}
      </div>
    )

  const { topic } = data
  return (
    <div data-testid="page-grammar">
      <button
        onClick={() => navigate('/grammar')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-text"
      >
        <ArrowLeft className="size-4" /> {L('Grammar Kingdom', 'Vương quốc ngữ pháp')}
      </button>

      <header className="mb-6 flex flex-wrap items-center gap-5">
        <ProgressRing value={data.mastery} size={72} stroke={6}>
          {Math.round(data.mastery * 100)}%
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <CefrBadge level={topic.cefr} />
            <Stars mastery={data.mastery} />
            {data.status === 'mastered' && <Badge tone="success">{L('Mastered', 'Thành thạo')}</Badge>}
            {data.mistakeCount > 0 && (
              <Badge tone="danger">
                {L(`${data.mistakeCount} recurring mistakes`, `${data.mistakeCount} lỗi lặp lại`)}
              </Badge>
            )}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{topic.title}</h1>
          <p className="mt-1 text-sm text-muted">{topic.summaryEn}</p>
        </div>
        <Tabs<Mode>
          value={mode}
          onChange={(m) => {
            if (m === 'practice' && !drill) startDrill(topic.exercises)
            else setMode(m)
          }}
          items={[
            { value: 'learn', label: L('Learn', 'Học') },
            {
              value: 'practice',
              label: L('Drill', 'Luyện tập'),
              count: drill?.exercises.length ?? topic.exercises.length,
            },
          ]}
        />
      </header>

      {mode === 'learn' ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
                <Languages className="size-4" /> {L('Explanation (Vietnamese)', 'Giải thích')}
              </div>
              <p className="leading-relaxed whitespace-pre-line">{topic.explanationVi}</p>
              <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
                <span className="mr-1 font-semibold text-accent">EN</span>
                <span className="text-muted">{topic.summaryEn}</span>
              </div>
            </Card>
            <Card>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted">
                <ListChecks className="size-4" /> {L('Patterns', 'Cấu trúc')}
              </div>
              <div className="space-y-2">
                {topic.patterns.map((p, i) => (
                  <motion.div
                    key={p}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="rounded-xl border border-accent/25 bg-accent/10 px-3 py-2 font-mono text-sm"
                  >
                    {p}
                  </motion.div>
                ))}
              </div>
            </Card>
          </div>

          <Section title={L('Examples', 'Ví dụ')} className="mt-8">
            <div className="grid gap-2 md:grid-cols-2">
              {topic.examples.map((ex) => (
                <div key={ex.en} className="flex items-start gap-2 rounded-xl border border-line bg-surface p-3">
                  <SpeakButton text={ex.en} />
                  <div>
                    <p className="font-medium">{ex.en}</p>
                    <p className="text-sm text-muted">{ex.vi}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title={L('Common mistakes', 'Lỗi thường gặp')}>
            <div className="space-y-2">
              {topic.commonMistakes.map((m) => (
                <div key={m.wrong} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <TriangleAlert className="size-4 text-danger" />
                    <span className="text-danger line-through decoration-2">{m.wrong}</span>
                    <ArrowRight className="size-4 text-faint" />
                    <span className="font-semibold text-success">{m.right}</span>
                    <SpeakButton text={m.right} />
                  </div>
                  <p className="mt-1 pl-6 text-sm text-muted">{m.why}</p>
                </div>
              ))}
            </div>
          </Section>

          <Card className="flex flex-wrap items-center gap-4">
            <Swords className="size-8 text-accent" />
            <div className="flex-1">
              <div className="font-display text-lg font-semibold">
                {L('Ready to defend the castle?', 'Sẵn sàng giữ lâu đài?')}
              </div>
              <p className="text-sm text-muted">
                {L(
                  `${topic.exercises.length} exercises · 80% to master this topic`,
                  `${topic.exercises.length} bài tập · đạt 80% để thành thạo`,
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              icon={<WandSparkles className="size-4" />}
              loading={aiLoading}
              disabled={!data.aiAvailable}
              onClick={generate}
              title={data.aiAvailable ? undefined : L('Needs an AI key (Settings → AI)', 'Cần API key (Cài đặt → AI)')}
              data-testid="grammar-generate"
            >
              {L('6 extra with AI', 'Thêm 6 câu bằng AI')}
            </Button>
            <Button
              variant="primary"
              icon={<Swords className="size-4" />}
              onClick={() => startDrill(topic.exercises)}
              data-testid="grammar-start-drill"
            >
              {L('Start drill', 'Bắt đầu luyện')}
            </Button>
          </Card>
          {!data.aiAvailable && (
            <p className="mt-2 text-right text-xs text-faint">
              {L(
                'AI exercises and explanations need an API key; the drill works offline.',
                'Bài tập AI và giải thích lỗi cần API key; phần luyện tập vẫn chạy offline.',
              )}
            </p>
          )}
          {aiError && (
            <div className="mt-3">
              <ErrorState error={aiError} />
            </div>
          )}

          {data.attempts.length > 0 && (
            <Section title={L('Your attempts', 'Lịch sử luyện tập')} className="mt-8">
              <div className="flex flex-wrap gap-2">
                {data.attempts.map((a) => (
                  <div key={a.createdAt} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                    <span className="font-semibold tabular-nums">{Math.round(a.score * 100)}%</span>
                    <span className="ml-2 text-muted">
                      {a.correct}/{a.total} · {fmt.date(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </motion.div>
      ) : drill ? (
        <>
          {drill.ai && (
            <div className="mx-auto mb-3 flex max-w-2xl items-center gap-2 text-xs text-muted">
              <AiBadge estimated={false} />{' '}
              {L(
                `Extra AI exercises for your level (${data.learnerLevel})`,
                `Bài tập thêm do AI tạo cho trình độ ${data.learnerLevel}`,
              )}
            </div>
          )}
          <Drill
            key={drill.key}
            topicId={topic.id}
            exercises={drill.exercises}
            isAi={drill.ai}
            aiAvailable={data.aiAvailable}
            nextTopic={data.nextTopic}
            onFinished={() => void reload()}
            onRestart={() => startDrill(drill.exercises, drill.ai)}
            onMore={generate}
            moreLoading={aiLoading}
          />
          {aiError && (
            <div className="mx-auto mt-3 max-w-2xl">
              <ErrorState error={aiError} />
            </div>
          )}
          <div className="mt-6 text-center">
            <Button variant="ghost" size="sm" icon={<BookOpen className="size-4" />} onClick={() => setMode('learn')}>
              {L('Back to the lesson', 'Quay lại bài học')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
