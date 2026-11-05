import { CheckCircle2, Layers, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Rating } from '@core/srs'
import { Button, Card, cx, Empty, Notice, ProgressBar } from '../components/ui'
import { useT, type MsgKey } from '../i18n'
import { buildDeck, previewLabels, selectDue, type StudyCard } from '../lib/review'
import { useApp } from '../store'

const SESSION_SIZE = 30
const RATINGS: { r: Rating; key: MsgKey; cls: string }[] = [
  { r: 1, key: 'review.again', cls: 'border-danger/40 text-danger' },
  { r: 2, key: 'review.hard', cls: 'border-warning/40 text-warning' },
  { r: 3, key: 'review.good', cls: 'border-success/40 text-success' },
  { r: 4, key: 'review.easy', cls: 'border-info/40 text-info' },
]

function speak(text: string) {
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 0.9
    synth.speak(u)
  } catch {
    /* speech not available */
  }
}

export function Review() {
  const t = useT()
  const cache = useApp((s) => s.cache)
  const review = useApp((s) => s.review)
  const pending = useApp((s) => s.queue.filter((r) => r.tbl === 'review_logs').length)
  const [session, setSession] = useState<string[] | null>(null)
  const [done, setDone] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const shownAt = useRef(Date.now())

  const deck = useMemo(() => (cache ? buildDeck(cache, new Date()) : []), [cache])
  const byKey = useMemo(() => new Map(deck.map((c) => [c.wordKey, c])), [deck])

  // Start a session once the cache is there (snapshot of due word keys, so new syncs don't reshuffle cards).
  useEffect(() => {
    if (session === null && cache) setSession(selectDue(deck, new Date(), SESSION_SIZE).map((c) => c.wordKey))
  }, [cache, deck, session])

  const currentKey = session?.find((k) => byKey.has(k))
  const card: StudyCard | undefined = currentKey ? byKey.get(currentKey) : undefined
  const labels = useMemo(() => (card ? previewLabels(card, new Date()) : null), [card])

  const rate = (r: Rating) => {
    if (!card) return
    review(card, r, Date.now() - shownAt.current)
    setDone((n) => n + 1)
    setSession((s) => (s ? s.filter((k) => k !== card.wordKey) : s))
    setRevealed(false)
    shownAt.current = Date.now()
  }

  const restart = () => {
    setDone(0)
    setRevealed(false)
    shownAt.current = Date.now()
    setSession(selectDue(deck, new Date(), SESSION_SIZE).map((c) => c.wordKey))
  }

  const queued =
    pending > 0 ? (
      <div className="mt-3">
        <Notice tone="info">{t('review.queued', { n: pending })}</Notice>
      </div>
    ) : null

  if (!card) {
    const moreDue = selectDue(deck, new Date(), 1).length > 0
    return (
      <div>
        {done > 0 ? (
          <Empty
            icon={<CheckCircle2 className="size-10 text-success" />}
            action={
              moreDue ? (
                <Button variant="primary" onClick={restart}>
                  {t('review.more')}
                </Button>
              ) : undefined
            }
          >
            {t('review.doneSession', { n: done })}
          </Empty>
        ) : (
          <Empty
            icon={<Layers className="size-10" />}
            action={
              moreDue ? (
                <Button variant="primary" onClick={restart}>
                  {t('review.more')}
                </Button>
              ) : undefined
            }
          >
            {deck.length === 0 ? t('review.emptyNoWords') : t('review.empty')}
          </Empty>
        )}
        {queued}
      </div>
    )
  }

  const total = done + (session?.filter((k) => byKey.has(k)).length ?? 0)
  const v = card.vocab
  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-3 flex items-center gap-3">
        <ProgressBar value={total ? done / total : 0} />
        <span className="shrink-0 font-mono text-xs text-faint">{t('review.left', { n: total - done })}</span>
      </div>

      <Card className="flex min-h-[300px] flex-1 flex-col">
        <div className="flex items-center gap-2 text-xs text-faint">
          {card.memory.state === 'new' && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{t('review.new')}</span>
          )}
          {v.cefr && <span className="rounded bg-surface-3 px-1.5 py-0.5">{v.cefr}</span>}
          {v.topic && <span className="truncate">{v.topic}</span>}
        </div>
        <div className="mt-6 flex flex-col items-center text-center">
          <div className="text-3xl font-semibold break-words">{v.word}</div>
          <div className="mt-1 flex items-center gap-2 text-muted">
            {v.ipa && <span>/{v.ipa.replace(/^\/|\/$/g, '')}/</span>}
            {v.pos && <span className="text-sm text-faint italic">{v.pos}</span>}
            <button
              onClick={() => speak(v.word)}
              aria-label="Play"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted active:bg-surface-2"
            >
              <Volume2 className="size-4" />
            </button>
          </div>
        </div>

        {revealed ? (
          <div className="mt-6 space-y-3 border-t border-line pt-4">
            {v.meaning_vi && <div className="text-lg font-semibold">{v.meaning_vi}</div>}
            {v.meaning_en && <div className="text-sm text-muted">{v.meaning_en}</div>}
            {v.examples.length > 0 && (
              <div>
                <div className="mb-1 text-xs text-faint">{t('review.examples')}</div>
                <ul className="space-y-1.5">
                  {v.examples.slice(0, 3).map((ex) => (
                    <li key={ex} className="border-l-2 border-accent/50 pl-2 text-sm">
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1" />
        )}
      </Card>

      <div className="sticky bottom-0 mt-3 bg-bg pt-1">
        {revealed ? (
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map(({ r, key, cls }) => (
              <button
                key={r}
                onClick={() => rate(r)}
                className={cx(
                  'flex h-14 flex-col items-center justify-center rounded-md border bg-surface-2 active:bg-surface-3',
                  cls,
                )}
              >
                <span className="text-sm font-semibold">{t(key)}</span>
                <span className="font-mono text-[11px] text-faint">{labels?.[r]}</span>
              </button>
            ))}
          </div>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={() => setRevealed(true)}>
            {t('review.show')}
          </Button>
        )}
      </div>
      {queued}
    </div>
  )
}
