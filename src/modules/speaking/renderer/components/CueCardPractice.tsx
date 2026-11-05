// Challenge and IELTS practice: cue card, preparation timer, speaking timer (auto-stop), then measured
// metrics, transcript and AI feedback.
import { motion } from 'framer-motion'
import { Hourglass, Mic, NotebookPen, RotateCcw, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SpeakingSession } from '@shared/types'
import { Button, Card, ErrorState, ProgressRing, Spinner, Textarea, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, type ApiError } from '@/lib/api'
import { useRecorder, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { SpeakingPromptView } from '../../contract'
import { analysisOf, formatClock, transcribeSafe } from '../lib/shared'
import { FeedbackPanel, MetricsPanel } from './Panels'

type Phase = 'ready' | 'prep' | 'speaking' | 'processing' | 'done'

/** Preparation time: IELTS Part 2 gives one minute; Part 3 and challenges start almost immediately. */
function prepSeconds(p: SpeakingPromptView): number {
  if (p.kind === 'ielts') return /part 3/i.test(p.title) ? 15 : 60
  return 20
}

export function CueCardPractice({
  prompt,
  aiReady,
  onSaved,
}: {
  prompt: SpeakingPromptView
  aiReady: boolean
  onSaved: () => void
}) {
  const L = useL()
  // Generous hard limit: the component stops the recording itself at durationSec.
  const rec = useRecorder(prompt.durationSec + 30)
  const [phase, setPhase] = useState<Phase>('ready')
  const [left, setLeft] = useState(prepSeconds(prompt))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [session, setSession] = useState<SpeakingSession | null>(null)
  const [recUrl, setRecUrl] = useState<string | null>(null)
  const autoFeedback = useRef(false)

  // Preparation countdown.
  useEffect(() => {
    if (phase !== 'prep') return
    if (left <= 0) {
      void beginSpeaking()
      return
    }
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, left])

  // Stop at the time limit ourselves (the recorder's own auto-stop would not hand us the recording).
  const stopping = useRef(false)
  useEffect(() => {
    if (phase === 'speaking' && rec.state === 'recording' && rec.elapsed >= prompt.durationSec && !stopping.current)
      void stopNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, rec.state, rec.elapsed])

  const beginSpeaking = async () => {
    setPhase('speaking')
    stopping.current = false
    await rec.start()
  }

  const stopNow = async () => {
    if (stopping.current) return
    stopping.current = true
    const r = await rec.stop()
    if (r) await process(r)
    else setPhase('ready')
  }

  const process = async (r: Recording) => {
    setPhase('processing')
    setRecUrl(r.url)
    setError(null)
    try {
      const stt = await transcribeSafe(r, prompt.cueCard.join(' ').slice(0, 900) || prompt.title, aiReady)
      if (stt.error) setError(stt.error)
      const res = await api('speaking:submit', {
        mode: prompt.kind === 'ielts' ? 'ielts' : 'challenge',
        promptId: prompt.id,
        prompt: [prompt.title, ...prompt.cueCard].join('\n').slice(0, 4000),
        transcript: stt.text,
        analysis: analysisOf(r),
      })
      setSession(res.session)
      setPhase('done')
      onSaved()
      void useApp.getState().refreshGame()
      // With AI available, feedback is requested right away for timed tasks.
      if (aiReady && res.session.transcript && !autoFeedback.current) {
        autoFeedback.current = true
        try {
          setSession(await api('speaking:feedback', { sessionId: res.session.id }))
        } catch (err) {
          setError(toApiError(err))
        }
      }
    } catch (err) {
      setError(toApiError(err))
      setPhase('done')
    }
  }

  const reset = () => {
    setPhase('ready')
    setLeft(prepSeconds(prompt))
    setSession(null)
    setRecUrl(null)
    setError(null)
    autoFeedback.current = false
  }

  const speakingLeft = Math.max(0, prompt.durationSec - rec.elapsed)

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative">
          <div className="text-xs font-semibold tracking-wider text-muted uppercase">{L('Cue card', 'Thẻ đề')}</div>
          <h2 className="mt-1 font-display text-xl font-semibold">{prompt.title}</h2>
          {prompt.cueCard.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {prompt.cueCard.map((c, i) => (
                <li key={i} className="flex gap-2 text-[15px]">
                  <span className="text-accent">•</span>
                  {c}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-muted">{prompt.instructionsVi}</p>
        </div>
      </Card>

      {phase === 'ready' && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            icon={<Hourglass className="size-5" />}
            onClick={() => (setLeft(prepSeconds(prompt)), setPhase('prep'))}
            data-testid="cue-start"
          >
            {L(`Start (${prepSeconds(prompt)}s preparation)`, `Bắt đầu (${prepSeconds(prompt)} giây chuẩn bị)`)}
          </Button>
          <Button variant="ghost" icon={<Mic className="size-4" />} onClick={() => void beginSpeaking()}>
            {L('Skip preparation', 'Bỏ qua chuẩn bị')}
          </Button>
          <span className="text-sm text-muted">
            {L(
              `Speaking time: up to ${formatClock(prompt.durationSec)}`,
              `Thời gian nói: tối đa ${formatClock(prompt.durationSec)}`,
            )}
          </span>
        </div>
      )}

      {phase === 'prep' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-5">
            <ProgressRing value={left / prepSeconds(prompt)} size={110} stroke={8}>
              <span className="font-mono text-2xl">{left}</span>
            </ProgressRing>
            <span className="text-sm text-muted">{L('Preparation', 'Chuẩn bị')}</span>
            <Button variant="secondary" size="sm" onClick={() => setLeft(0)}>
              {L('Ready – start speaking', 'Sẵn sàng – nói ngay')}
            </Button>
          </div>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <NotebookPen className="size-4" />
              {L('Notes (keywords only, not full sentences)', 'Ghi chú (chỉ từ khoá, không viết cả câu)')}
            </span>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-36" />
          </label>
        </motion.div>
      )}

      {phase === 'speaking' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-wrap items-center gap-6 rounded-2xl border border-line bg-surface p-5"
        >
          <ProgressRing value={speakingLeft / prompt.durationSec} size={120} stroke={8}>
            <span className="font-mono text-xl">{formatClock(speakingLeft)}</span>
          </ProgressRing>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <span
                className={cx(
                  'size-3 rounded-full',
                  rec.state === 'recording' ? 'animate-pulse bg-danger' : 'bg-surface-3',
                )}
              />
              {rec.state === 'recording'
                ? L('Recording – keep talking', 'Đang ghi – cứ tiếp tục nói')
                : rec.state === 'requesting'
                  ? L('Opening microphone…', 'Đang mở micro…')
                  : L('Processing…', 'Đang xử lý…')}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full bg-accent-gradient transition-[width] duration-75"
                style={{ width: `${Math.min(100, rec.level * 160)}%` }}
              />
            </div>
            {notes && <p className="text-sm whitespace-pre-wrap text-muted">{notes}</p>}
            {rec.error && <p className="text-sm text-danger">{rec.error}</p>}
          </div>
          <Button
            variant="danger"
            icon={<Square className="size-4" />}
            onClick={() => void stopNow()}
            disabled={rec.state !== 'recording'}
            data-testid="cue-stop"
          >
            {L('Stop', 'Dừng')}
          </Button>
          {rec.state === 'error' && (
            <Button variant="secondary" onClick={reset}>
              {L('Back', 'Quay lại')}
            </Button>
          )}
        </motion.div>
      )}

      {phase === 'processing' && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
          <Spinner />{' '}
          {aiReady
            ? L('Transcribing and analysing…', 'Đang chuyển thành chữ và phân tích…')
            : L('Measuring your recording…', 'Đang đo bản ghi…')}
        </div>
      )}

      {error && <ErrorState error={error} compact />}

      {phase === 'done' && session && (
        <div className="space-y-4">
          {recUrl && <audio controls src={recUrl} className="w-full" />}
          <MetricsPanel measured={session.measured} transcript={session.transcript || null} aiReady={aiReady} />
          <FeedbackPanel key={`${session.id}-${session.feedback ? 1 : 0}`} session={session} aiReady={aiReady} />
          <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={reset}>
            {L('Try again', 'Làm lại')}
          </Button>
        </div>
      )}
    </div>
  )
}
