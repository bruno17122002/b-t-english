// Learning widgets shared by modules: TTS buttons, click-a-word lookup, saving words to the Vocab Hub,
// recording, quizzes and the "AI estimate" label.
import { AnimatePresence, motion } from 'framer-motion'
import { BookmarkPlus, Check, Heart, Loader2, Mic, Sparkles, Square, Volume2, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Question } from '@shared/content'
import type { DictionaryResult, ModuleId } from '@shared/types'
import { useL } from '../../i18n'
import { api, toApiError } from '../../lib/api'
import { speak, stopSpeaking, useRecorder, type Accent, type Recording } from '../../lib/audio'
import { useApp } from '../../lib/store'
import { Badge, Button, cx, IconButton, Spinner } from '../ui'

// ---------- speech ----------
export function SpeakButton({
  text,
  accent,
  rate,
  label,
  size = 'icon',
  gender,
}: {
  text: string
  accent?: Accent
  rate?: number
  label?: string
  size?: 'icon' | 'sm'
  gender?: 'female' | 'male'
}) {
  const L = useL()
  const [playing, setPlaying] = useState(false)
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (playing) {
      stopSpeaking()
      setPlaying(false)
      return
    }
    setPlaying(true)
    await speak(text, { accent, rate, gender })
    setPlaying(false)
  }
  if (size === 'sm')
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={onClick}
        icon={playing ? <Square className="size-3.5" /> : <Volume2 className="size-4" />}
      >
        {label ?? L('Listen', 'Nghe')}
      </Button>
    )
  return (
    <IconButton label={label ?? L('Listen', 'Nghe')} onClick={onClick} className={playing ? 'text-accent' : undefined}>
      {playing ? <Square className="size-4" /> : <Volume2 className="size-4" />}
    </IconButton>
  )
}

export function AiBadge({ estimated = true }: { estimated?: boolean }) {
  const L = useL()
  return (
    <Badge tone="info" className="whitespace-nowrap">
      <Sparkles className="size-3" />
      {estimated ? L('AI estimate', 'AI ước lượng') : 'AI'}
    </Badge>
  )
}

// ---------- vocabulary ----------
export interface WordSeed {
  word: string
  ipa?: string
  pos?: string
  meaningVi?: string
  meaningEn?: string
  example?: string
  context?: string
  topic?: string
  cefr?: DictionaryResult['entry']['cefr']
}

export function SaveWordButton({
  seed,
  sourceModule,
  sourceRef,
  compact,
}: {
  seed: WordSeed
  sourceModule: ModuleId | 'manual' | 'dictionary'
  sourceRef?: string
  compact?: boolean
}) {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const refreshGame = useApp((s) => s.refreshGame)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const save = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setState('saving')
    try {
      const res = await api('vocab:save', {
        word: seed.word,
        ipa: seed.ipa,
        pos: seed.pos,
        meaningVi: seed.meaningVi,
        meaningEn: seed.meaningEn,
        examples: seed.example ? [seed.example] : [],
        context: seed.context,
        topic: seed.topic,
        cefr: seed.cefr ?? null,
        sourceModule,
        sourceRef,
      })
      setState('saved')
      toast({
        kind: 'success',
        title: res.created
          ? L(`Saved “${seed.word}”`, `Đã lưu “${seed.word}”`)
          : L(`“${seed.word}” is already in your word bank`, `“${seed.word}” đã có trong kho từ`),
      })
      void refreshGame()
    } catch (err) {
      setState('idle')
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }
  if (compact)
    return (
      <IconButton label={L('Save word', 'Lưu từ')} onClick={save} disabled={state !== 'idle'}>
        {state === 'saving' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : state === 'saved' ? (
          <Check className="size-4 text-success" />
        ) : (
          <BookmarkPlus className="size-4" />
        )}
      </IconButton>
    )
  return (
    <Button
      size="sm"
      variant={state === 'saved' ? 'success' : 'secondary'}
      loading={state === 'saving'}
      disabled={state === 'saved'}
      onClick={save}
      icon={state === 'saved' ? <Check className="size-4" /> : <BookmarkPlus className="size-4" />}
    >
      {state === 'saved' ? L('Saved', 'Đã lưu') : L('Save word', 'Lưu từ')}
    </Button>
  )
}

