// Reader: comfortable typography, click-to-lookup words, highlights & notes, listening, timer → WPM,
// comprehension quiz, AI sentence explanations and a retelling exercise.
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  Flag,
  Gauge,
  Languages,
  Pause,
  Play,
  Trophy,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { permutation } from '@core/shuffle'
import type { Bookmark as BookmarkRow } from '@shared/types'
import {
  AiBadge,
  FavoriteButton,
  InteractiveText,
  QuizQuestion,
  SpeakButton,
  type WordSeed,
} from '@/components/learning'
import { Badge, Button, Card, CefrBadge, cx, ErrorState, IconButton, LoadingBlock, Tabs } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { api, toApiError, useAction, useApi } from '@/lib/api'
import { stopSpeaking } from '@/lib/audio'
import { useApp } from '@/lib/store'
import type { HighlightColor, PassageView, ReadingHighlight, ReadingResult, SentenceExplanation } from '../../contract'
import { ExplainModal, GlossaryPanel, NotesPanel, RetellPanel } from '../components/Panels'
import { READER_THEMES, ReaderSettingsBar, useReaderPrefs } from '../components/ReaderSettings'
import { HIGHLIGHT_CLASS, SelectionMenu, type TextSelection } from '../components/SelectionMenu'
import { CATEGORY_META, formatClock, splitParagraphs } from '../components/shared'
import { segmentByHighlights } from '../lib/highlights'

const LEVEL_WPM = { A1: 70, A2: 90, B1: 120, B2: 150, C1: 180, C2: 210 } as const

export default function ReaderPage() {
  const { id = '' } = useParams()
  const L = useL()
  const navigate = useNavigate()
  const view = useApi('reading:get', { id }, [id])
  if (view.error)
    return (
      <div data-testid="page-reading" className="mx-auto max-w-3xl space-y-4">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/reading')}>
          {L('Library', 'Thư viện')}
        </Button>
        <ErrorState error={view.error} onRetry={view.reload} />
      </div>
    )
  if (!view.data || view.data.passage.id !== id)
    return (
      <div data-testid="page-reading" className="mx-auto max-w-3xl">
        <LoadingBlock rows={6} />
      </div>
    )
  return <Reader key={id} view={view.data} />
}

type Phase = 'reading' | 'quiz' | 'done'

