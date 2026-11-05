// Course lesson ('/journey/course/:lessonId'): grammar patterns, vocabulary, activities and practice links.
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Clapperboard,
  Ear,
  Layers,
  ListChecks,
  MessageCircle,
  Mic,
  PenLine,
  Puzzle,
  RotateCcw,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SpeakButton } from '@/components/learning'
import { Badge, Button, Card, CefrBadge, EmptyState, ErrorState, LoadingBlock, Section, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'

const ACTIVITY_LABELS: Record<string, { en: string; vi: string }> = {
  learn: { en: 'Learn new items', vi: 'Học nội dung mới' },
  translate: { en: 'Translate', vi: 'Dịch câu' },
  word_select: { en: 'Pick the word', vi: 'Chọn từ đúng' },
  match: { en: 'Match pairs', vi: 'Nối cặp' },
  word_bank: { en: 'Build the sentence', vi: 'Ghép câu' },
  fill_blank: { en: 'Fill in the blank', vi: 'Điền vào chỗ trống' },
  multiple_choice: { en: 'Multiple choice', vi: 'Trắc nghiệm' },
  listen_type: { en: 'Listen and type', vi: 'Nghe và gõ lại' },
  listen_select: { en: 'Listen and choose', vi: 'Nghe và chọn' },
  image_select: { en: 'Choose the picture', vi: 'Chọn hình' },
  sentence_complete: { en: 'Complete the sentence', vi: 'Hoàn thành câu' },
  error_correct: { en: 'Fix the mistake', vi: 'Sửa lỗi sai' },
  dialogue: { en: 'Dialogue', vi: 'Hội thoại' },
  speak: { en: 'Speak out loud', vi: 'Luyện nói' },
  story: { en: 'Mini story', vi: 'Truyện ngắn' },
  roleplay: { en: 'Role-play', vi: 'Nhập vai' },
  video_call: { en: 'Video call practice', vi: 'Gọi video luyện tập' },
}

/** Where the learner can practise each activity type in Lingua Quest. */
function practiceLinks(types: string[]) {
  const set = new Set(types)
  const links: { route: string; icon: typeof Ear; en: string; vi: string }[] = []
  if ([...set].some((t) => t.startsWith('listen')))
    links.push({ route: '/listening', icon: Ear, en: 'Listening Lab', vi: 'Phòng nghe' })
  if (set.has('speak')) links.push({ route: '/speaking', icon: Mic, en: 'Speaking practice', vi: 'Luyện nói' })
  if (set.has('dialogue') || set.has('roleplay') || set.has('video_call'))
    links.push({ route: '/tutor', icon: MessageCircle, en: 'Role-play with AI Tutor', vi: 'Nhập vai với gia sư AI' })
  if (set.has('story'))
    links.push({ route: '/cinema', icon: Clapperboard, en: 'Cinema stories', vi: 'Truyện điện ảnh' })
  if (set.has('translate') || set.has('sentence_complete') || set.has('error_correct'))
    links.push({ route: '/writing', icon: PenLine, en: 'Writing workshop', vi: 'Xưởng viết' })
  return links
}

/** Renders a grammar pattern with `{slot}` placeholders highlighted (plain text only, no HTML). */
function Pattern({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g).filter(Boolean)
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('{') && p.endsWith('}') ? (
          <span key={i} className="mx-0.5 rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent">
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  )
}

export default function CourseLessonPage() {
  const L = useL()
  const navigate = useNavigate()
  const { lessonId = '' } = useParams()
  const toast = useApp((s) => s.toast)
  const refreshGame = useApp((s) => s.refreshGame)
  const lesson = useApi('journey:courseLesson', lessonId ? { id: lessonId } : null, [lessonId])
  const [busy, setBusy] = useState<null | 'complete' | 'words'>(null)

  const setCompleted = async (completed: boolean) => {
    setBusy('complete')
    try {
      const res = await api('journey:courseComplete', { id: lessonId, completed })
      lesson.setData(res.lesson)
      if (res.reward) void refreshGame()
      if (completed && res.lesson.nextId)
        toast({
          kind: 'success',
          title: L('Lesson complete!', 'Hoàn thành bài học!'),
          action: { label: L('Next lesson', 'Bài tiếp theo'), route: `/journey/course/${res.lesson.nextId}` },
        })
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setBusy(null)
    }
  }

  const saveWords = async () => {
    setBusy('words')
    try {
      const res = await api('journey:courseSaveWords', { id: lessonId })
      lesson.setData(res.lesson)
      void refreshGame()
      toast({
        kind: 'success',
        title: L(`${res.saved} new words saved`, `Đã lưu ${res.saved} từ mới`),
        body: res.existing
          ? L(`${res.existing} were already in your word bank.`, `${res.existing} từ đã có trong kho từ.`)
          : undefined,
        action: { label: L('Word bank', 'Kho từ'), route: '/vocabulary' },
      })
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setBusy(null)
    }
  }

  const d = lesson.data
  return (
    <div data-testid="page-journey" className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate(d ? `/journey/course?level=${d.cefr}` : '/journey/course')}
        className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="size-4" /> {L('Course path', 'Lộ trình khóa học')}
      </button>
      {lesson.loading && !d ? (
        <LoadingBlock rows={5} />
      ) : lesson.error ? (
        <ErrorState error={lesson.error} onRetry={lesson.reload} />
      ) : !d ? (
        <EmptyState title={L('Lesson not found', 'Không tìm thấy bài học')} />
      ) : (
        <motion.div
          key={d.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="course-lesson"
        >
          <Card className="relative overflow-hidden p-6">
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <CefrBadge level={d.cefr} />
                <span>{d.levelTitle}</span>
                <span>·</span>
                <span>
                  {d.unit.icon} {d.unit.title}
                </span>
                <span>·</span>
                <span>
                  {L('Lesson', 'Bài')} {d.order}/{d.unit.lessonCount}
                </span>
              </div>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{d.title}</h1>
              {d.description && <p className="mt-1 text-muted">{d.description}</p>}
              <div className="mt-5 flex flex-wrap gap-2">
                {d.completed ? (
                  <>
                    <Badge tone="success" className="h-10 px-4 text-sm">
                      <CheckCircle2 className="size-4" /> {L('Completed', 'Đã hoàn thành')}
                    </Badge>
                    <Button
                      variant="ghost"
                      icon={<RotateCcw className="size-4" />}
                      loading={busy === 'complete'}
                      onClick={() => void setCompleted(false)}
                    >
                      {L('Mark as not done', 'Đánh dấu chưa học')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    icon={<Check className="size-4" />}
                    loading={busy === 'complete'}
                    onClick={() => void setCompleted(true)}
                    data-testid="course-complete"
                  >
                    {L('Mark lesson complete', 'Đánh dấu đã học xong')}
                  </Button>
                )}
                {d.nextId && (
                  <Button
                    icon={<ArrowRight className="size-4" />}
                    onClick={() => navigate(`/journey/course/${d.nextId}`)}
                  >
                    {L('Next lesson', 'Bài tiếp theo')}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Section title={L('Grammar focus', 'Trọng tâm ngữ pháp')}>
              <Card className="h-full">
                {d.grammar.length ? (
                  <ul className="space-y-2">
                    {d.grammar.map((g) => (
                      <li key={g} className="flex items-start gap-2 text-sm">
                        <Puzzle className="mt-0.5 size-4 shrink-0 text-accent" />
                        <Pattern text={g} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-faint">
                    {L('This lesson focuses on vocabulary and phrases.', 'Bài này tập trung vào từ vựng và cụm từ.')}
                  </p>
                )}
                {d.relatedGrammar.length > 0 && (
                  <div className="mt-4 border-t border-line pt-3">
                    <div className="mb-2 text-xs text-faint">
                      {L('Study it in Grammar Kingdom', 'Học kỹ hơn ở Vương quốc Ngữ pháp')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {d.relatedGrammar.map((g) => (
                        <Button
                          key={g.id}
                          size="sm"
                          onClick={() => navigate(`/grammar/${g.id}`)}
                          data-testid="course-related-grammar"
                        >
                          <CefrBadge level={g.cefr} /> {g.title}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </Section>

            <Section title={L('Activities', 'Hoạt động')}>
              <Card className="h-full">
                <ul className="space-y-2">
                  {d.activities.map((a, i) => (
                    <li key={`${a.type}-${i}`} className="flex items-start gap-2 text-sm">
                      <ListChecks className="mt-0.5 size-4 shrink-0 text-muted" />
                      <span className="flex-1">
                        {L(ACTIVITY_LABELS[a.type]?.en ?? a.type, ACTIVITY_LABELS[a.type]?.vi ?? a.type)}
                        {a.scenario && <span className="block text-xs text-faint">{a.scenario}</span>}
                      </span>
                      <span className="text-xs text-faint tabular-nums">×{a.count}</span>
                    </li>
                  ))}
                </ul>
                {practiceLinks(d.activities.map((a) => a.type)).length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                    {practiceLinks(d.activities.map((a) => a.type)).map((p) => (
                      <Button
                        key={p.route}
                        size="sm"
                        variant="ghost"
                        icon={<p.icon className="size-4" />}
                        onClick={() => navigate(p.route)}
                      >
                        {L(p.en, p.vi)}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            </Section>
          </div>

          <Section
            title={L('Vocabulary', 'Từ vựng')}
            className="mt-6"
            actions={
              d.vocabulary.length > 0 && (
                <Button
                  size="sm"
                  variant={d.vocabulary.every((w) => w.saved) ? 'ghost' : 'primary'}
                  icon={<BookmarkPlus className="size-4" />}
                  loading={busy === 'words'}
                  disabled={d.vocabulary.every((w) => w.saved)}
                  onClick={() => void saveWords()}
                  data-testid="course-save-words"
                >
                  {d.vocabulary.every((w) => w.saved)
                    ? L('All in word bank', 'Đã lưu hết')
                    : L('Save all to word bank', 'Lưu tất cả vào kho từ')}
                </Button>
              )
            }
          >
            {d.vocabulary.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.vocabulary.map((w) => (
                  <div
                    key={w.word}
                    className={cx(
                      'flex items-center gap-2 rounded-xl border bg-surface p-3',
                      w.saved ? 'border-success/25' : 'border-line',
                    )}
                  >
                    <SpeakButton text={w.word} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{w.word}</span>
                        {w.ipa && <span className="truncate font-mono text-xs text-faint">{w.ipa}</span>}
                      </div>
                      {w.meaningVi && <div className="truncate text-xs text-muted">{w.meaningVi}</div>}
                    </div>
                    {w.saved && (
                      <Layers
                        className="size-4 shrink-0 text-success"
                        aria-label={L('In word bank', 'Đã có trong kho từ')}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-faint">
                {L('No word list for this lesson.', 'Bài này không có danh sách từ.')}
              </p>
            )}
          </Section>

          <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
            <Button
              variant="ghost"
              disabled={!d.prevId}
              icon={<ArrowLeft className="size-4" />}
              onClick={() => d.prevId && navigate(`/journey/course/${d.prevId}`)}
            >
              {L('Previous', 'Bài trước')}
            </Button>
            <span className="text-xs text-faint">
              {L('Course outline adapted from Sprigo (MIT)', 'Đề cương khóa học phỏng theo Sprigo (MIT)')}
            </span>
            <Button
              variant="ghost"
              disabled={!d.nextId}
              onClick={() => d.nextId && navigate(`/journey/course/${d.nextId}`)}
            >
              {L('Next', 'Bài sau')} <ArrowRight className="size-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
