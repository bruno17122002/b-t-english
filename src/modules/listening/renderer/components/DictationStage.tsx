// Stage 2 – Dictation: listen to one line at a time and type it (or fill the gaps). Checking is lenient
// (case, punctuation, contractions and small typos), shows a word-level diff and allows instant retries.
import { motion } from 'framer-motion'
import { CheckCircle2, Eye, Keyboard, Play, RotateCcw, SkipForward, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ListeningTrack } from '@shared/content'
import { Badge, Button, ErrorState, Input, Kbd, ProgressBar, Tabs, Textarea, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, useAction, type ApiError } from '@/lib/api'
import type { DictationCheck, GapLine, GapResult, ListeningSubmitResult } from '../../contract'
import { useStopwatch, type TrackPlayer } from '../lib/usePlayer'
import { DiffView } from './DiffView'
import { StageResult } from './StageResult'

type Variant = 'dictation' | 'gap'

interface LineState {
  attempts: number
  done: boolean
  revealed: boolean
  accepted: boolean
  accuracy: number
  /** Gap mode: correct blanks and total blanks of this line. */
  correct: number
  total: number
}

const fresh = (): LineState => ({
  attempts: 0,
  done: false,
  revealed: false,
  accepted: false,
  accuracy: 0,
  correct: 0,
  total: 0,
})

