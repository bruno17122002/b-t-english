// FSRS flashcard review: due cards from 'vocab:due', flip with Space, rate with 1–4 (interval previews),
// time measured per card, progress bar and a session summary.
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, CalendarDays, Clock, PartyPopper, RotateCcw, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DueCard } from '@shared/types'
import { SpeakButton } from '@/components/learning'
import { Badge, Button, CefrBadge, cx, EmptyState, ErrorState, Kbd, LoadingBlock, ProgressBar, StatTile, Toggle } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { speak, stopSpeaking } from '@/lib/audio'
import { useApp } from '@/lib/store'
import { RATINGS, readPref, SOURCE_LABEL, writePref } from '../lib/labels'
import { Highlight } from '../components/bits'

interface Rated {
  id: number
  word: string
  rating: 1 | 2 | 3 | 4
  ms: number
}

export default function ReviewPage() {
  const L = useL()
  const navigate = useNavigate()
  const [session, setSession] = useState(0)
  const due = useApi('vocab:due', { limit: 100 }, [session])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [results, setResults] = useState<Rated[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoSpeak, setAutoSpeak] = useState(() => readPref('autoSpeak', '1') === '1')
  const shownAt = useRef(Date.now())

  const cards = due.data ?? []
  const card: DueCard | undefined = cards[index]
  const finished = !!due.data && cards.length > 0 && index >= cards.length

  // New card shown: reset the timer and optionally speak it.
  useEffect(() => {
    if (!card) return
    shownAt.current = Date.now()
    setFlipped(false)
    if (autoSpeak) void speak(card.word)
    return () => stopSpeaking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id])

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || !flipped || submitting) return
      setSubmitting(true)
      setError(null)
      const ms = Math.min(3_600_000, Date.now() - shownAt.current)
      try {
        await api('vocab:review', { id: card.id, rating, durationMs: ms })
        setResults((r) => [...r, { id: card.id, word: card.word, rating, ms }])
        setIndex((i) => i + 1)
        void useApp.getState().refreshGame()
      } catch (err) {
        setError(toApiError(err).message)
      } finally {
        setSubmitting(false)
      }
    },
    [card, flipped, submitting],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        if (card) setFlipped(true)
      } else if (/^[1-4]$/.test(e.key) && flipped) {
        e.preventDefault()
        void rate(Number(e.key) as 1 | 2 | 3 | 4)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, flipped, rate])

  const restart = () => {
    setIndex(0)
    setResults([])
    setFlipped(false)
    setSession((s) => s + 1)
  }

  return (
    <div data-testid="page-vocabulary" data-view="review" className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-3">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/vocabulary')}>
          {L('Word bank', 'Kho từ')}
        </Button>
        <div className="flex-1">
          {cards.length > 0 && !finished && (
            <div className="flex items-center gap-3">
              <ProgressBar value={index} max={cards.length} className="flex-1" />
              <span className="text-sm text-muted tabular-nums" data-testid="review-progress">
                {index + 1}/{cards.length}
              </span>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <Volume2 className="size-4" />
          {L('Auto-speak', 'Tự đọc')}
          <Toggle
            checked={autoSpeak}
            label={L('Speak each word automatically', 'Tự động đọc mỗi từ')}
            onChange={(v) => {
              setAutoSpeak(v)
              writePref('autoSpeak', v ? '1' : '0')
            }}
          />
        </label>
      </div>

      {due.loading ? (
        <LoadingBlock rows={3} />
      ) : due.error ? (
        <ErrorState error={due.error} onRetry={due.reload} />
      ) : finished ? (
        <Summary results={results} onMore={restart} />
      ) : !card ? (
        <NothingDue />
      ) : (
        <>
          <Flashcard card={card} flipped={flipped} onFlip={() => setFlipped(true)} />
          {error && (
            <div className="mt-3">
              <ErrorState compact error={error} />
            </div>
          )}
          <div className="mt-5">
            {!flipped ? (
              <div className="flex flex-col items-center gap-2">
                <Button variant="primary" size="lg" onClick={() => setFlipped(true)} data-testid="review-flip">
                  {L('Show answer', 'Xem đáp án')}
                </Button>
                <span className="text-xs text-faint">
                  <Kbd>Space</Kbd> {L('to flip', 'để lật thẻ')}
                </span>
              </div>
            ) : (
              <RatingButtons card={card} disabled={submitting} onRate={(r) => void rate(r)} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Flashcard({ card, flipped, onFlip }: { card: DueCard; flipped: boolean; onFlip: () => void }) {
  const L = useL()
  const tx = useTx()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !flipped && onFlip()}
      onKeyDown={(e) => e.key === 'Enter' && !flipped && onFlip()}
      className={cx('relative min-h-80 rounded-3xl border border-line bg-surface p-8 shadow-card transition', !flipped && 'cursor-pointer hover:border-line-strong')}
      data-testid="review-card"
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        {card.review.state === 'new' && <Badge tone="info">{L('New', 'Mới')}</Badge>}
        {card.review.lapses >= 2 && <Badge tone="danger">{L('Tricky', 'Hay quên')}</Badge>}
        <Badge tone="neutral">{tx(SOURCE_LABEL[card.sourceModule] ?? { en: card.sourceModule, vi: card.sourceModule })}</Badge>
      </div>
      <div className="flex flex-col items-center pt-6 text-center">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-5xl font-semibold tracking-tight" data-testid="review-word">
            {card.word}
          </h2>
          {card.cefr && <CefrBadge level={card.cefr} />}
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-muted">
          {card.ipa}
          {card.pos && <span className="font-sans text-sm italic">· {card.pos}</span>}
          <SpeakButton text={card.word} />
        </div>
      </div>
      <AnimatePresence>
        {flipped && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4 border-t border-line pt-6" data-testid="review-back">
            <div className="text-center">
              {card.meaningVi && <p className="text-xl font-semibold">{card.meaningVi}</p>}
              {card.meaningEn && <p className="mt-1 text-muted">{card.meaningEn}</p>}
            </div>
            {card.examples.length > 0 && (
              <ul className="space-y-1.5">
                {card.examples.slice(0, 3).map((ex) => (
                  <li key={ex} className="flex items-start gap-2 text-sm">
                    <SpeakButton text={ex} />
                    <Highlight text={ex} word={card.word} className="pt-2" />
                  </li>
                ))}
              </ul>
            )}
            {card.context && !card.examples.includes(card.context) && (
              <p className="border-l-2 border-accent/50 pl-3 text-sm text-muted italic">
                <Highlight text={card.context} word={card.word} />
              </p>
            )}
            {card.collocations.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {card.collocations.map((c) => (
                  <span key={c} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs">
                    {c}
                  </span>
                ))}
              </div>
            )}
            {card.notes && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{card.notes}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function RatingButtons({ card, disabled, onRate }: { card: DueCard; disabled: boolean; onRate: (r: 1 | 2 | 3 | 4) => void }) {
  const tx = useTx()
  return (
    <div className="grid grid-cols-4 gap-2" data-testid="review-ratings">
      {RATINGS.map((r) => (
        <button
          key={r.value}
          disabled={disabled}
          onClick={() => onRate(r.value)}
          className={cx('flex flex-col items-center rounded-2xl border px-3 py-3 transition disabled:opacity-50', r.tone)}
          data-testid={`review-rate-${r.value}`}
        >
          <span className="font-semibold">{tx(r.label)}</span>
          <span className="text-xs opacity-80">{card.preview[r.value]}</span>
          <span className="mt-1">
            <Kbd>{r.key}</Kbd>
          </span>
        </button>
      ))}
    </div>
  )
}

function Summary({ results, onMore }: { results: Rated[]; onMore: () => void }) {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const total = results.length
  const remembered = results.filter((r) => r.rating >= 3).length
  const avgSec = total ? results.reduce((s, r) => s + r.ms, 0) / total / 1000 : 0
  const again = results.filter((r) => r.rating === 1)
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-3xl border border-line bg-surface p-8 text-center" data-testid="review-summary">
      <PartyPopper className="mx-auto size-10 text-accent" />
      <h2 className="mt-3 font-display text-2xl font-semibold">{L('Session complete!', 'Hoàn thành phiên ôn!')}</h2>
      <p className="mt-1 text-sm text-muted">{L('Your next reviews are scheduled automatically.', 'Lịch ôn tiếp theo đã được tự động sắp xếp.')}</p>
      <div className="mt-6 grid grid-cols-3 gap-3 text-left">
        <StatTile label={L('Cards', 'Thẻ')} value={total} />
        <StatTile label={L('Remembered', 'Nhớ được')} value={`${total ? Math.round((remembered / total) * 100) : 0}%`} sub={L('rated Good or Easy', 'chấm Tốt hoặc Dễ')} />
        <StatTile icon={<Clock />} label={L('Avg. time', 'TB mỗi thẻ')} value={`${avgSec.toFixed(1)}s`} />
      </div>
      <div className="mt-4 flex justify-center gap-2">
        {RATINGS.map((r) => (
          <Badge key={r.value} tone={r.value === 1 ? 'danger' : r.value === 2 ? 'warning' : r.value === 3 ? 'success' : 'info'}>
            {tx(r.label)}: {results.filter((x) => x.rating === r.value).length}
          </Badge>
        ))}
      </div>
      {again.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {L('Coming back soon:', 'Sẽ gặp lại sớm:')} {again.map((r) => r.word).join(', ')}
        </p>
      )}
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={onMore}>
          {L('Check for more cards', 'Tìm thêm thẻ đến hạn')}
        </Button>
        <Button onClick={() => navigate('/vocabulary/practice')}>{L('Practice modes', 'Luyện tập thêm')}</Button>
      </div>
    </motion.div>
  )
}

function NothingDue() {
  const L = useL()
  const fmt = useFormat()
  const navigate = useNavigate()
  const stats = useApi('vocab:stats', undefined)
  const next = stats.data?.forecast.find((f) => f.count > 0)
  return (
    <EmptyState
      icon={<CalendarDays />}
      title={L('No cards due right now', 'Hiện chưa có thẻ nào đến hạn')}
      body={
        stats.data?.total
          ? next
            ? L(`Next reviews: ${next.count} card(s) on ${fmt.date(next.date)}. Great job keeping up!`, `Lần ôn tới: ${next.count} thẻ vào ${fmt.date(next.date)}. Bạn đang theo kịp rất tốt!`)
            : L('Everything is reviewed. Great job!', 'Bạn đã ôn hết. Tuyệt vời!')
          : L('Save words from lessons, the dictionary or the tutor and they will show up here.', 'Lưu từ từ bài học, từ điển hoặc gia sư và chúng sẽ xuất hiện ở đây.')
      }
      action={
        <div className="flex gap-2">
          <Button onClick={() => navigate('/vocabulary/practice')}>{L('Practice anyway', 'Vẫn luyện tập')}</Button>
          <Button variant="ghost" onClick={() => navigate('/vocabulary')}>
            {L('Word bank', 'Kho từ')}
          </Button>
        </div>
      }
    />
  )
}
