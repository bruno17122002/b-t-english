// Stage 1 – Gist: listen to the whole track without the text, then answer the comprehension questions.
import { EyeOff } from 'lucide-react'
import { useState } from 'react'
import { shuffled } from '@core/shuffle'
import type { ListeningTrack } from '@shared/content'
import { QuizQuestion } from '@/components/learning'
import { cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, useAction } from '@/lib/api'
import type { ListeningSubmitResult } from '../../contract'
import { useStopwatch, type TrackPlayer } from '../lib/usePlayer'
import { StageResult } from './StageResult'

export function GistStage({
  track,
  player,
  onSaved,
  onNext,
}: {
  track: ListeningTrack
  player: TrackPlayer
  onSaved: () => void
  onNext: () => void
}) {
  const L = useL()
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [round, setRound] = useState(0)
  const watch = useStopwatch()
  const submit = useAction(async (correct: number) => {
    const res = await api('listening:submit', {
      trackId: track.id,
      mode: 'gist',
      correct,
      total: track.questions.length,
      speed: player.speed,
      durationSec: watch.seconds(),
    })
    onSaved()
    return res
  })
  const [result, setResult] = useState<ListeningSubmitResult | undefined>()

  // A new random question order for every round (options are shuffled by QuizQuestion).
  const [questions, setQuestions] = useState(() => shuffled(track.questions))
  const answered = Object.keys(answers).length
  const correct = track.questions.filter((q) => answers[q.id] === q.answerIndex).length

  const answer = async (qid: string, choice: number) => {
    const next = { ...answers, [qid]: choice }
    setAnswers(next)
    if (Object.keys(next).length === track.questions.length) {
      const c = track.questions.filter((q) => next[q.id] === q.answerIndex).length
      setResult(await submit.run(c))
    }
  }

  const retry = () => {
    setAnswers({})
    setResult(undefined)
    setRound((r) => r + 1)
    setQuestions(shuffled(track.questions))
    watch.reset()
  }

  return (
    <div className="space-y-5" data-testid="listening-gist">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted">
          <EyeOff className="size-4" />
          {L(
            'The text is hidden. Play the whole track (twice if you need), then answer. Tap a line to hear it again.',
            'Văn bản được ẩn. Nghe cả bài (hai lần nếu cần) rồi trả lời. Bấm vào một câu để nghe lại.',
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {track.lines.map((l, i) => {
            const sp = track.speakers.find((s) => s.id === l.speaker)
            return (
              <button
                key={i}
                onClick={() => void player.playLine(i)}
                className={cx(
                  'rounded-lg border px-2.5 py-1 text-xs transition',
                  player.current === i && player.playing
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line text-muted hover:border-line-strong hover:text-text',
                )}
              >
                {i + 1}
                {track.speakers.length > 1 && sp ? ` · ${sp.name}` : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuizQuestion
            key={`${round}-${q.id}`}
            q={q}
            index={i}
            answered={answers[q.id] ?? null}
            onAnswer={(choice) => void answer(q.id, choice)}
          />
        ))}
      </div>

      <div className="text-sm text-muted">
        {L(`Answered ${answered}/${track.questions.length}`, `Đã trả lời ${answered}/${track.questions.length}`)}
        {answered > 0 && ` · ${L(`${correct} correct`, `${correct} câu đúng`)}`}
      </div>

      {(result || submit.pending || submit.error) && (
        <StageResult
          result={result}
          pending={submit.pending}
          error={submit.error}
          title={L('Gist complete', 'Hoàn thành nghe ý chính')}
          onRetry={retry}
          onResubmit={() => void submit.run(correct).then(setResult)}
          onNext={onNext}
          nextLabel={L('Go to dictation', 'Sang chép chính tả')}
        />
      )}
    </div>
  )
}