function Reader({ view }: { view: PassageView }) {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const toast = useApp((s) => s.toast)
  const refreshGame = useApp((s) => s.refreshGame)
  const { passage } = view
  const [prefs, updatePrefs] = useReaderPrefs()
  const paragraphs = useMemo(() => splitParagraphs(passage.body), [passage.body])
  const glossary: WordSeed[] = useMemo(
    () =>
      passage.glossary.map((g) => ({
        word: g.word,
        ipa: g.ipa,
        pos: g.pos,
        meaningVi: g.meaningVi,
        meaningEn: g.meaningEn,
        example: g.example,
        cefr: g.cefr,
      })),
    [passage.glossary],
  )
  const saved = useApi('reading:savedWords', undefined)
  const savedWords = useMemo(() => new Set(saved.data ?? []), [saved.data])
  const [highlights, setHighlights] = useState<ReadingHighlight[]>(view.highlights)
  const [bookmark, setBookmark] = useState<BookmarkRow | null>(null)
  const [side, setSide] = useState<'glossary' | 'notes'>('glossary')

  // ---------- timer ----------
  const [phase, setPhase] = useState<Phase>('reading')
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (phase !== 'reading' || paused) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') setElapsed((e) => e + 1)
    }, 1000)
    return () => window.clearInterval(t)
  }, [phase, paused])
  useEffect(() => () => stopSpeaking(), [])

  // ---------- bookmarks ----------
  useEffect(() => {
    api('library:bookmarks', { kind: 'reading', ref: passage.id }).then(
      (rows) => setBookmark(rows[0] ?? null),
      () => undefined,
    )
  }, [passage.id])
  const bookmarkParagraph = async (idx: number) => {
    try {
      const existing = await api('library:bookmarks', { kind: 'reading', ref: passage.id })
      for (const b of existing) await api('library:removeBookmark', { id: b.id })
      const rows = await api('library:addBookmark', {
        kind: 'reading',
        ref: passage.id,
        title: passage.title,
        note: '',
        position: `p${idx}`,
      })
      setBookmark(rows.find((b) => b.ref === passage.id) ?? null)
      toast({ kind: 'success', title: L(`Bookmarked paragraph ${idx + 1}`, `Đã đánh dấu đoạn ${idx + 1}`) })
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }
  const bookmarkIdx = bookmark ? Number(bookmark.position.replace(/^p/, '')) : -1
  const jumpTo = (idx: number) =>
    document.getElementById(`para-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  // ---------- selection → highlight / note / explain ----------
  const articleRef = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<TextSelection | null>(null)
  const onMouseUp = useCallback(() => {
    window.setTimeout(() => {
      const s = window.getSelection()
      const root = articleRef.current
      if (!s || s.rangeCount === 0 || !root || !s.anchorNode || !root.contains(s.anchorNode)) return
      const text = s.toString().replace(/\s+/g, ' ').trim()
      if (text.length < 2 || text.length > 2000) return
      const rect = s.getRangeAt(0).getBoundingClientRect()
      const box = root.getBoundingClientRect()
      const para = (s.anchorNode.parentElement?.closest('[data-para]') as HTMLElement | null)?.innerText ?? ''
      setSel({ text, context: para, x: rect.left - box.left + rect.width / 2, y: rect.top - box.top })
    }, 0)
  }, [])
  useEffect(() => {
    if (!sel) return
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest('[data-selection-menu]') && setSel(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [sel])

  const addHighlight = useAction(async (color: HighlightColor, note: string) => {
    if (!sel) return
    const h = await api('reading:addHighlight', { passageId: passage.id, text: sel.text, note, color })
    setHighlights((prev) => [...prev, h])
    setSel(null)
    window.getSelection()?.removeAllRanges()
    if (note) setSide('notes')
  })
  useEffect(() => {
    if (addHighlight.error) toast({ kind: 'error', title: addHighlight.error.message })
  }, [addHighlight.error, toast])

  const updateHighlight = async (hid: number, patch: { note?: string; color?: HighlightColor }) => {
    try {
      const h = await api('reading:updateHighlight', { id: hid, ...patch })
      setHighlights((prev) => prev.map((x) => (x.id === hid ? h : x)))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }
  const deleteHighlight = async (hid: number) => {
    try {
      await api('reading:deleteHighlight', { id: hid })
      setHighlights((prev) => prev.filter((x) => x.id !== hid))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }
  const jumpToHighlight = (h: ReadingHighlight) => {
    const idx = paragraphs.findIndex((p) => p.toLowerCase().includes(h.text.toLowerCase()))
    if (idx >= 0) jumpTo(idx)
  }

  const [explainOpen, setExplainOpen] = useState(false)
  const [explanation, setExplanation] = useState<SentenceExplanation | null>(null)
  const explain = useAction((sentence: string, context: string) =>
    api('reading:explainSentence', {
      passageId: passage.id,
      sentence: sentence.slice(0, 1200),
      context: context.slice(0, 3000),
    }),
  )
  const openExplain = async () => {
    if (!sel) return
    const { text, context } = sel
    setSel(null)
    setExplanation(null)
    setExplainOpen(true)
    const res = await explain.run(text, context)
    if (res) setExplanation(res)
  }

  // ---------- quiz ----------
  const [answers, setAnswers] = useState<(number | null)[]>(() => passage.questions.map(() => null))
  const [result, setResult] = useState<ReadingResult | null>(null)
  const complete = useAction(() =>
    api('reading:complete', {
      id: passage.id,
      seconds: Math.min(4 * 3600, Math.max(1, elapsed)),
      answers: answers.map((a) => (a === null ? -1 : a)),
    }),
  )
  const allAnswered = answers.every((a) => a !== null)
  // Questions are shown in a random order per visit; `answers` stays in the passage's own order for scoring.
  const questionOrder = useMemo(() => permutation(passage.questions.length), [passage.questions])
  const finishReading = () => {
    setPhase('quiz')
    window.setTimeout(
      () => document.getElementById('reading-quiz')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    )
  }
  const submitQuiz = async () => {
    const res = await complete.run()
    if (!res) return
    setResult(res)
    setPhase('done')
    void refreshGame()
  }

  const segmentsByParagraph = useMemo(
    () => paragraphs.map((p) => segmentByHighlights(p, highlights)),
    [paragraphs, highlights],
  )
  const highlightById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights])
  const themeStyle = READER_THEMES[prefs.theme]
  const textStyle = { fontSize: `${prefs.fontSize}px`, lineHeight: prefs.lineHeight }
  const correctCount = answers.filter((a, i) => a === passage.questions[i]?.answerIndex).length

  return (
    <div data-testid="page-reading" className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/reading')}>
          {L('Library', 'Thư viện')}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 px-2 py-1 text-sm tabular-nums"
            data-testid="reading-timer"
          >
            <Clock className="size-4 text-muted" />
            {formatClock(elapsed)}
            {phase === 'reading' && (
              <IconButton
                label={paused ? L('Resume timer', 'Tiếp tục bấm giờ') : L('Pause timer', 'Tạm dừng')}
                onClick={() => setPaused((p) => !p)}
                className="size-7"
              >
                {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </IconButton>
            )}
          </div>
          <ReaderSettingsBar prefs={prefs} update={updatePrefs} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <div
            style={themeStyle}
            className="relative rounded-3xl border border-line bg-surface px-6 py-8 text-text shadow-card sm:px-12"
            ref={articleRef}
            onMouseUp={onMouseUp}
          >
            <header className="mx-auto mb-6 max-w-[68ch]">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <CefrBadge level={passage.cefr} />
                <span>{tx(CATEGORY_META[passage.category])}</span>
                <span>·</span>
                <span>
                  {view.words} {L('words', 'từ')}
                </span>
                {view.source === 'ai' && <AiBadge estimated={false} />}
                {passage.topicTags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
              <div className="flex items-start justify-between gap-3">
                <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">{passage.title}</h1>
                <div className="flex shrink-0 items-center">
                  <SpeakButton text={passage.title} />
                  <FavoriteButton kind="reading" refId={passage.id} title={passage.title} />
                  <IconButton
                    label={
                      prefs.showSummary
                        ? L('Hide Vietnamese summary', 'Ẩn tóm tắt tiếng Việt')
                        : L('Show Vietnamese summary', 'Hiện tóm tắt tiếng Việt')
                    }
                    onClick={() => updatePrefs({ showSummary: !prefs.showSummary })}
                    className={prefs.showSummary ? 'text-accent' : undefined}
                    data-testid="reading-summary-toggle"
                  >
                    <Languages className="size-4" />
                  </IconButton>
                </div>
              </div>
              {prefs.showSummary && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-sm text-muted"
                  data-testid="reading-summary"
                >
                  <span className="font-semibold text-text">{L('Summary: ', 'Tóm tắt: ')}</span>
                  {passage.summaryVi}
                </motion.p>
              )}
              {bookmarkIdx >= 0 && bookmarkIdx < paragraphs.length && phase === 'reading' && (
                <button
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
                  onClick={() => jumpTo(bookmarkIdx)}
                >
                  <BookmarkCheck className="size-4" />{' '}
                  {L(`Continue from paragraph ${bookmarkIdx + 1}`, `Đọc tiếp từ đoạn ${bookmarkIdx + 1}`)}
                </button>
              )}
            </header>

            <article
              className={cx('mx-auto max-w-[68ch] space-y-5', prefs.serif ? 'font-display' : '')}
              style={textStyle}
              data-testid="reading-body"
            >
              {segmentsByParagraph.map((segments, idx) => (
                <div key={idx} id={`para-${idx}`} data-para={idx} className="group relative scroll-mt-24">
                  <div className="absolute top-0 -left-11 hidden flex-col opacity-0 transition group-hover:opacity-100 sm:flex">
                    <SpeakButton text={paragraphs[idx] ?? ''} label={L('Listen to paragraph', 'Nghe đoạn này')} />
                    <IconButton
                      label={L('Bookmark this paragraph', 'Đánh dấu đoạn này')}
                      onClick={() => void bookmarkParagraph(idx)}
                      className={bookmarkIdx === idx ? 'text-accent' : undefined}
                    >
                      {bookmarkIdx === idx ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                    </IconButton>
                  </div>
                  <p className="text-pretty">
                    {segments.map((seg, k) => {
                      const h = seg.highlightId !== null ? highlightById.get(seg.highlightId) : undefined
                      const inner = (
                        <InteractiveText
                          text={seg.text}
                          sourceModule="reading"
                          sourceRef={passage.id}
                          glossary={glossary}
                          savedWords={savedWords}
                        />
                      )
                      return h ? (
                        <mark
                          key={k}
                          title={h.note || undefined}
                          className={cx(
                            'rounded px-0.5 text-inherit box-decoration-clone',
                            HIGHLIGHT_CLASS[h.color],
                            h.note && 'underline decoration-dotted underline-offset-4',
                          )}
                        >
                          {inner}
                        </mark>
                      ) : (
                        <span key={k}>{inner}</span>
                      )
                    })}
                  </p>
                </div>
              ))}
            </article>
            {sel && (
              <SelectionMenu
                sel={sel}
                busy={addHighlight.pending}
                onHighlight={(c, n) => void addHighlight.run(c, n)}
                onExplain={() => void openExplain()}
              />
            )}

            {phase === 'reading' && (
              <div className="mx-auto mt-10 flex max-w-[68ch] flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
                <p className="text-sm text-muted">
                  {L(
                    'Tip: select text to highlight, add a note or ask AI to explain it.',
                    'Mẹo: bôi đen câu để đánh dấu, ghi chú hoặc nhờ AI giải thích.',
                  )}
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Flag className="size-4" />}
                  onClick={finishReading}
                  data-testid="reading-finish"
                >
                  {L("I've finished reading", 'Tôi đã đọc xong')}
                </Button>
              </div>
            )}
          </div>

          {phase !== 'reading' && (
            <section id="reading-quiz" className="scroll-mt-6 space-y-4" data-testid="reading-quiz">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-semibold">
                  {L('Check your understanding', 'Kiểm tra mức hiểu bài')}
                </h2>
                <span className="text-sm text-muted tabular-nums">
                  {answers.filter((a) => a !== null).length}/{passage.questions.length}
                </span>
              </div>
              {questionOrder.map((i, shown) => {
                const q = passage.questions[i]
                if (!q) return null
                return (
                  <QuizQuestion
                    key={q.id}
                    q={q}
                    index={shown}
                    answered={answers[i]}
                    onAnswer={(choice) =>
                      phase === 'quiz' && setAnswers((prev) => prev.map((a, k) => (k === i ? choice : a)))
                    }
                  />
                )
              })}
              {phase === 'quiz' && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {complete.error && <ErrorState error={complete.error} compact onRetry={submitQuiz} />}
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!allAnswered}
                    loading={complete.pending}
                    icon={<Trophy className="size-4" />}
                    onClick={submitQuiz}
                    data-testid="reading-submit-quiz"
                  >
                    {L('See my results', 'Xem kết quả')}
                  </Button>
                </div>
              )}
            </section>
          )}

          {result && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="border-accent/40" data-testid="reading-result">
                <div className="grid gap-4 sm:grid-cols-4">
                  <ResultStat
                    icon={<CheckCircle2 className="size-5 text-success" />}
                    label={L('Quiz', 'Câu hỏi')}
                    value={`${correctCount}/${passage.questions.length}`}
                    sub={`${Math.round(result.accuracy * 100)}%`}
                  />
                  <ResultStat
                    icon={<Gauge className="size-5 text-accent" />}
                    label={L('Speed', 'Tốc độ')}
                    value={`${result.entry.wpm} wpm`}
                    sub={
                      result.entry.wpm >= LEVEL_WPM[passage.cefr]
                        ? L(`On target for ${passage.cefr}`, `Đạt chuẩn ${passage.cefr}`)
                        : L(`Target ${LEVEL_WPM[passage.cefr]} wpm`, `Mục tiêu ${LEVEL_WPM[passage.cefr]} từ/phút`)
                    }
                  />
                  <ResultStat
                    icon={<Clock className="size-5 text-muted" />}
                    label={L('Time', 'Thời gian')}
                    value={formatClock(result.entry.seconds)}
                  />
                  <ResultStat
                    icon={<Trophy className="size-5 text-warning" />}
                    label="XP"
                    value={`+${result.reward.xpGained}`}
                    sub={L(
                      `Reading ${result.skill.cefr} · ${Math.round(result.skill.score)}%`,
                      `Kỹ năng đọc ${result.skill.cefr} · ${Math.round(result.skill.score)}%`,
                    )}
                  />
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => navigate('/reading')}>
                    {L('Choose another passage', 'Chọn bài khác')}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {phase === 'done' && <RetellPanel passageId={passage.id} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <Tabs<'glossary' | 'notes'>
            value={side}
            onChange={setSide}
            items={[
              { value: 'glossary', label: L('Key words', 'Từ khóa'), count: passage.glossary.length },
              { value: 'notes', label: L('Notes', 'Ghi chú'), count: highlights.length },
            ]}
          />
          {side === 'glossary' ? (
            <GlossaryPanel glossary={passage.glossary} passageId={passage.id} />
          ) : (
            <NotesPanel
              highlights={highlights}
              onUpdate={updateHighlight}
              onDelete={deleteHighlight}
              onJump={jumpToHighlight}
            />
          )}
          {view.history.length > 0 && (
            <Card className="p-4 text-sm">
              <div className="mb-2 text-xs font-semibold text-muted">
                {L('Your previous reads', 'Các lần đọc trước')}
              </div>
              <ul className="space-y-1 tabular-nums">
                {view.history.slice(0, 5).map((h) => (
                  <li key={h.id} className="flex justify-between text-muted">
                    <span>{h.wpm} wpm</span>
                    <span>
                      {h.quizCorrect}/{h.quizTotal}
                    </span>
                    <span>{formatClock(h.seconds)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <ExplainModal
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        loading={explain.pending}
        result={explanation}
        error={explain.error}
      />
    </div>
  )
}

function ResultStat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  )
}
