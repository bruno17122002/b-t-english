// Adaptive placement assessment ('/assessment'): 4 objective skills, optional writing/speaking, results.
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Compass,
  Ear,
  Headphones,
  Layers,
  Map,
  Mic,
  PenLine,
  Play,
  Puzzle,
  RotateCcw,
  SkipForward,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AssessmentItemView, AssessmentResult, SkillResult } from '@shared/types'
import { AiBadge, RecordButton } from '@/components/learning'
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
  Spinner,
  Textarea,
  cx,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'
import { speak, stopSpeaking, transcribe, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { AssessmentSession, ProductiveEstimate } from '../../contract'
import { CEFR_INFO, SKILL_META } from '../shared'

const MAX_PLAYS = 3 // first listen + 2 replays

type Phase = 'intro' | 'test' | 'writing' | 'speaking' | 'finishing' | 'result'

export default function AssessmentPage() {
  const L = useL()
  const navigate = useNavigate()
  const setProfile = useApp((s) => s.setProfile)
  const refreshGame = useApp((s) => s.refreshGame)
  const latest = useApi('journey:assessmentLatest', undefined)
  const [phase, setPhase] = useState<Phase>('intro')
  const [session, setSession] = useState<AssessmentSession | null>(null)
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => () => stopSpeaking(), [])

  const applySession = useCallback((s: AssessmentSession) => {
    setSession(s)
    if (s.current) setPhase('test')
    else if (!s.completedAt)
      setPhase((p) => (p === 'speaking' ? 'speaking' : p === 'test' || p === 'intro' ? 'writing' : p))
  }, [])

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (err) {
      setError(toApiError(err))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const start = (resume: boolean) =>
    run(async () => {
      const s = await api('journey:assessmentStart', { resume })
      setResult(null)
      applySession(s)
    })

  const answer = (choice: number) =>
    session?.current &&
    run(async () => {
      stopSpeaking()
      const s = await api('journey:assessmentAnswer', { id: session.id, itemId: session.current?.id ?? '', choice })
      applySession(s)
    })

  const finish = () =>
    session &&
    run(async () => {
      setPhase('finishing')
      try {
        const r = await api('journey:assessmentFinish', { id: session.id })
        setResult(r)
        setPhase('result')
        void refreshGame()
        void latest.reload()
        api('learner:profile')
          .then(setProfile)
          .catch(() => undefined)
      } catch (err) {
        setPhase('speaking')
        throw err
      }
    })

  return (
    <div data-testid="page-journey" className="mx-auto max-w-4xl">
      {phase === 'intro' && (
        <Intro
          latest={latest.data ?? null}
          loading={latest.loading}
          busy={busy}
          onStart={() => void start(true)}
          onRetake={() => void start(false)}
          onShowLatest={() => {
            if (latest.data) {
              setResult(latest.data)
              setPhase('result')
            }
          }}
        />
      )}
      {phase === 'test' && session?.current && (
        <TestView session={session} item={session.current} busy={busy} onAnswer={(c) => void answer(c)} />
      )}
      {phase === 'writing' && session && (
        <WritingTask
          session={session}
          onDone={(est) => {
            setSession({ ...session, writing: est })
          }}
          onNext={() => setPhase('speaking')}
        />
      )}
      {phase === 'speaking' && session && (
        <SpeakingTask
          session={session}
          busy={busy}
          onDone={(est) => setSession({ ...session, speaking: est })}
          onFinish={() => void finish()}
        />
      )}
      {phase === 'finishing' && (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <Spinner className="size-10" />
          <p className="text-muted">{L('Calculating your levels…', 'Đang tính trình độ của bạn…')}</p>
        </div>
      )}
      {phase === 'result' && result && (
        <ResultView
          result={result}
          onRoadmap={() => navigate('/journey?generate=1')}
          onHome={() => navigate('/')}
          onRetake={() => void start(false)}
        />
      )}
      {error && (
        <div className="mt-4">
          <ErrorState error={error} onRetry={() => setError(null)} compact />
        </div>
      )}
    </div>
  )
}

// ---------------- intro ----------------
function Intro({
  latest,
  loading,
  busy,
  onStart,
  onRetake,
  onShowLatest,
}: {
  latest: AssessmentResult | null
  loading: boolean
  busy: boolean
  onStart: () => void
  onRetake: () => void
  onShowLatest: () => void
}) {
  const L = useL()
  const fmt = useFormat()
  const parts = [
    { icon: Layers, label: L('Vocabulary', 'Từ vựng'), sub: L('6 questions', '6 câu') },
    { icon: Puzzle, label: L('Grammar', 'Ngữ pháp'), sub: L('6 questions', '6 câu') },
    { icon: BookOpen, label: L('Reading', 'Đọc hiểu'), sub: L('6 questions', '6 câu') },
    { icon: Headphones, label: L('Listening', 'Nghe'), sub: L('6 questions', '6 câu') },
    { icon: PenLine, label: L('Writing', 'Viết'), sub: L('optional', 'tùy chọn') },
    { icon: Mic, label: L('Speaking', 'Nói'), sub: L('optional', 'tùy chọn') },
  ]
  return (
    <div>
      <PageHeader
        icon={<Compass />}
        title={L('Placement test', 'Bài kiểm tra xếp lớp')}
        subtitle={L(
          'Adaptive: questions get harder when you are right and easier when you are not.',
          'Thích ứng: câu hỏi khó dần khi bạn trả lời đúng và dễ hơn khi bạn sai.',
        )}
      />
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-20 -right-20 size-60 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative grid grid-cols-2 gap-3 md:grid-cols-3">
          {parts.map((p) => (
            <div key={p.label} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
              <p.icon className="size-5 text-accent" />
              <div>
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="text-xs text-faint">{p.sub}</div>
              </div>
            </div>
          ))}
        </div>
        <ul className="relative mt-5 space-y-1.5 text-sm text-muted">
          <li className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0" />
            {L(
              'About 15 minutes. Your progress is saved – you can stop and resume.',
              'Khoảng 15 phút. Tiến độ được lưu – bạn có thể dừng và làm tiếp sau.',
            )}
          </li>
          <li className="flex gap-2">
            <Ear className="mt-0.5 size-4 shrink-0" />
            {L(
              'Listening questions can be played 3 times. Use headphones if you can.',
              'Câu nghe được phát tối đa 3 lần. Nên dùng tai nghe nếu có.',
            )}
          </li>
          <li className="flex gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0" />
            {L(
              "Don't guess wildly – an honest answer gives you a plan that fits.",
              'Đừng đoán bừa – trả lời trung thực giúp lộ trình phù hợp hơn.',
            )}
          </li>
        </ul>
        <div className="relative mt-6 flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={onStart}
            loading={busy}
            data-testid="assessment-start"
            icon={<ArrowRight className="size-5" />}
          >
            {latest ? L('Start a new test', 'Làm bài mới') : L('Start the test', 'Bắt đầu kiểm tra')}
          </Button>
          {latest && (
            <Button size="lg" variant="ghost" onClick={onShowLatest}>
              {L('See last result', 'Xem kết quả gần nhất')}
            </Button>
          )}
        </div>
      </Card>
      {loading ? (
        <div className="mt-6">
          <LoadingBlock rows={1} />
        </div>
      ) : latest ? (
        <Card className="mt-6 flex items-center gap-4">
          <CheckCircle2 className="size-6 text-success" />
          <div className="flex-1 text-sm">
            {L('Last test', 'Lần kiểm tra gần nhất')}:{' '}
            {fmt.date(latest.completedAt, { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
            {L('overall', 'tổng thể')} <CefrBadge level={latest.overall} />
          </div>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={onRetake} disabled={busy}>
            {L('Retake', 'Làm lại')}
          </Button>
        </Card>
      ) : null}
    </div>
  )
}

// ---------------- objective items ----------------
function TestView({
  session,
  item,
  busy,
  onAnswer,
}: {
  session: AssessmentSession
  item: AssessmentItemView
  busy: boolean
  onAnswer: (choice: number) => void
}) {
  const L = useL()
  const tx = useTx()
  const [selected, setSelected] = useState<number | null>(null)
  const [plays, setPlays] = useState(0)
  const [playing, setPlaying] = useState(false)
  const isListening = item.skill === 'listening'

  useEffect(() => {
    setSelected(null)
    setPlays(0)
    setPlaying(false)
  }, [item.id])

  const play = async () => {
    if (!item.passage || plays >= MAX_PLAYS || playing) return
    setPlays((p) => p + 1)
    setPlaying(true)
    try {
      await speak(item.passage, { rate: 0.95 })
    } catch {
      // A failed play does not count against the learner.
      setPlays((p) => Math.max(0, p - 1))
    } finally {
      setPlaying(false)
    }
  }

  const submit = () => {
    if (selected === null || busy) return
    onAnswer(selected)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      const n = Number(e.key)
      if (n >= 1 && n <= item.options.length) setSelected(n - 1)
      else if (e.key === 'Enter' && selected !== null && !busy) onAnswer(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item.options.length, selected, busy, onAnswer])

  const meta = SKILL_META[item.skill]
  const pct = session.objectiveTotal ? session.answeredTotal / session.objectiveTotal : 0

  return (
    <div data-testid="assessment-test">
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <meta.icon className="size-4 text-accent" />
            {tx(meta.label)}
            <span className="text-faint">
              · {L('question', 'câu')} {item.index}/{item.total}
            </span>
          </div>
          <span className="text-xs text-faint tabular-nums">{Math.round(pct * 100)}%</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {session.progress.map((p) => (
            <div key={p.skill}>
              <ProgressBar
                value={p.answered}
                max={p.total || 1}
                className="h-1.5"
                tone={p.done ? 'success' : 'accent'}
              />
              <div className={cx('mt-1 text-[11px]', p.skill === item.skill ? 'text-text' : 'text-faint')}>
                {tx(SKILL_META[p.skill].label)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="p-6">
            {isListening && item.passage && (
              <div className="mb-6 flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface-2/60 p-6">
                <button
                  onClick={() => void play()}
                  disabled={plays >= MAX_PLAYS || playing}
                  data-testid="assessment-play"
                  aria-label={L('Play audio', 'Phát âm thanh')}
                  className={cx(
                    'flex size-20 items-center justify-center rounded-full text-accent-ink transition disabled:opacity-50',
                    playing ? 'animate-pulse bg-accent' : 'bg-accent-gradient hover:brightness-110',
                  )}
                >
                  {playing ? (
                    <Ear className="size-9" />
                  ) : plays > 0 ? (
                    <RotateCcw className="size-8" />
                  ) : (
                    <Play className="ml-1 size-9" />
                  )}
                </button>
                <div className="text-sm text-muted">
                  {plays === 0
                    ? L('Press play, then answer the question.', 'Nhấn phát, sau đó trả lời câu hỏi.')
                    : L(`Plays left: ${MAX_PLAYS - plays}`, `Còn ${MAX_PLAYS - plays} lần nghe`)}
                </div>
              </div>
            )}
            {!isListening && item.passage && (
              <div className="mb-5 rounded-2xl border border-line bg-surface-2/60 p-4 text-[15px] leading-relaxed whitespace-pre-line">
                {item.passage}
              </div>
            )}
            <div className="mb-5 text-lg font-semibold">{item.prompt}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {item.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  aria-pressed={selected === i}
                  data-testid={`assessment-option-${i}`}
                  className={cx(
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    selected === i
                      ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_var(--accent)]'
                      : 'border-line bg-surface-2/40 hover:border-line-strong',
                  )}
                >
                  <span
                    className={cx(
                      'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                      selected === i ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="text-sm">{opt}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <span className="text-xs text-faint">
                {L('Keys 1–4 to choose, Enter to confirm', 'Phím 1–4 để chọn, Enter để xác nhận')}
              </span>
              <Button
                variant="primary"
                onClick={submit}
                disabled={selected === null}
                loading={busy}
                data-testid="assessment-next"
                icon={<ArrowRight className="size-4" />}
              >
                {L('Confirm', 'Xác nhận')}
              </Button>
            </div>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ---------------- writing ----------------
function EstimateCard({ est }: { est: ProductiveEstimate }) {
  const L = useL()
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-2xl border border-line bg-surface-2/60 p-4"
      data-testid="productive-estimate"
    >
      <div className="flex items-center gap-2">
        <CefrBadge level={est.cefr} className="text-sm" />
        {est.method === 'ai' ? <AiBadge /> : <Badge tone="warning">{L('rough estimate', 'ước lượng thô')}</Badge>}
      </div>
      <p className="mt-2 text-sm text-muted">{est.note}</p>
      {(est.strengths.length > 0 || est.improvements.length > 0) && (
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          {est.strengths.length > 0 && (
            <ul className="space-y-1">
              {est.strengths.map((s) => (
                <li key={s} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {s}
                </li>
              ))}
            </ul>
          )}
          {est.improvements.length > 0 && (
            <ul className="space-y-1">
              {est.improvements.map((s) => (
                <li key={s} className="flex gap-2">
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-accent" />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </motion.div>
  )
}

function WritingTask({
  session,
  onDone,
  onNext,
}: {
  session: AssessmentSession
  onDone: (e: ProductiveEstimate) => void
  onNext: () => void
}) {
  const L = useL()
  const tx = useTx()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const words = (text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []).length
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 2).length
  const grade = async () => {
    setBusy(true)
    setError(null)
    try {
      onDone(await api('journey:assessmentWriting', { id: session.id, text }))
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-testid="assessment-writing">
      <PageHeader
        icon={<PenLine />}
        title={L('Writing (optional)', 'Viết (tùy chọn)')}
        subtitle={L(
          'Great job on the questions! Two short optional tasks left.',
          'Bạn đã xong phần trắc nghiệm! Còn hai phần ngắn tùy chọn.',
        )}
      />
      <Card className="p-6">
        <p className="font-semibold">{tx(session.tasks.writing)}</p>
        <p className="mt-1 text-xs text-faint">{L(session.tasks.writing.vi, session.tasks.writing.en)}</p>
        <Textarea
          className="mt-4 min-h-40 text-[15px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={3000}
          disabled={busy}
          placeholder={L('Write in English…', 'Viết bằng tiếng Anh…')}
          data-testid="assessment-writing-text"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-faint">
          <span className="tabular-nums">
            {words} {L('words', 'từ')} · {sentences} {L('sentences', 'câu')}
          </span>
          <span>
            {session.aiAvailable
              ? L('Graded by AI (estimate)', 'AI chấm (ước lượng)')
              : L('Offline: rough estimate from text features', 'Offline: ước lượng thô theo đặc điểm văn bản')}
          </span>
        </div>
        {session.writing && <EstimateCard est={session.writing} />}
        {error && (
          <div className="mt-3">
            <ErrorState error={error} compact />
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-between gap-2">
          <Button
            variant="ghost"
            onClick={onNext}
            icon={<SkipForward className="size-4" />}
            data-testid="assessment-skip-writing"
          >
            {session.writing ? L('Continue', 'Tiếp tục') : L('Skip writing', 'Bỏ qua phần viết')}
          </Button>
          {session.writing ? (
            <Button variant="primary" onClick={onNext} icon={<ArrowRight className="size-4" />}>
              {L('Next: speaking', 'Tiếp: phần nói')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void grade()}
              loading={busy}
              disabled={words < 8}
              data-testid="assessment-grade-writing"
            >
              {L('Check my writing', 'Chấm bài viết')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

// ---------------- speaking ----------------
function SpeakingTask({
  session,
  busy,
  onDone,
  onFinish,
}: {
  session: AssessmentSession
  busy: boolean
  onDone: (e: ProductiveEstimate) => void
  onFinish: () => void
}) {
  const L = useL()
  const tx = useTx()
  const [working, setWorking] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const onRecorded = async (rec: Recording) => {
    setWorking(true)
    setError(null)
    try {
      const stt = await transcribe(rec, session.tasks.speaking.en)
      const text = stt.text.trim()
      setTranscript(text)
      if (!text)
        throw new Error(
          L(
            'We could not hear any words. Please try again closer to the microphone.',
            'Không nghe thấy lời nói. Hãy thử lại gần micro hơn.',
          ),
        )
      onDone(
        await api('journey:assessmentSpeaking', {
          id: session.id,
          transcript: text,
          durationSec: Math.max(1, rec.analysis.durationSec),
        }),
      )
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setWorking(false)
    }
  }
  return (
    <div data-testid="assessment-speaking">
      <PageHeader
        icon={<Mic />}
        title={L('Speaking (optional)', 'Nói (tùy chọn)')}
        subtitle={L(
          'Skip it and we will estimate speaking from your other skills.',
          'Bỏ qua thì kỹ năng nói sẽ được ước lượng từ các kỹ năng khác.',
        )}
      />
      <Card className="p-6">
        <p className="font-semibold">{tx(session.tasks.speaking)}</p>
        <p className="mt-1 text-xs text-faint">{L(session.tasks.speaking.vi, session.tasks.speaking.en)}</p>
        {session.aiAvailable ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            <RecordButton
              onRecorded={(r) => void onRecorded(r)}
              maxSeconds={90}
              disabled={working || busy}
              label={L('Tap to answer', 'Nhấn để trả lời')}
            />
            {working && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner className="size-4" /> {L('Listening to your answer…', 'Đang phân tích câu trả lời…')}
              </div>
            )}
            {transcript && <p className="max-w-xl text-center text-sm text-muted italic">“{transcript}”</p>}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-line bg-surface-2/60 p-4 text-sm text-muted">
            {L(
              'Speech recognition needs an AI key (Gemini or OpenAI). You can skip this part now and practise speaking later in the Speaking module.',
              'Nhận dạng giọng nói cần khóa AI (Gemini hoặc OpenAI). Bạn có thể bỏ qua phần này và luyện nói sau trong mục Nói.',
            )}
          </div>
        )}
        {session.speaking && <EstimateCard est={session.speaking} />}
        {error && (
          <div className="mt-3">
            <ErrorState error={error} compact />
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-between gap-2">
          {!session.speaking ? (
            <Button
              variant="ghost"
              onClick={onFinish}
              disabled={working}
              icon={<SkipForward className="size-4" />}
              data-testid="assessment-skip-speaking"
            >
              {L('Skip speaking', 'Bỏ qua phần nói')}
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            onClick={onFinish}
            loading={busy}
            disabled={working}
            data-testid="assessment-finish"
            icon={<ArrowRight className="size-4" />}
          >
            {L('See my results', 'Xem kết quả')}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------- results ----------------
function MethodLabel({ s }: { s: SkillResult }) {
  const L = useL()
  if (s.method === 'adaptive-test')
    return (
      <Badge tone="success">
        {L('test', 'kiểm tra')} {s.correct !== undefined ? `· ${s.correct}/${s.answered}` : ''}
      </Badge>
    )
  if (s.method === 'ai') return <AiBadge />
  if (s.method === 'heuristic') return <Badge tone="warning">{L('rough estimate', 'ước lượng thô')}</Badge>
  return <Badge tone="neutral">{L('estimated from other skills', 'ước lượng từ kỹ năng khác')}</Badge>
}

function ResultView({
  result,
  onRoadmap,
  onHome,
  onRetake,
}: {
  result: AssessmentResult
  onRoadmap: () => void
  onHome: () => void
  onRetake: () => void
}) {
  const L = useL()
  const tx = useTx()
  const info = CEFR_INFO[result.overall]
  return (
    <div data-testid="assessment-result">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden rounded-3xl border border-line bg-surface p-8 text-center shadow-card"
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative">
          <div className="text-sm tracking-wider text-muted uppercase">
            {L('Your overall level', 'Trình độ tổng thể của bạn')}
          </div>
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 12, delay: 0.1 }}
            className="mt-2 font-display text-7xl font-semibold text-gradient"
            data-testid="assessment-overall"
          >
            {result.overall}
          </motion.div>
          <div className="mt-1 text-lg font-semibold">{tx(info.name)}</div>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted">{tx(info.can)}</p>
          <div className="mt-2 text-xs text-faint">≈ IELTS {info.ielts}</div>
        </div>
      </motion.div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {result.skills.map((s, i) => {
          const meta = SKILL_META[s.skill]
          return (
            <motion.div
              key={s.skill}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
            >
              <Card className="h-full p-4">
                <div className="flex items-center gap-3">
                  <ProgressRing value={s.score / 100} size={52} stroke={5}>
                    <span className="font-display text-sm">{s.cefr}</span>
                  </ProgressRing>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold">
                      <meta.icon className="size-4 text-accent" />
                      {tx(meta.label)}
                    </div>
                    <div className="mt-1">
                      <MethodLabel s={s} />
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">{tx(CEFR_INFO[s.cefr].can)}</p>
                {s.note && s.method !== 'adaptive-test' && <p className="mt-1.5 text-xs text-faint">{s.note}</p>}
              </Card>
            </motion.div>
          )
        })}
      </div>
      <p className="mt-4 text-center text-xs text-faint">
        {L(
          'Objective skills come from the adaptive test. Writing and speaking are estimates and will be refined as you practise.',
          'Các kỹ năng trắc nghiệm được đo bằng bài kiểm tra thích ứng. Viết và nói là ước lượng và sẽ được điều chỉnh khi bạn luyện tập.',
        )}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button
          variant="primary"
          size="lg"
          icon={<Map className="size-5" />}
          onClick={onRoadmap}
          data-testid="assessment-to-roadmap"
        >
          {L('Build my roadmap', 'Tạo lộ trình của tôi')}
        </Button>
        <Button size="lg" onClick={onHome}>
          {L('Go to dashboard', 'Về trang tổng quan')}
        </Button>
        <Button size="lg" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={onRetake}>
          {L('Retake', 'Làm lại')}
        </Button>
      </div>
    </div>
  )
}
