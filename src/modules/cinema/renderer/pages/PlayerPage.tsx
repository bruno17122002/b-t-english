// Cinema player: cinematic stage with original backdrops, typewriter dialogue + TTS, subtitles, clickable
// words, expressions to save, choices with feedback, scene quizzes, endings, scene path and resume/replay.
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ChevronRight,
  Clapperboard,
  Film,
  Keyboard,
  Quote,
  RotateCcw,
  Route,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { permutation } from '@core/shuffle'
import type { CinemaStory, Scene } from '@shared/content'
import type { StoryProgress } from '@shared/types'
import {
  AiBadge,
  FavoriteButton,
  InteractiveText,
  QuizQuestion,
  SaveWordButton,
  SpeakButton,
} from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Kbd,
  LoadingBlock,
  Tabs,
  cx,
} from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'
import { speak, stopSpeaking } from '@/lib/audio'
import { useApp } from '@/lib/store'
import {
  initPlayer,
  playerReducer,
  sceneById,
  type AdvanceResult,
  type PlayerAction,
  type PlayerState,
} from '../../contract'
import { Backdrop } from '../components/Backdrop'
import { genreMeta } from '../components/genre'

type Subs = 'en' | 'both' | 'off'

function usePref<T extends string | boolean>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* preferences are best effort */
      }
    },
    [key],
  )
  return [value, set]
}

