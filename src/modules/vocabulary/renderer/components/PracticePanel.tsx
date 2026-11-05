// Practice modes over the word bank (no scheduling changes): spelling, meaning quiz, context cloze and
// listening match. Results are tracked for the session only.
import { motion } from 'framer-motion'
import { ArrowRight, Ear, Keyboard, ListChecks, Puzzle, RotateCcw, Trophy, Volume2, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VocabItem } from '@shared/types'
import { QuizQuestion, SpeakButton } from '@/components/learning'
import { Badge, Button, cx, EmptyState, ErrorState, Input, LoadingBlock, ProgressBar, ProgressRing } from '@/components/ui'
import { useL } from '@/i18n'
import { api, useApi } from '@/lib/api'
import { speak } from '@/lib/audio'
import {
  buildListeningMcq,
  buildMeaningMcq,
  gradeSpelling,
  letterHint,
  pickCloze,
  pickPracticeSet,
  type Cloze,
  type Mcq,
  type SpellingGrade,
  type WordLike,
} from '../lib/practice'

type Mode = 'spelling' | 'meaning' | 'cloze' | 'listening'

const MODES: { id: Mode; icon: LucideIcon; en: string; vi: string; descEn: string; descVi: string }[] = [
  { id: 'spelling', icon: Keyboard, en: 'Spelling', vi: 'Chính tả', descEn: 'Hear the word, then type it.', descVi: 'Nghe từ rồi gõ lại cho đúng.' },
  { id: 'meaning', icon: ListChecks, en: 'Meaning quiz', vi: 'Trắc nghiệm nghĩa', descEn: 'Pick the right Vietnamese meaning.', descVi: 'Chọn nghĩa tiếng Việt đúng.' },
  { id: 'cloze', icon: Puzzle, en: 'Context cloze', vi: 'Điền từ vào câu', descEn: 'Fill the gap in a real example sentence.', descVi: 'Điền từ còn thiếu trong câu ví dụ.' },
  { id: 'listening', icon: Ear, en: 'Listening match', vi: 'Nghe và chọn', descEn: 'Listen and choose the word you heard.', descVi: 'Nghe và chọn đúng từ vừa nghe.' },
]

const ROUNDS = 10

type Round =
  | { mode: 'spelling'; item: VocabItem }
  | { mode: 'meaning' | 'listening'; item: VocabItem; mcq: Mcq }
  | { mode: 'cloze'; item: VocabItem; cloze: Cloze & { sentence: string } }

interface Result {
  word: string
  correct: boolean
}

function buildRounds(mode: Mode, items: VocabItem[], pool: WordLike[]): Round[] {
  const out: Round[] = []
  for (const item of pickPracticeSet(items, Math.min(items.length, ROUNDS * 3))) {
    if (out.length >= ROUNDS) break
    if (mode === 'spelling') out.push({ mode, item })
    else if (mode === 'meaning') {
      const mcq = buildMeaningMcq(item, pool)
      if (mcq) out.push({ mode, item, mcq })
    } else if (mode === 'listening') {
      const mcq = buildListeningMcq(item, pool)
      if (mcq) out.push({ mode, item, mcq })
    } else {
      const cloze = pickCloze(item)
      if (cloze) out.push({ mode, item, cloze })
    }
  }
  return out
}

