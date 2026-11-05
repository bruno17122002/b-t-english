// Writing editor: live word count vs target, live metrics, autosaved draft, optional IELTS-style timer.
import { ArrowLeft, ChevronDown, ChevronUp, Hourglass, Lightbulb, Save, Send, Timer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { WRITING_TASK_TYPES, type WritingPrompt } from '@shared/content'
import { textMetrics } from '@core/text'
import { AiBadge } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  cx,
  ErrorState,
  Field,
  Input,
  ProgressBar,
  Select,
  Textarea,
  Toggle,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, ApiError, useAction } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { WritingPromptInfo } from '../../contract'
import { formatClock, MetricsPanel, TASK_META } from './shared'

interface Draft {
  text: string
  topic: string
  taskType: WritingPrompt['taskType']
  savedAt: string
}

const draftKey = (promptId: string | null) => `lq.writing.draft.${promptId ?? 'free'}`

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<Draft>
    if (typeof d.text !== 'string') return null
    return {
      text: d.text,
      topic: typeof d.topic === 'string' ? d.topic : '',
      taskType: d.taskType && (WRITING_TASK_TYPES as readonly string[]).includes(d.taskType) ? d.taskType : 'free',
      savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function writeDraft(key: string, d: Draft | null) {
  try {
    if (d && d.text.trim()) localStorage.setItem(key, JSON.stringify(d))
    else localStorage.removeItem(key)
  } catch {
    /* storage unavailable – the draft just isn't persisted */
  }
}

export function Editor({ prompt, aiAvailable }: { prompt: WritingPromptInfo | null; aiAvailable: boolean }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const refreshGame = useApp((s) => s.refreshGame)
  const key = draftKey(prompt?.id ?? null)
  const initial = useMemo(() => readDraft(key), [key])
  const [text, setText] = useState(initial?.text ?? '')
  const [topic, setTopic] = useState(initial?.topic ?? '')
  const [taskType, setTaskType] = useState<WritingPrompt['taskType']>(prompt?.taskType ?? initial?.taskType ?? 'free')
  const [savedAt, setSavedAt] = useState<string | null>(initial?.savedAt ?? null)
  const [showVi, setShowVi] = useState(true)
  const [showHints, setShowHints] = useState(false)
  const meta = TASK_META[taskType]
  const [timed, setTimed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Live metrics (pure, cheap) – recomputed on every keystroke.
  const metrics = useMemo(() => textMetrics(text), [text])
  const minWords = prompt?.minWords ?? 30
  const maxWords = prompt?.maxWords ?? 500
  const words = metrics.words

  // Autosave the draft (debounced).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const now = new Date().toISOString()
      writeDraft(key, { text, topic, taskType, savedAt: now })
      if (text.trim()) setSavedAt(now)
    }, 800)
    return () => window.clearTimeout(t)
  }, [key, text, topic, taskType])

  // Writing time: counts while the learner has started typing and the window is visible.
  const started = text.trim().length > 0
  useEffect(() => {
    if (!started) return
    const t = window.setInterval(() => document.visibilityState === 'visible' && setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(t)
  }, [started])
  const limit = meta.timerMinutes ? meta.timerMinutes * 60 : null
  const remaining = timed && limit ? limit - elapsed : null

  const submit = useAction(async (analyze: boolean) => {
    const res = await api('writing:submit', {
      promptId: prompt?.id ?? null,
      taskType,
      promptText: prompt ? prompt.instructions : topic,
      text,
      minutes: Math.max(0.5, Math.round((elapsed / 60) * 10) / 10),
      analyze,
    })
    writeDraft(key, null)
    void refreshGame()
    navigate(`/writing/result/${res.view.submission.id}`, { state: { aiError: res.aiError, xp: res.reward.xpGained } })
    return res
  })

  const wordTone = words < minWords ? 'warning' : words > maxWords ? 'warning' : 'success'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/writing')}>
          {L('All prompts', 'Tất cả đề bài')}
        </Button>
        <div className="flex items-center gap-2 text-sm">
          {limit && (
            <label className="flex items-center gap-2 text-muted">
              <Hourglass className="size-4" />
              {L(`IELTS timer (${meta.timerMinutes} min)`, `Bấm giờ IELTS (${meta.timerMinutes} phút)`)}
              <Toggle checked={timed} onChange={setTimed} label={L('IELTS timer', 'Bấm giờ IELTS')} />
            </label>
          )}
          <span
            className={cx(
              'flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-1.5 font-medium tabular-nums',
              remaining !== null && remaining <= 300 && 'border-warning/50 text-warning',
              remaining !== null && remaining <= 0 && 'border-danger/50 text-danger',
            )}
            data-testid="writing-timer"
          >
            <Timer className="size-4" />
            {remaining !== null
              ? remaining > 0
                ? formatClock(remaining)
                : L("Time's up", 'Hết giờ')
              : formatClock(elapsed)}
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone="accent">
                <meta.icon className="size-3" />
                {tx(meta)}
              </Badge>
              {prompt && <CefrBadge level={prompt.cefr} />}
              {prompt && (
                <span>
                  {prompt.minWords}–{prompt.maxWords} {L('words', 'từ')}
                </span>
              )}
            </div>
            <h1 className="font-display text-2xl font-semibold">
              {prompt ? prompt.title : L('Free writing', 'Viết tự do')}
            </h1>
            {prompt ? (
              <>
                <p className="mt-2 leading-relaxed">{prompt.instructions}</p>
                {showVi && <p className="mt-1 text-sm text-muted">{prompt.instructionsVi}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowVi((v) => !v)}>
                    {showVi ? L('Hide Vietnamese', 'Ẩn tiếng Việt') : L('Show Vietnamese', 'Hiện tiếng Việt')}
                  </Button>
                  {prompt.hints.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Lightbulb className="size-4" />}
                      onClick={() => setShowHints((v) => !v)}
                    >
                      {L('Hints', 'Gợi ý')}{' '}
                      {showHints ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </Button>
                  )}
                </div>
                {showHints && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted" data-testid="writing-hints">
                    {prompt.hints.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_200px]">
                <Field label={L('Topic or title (optional)', 'Chủ đề hoặc tiêu đề (không bắt buộc)')}>
                  <Input
                    value={topic}
                    maxLength={200}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder={L('e.g. My favourite festival', 'VD: Lễ hội tôi yêu thích')}
                  />
                </Field>
                <Field label={L('Type', 'Dạng bài')}>
                  <Select value={taskType} onChange={(e) => setTaskType(e.target.value as WritingPrompt['taskType'])}>
                    {WRITING_TASK_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {tx(TASK_META[t])}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </Card>

          <div className="rounded-2xl border border-line bg-surface p-1 focus-within:border-accent">
            <Textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              maxLength={12000}
              placeholder={L('Start writing in English…', 'Bắt đầu viết bằng tiếng Anh…')}
              className="min-h-[360px] resize-y border-0 bg-transparent px-4 py-3 text-[17px] leading-8 focus:border-0"
              data-testid="writing-editor"
              aria-label={L('Your text', 'Bài viết của bạn')}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-56 flex-1">
              <div
                className="mb-1 flex justify-between text-xs text-muted tabular-nums"
                data-testid="writing-wordcount"
              >
                <span>
                  {words} / {minWords}–{maxWords} {L('words', 'từ')}
                </span>
                <span className="flex items-center gap-1">
                  <Save className="size-3" />
                  {savedAt && text.trim()
                    ? L(`Draft saved ${fmt.time(savedAt)}`, `Đã lưu nháp ${fmt.time(savedAt)}`)
                    : L('Draft autosaves', 'Tự động lưu nháp')}
                </span>
              </div>
              <ProgressBar value={Math.min(words, maxWords)} max={maxWords} tone={wordTone} />
              {words > 0 && words < minWords && (
                <p className="mt-1 text-xs text-warning">
                  {L(`Write at least ${minWords - words} more words.`, `Viết thêm ít nhất ${minWords - words} từ.`)}
                </p>
              )}
              {words > maxWords && (
                <p className="mt-1 text-xs text-warning">
                  {L('Over the word limit – try to be more concise.', 'Vượt giới hạn số từ – hãy viết gọn hơn.')}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={words < 1}
                loading={submit.pending}
                onClick={() => void submit.run(false)}
                data-testid="writing-submit-offline"
              >
                {L('Save & check offline', 'Lưu & kiểm tra offline')}
              </Button>
              <Button
                variant="primary"
                disabled={words < 1 || !aiAvailable}
                loading={submit.pending}
                icon={<Send className="size-4" />}
                onClick={() => void submit.run(true)}
                data-testid="writing-submit"
              >
                {L('Submit for AI feedback', 'Nộp để AI nhận xét')}
              </Button>
            </div>
          </div>
          {!aiAvailable && (
            <ErrorState
              compact
              error={
                new ApiError({
                  code: 'ai_no_key',
                  hint: 'ai-settings',
                  message: L(
                    'AI feedback needs an API key. You can still save and get offline checks.',
                    'Cần API key để AI nhận xét. Bạn vẫn có thể lưu và kiểm tra offline.',
                  ),
                })
              }
            />
          )}
          {submit.error && <ErrorState error={submit.error} compact />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">
                {L('Live analysis', 'Phân tích trực tiếp')}
              </h2>
            </div>
            <MetricsPanel metrics={metrics} />
          </Card>
          <Card className="p-4 text-sm text-muted">
            <p className="mb-2 flex items-center gap-2 font-medium text-text">
              {L('After you submit', 'Sau khi nộp bài')} <AiBadge />
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{L('Corrected text with a word-by-word comparison', 'Bản sửa và so sánh từng từ')}</li>
              <li>{L('Scores, CEFR level and IELTS band estimate', 'Điểm, cấp CEFR và band IELTS ước lượng')}</li>
              <li>{L('Errors explained in Vietnamese', 'Giải thích lỗi bằng tiếng Việt')}</li>
              <li>{L('A second round to fix mistakes yourself', 'Vòng hai để tự sửa lỗi')}</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  )
}
