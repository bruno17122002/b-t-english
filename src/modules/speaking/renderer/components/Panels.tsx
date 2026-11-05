// Result panels for speaking sessions: measured metrics (objective) and AI feedback (estimated).
import { motion } from 'framer-motion'
import { Activity, Clock, Gauge, MessageSquareQuote, PauseCircle, Sparkles, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { SpeakingMeasured, SpeakingSession } from '@shared/types'
import { AiBadge, SpeakButton } from '@/components/learning'
import { Badge, Button, CefrBadge, ErrorState, ProgressBar, ProgressRing, StatTile, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, useAction } from '@/lib/api'
import { noKeyError } from '../lib/shared'

export function MetricsPanel({
  measured,
  transcript,
  aiReady,
}: {
  measured: SpeakingMeasured
  transcript: string | null
  aiReady: boolean
}) {
  const L = useL()
  return (
    <div className="space-y-3" data-testid="speaking-metrics">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
        <Activity className="size-4" />
        {L('Measured from your recording', 'Đo từ bản ghi âm')}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={<Clock />} label={L('Duration', 'Thời lượng')} value={`${measured.durationSec}s`} />
        <StatTile icon={<Activity />} label={L('Speaking time', 'Thời gian nói')} value={`${measured.speakingSec}s`} />
        <StatTile
          icon={<Gauge />}
          label={L('Speech rate', 'Tốc độ nói')}
          value={measured.wordsPerMinute !== null ? `${measured.wordsPerMinute}` : '—'}
          sub={
            measured.wordsPerMinute !== null
              ? L('words / min (natural ≈ 120–160)', 'từ/phút (tự nhiên ≈ 120–160)')
              : L('needs a transcript', 'cần bản chép lời')
          }
        />
        <StatTile
          icon={<PauseCircle />}
          label={L('Pauses', 'Ngắt quãng')}
          value={measured.pauseCount}
          sub={L(`longest ${measured.longestPauseSec}s`, `dài nhất ${measured.longestPauseSec}s`)}
        />
      </div>
      {measured.wordAccuracy !== null && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4">
          <ProgressRing value={measured.wordAccuracy} size={64}>
            {Math.round(measured.wordAccuracy * 100)}%
          </ProgressRing>
          <div className="min-w-0 flex-1 space-y-1.5 text-sm">
            <div className="font-semibold">{L('Words matched with the target', 'Số từ khớp với câu mẫu')}</div>
            {measured.missingWords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted">{L('Missing:', 'Thiếu:')}</span>
                {measured.missingWords.map((w, i) => (
                  <Badge key={`${w}-${i}`} tone="danger">
                    {w}
                  </Badge>
                ))}
              </div>
            )}
            {measured.extraWords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted">{L('Extra / changed:', 'Thừa / khác:')}</span>
                {measured.extraWords.map((w, i) => (
                  <Badge key={`${w}-${i}`} tone="warning">
                    {w}
                  </Badge>
                ))}
              </div>
            )}
            {measured.missingWords.length === 0 && measured.extraWords.length === 0 && (
              <div className="text-success">{L('Every word was recognised.', 'Tất cả các từ đều được nhận ra.')}</div>
            )}
          </div>
        </div>
      )}
      {transcript ? (
        <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <span className="text-xs font-semibold text-muted uppercase">{L('Recognised', 'Nhận dạng được')}</span>
          <p className="mt-1 italic">“{transcript}”</p>
        </div>
      ) : (
        !aiReady && (
          <ErrorState
            compact
            error={noKeyError(
              L(
                'Without an AI key the app can still record, play back and measure timing and pauses. Transcription, word matching and feedback need a Gemini or OpenAI key.',
                'Không có API key, ứng dụng vẫn ghi âm, phát lại và đo thời lượng, ngắt quãng. Chuyển giọng nói thành chữ, so khớp từ và nhận xét cần key Gemini hoặc OpenAI.',
              ),
            )}
          />
        )
      )}
    </div>
  )
}