export function PracticePanel({ onGoToBank }: { onGoToBank: () => void }) {
  const L = useL()
  const bank = useApi('vocab:list', { limit: 500, sort: 'recent' })
  const [extras, setExtras] = useState<WordLike[]>([])
  const [mode, setMode] = useState<Mode | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [message, setMessage] = useState<string | null>(null)

  // Dictionary entries widen the distractor pool when the word bank is small.
  useEffect(() => {
    let alive = true
    Promise.all(['a', 'c', 'm', 's', 't'].map((q) => api('search:query', { q }).catch(() => [])))
      .then((lists) => {
        if (!alive) return
        setExtras(lists.flat().filter((r) => r.kind === 'dictionary').map((r) => ({ word: r.title, meaningVi: r.subtitle })))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const items = useMemo(() => bank.data?.items ?? [], [bank.data])
  const pool = useMemo<WordLike[]>(() => [...items, ...extras], [items, extras])

  const start = (m: Mode) => {
    const r = buildRounds(m, items, pool)
    if (!r.length) {
      setMessage(
        m === 'cloze'
          ? L('None of your words has an example sentence containing it yet. Add examples to your words first.', 'Chưa có từ nào có câu ví dụ chứa chính từ đó. Hãy thêm ví dụ cho từ trước.')
          : L('Not enough words to build questions yet.', 'Chưa đủ từ để tạo câu hỏi.'),
      )
      return
    }
    setMessage(null)
    setMode(m)
    setRounds(r)
  }

  if (bank.loading && !bank.data) return <LoadingBlock rows={3} />
  if (bank.error) return <ErrorState error={bank.error} onRetry={bank.reload} />
  if (!items.length)
    return (
      <EmptyState
        icon={<Puzzle />}
        title={L('Save a few words first', 'Hãy lưu vài từ trước')}
        body={L('Practice modes use the words in your word bank.', 'Các chế độ luyện tập dùng từ trong kho từ của bạn.')}
        action={<Button onClick={onGoToBank}>{L('Go to word bank', 'Đến kho từ')}</Button>}
      />
    )

  if (mode && rounds.length)
    return (
      <Session
        key={`${mode}-${rounds.map((r) => r.item.id).join(',')}`}
        rounds={rounds}
        onExit={() => {
          setMode(null)
          setRounds([])
        }}
        onAgain={() => start(mode)}
      />
    )

  return (
    <div data-testid="vocab-practice">
      <p className="mb-4 text-sm text-muted">
        {L(
          'Quick drills on your saved words. Practice does not change your review schedule – use flashcard review for that.',
          'Luyện nhanh với từ đã lưu. Luyện tập không thay đổi lịch ôn – hãy dùng phần ôn thẻ cho việc đó.',
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => start(m.id)}
            className="group flex items-start gap-4 rounded-2xl border border-line bg-surface p-5 text-left transition hover:-translate-y-0.5 hover:border-accent"
            data-testid={`practice-${m.id}`}
          >
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <m.icon className="size-6" />
            </div>
            <div className="flex-1">
              <div className="font-display text-lg font-semibold">{L(m.en, m.vi)}</div>
              <p className="text-sm text-muted">{L(m.descEn, m.descVi)}</p>
            </div>
            <ArrowRight className="mt-1 size-5 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
          </button>
        ))}
      </div>
      {message && <p className="mt-4 text-sm text-warning">{message}</p>}
    </div>
  )
}

function Session({ rounds, onExit, onAgain }: { rounds: Round[]; onExit: () => void; onAgain: () => void }) {
  const L = useL()
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<Result[]>([])
  const [answered, setAnswered] = useState(false)
  const round = rounds[index]
  const done = index >= rounds.length

  const record = (correct: boolean) => {
    if (answered || !round) return
    setAnswered(true)
    setResults((r) => [...r, { word: round.item.word, correct }])
  }
  const next = () => {
    setAnswered(false)
    setIndex((i) => i + 1)
  }

  useEffect(() => {
    if (!answered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        next()
      }
    }
    // Defer so the Enter that submitted the answer does not also skip ahead.
    const t = setTimeout(() => window.addEventListener('keydown', onKey), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [answered])

  if (done) {
    const correct = results.filter((r) => r.correct).length
    const missed = results.filter((r) => !r.correct)
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-lg rounded-2xl border border-line bg-surface p-8 text-center" data-testid="practice-summary">
        <Trophy className="mx-auto size-10 text-warning" />
        <h2 className="mt-3 font-display text-2xl font-semibold">{L('Practice complete!', 'Hoàn thành luyện tập!')}</h2>
        <div className="mt-5 flex justify-center">
          <ProgressRing value={results.length ? correct / results.length : 0} size={96} stroke={8}>
            <span className="text-lg">
              {correct}/{results.length}
            </span>
          </ProgressRing>
        </div>
        {missed.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{L('Words to look at again', 'Từ cần xem lại')}</div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {missed.map((m, i) => (
                <Badge key={`${m.word}-${i}`} tone="danger">
                  {m.word}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={onAgain}>
            {L('Practice again', 'Luyện lại')}
          </Button>
          <Button onClick={onExit}>{L('Other modes', 'Chế độ khác')}</Button>
        </div>
      </motion.div>
    )
  }
  if (!round) return null

  return (
    <div className="mx-auto max-w-2xl" data-testid="practice-session">
      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onExit}>
          {L('Quit', 'Thoát')}
        </Button>
        <ProgressBar value={index} max={rounds.length} className="flex-1" />
        <span className="text-sm text-muted tabular-nums">
          {index + 1}/{rounds.length}
        </span>
      </div>
      <motion.div key={index} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="rounded-2xl border border-line bg-surface p-6">
        {round.mode === 'spelling' && <SpellingRound item={round.item} onResult={record} answered={answered} />}
        {round.mode === 'cloze' && <ClozeRound item={round.item} cloze={round.cloze} onResult={record} answered={answered} />}
        {(round.mode === 'meaning' || round.mode === 'listening') && <McqRound round={round} onResult={record} />}
      </motion.div>
      {answered && (
        <div className="mt-4 flex justify-end">
          <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={next} data-testid="practice-next">
            {index + 1 >= rounds.length ? L('See results', 'Xem kết quả') : L('Next', 'Tiếp')} <span className="text-xs opacity-70">↵</span>
          </Button>
        </div>
      )}
    </div>
  )
}

function Feedback({ grade, expected }: { grade: SpellingGrade; expected: string }) {
  const L = useL()
  return (
    <p className={cx('mt-3 text-sm font-medium', grade === 'wrong' ? 'text-danger' : grade === 'close' ? 'text-warning' : 'text-success')} role="status">
      {grade === 'correct' && L('Correct!', 'Chính xác!')}
      {grade === 'close' && L(`Almost – one small typo. Correct spelling: ${expected}`, `Gần đúng – sai một chút. Viết đúng: ${expected}`)}
      {grade === 'wrong' && L(`Not quite. The answer is “${expected}”.`, `Chưa đúng. Đáp án là “${expected}”.`)}
    </p>
  )
}

function SpellingRound({ item, onResult, answered }: { item: VocabItem; onResult: (ok: boolean) => void; answered: boolean }) {
  const L = useL()
  const [value, setValue] = useState('')
  const [hint, setHint] = useState(false)
  const [grade, setGrade] = useState<SpellingGrade | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void speak(item.word)
    inputRef.current?.focus()
  }, [item.word])
  const check = () => {
    if (answered || !value.trim()) return
    const g = gradeSpelling(item.word, value)
    setGrade(g)
    onResult(g !== 'wrong')
    if (g !== 'correct') void speak(item.word)
  }
  return (
    <div className="text-center">
      <div className="text-sm text-muted">{L('Listen and type the word', 'Nghe và gõ lại từ')}</div>
      <button
        onClick={() => void speak(item.word)}
        className="mx-auto mt-4 flex size-20 items-center justify-center rounded-full bg-accent-gradient text-accent-ink shadow-card transition hover:brightness-110"
        aria-label={L('Play the word', 'Phát âm từ')}
      >
        <Volume2 className="size-9" />
      </button>
      {item.meaningVi && <p className="mt-4 text-sm text-muted">{L('Meaning', 'Nghĩa')}: {item.meaningVi}</p>}
      <div className="mt-2 h-6 font-mono text-sm tracking-widest text-faint">{hint && letterHint(item.word)}</div>
      <div className="mx-auto mt-2 flex max-w-sm gap-2">
        <Input
          ref={inputRef}
          value={value}
          disabled={answered}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && check()}
          autoComplete="off"
          spellCheck={false}
          aria-label={L('Your answer', 'Câu trả lời')}
          className="text-center text-lg"
          data-testid="practice-input"
        />
        <Button variant="primary" onClick={check} disabled={answered || !value.trim()}>
          {L('Check', 'Kiểm tra')}
        </Button>
      </div>
      {!answered && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setHint(true)} disabled={hint}>
          {L('Show a hint', 'Gợi ý')}
        </Button>
      )}
      {grade && <Feedback grade={grade} expected={item.word} />}
    </div>
  )
}

