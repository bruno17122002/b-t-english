// One tutor conversation: message bubbles with inline corrections, new words, TTS, voice input.
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, BookmarkPlus, Lightbulb, Mic, Repeat, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { TutorStyle } from '@shared/types'
import { AiBadge, RecordButton, SaveWordButton, SpeakButton } from '@/components/learning'
import { Badge, Button, cx, ErrorState, IconButton, LoadingBlock, Modal, Select, Spinner, Textarea } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, ApiError, toApiError, useApi } from '@/lib/api'
import { transcribe, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { TutorChatMessage, TutorCorrection, TutorNewWord } from '../../contract'
import { parseMarkdownLite, plainText } from '../lib/markdownLite'
import { CATEGORY_LABEL, MODE_LIST, MODES } from '../lib/modes'
import { MistakesPanel } from './MistakesPanel'
import { MODE_ICONS } from './modeIcons'
import { RichText } from './RichText'

export function ChatView({ id, noKey, onChanged }: { id: number; noKey: boolean; onChanged: () => void }) {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const location = useLocation()
  const thread = useApi('tutor:get', { id }, [id])
  const [text, setText] = useState(() => (location.state as { draft?: string } | null)?.draft ?? '')
  const [viaVoice, setViaVoice] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [sendError, setSendError] = useState<ApiError | null>(null)
  const [showMic, setShowMic] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [mistakesOpen, setMistakesOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const conv = thread.data?.conversation
  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, pending])

  useEffect(() => {
    inputRef.current?.focus()
  }, [id])

  const send = async (raw?: string) => {
    const message = (raw ?? text).trim()
    if (!message || pending) return
    setPending(message)
    setSendError(null)
    setText('')
    const voice = viaVoice
    setViaVoice(false)
    try {
      const res = await api('tutor:send', { conversationId: id, text: message, viaVoice: voice })
      thread.setData((prev) => ({
        conversation: res.conversation,
        messages: [...(prev?.messages ?? []), res.userMessage, res.assistantMessage],
      }))
      onChanged()
      void useApp.getState().refreshGame()
    } catch (err) {
      setSendError(toApiError(err))
      setText(message)
      setViaVoice(voice)
    } finally {
      setPending(null)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const onRecorded = async (rec: Recording) => {
    setTranscribing(true)
    try {
      const res = await transcribe(rec)
      const t = res.text.trim()
      if (t) {
        setText((prev) => (prev ? `${prev} ${t}` : t))
        setViaVoice(true)
        setShowMic(false)
      }
    } catch (err) {
      setSendError(toApiError(err))
    } finally {
      setTranscribing(false)
    }
  }

  const changeMode = async (mode: TutorStyle) => {
    try {
      const c = await api('tutor:setMode', { id, mode })
      thread.setData((prev) => (prev ? { ...prev, conversation: c } : (prev ?? null)))
      onChanged()
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  if (thread.loading && !thread.data)
    return (
      <div className="p-6">
        <LoadingBlock rows={4} />
      </div>
    )
  if (thread.error) return <ErrorState error={thread.error} onRetry={thread.reload} />
  if (!conv)
    return (
      <ErrorState
        error={L('This conversation no longer exists.', 'Cuộc hội thoại này không còn tồn tại.')}
        onRetry={() => navigate('/tutor')}
      />
    )

  const ModeIcon = MODE_ICONS[conv.mode]
  const mode = MODES[conv.mode]

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-surface" data-testid="tutor-chat">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <ModeIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-semibold">{conv.title}</div>
          <div className="text-xs text-muted">{tx({ en: mode.en, vi: mode.vi })}</div>
        </div>
        <Select
          aria-label={L('Tutor mode', 'Chế độ gia sư')}
          value={conv.mode}
          onChange={(e) => void changeMode(e.target.value as TutorStyle)}
          className="h-9 w-48"
          data-testid="tutor-mode-select"
        >
          {MODE_LIST.map((m) => (
            <option key={m} value={m}>
              {tx({ en: MODES[m].en, vi: MODES[m].vi })}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" icon={<Repeat className="size-4" />} onClick={() => setMistakesOpen(true)}>
          {L('My mistakes', 'Lỗi của tôi')}
        </Button>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
        {!messages.length && !pending && (
          <div className="mx-auto max-w-xl py-8 text-center">
            <Sparkles className="mx-auto mb-3 size-8 text-accent" />
            <div className="font-display text-lg font-semibold">{L('Say hello to your tutor', 'Chào gia sư của bạn')}</div>
            <p className="mt-1 text-sm text-muted">{tx({ en: mode.descEn, vi: mode.descVi })}</p>
            <div className="mt-5 grid gap-2">
              {mode.starters.map((s) => (
                <button
                  key={s.text}
                  onClick={() => (noKey ? setText(s.text) : void send(s.text))}
                  className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-left text-sm transition hover:border-accent"
                  data-testid="tutor-starter"
                >
                  <div className="font-medium">{s.text}</div>
                  <div className="text-xs text-faint">{s.vi}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? <UserBubble key={m.id} m={m} /> : <TutorBubble key={m.id} m={m} conversationId={id} onAnswer={() => inputRef.current?.focus()} />,
        )}
        {pending && (
          <>
            <UserBubble m={{ id: -1, conversationId: id, role: 'user', content: pending, createdAt: new Date().toISOString(), corrections: [], newWords: [], followUpQuestion: '' }} pending />
            <TypingIndicator />
          </>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-line p-4">
        {noKey && (
          <div className="mb-3">
            <ErrorState
              compact
              error={
                new ApiError({
                  code: 'ai_no_key',
                  hint: 'ai-settings',
                  message: L(
                    'The AI tutor needs an API key (Gemini or OpenAI). Your past conversations stay readable.',
                    'Gia sư AI cần API key (Gemini hoặc OpenAI). Bạn vẫn xem lại được các cuộc hội thoại cũ.',
                  ),
                })
              }
            />
          </div>
        )}
        {sendError && !noKey && (
          <div className="mb-3">
            <ErrorState compact error={sendError} onRetry={sendError.needsAiSettings ? undefined : () => void send()} />
          </div>
        )}
        <AnimatePresence>
          {showMic && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3 overflow-hidden">
              <div className="relative flex items-center justify-center rounded-xl border border-line bg-surface-2 py-4">
                {transcribing ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Spinner /> {L('Transcribing…', 'Đang chuyển giọng nói thành chữ…')}
                  </div>
                ) : (
                  <RecordButton onRecorded={(r) => void onRecorded(r)} maxSeconds={60} label={L('Speak your message', 'Nói tin nhắn của bạn')} />
                )}
                <IconButton label={L('Close', 'Đóng')} className="absolute top-2 right-2" onClick={() => setShowMic(false)}>
                  <X className="size-4" />
                </IconButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-end gap-2">
          <IconButton
            label={L('Voice input', 'Nhập bằng giọng nói')}
            onClick={() => setShowMic((v) => !v)}
            disabled={noKey}
            className={cx('size-10', showMic && 'bg-surface-2 text-accent')}
          >
            <Mic className="size-5" />
          </IconButton>
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (!e.target.value) setViaVoice(false)
            }}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder={L('Write in English… (Enter to send, Shift+Enter for a new line)', 'Viết bằng tiếng Anh… (Enter để gửi, Shift+Enter xuống dòng)')}
            className="max-h-40 min-h-10 flex-1 resize-none"
            data-testid="tutor-input"
          />
          <Button
            variant="primary"
            onClick={() => void send()}
            disabled={!text.trim() || noKey}
            loading={!!pending}
            icon={<Send className="size-4" />}
            data-testid="tutor-send"
          >
            {L('Send', 'Gửi')}
          </Button>
        </div>
        {viaVoice && <div className="mt-1.5 text-xs text-faint">{L('From voice input – check it before sending.', 'Từ giọng nói – kiểm tra trước khi gửi.')}</div>}
      </div>

      <Modal open={mistakesOpen} onClose={() => setMistakesOpen(false)} title={L('My recurring mistakes', 'Lỗi hay lặp lại của tôi')} wide>
        <MistakesPanel />
      </Modal>
    </div>
  )
}

function UserBubble({ m, pending }: { m: TutorChatMessage; pending?: boolean }) {
  const fmt = useFormat()
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end" data-testid="tutor-msg-user">
      <div className={cx('max-w-[78%] rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-sm whitespace-pre-wrap', pending && 'opacity-60')}>
        {m.content}
      </div>
      {m.corrections.length > 0 && <Corrections items={m.corrections} />}
      {!pending && <div className="mt-1 text-[11px] text-faint">{fmt.time(m.createdAt)}</div>}
    </motion.div>
  )
}

function Corrections({ items }: { items: TutorCorrection[] }) {
  const L = useL()
  const tx = useTx()
  return (
    <div className="mt-1.5 w-full max-w-[78%] space-y-1.5 rounded-xl border border-warning/25 bg-warning/5 p-3 text-sm" data-testid="tutor-corrections">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
        <Lightbulb className="size-3.5" />
        {L(`${items.length} correction${items.length > 1 ? 's' : ''}`, `${items.length} chỗ cần sửa`)}
      </div>
      {items.map((c, i) => (
        <div key={i}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-danger line-through decoration-danger/60">{c.original}</span>
            <ArrowRight className="size-3.5 text-faint" />
            <span className="font-medium text-success">{c.correction}</span>
            <Badge tone="neutral" className="ml-1">
              {CATEGORY_LABEL[c.category] ? tx(CATEGORY_LABEL[c.category]!) : c.category}
            </Badge>
          </div>
          {c.explanationVi && <p className="mt-0.5 text-xs text-muted">{c.explanationVi}</p>}
        </div>
      ))}
    </div>
  )
}

function TutorBubble({ m, conversationId, onAnswer }: { m: TutorChatMessage; conversationId: number; onAnswer: () => void }) {
  const L = useL()
  const fmt = useFormat()
  const speakText = useMemo(() => plainText(parseMarkdownLite(m.content)), [m.content])
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start" data-testid="tutor-msg-assistant">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-line bg-surface-2 px-4 py-3 text-sm">
        <RichText text={m.content} interactive sourceRef={`tutor:${conversationId}`} />
        {m.followUpQuestion && (
          <button onClick={onAnswer} className="mt-3 block w-full rounded-lg bg-accent/10 px-3 py-2 text-left text-sm text-accent transition hover:bg-accent/15">
            {m.followUpQuestion}
          </button>
        )}
        {m.newWords.length > 0 && <NewWords words={m.newWords} conversationId={conversationId} />}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-faint">
        <SpeakButton text={speakText} label={L('Read aloud', 'Đọc to')} />
        <AiBadge estimated={false} />
        <span>{fmt.time(m.createdAt)}</span>
      </div>
    </motion.div>
  )
}

function NewWords({ words, conversationId }: { words: TutorNewWord[]; conversationId: number }) {
  const L = useL()
  const [savingAll, setSavingAll] = useState(false)
  const [savedAll, setSavedAll] = useState(false)
  const saveAll = async () => {
    setSavingAll(true)
    try {
      for (const w of words)
        await api('vocab:save', {
          word: w.word,
          meaningVi: w.meaningVi,
          examples: w.example ? [w.example] : [],
          sourceModule: 'tutor',
          sourceRef: `tutor:${conversationId}`,
        })
      setSavedAll(true)
      useApp.getState().toast({ kind: 'success', title: L(`Saved ${words.length} words`, `Đã lưu ${words.length} từ`) })
      void useApp.getState().refreshGame()
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setSavingAll(false)
    }
  }
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="tutor-new-words">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{L('New words', 'Từ mới')}</span>
        {words.length > 1 && (
          <Button size="sm" variant="ghost" loading={savingAll} disabled={savedAll} icon={<BookmarkPlus className="size-4" />} onClick={() => void saveAll()}>
            {savedAll ? L('All saved', 'Đã lưu hết') : L('Save all', 'Lưu tất cả')}
          </Button>
        )}
      </div>
      <ul className="space-y-1.5">
        {words.map((w) => (
          <li key={w.word} className="flex items-start gap-2">
            <SaveWordButton compact seed={{ word: w.word, meaningVi: w.meaningVi, example: w.example }} sourceModule="tutor" sourceRef={`tutor:${conversationId}`} />
            <div className="min-w-0 pt-1.5">
              <span className="font-semibold">{w.word}</span> <span className="text-muted">– {w.meaningVi}</span>
              {w.example && <div className="text-xs text-faint italic">{w.example}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TypingIndicator() {
  const L = useL()
  return (
    <div className="flex items-center gap-2" aria-label={L('Tutor is typing', 'Gia sư đang trả lời')} data-testid="tutor-typing">
      <div className="flex gap-1 rounded-2xl rounded-bl-md border border-line bg-surface-2 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-2 rounded-full bg-muted"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
      <span className="text-xs text-faint">{L('Tutor is typing…', 'Gia sư đang trả lời…')}</span>
    </div>
  )
}
