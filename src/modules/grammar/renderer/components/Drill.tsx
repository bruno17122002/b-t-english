// One-by-one grammar drill with instant feedback, combo streaks, AI "explain my mistake" and an end summary.
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  CircleCheck,
  CircleX,
  Flame,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Trophy,
  WandSparkles,
  X,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AiBadge } from '@/components/learning'
import { Badge, Button, Card, ErrorState, Input, Kbd, ProgressBar, ProgressRing, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, type ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import {
  checkAnswer,
  fillGap,
  type GrammarExercise,
  type GrammarSubmitResult,
  type MistakeExplanation,
} from '../../contract'
import { Stars } from './art'

interface Answer {
  exercise: GrammarExercise
  given: string
  correct: boolean
}

export function Drill({
  topicId,
  exercises,
  isAi,
  aiAvailable,
  nextTopic,
  onFinished,
  onRestart,
  onMore,
  moreLoading,
}: {
  topicId: string
  exercises: GrammarExercise[]
  isAi: boolean
  aiAvailable: boolean
  nextTopic: { id: string; title: string } | null
  onFinished: (r: GrammarSubmitResult) => void
  onRestart: () => void
  onMore: () => void
  moreLoading: boolean
}) {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [text, setText] = useState('')
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(0)
  const [result, setResult] = useState<GrammarSubmitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<ApiError | null>(null)
  const started = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)

  const ex = exercises[index]
  const current = answers[index]
  const finished = answers.length === exercises.length && exercises.length > 0

  useEffect(() => {
    if (ex?.type === 'gap' && !current) inputRef.current?.focus()
  }, [ex, current])

  const answer = (given: string) => {
    if (!ex || current) return
    const correct = checkAnswer(ex, given)
    setAnswers((a) => [...a, { exercise: ex, given, correct }])
    const nextStreak = correct ? streak + 1 : 0
    setStreak(nextStreak)
    setBest((b) => Math.max(b, nextStreak))
  }

  const submit = async (all: Answer[]) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await api('grammar:submit', {
        topicId,
        durationSec: Math.round((Date.now() - started.current) / 1000),
        answers: all.map((a) => ({
          exerciseId: a.exercise.id,
          given: a.given,
          ...(isAi ? { exercise: a.exercise } : {}),
        })),
      })
      setResult(res)
      onFinished(res)
      if (res.masteredNow) toast({ kind: 'success', title: L('Topic mastered! 👑', 'Đã thành thạo chủ điểm! 👑') })
    } catch (err) {
      setSubmitError(toApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const next = () => {
    if (!current) return
    if (index + 1 < exercises.length) {
      setIndex(index + 1)
      setText('')
    } else if (!result && !submitting) void submit(answers)
  }

  // Enter moves on after an answer; A–D pick a multiple-choice option.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (result || submitting || (e.target as HTMLElement | null)?.closest?.('button, input, textarea, select')) return
      if (e.key === 'Enter' && current) {
        e.preventDefault()
        next()
        return
      }
      if (!current && ex?.type === 'mcq' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const opt = ex.options[e.key.toUpperCase().charCodeAt(0) - 65]
        if (e.key.length === 1 && opt !== undefined) answer(opt)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (exercises.length === 0) return null

  if (finished && (result || submitting || submitError)) {
    return (
      <Summary
        answers={answers}
        result={result}
        submitting={submitting}
        error={submitError}
        best={best}
        topicId={topicId}
        aiAvailable={aiAvailable}
        nextTopic={nextTopic}
        onRetrySubmit={() => void submit(answers)}
        onRestart={onRestart}
        onMore={onMore}
        moreLoading={moreLoading}
      />
    )
  }
  if (!ex) return null

  const parts = ex.prompt.split('___')
  return (
    <div className="mx-auto max-w-2xl" data-testid="grammar-drill">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm text-muted tabular-nums">
          {index + 1}/{exercises.length}
        </span>
        <ProgressBar value={answers.length} max={exercises.length} className="flex-1" />
        <AnimatePresence mode="popLayout">
          <motion.span
            key={streak}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cx(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold',
              streak >= 3 ? 'bg-warning/15 text-warning' : 'text-faint',
            )}
          >
            <Flame className="size-4" />
            {streak}
          </motion.span>
        </AnimatePresence>
        {isAi && <AiBadge estimated={false} />}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={ex.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="p-6">
            <div className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">
              {ex.type === 'gap' ? L('Fill in the gap', 'Điền vào chỗ trống') : L('Choose the answer', 'Chọn đáp án')}
            </div>
            {ex.type === 'gap' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!current && text.trim()) answer(text)
                }}
              >
                <p className="font-display text-2xl leading-relaxed">
                  {parts.map((p, i) => (
                    <Fragment key={i}>
                      {p}
                      {i < parts.length - 1 &&
                        (current ? (
                          <span
                            className={cx(
                              'rounded-md px-1.5 font-semibold',
                              current.correct ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger line-through',
                            )}
                          >
                            {current.given || '—'}
                          </span>
                        ) : (
                          <span className="mx-1 inline-block border-b-2 border-dashed border-accent px-2 text-accent">
                            ?
                          </span>
                        ))}
                    </Fragment>
                  ))}
                </p>
                {!current && (
                  <div className="mt-5 flex gap-2">
                    <Input
                      ref={inputRef}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={L('Type the missing words…', 'Gõ phần còn thiếu…')}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="grammar-gap-input"
                    />
                    <Button type="submit" variant="primary" disabled={!text.trim()} data-testid="grammar-check">
                      {L('Check', 'Kiểm tra')}
                    </Button>
                  </div>
                )}
              </form>
            ) : (
              <>
                <p className="font-display text-2xl leading-relaxed">{ex.prompt}</p>
                <div className="mt-5 grid gap-2">
                  {ex.options.map((opt, i) => {
                    const chosen = current?.given === opt
                    const isAnswer = checkAnswer(ex, opt)
                    return (
                      <button
                        key={opt}
                        disabled={!!current}
                        onClick={() => answer(opt)}
                        data-testid={`grammar-option-${i}`}
                        className={cx(
                          'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition',
                          !current && 'border-line bg-surface-2 hover:border-accent hover:bg-surface-3',
                          current && isAnswer && 'border-success/50 bg-success/10 text-success',
                          current && chosen && !isAnswer && 'border-danger/50 bg-danger/10 text-danger',
                          current && !chosen && !isAnswer && 'border-line opacity-50',
                        )}
                      >
                        <Kbd>{String.fromCharCode(65 + i)}</Kbd>
                        <span className="flex-1">{opt}</span>
                        {current && isAnswer && <Check className="size-4" />}
                        {current && chosen && !isAnswer && <X className="size-4" />}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {current && <Feedback topicId={topicId} answer={current} streak={streak} aiAvailable={aiAvailable} />}
          </Card>
        </motion.div>
      </AnimatePresence>

      {current && (
        <div className="mt-4 flex items-center justify-end gap-3 text-xs text-faint">
          <span>
            <Kbd>Enter</Kbd> {L('to continue', 'để tiếp tục')}
          </span>
          <Button variant="primary" onClick={next} icon={<ArrowRight className="size-4" />} data-testid="grammar-next">
            {index + 1 < exercises.length ? L('Next', 'Tiếp') : L('Finish', 'Hoàn thành')}
          </Button>
        </div>
      )}
    </div>
  )
}

function Feedback({
  topicId,
  answer,
  streak,
  aiAvailable,
}: {
  topicId: string
  answer: Answer
  streak: number
  aiAvailable: boolean
}) {
  const L = useL()
  const ex = answer.exercise
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx(
        'mt-5 rounded-xl border p-4 text-sm',
        answer.correct ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10',
      )}
      data-testid="grammar-feedback"
    >
      <div className="mb-1 flex items-center gap-2 font-semibold">
        {answer.correct ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}
        {answer.correct
          ? streak >= 3
            ? L(`Combo ×${streak}! Brilliant.`, `Combo ×${streak}! Xuất sắc.`)
            : L('Correct!', 'Chính xác!')
          : L('Not quite.', 'Chưa đúng.')}
      </div>
      {!answer.correct && (
        <p className="mb-1">
          {L('Correct answer:', 'Đáp án đúng:')}{' '}
          <strong className="text-success">{ex.answer.split('/').join(' / ')}</strong>
          {ex.type === 'gap' && <span className="block text-muted">→ {fillGap(ex.prompt, ex.answer)}</span>}
        </p>
      )}
      {ex.explanation && (
        <p className="flex gap-2 text-muted">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
          {ex.explanation}
        </p>
      )}
      {!answer.correct && <ExplainMistake topicId={topicId} answer={answer} aiAvailable={aiAvailable} />}
    </motion.div>
  )
}

/** "Explain my mistake" – asks the AI tutor why the answer was wrong (needs an AI key). */
export function ExplainMistake({
  topicId,
  answer,
  aiAvailable,
}: {
  topicId: string
  answer: Answer
  aiAvailable: boolean
}) {
  const L = useL()
  const [data, setData] = useState<MistakeExplanation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api('grammar:explain', { topicId, exercise: answer.exercise, given: answer.given }))
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setLoading(false)
    }
  }
  if (data)
    return (
      <div className="mt-3 space-y-1.5 rounded-lg border border-line bg-surface p-3" data-testid="grammar-explanation">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-accent">{data.rule}</span>
          <AiBadge estimated={false} />
        </div>
        <p>{L(data.explanationEn, data.explanationVi)}</p>
        <p className="text-muted">{L(data.explanationVi, data.explanationEn)}</p>
        <p className="font-medium text-success">✓ {data.correctedSentence}</p>
        <p className="text-muted">💡 {data.tip}</p>
      </div>
    )
  return (
    <div className="mt-3">
      <Button
        size="sm"
        variant="secondary"
        loading={loading}
        onClick={run}
        icon={<Sparkles className="size-4" />}
        disabled={!aiAvailable}
        title={aiAvailable ? undefined : L('Needs an AI key (Settings → AI)', 'Cần API key (Cài đặt → AI)')}
        data-testid="grammar-explain"
      >
        {L('Explain my mistake', 'Giải thích lỗi của tôi')}
      </Button>
      {!aiAvailable && <span className="ml-2 text-xs text-faint">{L('Needs an AI key', 'Cần API key AI')}</span>}
      {error && (
        <div className="mt-2">
          <ErrorState error={error} compact />
        </div>
      )}
    </div>
  )
}