/** Popover with dictionary lookup for a clicked word (offline first, AI on demand). */
export function WordPopover({
  word,
  context,
  sourceModule,
  sourceRef,
  glossary,
  onClose,
  accent,
}: {
  word: string
  context?: string
  sourceModule: ModuleId
  sourceRef?: string
  glossary?: WordSeed[]
  onClose: () => void
  accent?: Accent
}) {
  const L = useL()
  const [result, setResult] = useState<DictionaryResult | null | undefined>(undefined)
  const [aiLoading, setAiLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const local = glossary?.find((g) => g.word.toLowerCase() === word.toLowerCase())

  useEffect(() => {
    let alive = true
    setResult(undefined)
    if (local) return
    api('vocab:lookup', { word, context })
      .then((r) => alive && setResult(r))
      .catch(() => alive && setResult(null))
    return () => {
      alive = false
    }
  }, [word, context, local])

  const askAi = async () => {
    setAiLoading(true)
    setError(null)
    try {
      setResult(await api('vocab:lookup', { word, context, useAi: true }))
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setAiLoading(false)
    }
  }

  const entry: WordSeed | null =
    local ??
    (result
      ? {
          word: result.entry.word,
          ipa: result.entry.ipa,
          pos: result.entry.pos,
          meaningVi: result.entry.meaningVi,
          meaningEn: result.entry.meaningEn,
          example: result.entry.example,
          cefr: result.entry.cefr,
        }
      : null)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-80 rounded-2xl border border-line-strong bg-surface p-4 text-left shadow-card"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-xl font-semibold">{entry?.word ?? word}</div>
          {entry?.ipa && (
            <div className="font-mono text-sm text-muted">
              {entry.ipa} {entry.pos && <span className="italic">· {entry.pos}</span>}
            </div>
          )}
        </div>
        <div className="flex">
          <SpeakButton text={entry?.word ?? word} accent={accent} />
          <IconButton label={L('Close', 'Đóng')} onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
      {result === undefined && !local ? (
        <div className="py-4">
          <Spinner />
        </div>
      ) : entry ? (
        <div className="mt-3 space-y-2 text-sm">
          {entry.meaningVi && <p className="font-medium">{entry.meaningVi}</p>}
          {entry.meaningEn && <p className="text-muted">{entry.meaningEn}</p>}
          {entry.example && <p className="border-l-2 border-accent/50 pl-2 text-muted italic">{entry.example}</p>}
          {result?.source === 'ai' && <AiBadge estimated={false} />}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {L('Not in the offline dictionary.', 'Chưa có trong từ điển offline.')}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <SaveWordButton
          seed={{ ...(entry ?? { word }), context: context ?? entry?.context }}
          sourceModule={sourceModule}
          sourceRef={sourceRef}
        />
        {result?.source !== 'ai' && (
          <Button size="sm" variant="ghost" loading={aiLoading} onClick={askAi} icon={<Sparkles className="size-4" />}>
            {L('Explain with AI', 'Giải thích bằng AI')}
          </Button>
        )}
      </div>
    </motion.div>
  )
}

const TOKEN_RE = /([A-Za-z][A-Za-z'’-]*)/g

/**
 * Renders English text where every word is clickable for a dictionary popover.
 * `highlight` marks glossary words; `savedWords` underlines words already in the word bank.
 */
export function InteractiveText({
  text,
  sourceModule,
  sourceRef,
  glossary,
  className,
  accent,
  savedWords,
}: {
  text: string
  sourceModule: ModuleId
  sourceRef?: string
  glossary?: WordSeed[]
  className?: string
  accent?: Accent
  savedWords?: Set<string>
}) {
  const [open, setOpen] = useState<{ word: string; key: number } | null>(null)
  const glossarySet = useMemo(() => new Set((glossary ?? []).map((g) => g.word.toLowerCase())), [glossary])
  const parts = useMemo(() => text.split(TOKEN_RE), [text])
  const wrapRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !wrapRef.current?.contains(e.target as Node) && setOpen(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const sentenceOf = (idx: number) => {
    const before = parts.slice(0, idx).join('')
    const after = parts.slice(idx).join('')
    const start =
      Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '), before.lastIndexOf('\n')) +
      1
    const endRel = after.search(/[.?!]\s|\n|$/)
    return (before.slice(start) + after.slice(0, endRel + 1)).trim()
  }
  return (
    <span ref={wrapRef} className={className}>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>
        const lower = p.toLowerCase().replace(/[’']s$/, '')
        return (
          <span key={i} className="relative inline">
            <span
              role="button"
              tabIndex={-1}
              onClick={() => setOpen(open?.key === i ? null : { word: p.replace(/[’']s$/, ''), key: i })}
              className={cx(
                'word-token',
                glossarySet.has(lower) && 'font-semibold text-accent',
                savedWords?.has(lower) && 'word-saved',
              )}
            >
              {p}
            </span>
            <AnimatePresence>
              {open?.key === i && (
                <span className="absolute top-full left-0 z-40 mt-2 block">
                  <WordPopover
                    word={open.word}
                    context={sentenceOf(i)}
                    sourceModule={sourceModule}
                    sourceRef={sourceRef}
                    glossary={glossary}
                    accent={accent}
                    onClose={() => setOpen(null)}
                  />
                </span>
              )}
            </AnimatePresence>
          </span>
        )
      })}
    </span>
  )
}

// ---------- favorites ----------
export function FavoriteButton({ kind, refId, title }: { kind: string; refId: string; title: string }) {
  const L = useL()
  const [fav, setFav] = useState(false)
  useEffect(() => {
    api('library:isFavorite', { kind, ref: refId }).then(setFav, () => undefined)
  }, [kind, refId])
  return (
    <IconButton
      label={fav ? L('Remove from favorites', 'Bỏ yêu thích') : L('Add to favorites', 'Thêm vào yêu thích')}
      onClick={async (e) => {
        e.stopPropagation()
        setFav(await api('library:toggleFavorite', { kind, ref: refId, title }))
      }}
    >
      <Heart className={cx('size-4', fav && 'fill-danger text-danger')} />
    </IconButton>
  )
}

// ---------- recording ----------
export function RecordButton({
  onRecorded,
  maxSeconds = 120,
  disabled,
  label,
}: {
  onRecorded: (rec: Recording) => void
  maxSeconds?: number
  disabled?: boolean
  label?: string
}) {
  const L = useL()
  const rec = useRecorder(maxSeconds, (r) => r && onRecorded(r))
  const recording = rec.state === 'recording'
  const toggle = async () => {
    if (recording) {
      const r = await rec.stop()
      if (r) onRecorded(r)
    } else await rec.start()
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={toggle}
        disabled={disabled || rec.state === 'processing' || rec.state === 'requesting'}
        aria-label={recording ? L('Stop recording', 'Dừng ghi âm') : (label ?? L('Start recording', 'Bắt đầu ghi âm'))}
        className={cx(
          'relative flex size-20 items-center justify-center rounded-full text-white shadow-card transition disabled:opacity-50',
          recording ? 'bg-danger' : 'bg-accent',
        )}
      >
        {recording && (
          <span
            className="absolute inset-0 rounded-full bg-danger/40"
            style={{ transform: `scale(${1 + rec.level * 0.6})`, transition: 'transform 80ms' }}
          />
        )}
        <span className="relative">
          {rec.state === 'processing' ? (
            <Loader2 className="size-8 animate-spin" />
          ) : recording ? (
            <Square className="size-7" />
          ) : (
            <Mic className="size-8" />
          )}
        </span>
      </button>
      <div className="text-xs text-muted tabular-nums">
        {recording
          ? `${Math.floor(rec.elapsed)}s / ${maxSeconds}s`
          : rec.state === 'processing'
            ? L('Processing…', 'Đang xử lý…')
            : (label ?? L('Tap to speak', 'Nhấn để nói'))}
      </div>
      {rec.error && <p className="max-w-sm text-center text-xs text-danger">{rec.error}</p>}
    </div>
  )
}

// ---------- quiz ----------
export function QuizQuestion({
  q,
  index,
  onAnswer,
  answered,
  showVietnameseHint,
}: {
  q: Question
  index?: number
  onAnswer: (choice: number, correct: boolean) => void
  answered?: number | null
  showVietnameseHint?: ReactNode
}) {
  const L = useL()
  const done = answered !== undefined && answered !== null
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <p className="mb-3 font-medium">
        {index !== undefined && <span className="mr-2 text-muted">{index + 1}.</span>}
        {q.prompt}
      </p>
      <div className="grid gap-2">
        {q.options.map((opt, i) => {
          const isCorrect = i === q.answerIndex
          const chosen = answered === i
          return (
            <button
              key={i}
              disabled={done}
              onClick={() => onAnswer(i, isCorrect)}
              className={cx(
                'rounded-xl border px-3 py-2 text-left text-sm transition',
                !done && 'border-line hover:border-accent hover:bg-surface-3',
                done && isCorrect && 'border-success/50 bg-success/10 text-success',
                done && chosen && !isCorrect && 'border-danger/50 bg-danger/10 text-danger',
                done && !chosen && !isCorrect && 'border-line opacity-60',
              )}
            >
              {opt}
            </button>
          )
        })}
      </div>
      {done && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-sm text-muted">
          <span className={answered === q.answerIndex ? 'text-success' : 'text-danger'}>
            {answered === q.answerIndex ? L('Correct! ', 'Chính xác! ') : L('Not quite. ', 'Chưa đúng. ')}
          </span>
          {q.explanation}
          {showVietnameseHint}
        </motion.p>
      )}
    </div>
  )
}
