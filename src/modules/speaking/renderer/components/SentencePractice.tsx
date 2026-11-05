// Shadowing and listen-&-repeat practice: hear a target sentence, record yourself, then see measured
// metrics (duration, pauses, WPM, word match) and optional AI feedback.
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Eye, EyeOff, Turtle, Volume2 } from 'lucide-react'
import { useState } from 'react'
import type { SpeakingSession } from '@shared/types'
import { RecordButton } from '@/components/learning'
import { Button, Card, ErrorState, Spinner, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, type ApiError } from '@/lib/api'
import { speak, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { SpeakingPromptView } from '../../contract'
import { analysisOf, transcribeSafe } from '../lib/shared'
import { FeedbackPanel, MetricsPanel } from './Panels'

export function SentencePractice({
  prompt,
  aiReady,
  onSaved,
}: {
  prompt: SpeakingPromptView
  aiReady: boolean
  onSaved: () => void
}) {
  const L = useL()
  const isRepeat = prompt.kind === 'repeat'
  const [idx, setIdx] = useState(0)
  const [showText, setShowText] = useState(!isRepeat)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [session, setSession] = useState<SpeakingSession | null>(null)
  const [recUrl, setRecUrl] = useState<string | null>(null)
  const [best, setBest] = useState<Record<number, number>>({})
  const sentence = prompt.sentences[idx] ?? ''

  const go = (i: number) => {
    setIdx(i)
    setSession(null)
    setRecUrl(null)
    setError(null)
    setShowText(!isRepeat)
  }

  const onRecorded = async (rec: Recording) => {
    setRecUrl(rec.url)
    setBusy(true)
    setError(null)
    try {
      const stt = await transcribeSafe(rec, sentence, aiReady)
      if (stt.error) setError(stt.error)
      const res = await api('speaking:submit', {
        mode: prompt.kind === 'repeat' ? 'repeat' : 'shadowing',
        promptId: prompt.id,
        prompt: sentence,
        target: sentence,
        transcript: stt.text,
        analysis: analysisOf(rec),
      })
      setSession(res.session)
      if (res.score !== null) setBest((b) => ({ ...b, [idx]: Math.max(b[idx] ?? 0, res.score ?? 0) }))
      setShowText(true)
      onSaved()
      void useApp.getState().refreshGame()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {prompt.sentences.map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            className={cx(
              'h-2 w-8 rounded-full transition',
              i === idx
                ? 'bg-accent'
                : best[i] !== undefined
                  ? best[i] >= 0.8
                    ? 'bg-success'
                    : 'bg-warning'
                  : 'bg-surface-3 hover:bg-line-strong',
            )}
            aria-label={L(`Sentence ${i + 1}`, `Câu ${i + 1}`)}
          />
        ))}
      </div>

      <Card className="text-center">
        <div className="text-xs font-semibold tracking-wider text-muted uppercase">
          {L('Sentence', 'Câu')} {idx + 1}/{prompt.sentences.length}
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={`${idx}-${showText}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cx(
              'mx-auto mt-3 max-w-2xl font-display text-2xl leading-snug',
              !showText && 'blur-md select-none',
            )}
            data-testid="speaking-target"
          >
            {sentence}
          </motion.p>
        </AnimatePresence>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" icon={<Volume2 className="size-4" />} onClick={() => void speak(sentence)}>
            {L('Listen', 'Nghe')}
          </Button>
          <Button
            variant="ghost"
            icon={<Turtle className="size-4" />}
            onClick={() => void speak(sentence, { rate: 0.75 })}
          >
            {L('Slowly', 'Chậm')}
          </Button>
          {isRepeat && (
            <Button
              variant="ghost"
              icon={showText ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              onClick={() => setShowText((v) => !v)}
            >
              {showText ? L('Hide text', 'Ẩn chữ') : L('Show text', 'Hiện chữ')}
            </Button>
          )}
        </div>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
          {isRepeat
            ? L('Listen, then repeat from memory without reading.', 'Nghe rồi nhắc lại theo trí nhớ, không nhìn chữ.')
            : L(
                'Listen, then speak along at the same speed and rhythm.',
                'Nghe rồi nói theo cùng tốc độ và nhịp điệu.',
              )}
        </p>
        <div className="mt-6 flex justify-center">
          <RecordButton key={idx} maxSeconds={30} disabled={busy} onRecorded={(r) => void onRecorded(r)} />
        </div>
        {busy && (
          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted">
            <Spinner className="size-4" />
            {aiReady ? L('Transcribing and measuring…', 'Đang chuyển thành chữ và đo…') : L('Measuring…', 'Đang đo…')}
          </div>
        )}
      </Card>

      {error && <ErrorState error={error} compact />}

      {session && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {recUrl && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
              <span className="text-sm text-muted">{L('Your recording', 'Bản ghi của bạn')}</span>
              <audio controls src={recUrl} className="h-9 flex-1" />
              <Button
                size="sm"
                variant="ghost"
                icon={<Volume2 className="size-4" />}
                onClick={() => void speak(sentence)}
              >
                {L('Model', 'Câu mẫu')}
              </Button>
            </div>
          )}
          <MetricsPanel measured={session.measured} transcript={session.transcript || null} aiReady={aiReady} />
          <FeedbackPanel key={session.id} session={session} aiReady={aiReady} />
        </motion.div>
      )}

      <div className="flex justify-between">
        <Button
          variant="ghost"
          icon={<ArrowLeft className="size-4" />}
          disabled={idx === 0}
          onClick={() => go(idx - 1)}
        >
          {L('Previous', 'Câu trước')}
        </Button>
        <Button
          variant={session ? 'primary' : 'secondary'}
          icon={<ArrowRight className="size-4" />}
          disabled={idx >= prompt.sentences.length - 1}
          onClick={() => go(idx + 1)}
        >
          {L('Next sentence', 'Câu tiếp')}
        </Button>
      </div>
    </div>
  )
}