function Summary({
  answers,
  result,
  submitting,
  error,
  best,
  topicId,
  aiAvailable,
  nextTopic,
  onRetrySubmit,
  onRestart,
  onMore,
  moreLoading,
}: {
  answers: Answer[]
  result: GrammarSubmitResult | null
  submitting: boolean
  error: ApiError | null
  best: number
  topicId: string
  aiAvailable: boolean
  nextTopic: { id: string; title: string } | null
  onRetrySubmit: () => void
  onRestart: () => void
  onMore: () => void
  moreLoading: boolean
}) {
  const L = useL()
  const navigate = useNavigate()
  const correct = answers.filter((a) => a.correct).length
  const score = result?.score ?? correct / Math.max(1, answers.length)
  const wrong = answers.filter((a) => !a.correct)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mx-auto max-w-2xl"
      data-testid="grammar-summary"
    >
      <Card className="relative overflow-hidden p-6 text-center">
        <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-64 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative">
          <Trophy className={cx('mx-auto size-10', score >= 0.8 ? 'text-warning' : 'text-muted')} />
          <h2 className="mt-2 font-display text-3xl font-semibold">
            {score >= 0.95
              ? L('Flawless!', 'Hoàn hảo!')
              : score >= 0.8
                ? L('Castle defended!', 'Giữ vững lâu đài!')
                : score >= 0.5
                  ? L('Good effort!', 'Cố gắng tốt!')
                  : L('Keep training!', 'Luyện thêm nhé!')}
          </h2>
          <div className="mt-4 flex items-center justify-center gap-6">
            <ProgressRing value={score} size={88} stroke={7}>
              <span className="text-lg">{Math.round(score * 100)}%</span>
            </ProgressRing>
            <div className="space-y-1 text-left text-sm">
              <div>
                <strong className="tabular-nums">
                  {correct}/{answers.length}
                </strong>{' '}
                {L('correct', 'câu đúng')}
              </div>
              <div className="flex items-center gap-1">
                <Flame className="size-4 text-warning" /> {L('Best combo', 'Combo dài nhất')} <strong>{best}</strong>
              </div>
              {result && (
                <>
                  <div className="text-accent">+{result.reward.xpGained} XP</div>
                  <div className="flex items-center gap-2">
                    {L('Mastery', 'Thành thạo')} <Stars mastery={result.mastery} />
                    {result.masteredNow && <Badge tone="success">{L('Mastered!', 'Thành thạo!')}</Badge>}
                  </div>
                </>
              )}
            </div>
          </div>
          {submitting && <p className="mt-3 text-sm text-muted">{L('Saving your result…', 'Đang lưu kết quả…')}</p>}
          {error && (
            <div className="mt-4 text-left">
              <ErrorState error={error} onRetry={onRetrySubmit} />
            </div>
          )}
        </div>
      </Card>

      {wrong.length > 0 && (
        <Card className="mt-4">
          <h3 className="mb-3 text-sm font-semibold tracking-wider text-muted uppercase">
            {L('Review your mistakes', 'Xem lại lỗi sai')}
          </h3>
          <div className="space-y-3">
            {wrong.map((a) => (
              <div key={a.exercise.id} className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
                <p className="font-medium">{a.exercise.prompt}</p>
                <p className="mt-1">
                  <span className="text-danger line-through">{a.given || '—'}</span> →{' '}
                  <span className="font-semibold text-success">{a.exercise.answer}</span>
                </p>
                <ExplainMistake topicId={topicId} answer={a} aiAvailable={aiAvailable} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          icon={<RotateCcw className="size-4" />}
          onClick={onRestart}
          data-testid="grammar-restart"
        >
          {L('Practice again', 'Luyện lại')}
        </Button>
        <Button
          variant="secondary"
          icon={<WandSparkles className="size-4" />}
          loading={moreLoading}
          disabled={!aiAvailable}
          onClick={onMore}
          title={aiAvailable ? undefined : L('Needs an AI key', 'Cần API key AI')}
          data-testid="grammar-more-ai"
        >
          {L('6 more with AI', 'Thêm 6 câu bằng AI')}
        </Button>
        {nextTopic && (
          <Button
            variant="primary"
            icon={<ArrowRight className="size-4" />}
            onClick={() => navigate(`/grammar/${nextTopic.id}`)}
          >
            {L('Next topic', 'Chủ điểm tiếp')}: {nextTopic.title}
          </Button>
        )}
      </div>
    </motion.div>
  )
}
