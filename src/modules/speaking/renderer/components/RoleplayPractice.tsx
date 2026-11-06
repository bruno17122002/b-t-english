// AI role-play / real-world conversation: the character speaks (TTS), the learner answers by voice or
// typing, receives gentle corrections and at the end gets measured metrics plus AI feedback.
import { AnimatePresence, motion } from 'framer-motion'
import { Bot, Flag, Lightbulb, Mic, Send, User, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SpeakingSession } from '@shared/types'
import { AiBadge, RecordButton } from '@/components/learning'
import { Button, Card, ErrorState, Input, Spinner, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, type ApiError } from '@/lib/api'
import { speak, stopSpeaking, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { RecordingAnalysis, RoleplayReply, SpeakingPromptView } from '../../contract'
import { analysisOf, formatClock, noKeyError, sumAnalyses, transcribeSafe } from '../lib/shared'
import { FeedbackPanel, MetricsPanel } from './Panels'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  correction?: RoleplayReply['correction']
}

export function RoleplayPractice({
  prompt,
  aiReady,
  onSaved,
}: {
  prompt: SpeakingPromptView
  aiReady: boolean
  onSaved: () => void
}) {
  const L = useL()
  const opening = prompt.openingLine ?? 'Hello! How can I help you today?'
  const [started, setStarted] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', content: opening }])
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState('')
  const [thinking, setThinking] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [analyses, setAnalyses] = useState<RecordingAnalysis[]>([])
  const [ended, setEnded] = useState(false)
  const [session, setSession] = useState<SpeakingSession | null>(null)
  const [saving, setSaving] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, thinking])

  useEffect(() => {
    if (!started || ended) return
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(t)
  }, [started, ended])

  useEffect(() => stopSpeaking, [])

  if (!aiReady)
    return (
      <ErrorState
        error={noKeyError(
          L(
            'AI role-plays need a Gemini or OpenAI key so the character can answer you. Without a key, try the scripted scenarios (marked “Scripted scenario”) – they work offline.',
            'Nhập vai với AI cần key Gemini hoặc OpenAI để nhân vật trả lời bạn. Không có key, hãy thử các “Kịch bản hội thoại” – dùng được offline.',
          ),
        )}
      />
    )

  const start = () => {
    setStarted(true)
    void speak(opening)
  }

  const send = async (text: string) => {
    const userText = text.trim()
    if (!userText || thinking) return
    setDraft('')
    setError(null)
    const history = messages.slice(1).map((m) => ({ role: m.role, content: m.content }))
    setMessages((m) => [...m, { role: 'user', content: userText }])
    setThinking(true)
    try {
      const reply = await api('speaking:roleplayTurn', { promptId: prompt.id, history, userText })
      setMessages((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last && last.role === 'user') copy[copy.length - 1] = { ...last, correction: reply.correction }
        return [...copy, { role: 'assistant', content: reply.reply }]
      })
      setHint(reply.hintVi)
      void speak(reply.reply)
      if (reply.done) setEnded(true)
    } catch (err) {
      setError(toApiError(err))
      setMessages((m) => m.slice(0, -1))
      setDraft(userText)
    } finally {
      setThinking(false)
    }
  }

  const onRecorded = async (rec: Recording) => {
    setAnalyses((a) => [...a, analysisOf(rec)])
    setTranscribing(true)
    const stt = await transcribeSafe(rec, undefined, aiReady)
    setTranscribing(false)
    if (stt.error) setError(stt.error)
    if (stt.text) await send(stt.text)
  }

  const finish = async () => {
    setEnded(true)
    stopSpeaking()
    setSaving(true)
    try {
      const learnerTurns = messages.filter((m) => m.role === 'user').map((m) => m.content)
      const res = await api('speaking:submit', {
        mode: prompt.kind === 'real-world' ? 'real-world' : 'roleplay',
        promptId: prompt.id,
        prompt: `${prompt.title}. AI role: ${prompt.aiRole ?? ''}`.slice(0, 4000),
        transcript: learnerTurns.join('\n') || null,
        analysis: analyses.length
          ? sumAnalyses(analyses)
          : { durationSec: Math.min(3600, elapsed), speakingSec: 0, pauseCount: 0, longestPauseSec: 0 },
      })
      setSession(res.session)
      onSaved()
      void useApp.getState().refreshGame()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const userTurns = messages.filter((m) => m.role === 'user').length

  return (
    <div className="space-y-4">
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3 text-sm">
          <span className="flex items-center gap-2 text-muted">
            <Bot className="size-4 text-accent" />
            {prompt.aiRole ?? L('Conversation partner', 'Người đối thoại')}
            <AiBadge estimated={false} />
          </span>
          <span className="font-mono text-muted tabular-nums">
            {formatClock(elapsed)} / {formatClock(prompt.durationSec)}
          </span>
        </div>
        <div className="max-h-[52vh] min-h-64 space-y-3 overflow-y-auto p-5" data-testid="roleplay-chat">
          {!started ? (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-md text-sm text-muted">{prompt.instructionsVi}</p>
              <Button variant="primary" size="lg" onClick={start} data-testid="roleplay-start">
                {L('Start the conversation', 'Bắt đầu hội thoại')}
              </Button>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cx('flex gap-2', m.role === 'user' && 'flex-row-reverse')}
                >
                  <div
                    className={cx(
                      'mt-1 flex size-7 shrink-0 items-center justify-center rounded-full',
                      m.role === 'user' ? 'bg-accent/20 text-accent' : 'bg-surface-3 text-muted',
                    )}
                  >
                    {m.role === 'user' ? <User className="size-4" /> : <Bot className="size-4" />}
                  </div>
                  <div className="max-w-[80%] space-y-1.5">
                    <div
                      className={cx(
                        'rounded-2xl px-4 py-2.5 leading-relaxed',
                        m.role === 'user' ? 'bg-accent/15' : 'bg-surface-2',
                      )}
                    >
                      {m.content}
                      {m.role === 'assistant' && (
                        <button
                          onClick={() => void speak(m.content)}
                          className="ml-2 inline-flex align-middle text-faint hover:text-text"
                          aria-label={L('Listen again', 'Nghe lại')}
                        >
                          <Volume2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    {m.correction && (
                      <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                        <span className="text-danger line-through">{m.correction.original}</span> →{' '}
                        <span className="font-medium text-success">{m.correction.better}</span>
                        <p className="text-xs text-muted">{m.correction.explanationVi}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              {thinking && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner className="size-4" /> {L('Thinking…', 'Đang trả lời…')}
                </div>
              )}
            </AnimatePresence>
          )}
          <div ref={endRef} />
        </div>
        {started && !ended && (
          <div className="space-y-3 border-t border-line p-4">
            {hint && (
              <p className="flex items-start gap-2 text-sm text-muted">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                {hint}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <RecordButton
                maxSeconds={60}
                disabled={thinking || transcribing}
                onRecorded={(r) => void onRecorded(r)}
                label={L('Answer by voice', 'Trả lời bằng giọng nói')}
              />
              <form
                className="flex min-w-60 flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void send(draft)
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={L('…or type your answer', '…hoặc gõ câu trả lời')}
                  disabled={thinking}
                  maxLength={1000}
                  aria-label={L('Your answer', 'Câu trả lời')}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  icon={<Send className="size-4" />}
                  disabled={!draft.trim() || thinking}
                >
                  {L('Send', 'Gửi')}
                </Button>
              </form>
            </div>
            {transcribing && (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Mic className="size-3.5" /> {L('Transcribing…', 'Đang chuyển giọng nói thành chữ…')}
              </p>
            )}
          </div>
        )}
      </Card>

      {error && <ErrorState error={error} compact />}

      {started && !session && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{L(`${userTurns} turns spoken`, `Đã nói ${userTurns} lượt`)}</span>
          <Button
            variant={ended ? 'primary' : 'secondary'}
            icon={<Flag className="size-4" />}
            loading={saving}
            disabled={userTurns === 0}
            onClick={() => void finish()}
            data-testid="roleplay-finish"
          >
            {L('Finish & get feedback', 'Kết thúc & nhận xét')}
          </Button>
        </div>
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