function ClozeRound({ item, cloze, onResult, answered }: { item: VocabItem; cloze: Cloze & { sentence: string }; onResult: (ok: boolean) => void; answered: boolean }) {
  const L = useL()
  const [value, setValue] = useState('')
  const [grade, setGrade] = useState<SpellingGrade | null>(null)
  const check = () => {
    if (answered || !value.trim()) return
    let g = gradeSpelling(cloze.answer, value)
    // The base form for an inflected gap ("run" for "running") is nearly right.
    if (g === 'wrong' && gradeSpelling(item.word, value) === 'correct') g = 'close'
    setGrade(g)
    onResult(g !== 'wrong')
  }
  return (
    <div>
      <div className="text-sm text-muted">{L('Fill the gap with the right word', 'Điền từ thích hợp vào chỗ trống')}</div>
      <p className="mt-4 text-xl leading-relaxed">
        {cloze.before}
        <span className={cx('mx-1 inline-block min-w-24 border-b-2 px-1 text-center font-semibold', grade ? (grade === 'wrong' ? 'border-danger text-danger' : 'border-success text-success') : 'border-accent')}>
          {grade ? cloze.answer : ' '}
        </span>
        {cloze.after}
      </p>
      <p className="mt-3 text-sm text-muted">
        {L('Hint', 'Gợi ý')}: {item.meaningVi || item.meaningEn} · {letterHint(cloze.answer).split(' ')[0]}…
      </p>
      <div className="mt-4 flex max-w-sm gap-2">
        <Input autoFocus value={value} disabled={answered} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} autoComplete="off" spellCheck={false} aria-label={L('Missing word', 'Từ còn thiếu')} data-testid="practice-input" />
        <Button variant="primary" onClick={check} disabled={answered || !value.trim()}>
          {L('Check', 'Kiểm tra')}
        </Button>
      </div>
      {grade && (
        <div className="flex items-center gap-2">
          <Feedback grade={grade} expected={cloze.answer} />
          <SpeakButton text={cloze.sentence} />
        </div>
      )}
    </div>
  )
}

