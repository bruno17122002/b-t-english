// A Pronunciation Path lesson: theory (sanitised text) or a word drill (listen → record → AI phoneme
// estimate aligned with the target IPA, or self-assessment offline). Completion is stored per lesson.
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Dumbbell,
  GraduationCap,
  Lightbulb,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Turtle,
  Volume2,
  XCircle,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AiBadge, RecordButton } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  ProgressBar,
  ProgressRing,
  Section,
  Spinner,
  cx,
} from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, useAction, useApi, type ApiError } from '@/lib/api'
import { speak, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { PronCompleteResult, PronEstimateResult, PronLessonView } from '../../contract'
import { AlignmentView, CadenceAttribution, PhonemeModal, TheoryView } from '../components/Pronunciation'
import { noKeyError, transcribeSafe, useAiReady } from '../lib/shared'
import type { PhonemeEntry } from '@shared/packs'

const TYPE_META = {
  theory: { icon: BookOpen, en: 'Theory', vi: 'Lý thuyết' },
  practice: { icon: Dumbbell, en: 'Practice', vi: 'Luyện tập' },
  exam: { icon: GraduationCap, en: 'Exam', vi: 'Kiểm tra' },
}

export default function PronLessonPage() {
  const L = useL()
  const navigate = useNavigate()
  const { lessonId = '' } = useParams()
  const { data, error, loading, reload } = useApi('speaking:pronLesson', { id: lessonId }, [lessonId])
  const ai = useAiReady()

  return (
    <div data-testid="page-speaking">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="size-4" />}
        onClick={() => navigate('/speaking/pronunciation')}
        className="mb-4"
      >
        {L('Pronunciation Path', 'Lộ trình phát âm')}
      </Button>
      {(loading && !data) || ai.loading ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        error.code === 'not_found' ? (
          <EmptyState title={L('Lesson not found', 'Không tìm thấy bài học')} body={error.message} />
        ) : (
          <ErrorState error={error} onRetry={reload} />
        )
      ) : data ? (
        <Lesson key={data.lesson.id} view={data} aiReady={ai.ready} onDone={() => void reload()} />
      ) : null}
    </div>
  )
}

function Lesson({ view, aiReady, onDone }: { view: PronLessonView; aiReady: boolean; onDone: () => void }) {
  const L = useL()
  const navigate = useNavigate()
  const [phoneme, setPhoneme] = useState<PhonemeEntry | null>(null)
  const meta = TYPE_META[view.lesson.type]
  const Icon = meta.icon

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
            <Icon className="size-4" />
            {L(`Module ${view.module.order} · ${meta.en}`, `Chặng ${view.module.order} · ${meta.vi}`)}
            {view.lesson.completed && (
              <Badge tone="success">
                <CheckCircle2 className="size-3" /> {L('Done', 'Đã xong')}
              </Badge>
            )}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{view.lesson.title}</h1>
          <p className="mt-1 text-sm text-muted">{view.module.title}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {view.focusPhonemes.map((p) => (
            <button
              key={p.symbol}
              onClick={() => setPhoneme(p)}
              className="rounded-lg bg-accent/10 px-2.5 py-1 font-mono text-accent hover:bg-accent/20"
              title={p.label}
            >
              /{p.symbol}/
            </button>
          ))}
        </div>
      </header>

      {view.lesson.type === 'theory' ? (
        <TheoryLesson view={view} onDone={onDone} />
      ) : (
        <WordDrill view={view} aiReady={aiReady} onDone={onDone} />
      )}

      <div className="mt-8 flex justify-between">
        <Button
          variant="ghost"
          icon={<ArrowLeft className="size-4" />}
          disabled={!view.prevLessonId}
          onClick={() => view.prevLessonId && navigate(`/speaking/pronunciation/${view.prevLessonId}`)}
        >
          {L('Previous lesson', 'Bài trước')}
        </Button>
        <Button
          variant="ghost"
          icon={<ArrowRight className="size-4" />}
          disabled={!view.nextLessonId}
          onClick={() => view.nextLessonId && navigate(`/speaking/pronunciation/${view.nextLessonId}`)}
        >
          {L('Next lesson', 'Bài sau')}
        </Button>
      </div>
      <PhonemeModal p={phoneme} onClose={() => setPhoneme(null)} />
      <CadenceAttribution attribution={view.attribution} />
    </>
  )
}