export default function PlayerPage() {
  const { id = '' } = useParams()
  const L = useL()
  const navigate = useNavigate()
  const detail = useApi('cinema:story', { id }, [id])
  const [progress, setProgress] = useState<StoryProgress | null>(null)
  const [startError, setStartError] = useState<ApiError | null>(null)

  useEffect(() => {
    if (!detail.data) return
    let alive = true
    setProgress(null)
    api('cinema:start', { id })
      .then((p) => alive && setProgress(p))
      .catch((err) => alive && setStartError(toApiError(err)))
    return () => {
      alive = false
    }
  }, [detail.data, id])

  useEffect(() => () => stopSpeaking(), [])

  const error = detail.error ?? startError
  return (
    <div data-testid="page-cinema">
      <button
        onClick={() => navigate('/cinema')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-text"
      >
        <ArrowLeft className="size-4" /> {L('Cinema library', 'Thư viện phim')}
      </button>
      {error ? (
        error.code === 'not_found' ? (
          <EmptyState
            icon={<Film />}
            title={L('Film not found', 'Không tìm thấy phim')}
            action={<Button onClick={() => navigate('/cinema')}>{L('Back to the library', 'Về thư viện')}</Button>}
          />
        ) : (
          <ErrorState error={error} onRetry={() => void detail.reload()} />
        )
      ) : !detail.data || !progress ? (
        <LoadingBlock rows={4} />
      ) : (
        <Player key={detail.data.story.id} story={detail.data.story} source={detail.data.source} initial={progress} />
      )}
    </div>
  )
}

const QUALITY = {
  great: { tone: 'success', en: 'Great choice!', vi: 'Lựa chọn tuyệt vời!' },
  ok: { tone: 'warning', en: 'OK – but could be better', vi: 'Tạm ổn – có thể tốt hơn' },
  awkward: { tone: 'danger', en: 'Awkward', vi: 'Chưa khéo' },
} as const

const ENDING = {
  good: { en: 'Good ending', vi: 'Kết có hậu', color: '#4ade80' },
  neutral: { en: 'Neutral ending', vi: 'Kết bình thường', color: '#fbbf24' },
  bad: { en: 'Bad ending', vi: 'Kết chưa vui', color: '#f87171' },
} as const

function Player({ story, source, initial }: { story: CinemaStory; source: 'builtin' | 'ai'; initial: StoryProgress }) {
  const L = useL()
  const navigate = useNavigate()
  const reduceMotion = useApp((s) => s.settings?.reduceMotion ?? false)
  const reducer = useCallback((s: PlayerState, a: PlayerAction) => playerReducer(story, s, a), [story])
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initPlayer(story, initial.currentSceneId, initial.path, !!initial.completedAt),
  )
  const [progress, setProgress] = useState(initial)
  const [endResult, setEndResult] = useState<AdvanceResult | null>(null)
  const [syncError, setSyncError] = useState<ApiError | null>(null)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [subs, setSubs] = usePref<Subs>('lq.cinema.subs', 'both')
  const [voice, setVoice] = usePref<boolean>('lq.cinema.voice', true)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const synced = useRef(0)
  const quizRef = useRef<HTMLDivElement>(null)

  const scene = sceneById(story, state.sceneId) as Scene
  const line = scene.lines[state.lineIndex]
  const characters = useMemo(() => new Map(story.characters.map((c) => [c.id, c])), [story])
  const speaker = line && line.characterId !== 'narrator' ? characters.get(line.characterId) : undefined
  // Choices and quiz questions are shown in a random order per visit (the best reply is not always first);
  // dispatched indexes stay the scene's own indexes.
  const choiceOrder = useMemo(() => permutation(scene.choice?.options.length ?? 0), [scene])
  const quizOrder = useMemo(() => permutation(scene.quiz?.length ?? 0), [scene])

  // ---------- typewriter ----------
  const lineKey = `${state.sceneId}:${state.lineIndex}`
  const full = line?.text ?? ''
  const [typing, setTyping] = useState({ key: '', n: 0 })
  const typed = reduceMotion ? full.length : typing.key === lineKey ? typing.n : 0
  const typingDone = typed >= full.length
  useEffect(() => {
    if (typingDone) return
    const t = setTimeout(() => setTyping({ key: lineKey, n: Math.min(full.length, typed + 2) }), 28)
    return () => clearTimeout(t)
  }, [typed, typingDone, lineKey, full.length])

  // ---------- voice ----------
  useEffect(() => {
    if (!voice || !line || state.phase !== 'lines') return
    void speak(line.text, { gender: speaker?.voiceGender })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, voice])

  // ---------- sync scene exits to main ----------
  useEffect(() => {
    const exit = state.lastExit
    if (!exit || exit.seq <= synced.current) return
    synced.current = exit.seq
    queue.current = queue.current.then(async () => {
      try {
        const res = await api('cinema:advance', {
          id: story.id,
          sceneId: exit.sceneId,
          optionIndex: exit.optionIndex,
          quizAnswers: exit.quizAnswers,
        })
        setProgress(res.progress)
        if (res.ending) setEndResult(res)
      } catch (err) {
        setSyncError(toApiError(err))
      }
    })
  }, [state.lastExit, story.id])

  const resync = async () => {
    setSyncError(null)
    try {
      const p = await api('cinema:start', { id: story.id })
      synced.current = 0
      setProgress(p)
      dispatch({ type: 'reset', sceneId: p.currentSceneId, path: p.path, completed: !!p.completedAt })
    } catch (err) {
      setSyncError(toApiError(err))
    }
  }

  const restart = async () => {
    setConfirmRestart(false)
    stopSpeaking()
    try {
      await queue.current
      const p = await api('cinema:start', { id: story.id, restart: true })
      synced.current = 0
      setEndResult(null)
      setSyncError(null)
      setProgress(p)
      dispatch({ type: 'reset', sceneId: p.currentSceneId, path: p.path })
    } catch (err) {
      setSyncError(toApiError(err))
    }
  }

  const advance = useCallback(() => {
    if (state.phase === 'lines' && !typingDone) {
      setTyping({ key: lineKey, n: full.length })
      return
    }
    if (state.phase === 'lines' || state.phase === 'feedback' || state.phase === 'quiz') dispatch({ type: 'next' })
  }, [state.phase, typingDone, lineKey, full.length])

  // Space / Enter = next line; 1–4 pick a choice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t?.closest?.('input, textarea, select, [contenteditable="true"]') ||
        document.querySelector('[role="dialog"]')
      )
        return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        advance()
      } else if (state.phase === 'choice' && /^[1-4]$/.test(e.key)) {
        const optionIndex = choiceOrder[Number(e.key) - 1]
        if (optionIndex !== undefined) dispatch({ type: 'choose', optionIndex })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, state.phase, choiceOrder])

  useEffect(() => {
    if (state.phase === 'quiz')
      quizRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
  }, [state.phase, reduceMotion])

  const presentIds = [...new Set(scene.lines.map((l) => l.characterId).filter((c) => c !== 'narrator'))]
  const chosen = state.choiceIndex !== null ? scene.choice?.options[state.choiceIndex] : undefined
  const ended = state.phase === 'ending'
  const sourceRef = `${story.id}#${scene.id}`
  const glossaryFor = (l: Scene['lines'][number]) =>
    (l.expressions ?? []).map((e) => ({ word: e.phrase, meaningVi: e.meaningVi, meaningEn: e.explanation }))
  const revealedCount = state.lineIndex + (subs === 'off' && !ended ? 0 : 1)
  const g = genreMeta(story.genre)

  // Expressions collected along the path so far (earlier scenes fully, current scene up to the revealed line).
  const expressions = useMemo(() => {
    const seen = new Set<string>()
    const out: { phrase: string; meaningVi: string; explanation: string; line: string }[] = []
    state.path.forEach((sid, i) => {
      const s = sceneById(story, sid)
      if (!s) return
      const lines = i === state.path.length - 1 ? s.lines.slice(0, state.lineIndex + 1) : s.lines
      for (const l of lines)
        for (const e of l.expressions ?? [])
          if (!seen.has(e.phrase.toLowerCase())) {
            seen.add(e.phrase.toLowerCase())
            out.push({ ...e, line: l.text })
          }
    })
    return out.reverse()
  }, [story, state.path, state.lineIndex])

  return (
    <div data-testid="cinema-player">
      {/* title bar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: g.from }}>
            <Clapperboard className="size-4" /> {L(g.en, g.vi)}
            <CefrBadge level={story.cefr} />
            {source === 'ai' && <AiBadge estimated={false} />}
          </div>
          <h1 className="truncate font-display text-2xl font-semibold">{story.title}</h1>
        </div>
        <Tabs<Subs>
          value={subs}
          onChange={setSubs}
          items={[
            { value: 'en', label: 'EN' },
            { value: 'both', label: 'EN + VI' },
            { value: 'off', label: L('Off', 'Tắt') },
          ]}
        />
        <IconButton
          label={voice ? L('Mute voices', 'Tắt giọng đọc') : L('Read lines aloud', 'Bật giọng đọc')}
          onClick={() => (voice ? (stopSpeaking(), setVoice(false)) : setVoice(true))}
          data-testid="cinema-voice"
        >
          {voice ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
        </IconButton>
        <FavoriteButton kind="story" refId={story.id} title={story.title} />
        <Button
          size="sm"
          variant="secondary"
          icon={<RotateCcw className="size-4" />}
          onClick={() => (progress.path.length > 1 && !ended ? setConfirmRestart(true) : void restart())}
          data-testid="cinema-restart"
        >
          {L('From the start', 'Xem từ đầu')}
        </Button>
      </div>

      {syncError && (
        <div className="mb-3">
          <ErrorState error={syncError} onRetry={resync} compact />
        </div>
      )}

      {/* stage */}
      <div
        className="relative aspect-video w-full cursor-pointer select-none"
        onClick={advance}
        data-testid="cinema-stage"
      >
        <div className="absolute inset-0 overflow-hidden rounded-2xl bg-black shadow-card">
          <AnimatePresence initial={false}>
            <motion.div
              key={scene.id}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.7 }}
            >
              <Backdrop backdrop={scene.backdrop} mood={scene.mood} still={reduceMotion} />
            </motion.div>
          </AnimatePresence>
          <div className="absolute inset-x-0 top-0 flex h-[9%] items-center justify-between bg-black px-5 text-[11px] text-white/70">
            <span className="truncate">{scene.title}</span>
            <span>
              {L('Scene', 'Cảnh')} {state.path.length}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[9%] bg-black" />
        </div>

        {/* cast */}
        <div className="absolute top-[12%] left-4 flex flex-wrap gap-2">
          {presentIds.map((cid) => {
            const c = characters.get(cid)
            if (!c) return null
            const active = line?.characterId === cid && state.phase === 'lines'
            return (
              <motion.span
                key={cid}
                animate={{ scale: active ? 1.08 : 1, opacity: active || state.phase !== 'lines' ? 1 : 0.65 }}
                className="flex items-center gap-1.5 rounded-full bg-black/55 py-1 pr-3 pl-1 text-xs font-semibold text-white"
                style={{ boxShadow: active ? `0 0 0 2px ${c.color}` : undefined }}
                title={c.role}
              >
                <span
                  className="flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-black"
                  style={{ background: c.color }}
                >
                  {c.name.slice(0, 1)}
                </span>
                {c.name}
              </motion.span>
            )
          })}
        </div>

        {/* dialogue box */}
        {line && !ended && state.phase !== 'choice' && (
          <motion.div
            key={lineKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-x-[4%] bottom-[12%] rounded-2xl bg-black/70 p-4 text-white shadow-2xl md:p-5"
            data-testid="cinema-line"
          >
            <div
              className="mb-1 flex items-center gap-2 text-sm font-bold"
              style={{ color: speaker?.color ?? '#cbd5e1' }}
            >
              {speaker ? speaker.name : <span className="italic">{L('Narrator', 'Người dẫn chuyện')}</span>}
              <span className="ml-auto flex items-center gap-1 text-white/60" onClick={(e) => e.stopPropagation()}>
                <SpeakButton text={line.text} gender={speaker?.voiceGender} />
              </span>
            </div>
            {subs === 'off' ? (
              <p className="text-base text-white/60 italic md:text-lg">
                <Volume2 className="mr-1 inline size-4" />
                {L('Subtitles off – listen carefully…', 'Đã tắt phụ đề – hãy nghe kỹ…')}
              </p>
            ) : (
              <p className={cx('min-h-[1.75em] text-lg leading-snug md:text-xl', !speaker && 'text-white/85 italic')}>
                {typingDone ? (
                  <span onClick={(e) => e.stopPropagation()} className="cursor-text">
                    <InteractiveText
                      text={line.text}
                      sourceModule="cinema"
                      sourceRef={sourceRef}
                      glossary={glossaryFor(line)}
                    />
                  </span>
                ) : (
                  <>
                    {full.slice(0, typed)}
                    <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-white/80 align-middle" />
                  </>
                )}
              </p>
            )}
            {subs === 'both' && typingDone && <p className="mt-1 text-sm text-white/65">{line.translationVi}</p>}
            {state.phase === 'lines' && (
              <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-white/45">
                <Kbd>Space</Kbd> {L('next', 'tiếp')}
                <ChevronRight className="size-3.5 animate-pulse" />
              </div>
            )}
          </motion.div>
        )}

        {/* quiz hint */}
        {state.phase === 'quiz' && (
          <div className="absolute inset-x-0 top-[12%] flex justify-center">
            <span className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink shadow-lg">
              {L('Quick check – answer below ↓', 'Kiểm tra nhanh – trả lời bên dưới ↓')}
            </span>
          </div>
        )}

        {/* choice */}
        <AnimatePresence>
          {state.phase === 'choice' && scene.choice && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/60 p-[5%]"
              onClick={(e) => e.stopPropagation()}
              data-testid="cinema-choice"
            >
              <p className="mb-1 text-center font-display text-xl font-semibold text-white md:text-2xl">
                {scene.choice.prompt}
              </p>
              {choiceOrder.map((optionIndex, i) => {
                const o = scene.choice?.options[optionIndex]
                if (!o) return null
                return (
                  <motion.div
                    key={optionIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className="flex w-full max-w-2xl items-center gap-2"
                  >
                    <button
                      onClick={() => dispatch({ type: 'choose', optionIndex })}
                      className="flex flex-1 items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-left text-white transition hover:border-white/50 hover:bg-white/20"
                      data-testid={`cinema-option-${i}`}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15 text-sm font-bold">
                        {i + 1}
                      </span>
                      <span className="flex-1">“{o.text}”</span>
                    </button>
                    <span className="text-white/70">
                      <SpeakButton text={o.text} />
                    </span>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* choice feedback */}
        {state.phase === 'feedback' && chosen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-x-[4%] top-[12%] rounded-2xl bg-black/75 p-4 text-white shadow-2xl"
            data-testid="cinema-feedback"
          >
            <div className="flex items-center gap-2">
              <Badge tone={QUALITY[chosen.quality].tone}>
                {L(QUALITY[chosen.quality].en, QUALITY[chosen.quality].vi)}
              </Badge>
              <span className="truncate text-sm text-white/80">“{chosen.text}”</span>
            </div>
            <p className="mt-2 text-sm text-white/85">{chosen.feedbackVi}</p>
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-white/50">
              <Kbd>Space</Kbd> {L('continue', 'tiếp tục')}
            </div>
          </motion.div>
        )}

        {/* ending */}
        <AnimatePresence>
          {ended && scene.ending && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.8 }}
              className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/75 p-[5%] text-center text-white"
              onClick={(e) => e.stopPropagation()}
              data-testid="cinema-ending"
            >
              <div className="max-w-2xl">
                <div className="font-display text-4xl font-semibold tracking-[0.2em] md:text-5xl">
                  {L('THE END', 'HẾT PHIM')}
                </div>
                <div
                  className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold text-black"
                  style={{ background: ENDING[scene.ending.type].color }}
                >
                  <Trophy className="size-4" /> {L(ENDING[scene.ending.type].en, ENDING[scene.ending.type].vi)}
                </div>
                <p className="mt-4 text-lg">{scene.ending.summaryEn}</p>
                <p className="mt-1 text-sm text-white/70">{scene.ending.summaryVi}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm text-white/80">
                  {progress.quizTotal > 0 && (
                    <span>
                      {L('Quiz', 'Câu hỏi')}:{' '}
                      <strong>
                        {progress.quizCorrect}/{progress.quizTotal}
                      </strong>
                    </span>
                  )}
                  {progress.choices.length > 0 && (
                    <span>
                      {L('Great choices', 'Lựa chọn hay')}:{' '}
                      <strong>
                        {progress.choices.filter((c) => c.quality === 'great').length}/{progress.choices.length}
                      </strong>
                    </span>
                  )}
                  {endResult && (
                    <span className="text-accent">
                      <Sparkles className="mr-1 inline size-4" />+
                      {endResult.sceneReward.xpGained + (endResult.storyReward?.xpGained ?? 0)} XP
                    </span>
                  )}
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    icon={<RotateCcw className="size-4" />}
                    onClick={() => void restart()}
                    data-testid="cinema-replay"
                  >
                    {scene.ending.type === 'good'
                      ? L('Watch again', 'Xem lại')
                      : L('Try for a better ending', 'Thử tìm kết tốt hơn')}
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/cinema')}>
                    {L('More films', 'Phim khác')}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-faint">
        <Keyboard className="size-3.5" />{' '}
        {L(
          'Space / Enter: next line · 1–4: choose · click a word to look it up',
          'Space / Enter: câu tiếp · 1–4: chọn · bấm vào từ để tra',
        )}
      </div>

      {/* quiz */}
      {state.phase === 'quiz' && scene.quiz && (
        <div ref={quizRef} className="mt-5" data-testid="cinema-quiz">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-muted">
              {L('Did you follow the scene?', 'Bạn có theo kịp cảnh phim?')}
            </h3>
            <div className="space-y-3">
              {quizOrder.map((qi, shown) => {
                const q = scene.quiz?.[qi]
                if (!q) return null
                return (
                  <QuizQuestion
                    key={q.id}
                    q={q}
                    index={shown}
                    answered={state.quizAnswers[qi]}
                    onAnswer={(choice) => dispatch({ type: 'answer', index: qi, choice })}
                  />
                )
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                disabled={state.quizAnswers.some((a) => a === null)}
                onClick={() => dispatch({ type: 'next' })}
                icon={<ChevronRight className="size-4" />}
                data-testid="cinema-quiz-continue"
              >
                {L('Continue the film', 'Xem tiếp')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
            <Quote className="size-4" /> {L('Scene script', 'Lời thoại cảnh này')}
          </h3>
          <div className="space-y-2.5" data-testid="cinema-transcript">
            {scene.lines.slice(0, Math.max(0, revealedCount)).map((l, i) => {
              const c = l.characterId !== 'narrator' ? characters.get(l.characterId) : undefined
              return (
                <div
                  key={i}
                  className={cx(
                    'flex gap-2 text-sm',
                    i === state.lineIndex && !ended && 'rounded-lg bg-surface-2 p-1.5 -m-1.5',
                  )}
                >
                  <span className="w-20 shrink-0 truncate pt-0.5 text-xs font-bold" style={{ color: c?.color }}>
                    {c?.name ?? L('Narrator', 'Dẫn truyện')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cx(!c && 'text-muted italic')}>
                      <InteractiveText
                        text={l.text}
                        sourceModule="cinema"
                        sourceRef={sourceRef}
                        glossary={glossaryFor(l)}
                      />
                    </p>
                    {subs !== 'en' && <p className="text-xs text-faint">{l.translationVi}</p>}
                  </div>
                  <SpeakButton text={l.text} gender={c?.voiceGender} />
                </div>
              )
            })}
            {revealedCount === 0 && (
              <p className="text-sm text-faint">
                {L('Lines appear here after you hear them.', 'Lời thoại hiện ở đây sau khi bạn nghe.')}
              </p>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
              <Sparkles className="size-4" /> {L('Expressions', 'Cụm từ hay')}
            </h3>
            {expressions.length === 0 ? (
              <p className="text-sm text-faint">
                {L(
                  'Useful phrases from the film will collect here.',
                  'Các cụm từ hữu ích trong phim sẽ được gom ở đây.',
                )}
              </p>
            ) : (
              <div className="space-y-3" data-testid="cinema-expressions">
                {expressions.map((e) => (
                  <div key={e.phrase} className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{e.phrase}</div>
                        <div className="text-sm text-accent">{e.meaningVi}</div>
                      </div>
                      <div className="flex items-center">
                        <SpeakButton text={e.phrase} />
                        <SaveWordButton
                          compact
                          seed={{
                            word: e.phrase.slice(0, 80),
                            meaningVi: e.meaningVi,
                            meaningEn: e.explanation,
                            example: e.line,
                            context: e.line,
                            topic: 'cinema',
                          }}
                          sourceModule="cinema"
                          sourceRef={story.id}
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted">{e.explanation}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
              <Route className="size-4" /> {L('Your path', 'Hành trình của bạn')}
            </h3>
            <ol className="relative space-y-2 border-l border-line pl-4" data-testid="cinema-path">
              {state.path.map((sid, i) => {
                const s = sceneById(story, sid)
                const current = i === state.path.length - 1
                const choice = progress.choices.find((c) => c.sceneId === sid)
                return (
                  <li key={`${sid}-${i}`} className="relative text-sm">
                    <span
                      className={cx(
                        'absolute top-1.5 -left-[21px] size-2.5 rounded-full',
                        current ? 'bg-accent ring-4 ring-accent/20' : 'bg-line-strong',
                      )}
                    />
                    <span className={cx(current ? 'font-semibold' : 'text-muted')}>
                      {i + 1}. {s?.title ?? sid}
                    </span>
                    {choice && (
                      <Badge tone={QUALITY[choice.quality].tone} className="ml-2">
                        {L(QUALITY[choice.quality].en, QUALITY[choice.quality].vi)}
                      </Badge>
                    )}
                  </li>
                )
              })}
            </ol>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRestart}
        title={L('Start again from the beginning?', 'Xem lại từ đầu?')}
        body={L(
          'Your current path and choices will be reset. XP you already earned stays.',
          'Hành trình và lựa chọn hiện tại sẽ được đặt lại. XP đã nhận vẫn được giữ.',
        )}
        confirmLabel={L('Restart', 'Xem từ đầu')}
        onConfirm={() => void restart()}
        onCancel={() => setConfirmRestart(false)}
      />
    </div>
  )
}
