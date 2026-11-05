// Stage 3 – Shadow & review: transcript with translation toggle and click-to-look-up words, key vocabulary,
// and line-by-line shadowing (record → transcribe → word match score).
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Languages, Mic, Play, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import type { ListeningTrack } from '@shared/content'
import { compareWords } from '@core/text'
import { AiBadge, InteractiveText, RecordButton, SaveWordButton, SpeakButton } from '@/components/learning'
import { Badge, Button, Card, ErrorState, Section, Toggle, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { ApiError, api, toApiError, useAction, useApi } from '@/lib/api'
import { transcribe, type Recording } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { ListeningSubmitResult } from '../../contract'
import { useStopwatch, type TrackPlayer } from '../lib/usePlayer'
import { StageResult } from './StageResult'

interface ShadowScore {
  score: number | null
  transcript: string | null
  missing: string[]
  self: boolean
  url: string
}

const PASS = 0.7

export function ShadowStage({
  track,
  player,
  onSaved,
}: {
  track: ListeningTrack
  player: TrackPlayer
  onSaved: () => void
}) {
  const L = useL()
  const showHintsDefault = useApp((s) => s.settings?.showVietnameseHints ?? true)
  const [showVi, setShowVi] = useState(showHintsDefault)
  const [active, setActive] = useState(0)
  const [scores, setScores] = useState<Record<number, ShadowScore>>({})
  const [busy, setBusy] = useState(false)
  const [sttError, setSttError] = useState<ApiError | null>(null)
  const [result, setResult] = useState<ListeningSubmitResult | undefined>()
  const [finished, setFinished] = useState(false)
  const ai = useApi('ai:config', undefined, [])
  const aiReady = ai.data ? ai.data.activeProvider !== null : false
  const watch = useStopwatch()

  const activeLine = track.lines[active]
  const glossary = track.keyVocabulary

  const onRecorded = async (rec: Recording) => {
    const index = active
    const target = track.lines[index]?.text ?? ''
    setSttError(null)
    if (!aiReady) {
      setScores((s) => ({ ...s, [index]: { score: null, transcript: null, missing: [], self: false, url: rec.url } }))
      return
    }
    setBusy(true)
    try {
      const { text } = await transcribe(rec, target)
      const cmp = compareWords(target, text)
      setScores((s) => ({
        ...s,
        [index]: { score: cmp.accuracy, transcript: text, missing: cmp.missing, self: false, url: rec.url },
      }))
    } catch (err) {
      setSttError(toApiError(err))
      setScores((s) => ({ ...s, [index]: { score: null, transcript: null, missing: [], self: false, url: rec.url } }))
    } finally {
      setBusy(false)
    }
  }

  const passed = (i: number) => {
    const s = scores[i]
    return !!s && (s.self || (s.score ?? 0) >= PASS)
  }
  const passedCount = track.lines.filter((_, i) => passed(i)).length

  const submit = useAction(async () => {
    const res = await api('listening:submit', {
      trackId: track.id,
      mode: 'shadow',
      correct: passedCount,
      total: track.lines.length,
      speed: player.speed,
      durationSec: watch.seconds(),
      lines: track.lines.map((_, i) => ({
        line: i,
        accuracy: scores[i]?.self ? 1 : (scores[i]?.score ?? 0),
        attempts: scores[i] ? 1 : 0,
      })),
    })
    onSaved()
    return res
  })

  const finish = async () => {
    setFinished(true)
    player.stop()
    setResult(await submit.run())
  }

  const current = scores[active]

  return (
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]" data-testid="listening-shadow">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {L(
              'Click any word to look it up and save it. Pick a line, listen, then say it at the same speed.',
              'Bấm vào từ để tra và lưu. Chọn một câu, nghe rồi nói theo cùng tốc độ.',
            )}
          </p>
          <label className="flex items-center gap-2 text-sm text-muted">
            <Languages className="size-4" />
            {L('Vietnamese', 'Tiếng Việt')}
            <Toggle
              checked={showVi}
              onChange={setShowVi}
              label={L('Show Vietnamese translation', 'Hiện bản dịch tiếng Việt')}
            />
          </label>
        </div>

        <div className="space-y-2">
          {track.lines.map((l, i) => {
            const sp = track.speakers.find((s) => s.id === l.speaker)
            const isPlaying = player.playing && player.current === i
            const sc = scores[i]
            return (
              <div
                key={i}
                onClick={() => setActive(i)}
                className={cx(
                  'flex cursor-pointer gap-3 rounded-xl border p-3 transition',
                  active === i ? 'border-accent/60 bg-accent/5' : 'border-line bg-surface hover:border-line-strong',
                  isPlaying && 'ring-2 ring-accent/40',
                )}
                data-testid={`shadow-line-${i}`}
              >
                <button
                  onClick={(e) => (e.stopPropagation(), setActive(i), void player.playLine(i))}
                  className={cx(
                    'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                    isPlaying ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted hover:text-text',
                  )}
                  aria-label={L(`Play line ${i + 1}`, `Nghe câu ${i + 1}`)}
                >
                  <Play className="ml-0.5 size-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  {track.speakers.length > 1 && sp && (
                    <div className="text-xs font-semibold text-accent">{sp.name}</div>
                  )}
                  <div className="leading-relaxed">
                    <InteractiveText
                      text={l.text}
                      sourceModule="listening"
                      sourceRef={track.id}
                      glossary={glossary}
                      accent={track.accent}
                    />
                  </div>
                  {showVi && <div className="mt-0.5 text-sm text-muted">{l.translationVi}</div>}
                </div>
                {sc && (
                  <div className="shrink-0 self-center">
                    {sc.self ? (
                      <Badge tone="success">
                        <ThumbsUp className="size-3" />
                      </Badge>
                    ) : sc.score !== null ? (
                      <Badge tone={sc.score >= PASS ? 'success' : 'warning'}>{Math.round(sc.score * 100)}%</Badge>
                    ) : (
                      <Badge tone="neutral">
                        <Mic className="size-3" />
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-5">
        <Card className="xl:sticky xl:top-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-muted">
              {L('Shadow line', 'Nói đuổi câu')} {active + 1}/{track.lines.length}
            </div>
            {aiReady && <AiBadge />}
          </div>
          <p className="font-display text-lg leading-snug">{activeLine?.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Play className="size-4" />}
              onClick={() => void player.playLine(active)}
            >
              {L('Listen', 'Nghe')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActive((a) => Math.min(track.lines.length - 1, a + 1))}
              disabled={active >= track.lines.length - 1}
            >
              {L('Next line', 'Câu tiếp')}
            </Button>
          </div>
          <div className="mt-5 flex justify-center">
            <RecordButton
              key={active}
              maxSeconds={30}
              disabled={busy}
              onRecorded={(r) => void onRecorded(r)}
              label={L('Record yourself', 'Ghi âm giọng bạn')}
            />
          </div>
          <AnimatePresence>
            {current && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-3">
                <audio controls src={current.url} className="w-full" />
                {current.score !== null ? (
                  <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">{L('Word match', 'Khớp từ')}</span>
                      <span className={cx('font-semibold', current.score >= PASS ? 'text-success' : 'text-warning')}>
                        {Math.round(current.score * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-muted italic">“{current.transcript}”</p>
                    {current.missing.length > 0 && (
                      <p className="mt-1 text-xs text-warning">
                        {L('Not recognised:', 'Chưa nhận ra:')} {current.missing.join(', ')}
                      </p>
                    )}
                  </div>
                ) : (
                  !current.self && (
                    <div className="space-y-2">
                      {!aiReady && (
                        <ErrorState
                          compact
                          error={
                            new ApiError({
                              code: 'ai_no_key',
                              message: L(
                                'Automatic scoring needs speech-to-text (AI key). Compare your recording with the model and check it yourself.',
                                'Chấm tự động cần chuyển giọng nói thành chữ (API key). Hãy tự so bản ghi với câu mẫu.',
                              ),
                              hint: 'ai-settings',
                            })
                          }
                        />
                      )}
                      <Button
                        size="sm"
                        variant="success"
                        icon={<ThumbsUp className="size-4" />}
                        onClick={() => setScores((s) => ({ ...s, [active]: { ...current, self: true } }))}
                      >
                        {L('Sounds like the model', 'Giống câu mẫu')}
                      </Button>
                    </div>
                  )
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {sttError && (
            <div className="mt-3">
              <ErrorState error={sttError} compact />
            </div>
          )}
        </Card>

        <Section title={L('Key vocabulary', 'Từ vựng chính')}>
          <div className="space-y-2">
            {track.keyVocabulary.map((v) => (
              <div key={v.word} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-semibold">{v.word}</span>{' '}
                    <span className="font-mono text-xs text-muted">{v.ipa}</span>{' '}
                    <span className="text-xs text-faint italic">{v.pos}</span>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <SpeakButton text={v.word} accent={track.accent} />
                    <SaveWordButton
                      seed={{ ...v, context: v.example, topic: track.topic }}
                      sourceModule="listening"
                      sourceRef={track.id}
                      compact
                    />
                  </div>
                </div>
                <p className="text-sm">{v.meaningVi}</p>
                <p className="text-xs text-muted italic">{v.example}</p>
              </div>
            ))}
          </div>
        </Section>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold">{L('Shadowed lines', 'Số câu đã nói đuổi')}</div>
              <div className="text-muted">
                {passedCount}/{track.lines.length} · {L(`pass mark ${PASS * 100}%`, `đạt từ ${PASS * 100}%`)}
              </div>
            </div>
            <Button
              variant="primary"
              icon={<CheckCircle2 className="size-4" />}
              onClick={() => void finish()}
              disabled={finished && !submit.error}
              data-testid="shadow-finish"
            >
              {L('Finish review', 'Hoàn thành')}
            </Button>
          </div>
          {finished && (
            <div className="mt-4">
              <StageResult
                result={result}
                pending={submit.pending}
                error={submit.error}
                title={L('Track complete', 'Hoàn thành bài nghe')}
                onRetry={() => {
                  setFinished(false)
                  setResult(undefined)
                  setScores({})
                  watch.reset()
                }}
                onResubmit={() => void submit.run().then(setResult)}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