export function DictationStage({
  track,
  gaps,
  player,
  onSaved,
  onNext,
}: {
  track: ListeningTrack
  gaps: GapLine[]
  player: TrackPlayer
  onSaved: () => void
  onNext: () => void
}) {
  const L = useL()
  const [variant, setVariant] = useState<Variant>('dictation')
  const [idx, setIdx] = useState(0)
  const [lines, setLines] = useState<LineState[]>(() => track.lines.map(fresh))
  const [typed, setTyped] = useState('')
  const [check, setCheck] = useState<DictationCheck | null>(null)
  const [gapAnswers, setGapAnswers] = useState<string[]>([])
  const [gapResults, setGapResults] = useState<GapResult[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<ApiError | null>(null)
  const [finished, setFinished] = useState(false)
  const [result, setResult] = useState<ListeningSubmitResult | undefined>()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const watch = useStopwatch()

  const line = track.lines[idx]
  const gap = gaps[idx]
  const state = lines[idx] ?? fresh()
  const speaker = track.speakers.find((s) => s.id === line?.speaker)

  const resetLine = () => {
    setTyped('')
    setCheck(null)
    setGapAnswers([])
    setGapResults(null)
    setCheckError(null)
  }

  const restart = (v: Variant = variant) => {
    setVariant(v)
    setIdx(0)
    setLines(track.lines.map(fresh))
    setFinished(false)
    setResult(undefined)
    resetLine()
    watch.reset()
  }

  const patch = (i: number, p: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))

  useEffect(() => {
    // Lines without any blank (very short lines) are skipped in gap mode.
    if (variant === 'gap' && gap && gap.blanks.length === 0 && !state.done)
      patch(idx, { done: true, accepted: true, accuracy: 1, correct: 0, total: 0 })
  }, [variant, gap, idx, state.done])

  useEffect(() => {
    inputRef.current?.focus()
  }, [idx, variant])

  const submit = useAction(async (all: LineState[]) => {
    const correct =
      variant === 'gap' ? all.reduce((s, l) => s + l.correct, 0) : all.filter((l) => l.accepted && !l.revealed).length
    const total = variant === 'gap' ? all.reduce((s, l) => s + l.total, 0) : all.length
    const res = await api('listening:submit', {
      trackId: track.id,
      mode: variant,
      correct,
      total: Math.max(1, total),
      speed: player.speed,
      durationSec: watch.seconds(),
      lines: all.map((l, i) => ({ line: i, accuracy: l.accuracy, attempts: l.attempts, revealed: l.revealed })),
    })
    onSaved()
    return res
  })

  const runCheck = async () => {
    if (!line || state.done) return
    setChecking(true)
    setCheckError(null)
    try {
      if (variant === 'dictation') {
        const c = await api('listening:checkLine', { trackId: track.id, line: idx, typed })
        setCheck(c)
        patch(idx, {
          attempts: state.attempts + 1,
          accuracy: Math.max(state.accuracy, c.accuracy),
          ...(c.accepted ? { done: true, accepted: true } : {}),
        })
      } else if (gap) {
        const r = await api('listening:checkGaps', {
          trackId: track.id,
          line: idx,
          answers: gap.blanks.map((_, i) => gapAnswers[i] ?? ''),
        })
        setGapResults(r)
        const good = r.filter((x) => x !== 'wrong').length
        const all = good === gap.blanks.length
        patch(idx, {
          attempts: state.attempts + 1,
          accuracy: Math.max(state.accuracy, good / Math.max(1, gap.blanks.length)),
          total: gap.blanks.length,
          ...(all ? { done: true, accepted: true, correct: good } : {}),
        })
      }
    } catch (err) {
      setCheckError(toApiError(err))
    } finally {
      setChecking(false)
    }
  }

  const reveal = () => {
    // Gap mode keeps partial credit for blanks already answered correctly; a revealed dictation line scores 0.
    const partial = variant === 'gap' ? (gapResults?.filter((r) => r !== 'wrong').length ?? 0) : 0
    patch(idx, { done: true, revealed: true, total: gap?.blanks.length ?? 0, correct: partial })
  }

  const goNext = async () => {
    if (idx < track.lines.length - 1) {
      const next = idx + 1
      setIdx(next)
      resetLine()
      void player.playLine(next)
    } else {
      setFinished(true)
      player.stop()
      setResult(await submit.run(lines))
    }
  }

  const retry = () => {
    setCheck(null)
    setGapResults(null)
    void player.playLine(idx)
    inputRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault()
      void player.playLine(idx)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (state.done) void goNext()
      else void runCheck()
    }
  }

  const doneCount = lines.filter((l) => l.done).length
  const showAnswer = state.done

  if (finished)
    return (
      <StageResult
        result={result}
        pending={submit.pending}
        error={submit.error}
        title={
          variant === 'gap'
            ? L('Gap fill complete', 'Hoàn thành điền từ')
            : L('Dictation complete', 'Hoàn thành chép chính tả')
        }
        onRetry={() => restart()}
        onResubmit={() => void submit.run(lines).then(setResult)}
        onNext={onNext}
        nextLabel={L('Shadow & review', 'Nói đuổi & ôn lại')}
      />
    )

  if (!line) return null

  return (
    <div className="space-y-4" data-testid="listening-dictation">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Variant>
          value={variant}
          onChange={(v) => v !== variant && restart(v)}
          items={[
            { value: 'dictation', label: L('Full dictation', 'Chép cả câu') },
            { value: 'gap', label: L('Gap fill (easier)', 'Điền từ (dễ hơn)') },
          ]}
        />
        <div className="flex items-center gap-2 text-xs text-faint">
          <Keyboard className="size-3.5" />
          <Kbd>Enter</Kbd> {L('check / next', 'kiểm tra / tiếp')} · <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd>{' '}
          {L('replay', 'nghe lại')}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ProgressBar value={doneCount} max={track.lines.length} className="flex-1" />
        <span className="text-sm text-muted tabular-nums">
          {idx + 1}/{track.lines.length}
        </span>
      </div>

      <motion.div
        key={`${variant}-${idx}`}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        className="rounded-2xl border border-line bg-surface p-5"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<Play className="size-4" />}
            onClick={() => void player.playLine(idx)}
            data-testid="dictation-play-line"
          >
            {L('Play line', 'Nghe câu')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Volume2 className="size-4" />}
            onClick={() => (player.setSpeed(Math.max(0.6, player.speed - 0.2)), void player.playLine(idx))}
          >
            {L('Slower', 'Chậm hơn')}
          </Button>
          {speaker && track.speakers.length > 1 && <Badge tone="neutral">{speaker.name}</Badge>}
          {state.attempts > 0 && (
            <span className="text-xs text-faint">
              {L(`Attempts: ${state.attempts}`, `Số lần thử: ${state.attempts}`)}
            </span>
          )}
        </div>

        {variant === 'dictation' ? (
          <Textarea
            ref={inputRef}
            value={typed}
            maxLength={1000}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={onKey}
            disabled={state.done}
            placeholder={L('Type what you hear…', 'Gõ những gì bạn nghe được…')}
            className="min-h-20 font-mono"
            spellCheck={false}
            aria-label={L('Your dictation', 'Bài chép của bạn')}
            data-testid="dictation-input"
          />
        ) : (
          gap && (
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-3 text-[17px] leading-relaxed">
              {gap.tokens.map((tok, ti) => {
                const bi = gap.blanks.findIndex((b) => b.index === ti)
                const blank = gap.blanks[bi]
                if (!blank) return <span key={ti}>{tok}</span>
                const res = gapResults?.[bi]
                return (
                  <span key={ti} className="inline-flex items-baseline">
                    {blank.before}
                    {showAnswer ? (
                      <span
                        className={cx(
                          'rounded px-1 font-semibold',
                          res && res !== 'wrong' && !state.revealed
                            ? 'bg-success/15 text-success'
                            : 'bg-accent/15 text-accent',
                        )}
                      >
                        {blank.answer}
                      </span>
                    ) : (
                      <Input
                        value={gapAnswers[bi] ?? ''}
                        maxLength={80}
                        onChange={(e) => setGapAnswers((a) => Object.assign([...a], { [bi]: e.target.value }))}
                        onKeyDown={onKey}
                        style={{ width: `${Math.max(4, blank.answer.length + 2)}ch` }}
                        className={cx(
                          'h-8 px-2 font-mono',
                          res === 'wrong' && 'border-danger',
                          res === 'typo' && 'border-warning',
                          res === 'ok' && 'border-success',
                        )}
                        aria-label={L(`Blank ${bi + 1}`, `Ô trống ${bi + 1}`)}
                        spellCheck={false}
                      />
                    )}
                    {blank.after}
                  </span>
                )
              })}
            </div>
          )
        )}

        {checkError && (
          <div className="mt-3">
            <ErrorState error={checkError} compact onRetry={() => void runCheck()} />
          </div>
        )}

        {variant === 'dictation' && check && (
          <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
            <DiffView tokens={check.tokens} showExpected={state.done} />
            <p className={cx('mt-3 text-sm', check.accepted ? 'text-success' : 'text-muted')}>
              {check.accepted
                ? check.perfect
                  ? L('Perfect!', 'Hoàn hảo!')
                  : L(
                      'Accepted – check the underlined spelling.',
                      'Được chấp nhận – xem lại chính tả các từ gạch chân.',
                    )
                : L(
                    `${Math.round(check.accuracy * 100)}% of the words are right. Listen again and fix the marked words.`,
                    `Đúng ${Math.round(check.accuracy * 100)}% số từ. Nghe lại và sửa các chỗ được đánh dấu.`,
                  )}
            </p>
          </div>
        )}

        {variant === 'gap' && gapResults && !state.done && (
          <p className="mt-3 text-sm text-muted">
            {L(
              `${gapResults.filter((r) => r !== 'wrong').length}/${gapResults.length} blanks right – try the red ones again.`,
              `Đúng ${gapResults.filter((r) => r !== 'wrong').length}/${gapResults.length} ô – thử lại các ô màu đỏ.`,
            )}
          </p>
        )}

        {showAnswer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 rounded-xl border border-line p-4"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              {state.revealed ? (
                <Eye className="size-4 text-warning" />
              ) : (
                <CheckCircle2 className="size-4 text-success" />
              )}
              {line.text}
            </div>
            <p className="mt-1 text-sm text-muted">{line.translationVi}</p>
          </motion.div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!state.done ? (
            <>
              <Button
                variant="primary"
                loading={checking}
                onClick={() => void runCheck()}
                disabled={variant === 'dictation' ? !typed.trim() : !gapAnswers.some((a) => a?.trim())}
                data-testid="dictation-check"
              >
                {L('Check', 'Kiểm tra')}
              </Button>
              {(check || gapResults) && (
                <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={retry}>
                  {L('Listen & retry', 'Nghe lại & sửa')}
                </Button>
              )}
              <Button variant="ghost" icon={<Eye className="size-4" />} onClick={reveal} data-testid="dictation-reveal">
                {L('Reveal', 'Xem đáp án')}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              icon={<SkipForward className="size-4" />}
              onClick={() => void goNext()}
              data-testid="dictation-next"
            >
              {idx < track.lines.length - 1 ? L('Next line', 'Câu tiếp') : L('Finish', 'Hoàn thành')}
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