function ScoreRow({ label, score, children }: { label: string; score: number; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="font-mono tabular-nums">{score.toFixed(score % 1 ? 1 : 0)}/10</span>
      </div>
      <ProgressBar value={score} max={10} tone={score >= 7 ? 'success' : score >= 5 ? 'accent' : 'warning'} />
      {children && <div className="mt-2 space-y-1 text-sm text-muted">{children}</div>}
    </div>
  )
}

/** AI feedback for a stored session; requests it on demand (or automatically with `auto`). */
export function FeedbackPanel({
  session,
  aiReady,
  onUpdated,
}: {
  session: SpeakingSession
  aiReady: boolean
  onUpdated?: (s: SpeakingSession) => void
}) {
  const L = useL()
  const [current, setCurrent] = useState(session)
  const req = useAction(() => api('speaking:feedback', { sessionId: session.id }))
  const fb = current.feedback

  const ask = async () => {
    const s = await req.run()
    if (s) {
      setCurrent(s)
      onUpdated?.(s)
    }
  }

  if (!fb) {
    if (!current.transcript.trim()) return null
    return (
      <div className="rounded-2xl border border-dashed border-line p-4">
        {aiReady ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {L(
                'Get pronunciation, fluency, grammar and vocabulary feedback.',
                'Nhận xét phát âm, độ trôi chảy, ngữ pháp và từ vựng.',
              )}
            </p>
            <Button
              variant="primary"
              icon={<Wand2 className="size-4" />}
              loading={req.pending}
              onClick={() => void ask()}
              data-testid="speaking-get-feedback"
            >
              {L('AI feedback', 'Nhận xét bằng AI')}
            </Button>
          </div>
        ) : (
          <ErrorState
            compact
            error={noKeyError(
              L('AI feedback needs a Gemini or OpenAI key.', 'Nhận xét bằng AI cần key Gemini hoặc OpenAI.'),
            )}
          />
        )}
        {req.error && (
          <div className="mt-3">
            <ErrorState error={req.error} compact onRetry={() => void ask()} />
          </div>
        )}
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
      data-testid="speaking-feedback"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent" />
        <span className="text-xs font-semibold tracking-wider text-muted uppercase">
          {L('Coach feedback', 'Nhận xét của huấn luyện viên')}
        </span>
        <AiBadge />
        <span className="ml-auto flex items-center gap-1.5 text-sm text-muted">
          {L('Estimated level', 'Trình độ ước lượng')} <CefrBadge level={fb.cefrEstimate} />
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ScoreRow label={L('Pronunciation', 'Phát âm')} score={fb.pronunciation.score}>
          {fb.pronunciation.notes.map((n, i) => (
            <p key={i}>• {n}</p>
          ))}
        </ScoreRow>
        <ScoreRow label={L('Fluency', 'Độ trôi chảy')} score={fb.fluency.score}>
          {fb.fluency.notes.map((n, i) => (
            <p key={i}>• {n}</p>
          ))}
        </ScoreRow>
        <ScoreRow label={L('Grammar', 'Ngữ pháp')} score={fb.grammar.score}>
          {fb.grammar.corrections.length === 0 && (
            <p>{L('No clear grammar mistakes.', 'Không có lỗi ngữ pháp rõ ràng.')}</p>
          )}
          {fb.grammar.corrections.map((c, i) => (
            <div key={i} className="rounded-lg bg-surface-2 p-2">
              <span className="text-danger line-through">{c.original}</span> →{' '}
              <span className="font-medium text-success">{c.better}</span>
              <p className="text-xs">{c.explanationVi}</p>
            </div>
          ))}
        </ScoreRow>
        <ScoreRow label={L('Vocabulary', 'Từ vựng')} score={fb.vocabulary.score}>
          {fb.vocabulary.suggestions.map((n, i) => (
            <p key={i}>• {n}</p>
          ))}
        </ScoreRow>
      </div>
      {fb.naturalVersion && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquareQuote className="size-4 text-accent" />
              {L('A more natural way to say it', 'Cách nói tự nhiên hơn')}
            </span>
            <SpeakButton text={fb.naturalVersion} />
          </div>
          <p className="leading-relaxed">{fb.naturalVersion}</p>
        </div>
      )}
      <p className={cx('text-sm text-muted italic')}>{fb.encouragement}</p>
    </motion.div>
  )
}