function TheoryLesson({ view, onDone }: { view: PronLessonView; onDone: () => void }) {
  const L = useL()
  const navigate = useNavigate()
  const started = useRef(Date.now())
  const complete = useAction(async () => {
    const res = await api('speaking:pronComplete', {
      lessonId: view.lesson.id,
      score: 1,
      durationSec: Math.round((Date.now() - started.current) / 1000),
      speakingSec: 0,
    })
    void useApp.getState().refreshGame()
    onDone()
    return res
  })
  const [done, setDone] = useState<PronCompleteResult | undefined>()
  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <TheoryView blocks={view.theory} />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {done ? (
            <>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-success">
                <CheckCircle2 className="size-4" /> {L('Marked as read', 'Đã đánh dấu đã học')}
                {done.reward.xpGained > 0 && <span className="text-accent">+{done.reward.xpGained} XP</span>}
              </span>
              {view.nextLessonId && (
                <Button
                  variant="primary"
                  icon={<ArrowRight className="size-4" />}
                  onClick={() => navigate(`/speaking/pronunciation/${view.nextLessonId}`)}
                >
                  {L('Start practising', 'Bắt đầu luyện')}
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="primary"
              icon={<CheckCircle2 className="size-4" />}
              loading={complete.pending}
              onClick={() => void complete.run().then(setDone)}
              data-testid="pron-theory-done"
            >
              {L('I have read this', 'Tôi đã đọc xong')}
            </Button>
          )}
        </div>
        {complete.error && (
          <div className="mt-3">
            <ErrorState error={complete.error} compact />
          </div>
        )}
      </Card>
      <div className="space-y-3">
        {view.focusPhonemes.map((p) => (
          <Card key={p.symbol} className="p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl text-accent">/{p.symbol}/</span>
              <span className="text-sm text-muted">{p.label}</span>
            </div>
            {p.viNote && (
              <p className="mt-2 flex gap-1.5 text-sm">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                {p.viNote}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {p.exampleWords.slice(0, 5).map((w) => (
                <button
                  key={w}
                  onClick={() => void speak(w)}
                  className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent"
                >
                  {w}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

interface WordResult {
  score: number
  method: 'ai' | 'self'
  estimate?: PronEstimateResult
}

function WordDrill({ view, aiReady, onDone }: { view: PronLessonView; aiReady: boolean; onDone: () => void }) {
  const L = useL()
  const navigate = useNavigate()
  const isExam = view.lesson.type === 'exam'
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState<Record<number, WordResult>>({})
  const [recUrl, setRecUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [finished, setFinished] = useState(false)
  const [complete, setComplete] = useState<PronCompleteResult | null>(null)
  const [saving, setSaving] = useState(false)
  const speakingSec = useRef(0)
  const started = useRef(Date.now())
  const word = view.words[idx]
  const res = results[idx]

  if (view.words.length === 0) return <EmptyState title={L('No words in this lesson', 'Bài này chưa có từ')} />

  const onRecorded = async (rec: Recording) => {
    if (!word) return
    speakingSec.current += rec.analysis.speakingSec
    setRecUrl(rec.url)
    setError(null)
    if (!aiReady) return
    setBusy(true)
    try {
      const stt = await transcribeSafe(rec, word.word, true)
      if (stt.error) throw stt.error
      const est = await api('speaking:pronEstimate', { word: word.word, ipa: word.ipa, transcript: stt.text ?? '' })
      setResults((r) => ({ ...r, [idx]: { score: est.score, method: 'ai', estimate: est } }))
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const selfRate = (score: number) => setResults((r) => ({ ...r, [idx]: { score, method: 'self' } }))

  const next = () => {
    setRecUrl(null)
    setError(null)
    if (idx < view.words.length - 1) setIdx(idx + 1)
    else setFinished(true)
  }

  const scored = Object.values(results)
  const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / view.words.length : 0

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const r = await api('speaking:pronComplete', {
        lessonId: view.lesson.id,
        score: Math.round(avg * 100) / 100,
        durationSec: Math.round((Date.now() - started.current) / 1000),
        speakingSec: Math.round(speakingSec.current),
        words: view.words.map((w, i) => ({
          word: w.word,
          score: results[i]?.score ?? 0,
          method: results[i]?.method ?? 'self',
        })),
      })
      setComplete(r)
      void useApp.getState().refreshGame()
      onDone()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const restart = () => {
    setIdx(0)
    setResults({})
    setFinished(false)
    setComplete(null)
    setRecUrl(null)
    speakingSec.current = 0
    started.current = Date.now()
  }

  if (finished)
    return (
      <Card className="flex flex-wrap items-center gap-5" data-testid="pron-drill-result">
        <ProgressRing value={avg} size={84}>
          {Math.round(avg * 100)}%
        </ProgressRing>
        <div className="flex-1">
          <div className="font-display text-xl font-semibold">
            {complete
              ? complete.passed
                ? isExam
                  ? L('Exam passed!', 'Đã qua bài kiểm tra!')
                  : L('Lesson complete!', 'Hoàn thành bài!')
                : L(
                    `Not passed yet – you need ${Math.round(view.passScore * 100)}%`,
                    `Chưa đạt – cần ${Math.round(view.passScore * 100)}%`,
                  )
              : L('Drill finished', 'Đã luyện xong')}
          </div>
          <p className="text-sm text-muted">
            {scored.some((r) => r.method === 'ai')
              ? L('Scores are AI estimates from speech recognition.', 'Điểm do AI ước lượng từ nhận dạng giọng nói.')
              : L('Self-assessed (rough estimate).', 'Tự đánh giá (ước lượng thô).')}
            {complete && complete.reward.xpGained > 0 && (
              <span className="ml-2 font-semibold text-accent">+{complete.reward.xpGained} XP</span>
            )}
          </p>
          {error && (
            <div className="mt-2">
              <ErrorState error={error} compact />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!complete ? (
            <Button variant="primary" loading={saving} onClick={() => void save()} data-testid="pron-save">
              {L('Save result', 'Lưu kết quả')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={restart}>
                {L('Practise again', 'Luyện lại')}
              </Button>
              {view.nextLessonId && complete.passed && (
                <Button
                  variant="primary"
                  icon={<ArrowRight className="size-4" />}
                  onClick={() => navigate(`/speaking/pronunciation/${view.nextLessonId}`)}
                >
                  {L('Next lesson', 'Bài tiếp')}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    )

  if (!word) return null
  const showModel = !isExam || !!res

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ProgressBar value={Object.keys(results).length} max={view.words.length} className="flex-1" />
        <span className="text-sm text-muted tabular-nums">
          {idx + 1}/{view.words.length}
        </span>
      </div>
      {isExam && (
        <p className="text-sm text-muted">
          {L(
            'Exam: read the word aloud first – the model audio unlocks after your attempt.',
            'Kiểm tra: đọc to từ trước – âm mẫu mở sau khi bạn nói.',
          )}
        </p>
      )}

      <motion.div key={idx} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
        <Card className="text-center">
          <div className="font-display text-5xl font-semibold tracking-tight" data-testid="pron-word">
            {word.word}
          </div>
          <div className="mt-2 font-mono text-lg text-muted">
            /
            {word.phonemes.map((p, i) => (
              <span key={i} className={cx(p === word.focusPhoneme && 'rounded bg-accent/15 px-0.5 text-accent')}>
                {p}
              </span>
            ))}
            /
          </div>
          {word.cue && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{word.cue}</p>}
          {showModel && (
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="secondary" icon={<Volume2 className="size-4" />} onClick={() => void speak(word.word)}>
                {L('Listen', 'Nghe')}
              </Button>
              <Button
                variant="ghost"
                icon={<Turtle className="size-4" />}
                onClick={() => void speak(word.word, { rate: 0.6 })}
              >
                {L('Slowly', 'Chậm')}
              </Button>
            </div>
          )}
          <div className="mt-6 flex justify-center">
            <RecordButton key={idx} maxSeconds={8} disabled={busy} onRecorded={(r) => void onRecorded(r)} />
          </div>
          {busy && (
            <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted">
              <Spinner className="size-4" /> {L('Estimating your sounds…', 'Đang ước lượng âm bạn phát ra…')}
            </p>
          )}
        </Card>
      </motion.div>

      {error && <ErrorState error={error} compact />}

      {recUrl && (
        <Card className="space-y-4">
          <audio controls src={recUrl} className="w-full" />
          {res?.estimate ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold">
                  {L('Sounds we think you made', 'Âm mà AI nghĩ bạn đã phát ra')}
                </span>
                <AiBadge />
                <span className="ml-auto font-mono text-sm">{Math.round(res.estimate.score * 100)}%</span>
              </div>
              <AlignmentView alignment={res.estimate.alignment} />
              <p className="text-sm text-muted">
                {L('Recognised as', 'Nhận dạng là')}: “{res.estimate.transcript || '…'}” · /{res.estimate.heardIpa}/
                {res.estimate.confidence === 'low' && (
                  <span className="ml-1 text-faint">({L('low confidence', 'độ tin cậy thấp')})</span>
                )}
              </p>
              {res.estimate.tipVi && (
                <p className="flex gap-1.5 text-sm">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                  {res.estimate.tipVi}
                </p>
              )}
            </div>
          ) : !aiReady ? (
            <div className="space-y-3">
              <ErrorState
                compact
                error={noKeyError(
                  L(
                    'Sound-by-sound analysis needs speech-to-text (AI key). Listen to your recording and the model, then rate yourself.',
                    'Phân tích từng âm cần chuyển giọng nói thành chữ (API key). Hãy nghe lại bản ghi và âm mẫu rồi tự đánh giá.',
                  ),
                )}
              />
              {!res && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Volume2 className="size-4" />}
                    onClick={() => void speak(word.word)}
                  >
                    {L('Model', 'Âm mẫu')}
                  </Button>
                  <Button
                    size="sm"
                    variant="success"
                    icon={<ThumbsUp className="size-4" />}
                    onClick={() => selfRate(1)}
                  >
                    {L('Sounds right', 'Giống mẫu')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => selfRate(0.6)}>
                    {L('Close', 'Gần đúng')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<ThumbsDown className="size-4" />}
                    onClick={() => selfRate(0.2)}
                  >
                    {L('Needs work', 'Cần luyện thêm')}
                  </Button>
                </div>
              )}
              {res && (
                <p className="text-sm text-muted">
                  {L('Self-assessed (rough estimate).', 'Tự đánh giá (ước lượng thô).')}
                </p>
              )}
            </div>
          ) : null}
        </Card>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-faint">
          {res ? (
            res.score >= view.passScore ? (
              <CheckCircle2 className="inline size-4 text-success" />
            ) : (
              <XCircle className="inline size-4 text-warning" />
            )
          ) : null}
        </span>
        <div className="flex gap-2">
          {!res && (
            <Button variant="ghost" onClick={() => (selfRate(0), next())}>
              {L('Skip', 'Bỏ qua')}
            </Button>
          )}
          <Button
            variant={res ? 'primary' : 'secondary'}
            icon={<ArrowRight className="size-4" />}
            disabled={!res}
            onClick={next}
            data-testid="pron-next"
          >
            {idx < view.words.length - 1 ? L('Next word', 'Từ tiếp') : L('Finish', 'Hoàn thành')}
          </Button>
        </div>
      </div>
      <Section title={L('Words in this lesson', 'Các từ trong bài')} className="mt-6">
        <div className="flex flex-wrap gap-1.5">
          {view.words.map((w, i) => (
            <span
              key={w.word}
              className={cx(
                'rounded-lg border px-2.5 py-1 text-sm',
                i === idx
                  ? 'border-accent text-accent'
                  : results[i]
                    ? (results[i]?.score ?? 0) >= view.passScore
                      ? 'border-success/40 text-success'
                      : 'border-warning/40 text-warning'
                    : 'border-line text-muted',
              )}
            >
              {w.word}
            </span>
          ))}
        </div>
      </Section>
    </div>
  )
}