function McqRound({ round, onResult }: { round: Extract<Round, { mcq: Mcq }>; onResult: (ok: boolean) => void }) {
  const L = useL()
  const [choice, setChoice] = useState<number | null>(null)
  const listening = round.mode === 'listening'
  useEffect(() => {
    if (listening) void speak(round.item.word)
  }, [listening, round.item.word])
  const question = {
    id: `practice-${round.item.id}`,
    type: 'mcq' as const,
    prompt: listening ? L('Which word did you hear?', 'Bạn vừa nghe từ nào?') : L(`What does “${round.item.word}” mean?`, `“${round.item.word}” nghĩa là gì?`),
    options: round.mcq.options,
    answerIndex: round.mcq.answerIndex,
    explanation: listening ? `${round.item.word}${round.item.meaningVi ? ` – ${round.item.meaningVi}` : ''}` : round.item.examples[0] ?? round.item.meaningEn,
  }
  return (
    <div>
      {listening && (
        <div className="mb-4 flex justify-center">
          <button
            onClick={() => void speak(round.item.word)}
            className="flex size-20 items-center justify-center rounded-full bg-accent-gradient text-accent-ink shadow-card transition hover:brightness-110"
            aria-label={L('Play again', 'Nghe lại')}
          >
            <Volume2 className="size-9" />
          </button>
        </div>
      )}
      <QuizQuestion
        q={question}
        answered={choice}
        onAnswer={(i, ok) => {
          if (choice !== null) return
          setChoice(i)
          onResult(ok)
        }}
      />
    </div>
  )
}
