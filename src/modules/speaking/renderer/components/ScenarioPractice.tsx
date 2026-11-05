// Scripted conversation scenarios from the Cadence pack: the coach line is spoken, the learner answers
// following the prompt, and each answer is compared with the model response (works offline by typing).
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Eye, Flag, Lightbulb, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SpeakingSession } from '@shared/types'
import { compareWords } from '@core/text'
import { RecordButton } from '@/components/learning'
import { Badge, Button, Card, ErrorState, Input, ProgressBar, ProgressRing, Spinner, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, type ApiError } from '@/lib/api'
import { speak, stopSpeaking, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { RecordingAnalysis, ScenarioInfo, SpeakingPromptView } from '../../contract'
import { analysisOf, sumAnalyses, transcribeSafe } from '../lib/shared'
import { FeedbackPanel, MetricsPanel } from './Panels'

interface TurnResult {
  answer: string
  score: number
  missing: string[]
  url: string | null
}

export function ScenarioPractice({
  prompt,
  scenario,
  aiReady,
  onSaved,
}: {
  prompt: SpeakingPromptView
  scenario: ScenarioInfo
  aiReady: boolean
  onSaved: () => void
}) {
  const L = useL()
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState<Record<number, TurnResult>>({})
  const [draft, setDraft] = useState('')
  const [showModel, setShowModel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [analyses, setAnalyses] = useState<RecordingAnalysis[]>([])
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const [session, setSession] = useState<SpeakingSession | null>(null)
  const [saving, setSaving] = useState(false)
  const turn = scenario.turns[idx]
  const res = results[idx]
  const pass = scenario.passScore / 100

  useEffect(() => {
    if (turn) void speak(turn.coachMessage)
    return () => stopSpeaking()
  }, [turn])

  const score = (answer: string, url: string | null) => {
    if (!turn) return
    const cmp = compareWords(turn.expectedResponse, answer)
    setResults((r) => ({ ...r, [idx]: { answer, score: cmp.accuracy, missing: cmp.missing, url } }))
    setShowModel(true)
  }

  const onRecorded = async (rec: Recording) => {
    if (!turn) return
    setAnalyses((a) => [...a, analysisOf(rec)])
    setPendingUrl(rec.url)
    setBusy(true)
    setError(null)
    const stt = await transcribeSafe(rec, turn.expectedResponse, aiReady)
    setBusy(false)
    if (stt.error) setError(stt.error)
    if (stt.text) score(stt.text, rec.url)
  }

  const next = () => {
    setIdx((i) => i + 1)
    setDraft('')
    setShowModel(false)
    setPendingUrl(null)
    setError(null)
  }

  const done = Object.keys(results).length
  const avg = done ? Object.values(results).reduce((s, r) => s + r.score, 0) / done : 0
  const finished = idx >= scenario.turns.length

  const finish = async () => {
    setSaving(true)
    setError(null)
    try {
      const answered = scenario.turns.map((_, i) => results[i]).filter((r): r is TurnResult => !!r)
      const r = await api('speaking:submit', {
        mode: 'scenario',
        promptId: prompt.id,
        prompt: scenario.scenario,
        target: scenario.turns
          .filter((_, i) => results[i])
          .map((t) => t.expectedResponse)
          .join(' '),
        transcript: answered.map((a) => a.answer).join(' ') || null,
        analysis: analyses.length
          ? sumAnalyses(analyses)
          : { durationSec: 0, speakingSec: 0, pauseCount: 0, longestPauseSec: 0 },
      })
      setSession(r.session)
      onSaved()
      void useApp.getState().refreshGame()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm leading-relaxed">{scenario.scenario}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{scenario.level}</Badge>
          <Badge tone="neutral">{scenario.topic}</Badge>
          {scenario.focus.map((f) => (
            <Badge key={f} tone="info">
              {f}
            </Badge>
          ))}
          <span className="ml-auto text-xs text-muted">
            {L(`Pass mark ${scenario.passScore}%`, `Đạt từ ${scenario.passScore}%`)}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <ProgressBar value={Math.min(idx, scenario.turns.length)} max={scenario.turns.length} className="flex-1" />
          <span className="text-sm text-muted tabular-nums">
            {Math.min(idx + 1, scenario.turns.length)}/{scenario.turns.length}
          </span>
        </div>
      </Card>

      {turn && !finished && (
        <motion.div key={idx} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
          <Card className="space-y-4">
            <div className="flex items-start gap-3">
              <button
                onClick={() => void speak(turn.coachMessage)}
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
                aria-label={L('Listen', 'Nghe')}
              >
                <Volume2 className="size-4" />
              </button>
              <div
                className="rounded-2xl bg-surface-2 px-4 py-2.5 text-lg leading-relaxed"
                data-testid="scenario-coach"
              >
                {turn.coachMessage}
              </div>
            </div>
            <div className="rounded-xl border border-line p-3 text-sm">
              <div className="font-semibold">{turn.userPrompt}</div>
              <p className="mt-1 flex items-start gap-1.5 text-muted">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                {turn.coachingCue}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <RecordButton key={idx} maxSeconds={45} disabled={busy} onRecorded={(r) => void onRecorded(r)} />
              <form
                className="flex min-w-60 flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (draft.trim()) score(draft.trim(), pendingUrl)
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    aiReady
                      ? L('…or type your answer', '…hoặc gõ câu trả lời')
                      : L('Type what you said (no AI key needed)', 'Gõ lại điều bạn đã nói (không cần API key)')
                  }
                  maxLength={1000}
                  aria-label={L('Your answer', 'Câu trả lời')}
                />
                <Button type="submit" variant="secondary" disabled={!draft.trim()}>
                  {L('Check', 'Kiểm tra')}
                </Button>
              </form>
            </div>
            {busy && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner className="size-4" /> {L('Transcribing…', 'Đang chuyển thành chữ…')}
              </p>
            )}
            {pendingUrl && !res && !busy && <audio controls src={pendingUrl} className="w-full" />}

            {res && (
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface-2 p-3">
                <ProgressRing value={res.score} size={56}>
                  {Math.round(res.score * 100)}
                </ProgressRing>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="italic">“{res.answer}”</p>
                  {res.missing.length > 0 && (
                    <p className="mt-1 text-xs text-warning">
                      {L('Model words you did not use:', 'Từ trong câu mẫu bạn chưa dùng:')} {res.missing.join(', ')}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-faint">
                    {L(
                      'Rough estimate: word overlap with the model answer.',
                      'Ước lượng thô: mức trùng từ với câu mẫu.',
                    )}
                  </p>
                </div>
                {res.url && <audio controls src={res.url} className="h-9" />}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<Eye className="size-4" />}
                onClick={() => setShowModel((v) => !v)}
              >
                {showModel ? L('Hide model answer', 'Ẩn câu mẫu') : L('Show model answer', 'Xem câu mẫu')}
              </Button>
              {showModel && (
                <span className="flex items-center gap-1 text-sm">
                  <span className="text-success">{turn.expectedResponse}</span>
                  <button
                    onClick={() => void speak(turn.expectedResponse)}
                    className="text-faint hover:text-text"
                    aria-label={L('Listen to the model', 'Nghe câu mẫu')}
                  >
                    <Volume2 className="size-4" />
                  </button>
                </span>
              )}
              <Button
                className="ml-auto"
                variant={res ? 'primary' : 'ghost'}
                icon={<ArrowRight className="size-4" />}
                onClick={next}
              >
                {idx < scenario.turns.length - 1 ? L('Next turn', 'Lượt tiếp') : L('See result', 'Xem kết quả')}
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {error && <ErrorState error={error} compact />}

      {finished && !session && (
        <Card className="flex flex-wrap items-center gap-5">
          <ProgressRing value={avg} size={76}>
            {Math.round(avg * 100)}%
          </ProgressRing>
          <div className="flex-1">
            <div className={cx('font-display text-lg font-semibold', avg >= pass ? 'text-success' : 'text-warning')}>
              {avg >= pass ? (
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-5" /> {L('Scenario passed!', 'Đạt kịch bản!')}
                </span>
              ) : (
                L('Keep practising – almost there', 'Luyện thêm chút nữa – sắp đạt rồi')
              )}
            </div>
            <p className="text-sm text-muted">
              {L(
                `${done} of ${scenario.turns.length} turns answered`,
                `Đã trả lời ${done}/${scenario.turns.length} lượt`,
              )}
            </p>
          </div>
          <Button
            variant="primary"
            icon={<Flag className="size-4" />}
            loading={saving}
            disabled={done === 0}
            onClick={() => void finish()}
            data-testid="scenario-finish"
          >
            {L('Save session', 'Lưu buổi luyện')}
          </Button>
        </Card>
      )}

      {session && (
        <div className="space-y-4">
          <MetricsPanel measured={session.measured} transcript={null} aiReady={aiReady} />
          <FeedbackPanel session={session} aiReady={aiReady} />
        </div>
      )}
    </div>
  )
}
