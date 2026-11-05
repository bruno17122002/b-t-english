// Onboarding wizard ('/onboarding', full screen): profile, goals, interests, schedule, optional AI, placement.
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Compass,
  KeyRound,
  Rocket,
  SkipForward,
  Sparkles,
  WifiOff,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Cefr } from '@shared/content'
import type { LearningStyle, SelfLevel } from '@shared/types'
import { Badge, Button, CefrBadge, ErrorState, Input, Select, cx } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import { THEMES, session, type Bi } from '../shared'

interface Draft {
  displayName: string
  selfReportedLevel: SelfLevel
  purposes: string[]
  targetCefr: Cefr
  targetIelts: number | null
  interests: string[]
  dailyMinutes: number
  learningStyle: LearningStyle
}

const STORAGE_KEY = 'lq.journey.onboarding'
const STEPS = ['welcome', 'name', 'level', 'goals', 'interests', 'schedule', 'ai', 'placement'] as const
type Step = (typeof STEPS)[number]

const LEVELS: { key: SelfLevel; cefr: Cefr; label: Bi; desc: Bi }[] = [
  {
    key: 'beginner',
    cefr: 'A1',
    label: { en: 'Beginner', vi: 'Mới bắt đầu' },
    desc: { en: 'I know only a few words.', vi: 'Tôi gần như chưa biết gì, chỉ biết vài từ đơn giản.' },
  },
  {
    key: 'elementary',
    cefr: 'A2',
    label: { en: 'Elementary', vi: 'Sơ cấp' },
    desc: {
      en: 'I can introduce myself and handle simple situations.',
      vi: 'Tôi giới thiệu được bản thân và xử lý tình huống đơn giản.',
    },
  },
  {
    key: 'intermediate',
    cefr: 'B1',
    label: { en: 'Intermediate', vi: 'Trung cấp' },
    desc: {
      en: 'I can talk about everyday topics but make mistakes.',
      vi: 'Tôi nói được các chủ đề hằng ngày nhưng còn hay sai.',
    },
  },
  {
    key: 'upper',
    cefr: 'B2',
    label: { en: 'Upper intermediate', vi: 'Trung cao cấp' },
    desc: {
      en: 'I can discuss many topics and understand most films.',
      vi: 'Tôi thảo luận được nhiều chủ đề, xem phim hiểu phần lớn.',
    },
  },
  {
    key: 'advanced',
    cefr: 'C1',
    label: { en: 'Advanced', vi: 'Cao cấp' },
    desc: {
      en: 'I use English fluently at work or university.',
      vi: 'Tôi dùng tiếng Anh trôi chảy trong công việc hoặc học thuật.',
    },
  },
]

const PURPOSES: { key: string; label: Bi; emoji: string }[] = [
  { key: 'ielts', label: { en: 'IELTS exam', vi: 'Thi IELTS' }, emoji: '🎯' },
  { key: 'work', label: { en: 'Work & career', vi: 'Công việc' }, emoji: '💼' },
  { key: 'travel', label: { en: 'Travel', vi: 'Du lịch' }, emoji: '✈️' },
  { key: 'study-abroad', label: { en: 'Study abroad', vi: 'Du học' }, emoji: '🎓' },
  { key: 'communication', label: { en: 'Everyday conversation', vi: 'Giao tiếp' }, emoji: '💬' },
  { key: 'entertainment', label: { en: 'Movies, music, games', vi: 'Giải trí' }, emoji: '🎬' },
  { key: 'self-growth', label: { en: 'Personal growth', vi: 'Phát triển bản thân' }, emoji: '🌱' },
  { key: 'kids', label: { en: 'Help my children', vi: 'Dạy con' }, emoji: '👨‍👩‍👧' },
]

const STYLES: { key: LearningStyle; label: Bi; desc: Bi }[] = [
  { key: 'mixed', label: { en: 'Mixed', vi: 'Kết hợp' }, desc: { en: 'A bit of everything', vi: 'Mỗi thứ một chút' } },
  {
    key: 'visual',
    label: { en: 'Visual', vi: 'Hình ảnh' },
    desc: { en: 'Charts, colours, stories', vi: 'Hình, màu sắc, câu chuyện' },
  },
  {
    key: 'auditory',
    label: { en: 'Listening', vi: 'Nghe' },
    desc: { en: 'Audio, dialogues, shadowing', vi: 'Nghe, hội thoại, nhại giọng' },
  },
  {
    key: 'reading',
    label: { en: 'Reading & writing', vi: 'Đọc & viết' },
    desc: { en: 'Texts and notes', vi: 'Văn bản và ghi chép' },
  },
  {
    key: 'kinesthetic',
    label: { en: 'Hands-on', vi: 'Thực hành' },
    desc: { en: 'Games, role-play, doing', vi: 'Trò chơi, nhập vai, làm thật' },
  },
]

const MINUTES = [10, 20, 30, 45, 60]
const IELTS_BANDS = [4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8]

export default function OnboardingPage() {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const profile = useApp((s) => s.profile)
  const setProfile = useApp((s) => s.setProfile)
  const saved = session.get<{ step: number; draft: Draft }>(STORAGE_KEY)
  const [step, setStep] = useState(saved?.step ?? 0)
  const [dir, setDir] = useState(1)
  const [draft, setDraft] = useState<Draft>(
    saved?.draft ?? {
      displayName: profile?.displayName ?? '',
      selfReportedLevel: profile?.selfReportedLevel ?? 'beginner',
      purposes: profile?.purposes.length ? profile.purposes : ['ielts'],
      targetCefr: profile?.targetCefr ?? 'B2',
      targetIelts: profile?.targetIelts ?? 6.5,
      interests: profile?.interests ?? [],
      dailyMinutes: profile?.dailyMinutes ?? 20,
      learningStyle: profile?.learningStyle ?? 'mixed',
    },
  )
  const [saving, setSaving] = useState<null | 'test' | 'skip'>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const ai = useApi('ai:config', undefined)

  useEffect(() => session.set(STORAGE_KEY, { step, draft }), [step, draft])

  const current: Step = STEPS[step] ?? 'welcome'
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const toggle = (key: 'purposes' | 'interests', value: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(value) ? d[key].filter((x) => x !== value) : [...d[key], value] }))

  const canNext =
    current === 'name'
      ? draft.displayName.trim().length > 0
      : current === 'goals'
        ? draft.purposes.length > 0
        : current === 'interests'
          ? draft.interests.length > 0
          : true
  const go = (delta: number) => {
    setDir(delta)
    setStep((s) => Math.max(0, Math.min(STEPS.length - 1, s + delta)))
  }

  const profilePatch = () => ({
    displayName: draft.displayName.trim().slice(0, 60),
    selfReportedLevel: draft.selfReportedLevel,
    purposes: draft.purposes,
    targetCefr: draft.targetCefr,
    targetIelts: draft.targetIelts,
    interests: draft.interests,
    dailyMinutes: draft.dailyMinutes,
    learningStyle: draft.learningStyle,
  })

  const openAiSettings = async () => {
    // Persist what we have so the learner can come back after configuring a key.
    try {
      setProfile(await api('learner:updateProfile', profilePatch()))
    } catch {
      /* the draft is also kept in session storage */
    }
    navigate('/settings/ai')
  }

  const finish = async (takeTest: boolean) => {
    setSaving(takeTest ? 'test' : 'skip')
    setError(null)
    try {
      await api('learner:updateProfile', profilePatch())
      if (!takeTest) await api('journey:placementSkip')
      const p = await api('learner:updateProfile', { onboardingCompleted: true })
      session.remove(STORAGE_KEY)
      setProfile(p)
      navigate(takeTest ? '/assessment' : '/journey?generate=1', { replace: true })
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setSaving(null)
    }
  }

  const aiReady = !!ai.data && (ai.data.providers.gemini.hasKey || ai.data.providers.openai.hasKey || ai.data.mockMode)

  return (
    <div data-testid="page-journey" className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />
      {/* progress */}
      <header className="relative flex items-center justify-between px-8 pt-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent-gradient text-accent-ink">
            <Sparkles className="size-5" />
          </div>
          <span className="font-display text-lg font-semibold">
            Lingua <span className="text-gradient">Quest</span>
          </span>
        </div>
        <div
          className="flex items-center gap-1.5"
          aria-label={L(`Step ${step + 1} of ${STEPS.length}`, `Bước ${step + 1}/${STEPS.length}`)}
        >
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cx(
                'h-1.5 rounded-full transition-all duration-300',
                i === step ? 'w-8 bg-accent' : i < step ? 'w-4 bg-accent/60' : 'w-4 bg-surface-3',
              )}
            />
          ))}
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={current}
            custom={dir}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-full max-w-2xl"
          >
            {current === 'welcome' && (
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0.6, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 12 }}
                  className="mx-auto mb-6 flex size-20 items-center justify-center rounded-3xl bg-accent-gradient text-accent-ink shadow-[0_20px_60px_-20px_var(--accent)]"
                >
                  <Rocket className="size-10" />
                </motion.div>
                <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
                  {L('Your English adventure', 'Hành trình tiếng Anh')}{' '}
                  <span className="text-gradient">{L('starts here', 'bắt đầu từ đây')}</span>
                </h1>
                <p className="mx-auto mt-4 max-w-lg text-muted">
                  {L(
                    'From your very first word to IELTS 6.5 (B2). Answer a few questions and we will build a plan that fits you – it takes about 2 minutes.',
                    'Từ những từ đầu tiên đến IELTS 6.5 (B2). Trả lời vài câu hỏi để chúng mình thiết kế lộ trình phù hợp với bạn – chỉ mất khoảng 2 phút.',
                  )}
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className="mt-8"
                  onClick={() => go(1)}
                  data-testid="onboarding-start"
                  icon={<ArrowRight className="size-5" />}
                >
                  {L("Let's go", 'Bắt đầu nào')}
                </Button>
              </div>
            )}

            {current === 'name' && (
              <StepFrame
                title={L('What should we call you?', 'Chúng mình nên gọi bạn là gì?')}
                subtitle={L('Only shown inside the app.', 'Chỉ hiển thị trong ứng dụng.')}
              >
                <Input
                  autoFocus
                  value={draft.displayName}
                  maxLength={60}
                  placeholder={L('Your name or nickname', 'Tên hoặc biệt danh của bạn')}
                  className="h-14 text-lg"
                  onChange={(e) => patch({ displayName: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && canNext && go(1)}
                  data-testid="onboarding-name"
                />
              </StepFrame>
            )}

            {current === 'level' && (
              <StepFrame
                title={L('How is your English now?', 'Tiếng Anh của bạn hiện tại thế nào?')}
                subtitle={L(
                  'A rough guess is fine – the placement test will fine-tune it.',
                  'Ước lượng sơ bộ là được – bài kiểm tra sẽ xác định chính xác hơn.',
                )}
              >
                <div className="space-y-2">
                  {LEVELS.map((lv) => (
                    <ChoiceCard
                      key={lv.key}
                      selected={draft.selfReportedLevel === lv.key}
                      onClick={() => patch({ selfReportedLevel: lv.key })}
                      testId={`level-${lv.key}`}
                    >
                      <CefrBadge level={lv.cefr} className="text-sm" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{tx(lv.label)}</div>
                        <div className="text-sm text-muted">{lv.desc.vi}</div>
                        <div className="text-xs text-faint">{lv.desc.en}</div>
                      </div>
                    </ChoiceCard>
                  ))}
                </div>
              </StepFrame>
            )}

            {current === 'goals' && (
              <StepFrame
                title={L('Why are you learning English?', 'Bạn học tiếng Anh để làm gì?')}
                subtitle={L('Choose all that apply.', 'Chọn tất cả lựa chọn phù hợp.')}
              >
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {PURPOSES.map((p) => (
                    <Chip
                      key={p.key}
                      selected={draft.purposes.includes(p.key)}
                      onClick={() => toggle('purposes', p.key)}
                      testId={`purpose-${p.key}`}
                    >
                      <span className="text-xl">{p.emoji}</span>
                      <span className="text-sm font-medium">{tx(p.label)}</span>
                    </Chip>
                  ))}
                </div>
                <div className="mt-6 grid gap-4 rounded-2xl border border-line bg-surface p-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium">{L('Target level', 'Trình độ mục tiêu')}</span>
                    <Select
                      value={draft.targetCefr}
                      onChange={(e) => patch({ targetCefr: e.target.value as Cefr })}
                      data-testid="onboarding-target"
                    >
                      {(['A2', 'B1', 'B2', 'C1', 'C2'] as const).map((c) => (
                        <option key={c} value={c}>
                          {c}
                          {c === 'B2' ? ` – ${L('recommended (≈ IELTS 6.5)', 'khuyên dùng (≈ IELTS 6.5)')}` : ''}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium">
                      {L('Target IELTS band (optional)', 'Band IELTS mục tiêu (tùy chọn)')}
                    </span>
                    <Select
                      value={draft.targetIelts === null ? '' : String(draft.targetIelts)}
                      onChange={(e) => patch({ targetIelts: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">{L('Not taking IELTS', 'Không thi IELTS')}</option>
                      {IELTS_BANDS.map((b) => (
                        <option key={b} value={b}>
                          {b.toFixed(1)}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              </StepFrame>
            )}

            {current === 'interests' && (
              <StepFrame
                title={L('What do you enjoy?', 'Bạn thích chủ đề nào?')}
                subtitle={L(
                  'We pick stories, articles and examples around these.',
                  'Bài đọc, câu chuyện và ví dụ sẽ xoay quanh các chủ đề này.',
                )}
              >
                <div className="flex flex-wrap gap-2">
                  {THEMES.map((t) => (
                    <Chip
                      key={t.key}
                      selected={draft.interests.includes(t.key)}
                      onClick={() => toggle('interests', t.key)}
                      inline
                      testId={`interest-${t.key}`}
                    >
                      <span>{t.emoji}</span>
                      <span className="text-sm font-medium">{tx(t.label)}</span>
                    </Chip>
                  ))}
                </div>
              </StepFrame>
            )}

            {current === 'schedule' && (
              <StepFrame
                title={L('How much time per day?', 'Mỗi ngày bạn học bao lâu?')}
                subtitle={L('Consistency matters more than length.', 'Đều đặn quan trọng hơn thời lượng.')}
              >
                <div className="grid grid-cols-5 gap-2">
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      onClick={() => patch({ dailyMinutes: m })}
                      data-testid={`minutes-${m}`}
                      className={cx(
                        'rounded-2xl border p-4 text-center transition',
                        draft.dailyMinutes === m
                          ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_var(--accent)]'
                          : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <div className="font-display text-2xl font-semibold">{m}</div>
                      <div className="text-xs text-muted">{L('min', 'phút')}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-center text-xs text-faint">
                  {draft.dailyMinutes <= 10
                    ? L('Light: good for busy days.', 'Nhẹ nhàng: phù hợp ngày bận rộn.')
                    : draft.dailyMinutes <= 30
                      ? L('Steady: the sweet spot for most learners.', 'Đều đặn: mức lý tưởng cho đa số người học.')
                      : L(
                          'Intensive: fastest progress towards your goal.',
                          'Tăng tốc: tiến bộ nhanh nhất tới mục tiêu.',
                        )}
                </p>
                <div className="mt-6 mb-2 text-sm font-medium">
                  {L('How do you like to learn?', 'Bạn thích học theo cách nào?')}
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {STYLES.map((s) => (
                    <Chip
                      key={s.key}
                      selected={draft.learningStyle === s.key}
                      onClick={() => patch({ learningStyle: s.key })}
                    >
                      <span className="text-sm font-semibold">{tx(s.label)}</span>
                      <span className="text-[11px] text-faint">{tx(s.desc)}</span>
                    </Chip>
                  ))}
                </div>
              </StepFrame>
            )}

            {current === 'ai' && (
              <StepFrame
                title={L('Supercharge with AI (optional)', 'Tăng sức mạnh với AI (tùy chọn)')}
                subtitle={L(
                  'Lingua Quest works fully offline. An AI key unlocks extra features.',
                  'Lingua Quest dùng được hoàn toàn offline. Thêm khóa AI để mở khóa tính năng nâng cao.',
                )}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-surface p-4">
                    <div className="mb-2 flex items-center gap-2 font-semibold">
                      <Bot className="size-5 text-accent" /> {L('With AI', 'Khi có AI')}
                    </div>
                    <ul className="space-y-1.5 text-sm text-muted">
                      {[
                        L('Detailed writing & speaking feedback', 'Chấm bài viết và bài nói chi tiết'),
                        L('A personal AI tutor to chat with', 'Gia sư AI trò chuyện cùng bạn'),
                        L('Roadmap personalised by AI', 'Lộ trình do AI cá nhân hóa'),
                        L('Natural voices and speech recognition', 'Giọng đọc tự nhiên và nhận dạng giọng nói'),
                      ].map((t) => (
                        <li key={t} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-success" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-line bg-surface p-4">
                    <div className="mb-2 flex items-center gap-2 font-semibold">
                      <KeyRound className="size-5 text-accent" /> {L('Your own key', 'Khóa của riêng bạn')}
                    </div>
                    <p className="text-sm text-muted">
                      {L(
                        'Use a Google Gemini key (has a free tier) or an OpenAI key. The key is encrypted on this computer and only sent to that provider.',
                        'Dùng khóa Google Gemini (có gói miễn phí) hoặc khóa OpenAI. Khóa được mã hóa trên máy này và chỉ gửi tới nhà cung cấp đó.',
                      )}
                    </p>
                    {aiReady ? (
                      <Badge tone="success" className="mt-3">
                        <Check className="size-3" /> {L('AI is configured', 'Đã cấu hình AI')}
                      </Badge>
                    ) : (
                      <Button
                        className="mt-3"
                        icon={<KeyRound className="size-4" />}
                        onClick={openAiSettings}
                        data-testid="onboarding-ai-settings"
                      >
                        {L('Add a key in Settings', 'Thêm khóa trong Cài đặt')}
                      </Button>
                    )}
                  </div>
                </div>
                {!aiReady && (
                  <button
                    onClick={() => go(1)}
                    className="mx-auto mt-5 flex items-center gap-2 text-sm text-muted hover:text-text"
                    data-testid="onboarding-skip-ai"
                  >
                    <WifiOff className="size-4" />{' '}
                    {L('Skip – use offline mode for now', 'Bỏ qua – dùng chế độ offline trước')}
                  </button>
                )}
              </StepFrame>
            )}

            {current === 'placement' && (
              <StepFrame
                title={L('Last step: find your level', 'Bước cuối: xác định trình độ')}
                subtitle={L(
                  'An adaptive test makes your plan much more accurate.',
                  'Bài kiểm tra thích ứng giúp lộ trình chính xác hơn nhiều.',
                )}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    onClick={() => void finish(true)}
                    disabled={saving !== null}
                    data-testid="onboarding-take-test"
                    className="group rounded-2xl border border-accent/40 bg-accent/10 p-5 text-left transition hover:bg-accent/15 disabled:opacity-60"
                  >
                    <Compass className="mb-3 size-8 text-accent" />
                    <div className="font-display text-xl font-semibold">
                      {L('Take the placement test', 'Làm bài kiểm tra xếp lớp')}
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {L(
                        'About 15 minutes: vocabulary, grammar, reading, listening, plus optional writing and speaking.',
                        'Khoảng 15 phút: từ vựng, ngữ pháp, đọc, nghe, cùng phần viết và nói (tùy chọn).',
                      )}
                    </p>
                    <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-accent">
                      {saving === 'test' ? L('Saving…', 'Đang lưu…') : L('Start now', 'Làm ngay')}{' '}
                      <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                    </div>
                  </button>
                  <button
                    onClick={() => void finish(false)}
                    disabled={saving !== null}
                    data-testid="onboarding-skip-test"
                    className="group rounded-2xl border border-line bg-surface p-5 text-left transition hover:border-line-strong disabled:opacity-60"
                  >
                    <SkipForward className="mb-3 size-8 text-muted" />
                    <div className="font-display text-xl font-semibold">{L('Skip for now', 'Để sau')}</div>
                    <p className="mt-1 text-sm text-muted">
                      {L(
                        `We will start every skill at ${LEVELS.find((l) => l.key === draft.selfReportedLevel)?.cefr ?? 'A1'} (your own estimate). You can take the test anytime from Journey.`,
                        `Mọi kỹ năng sẽ bắt đầu ở ${LEVELS.find((l) => l.key === draft.selfReportedLevel)?.cefr ?? 'A1'} (theo bạn tự đánh giá). Bạn có thể làm bài kiểm tra bất cứ lúc nào trong mục Hành trình.`,
                      )}
                    </p>
                    <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-muted">
                      {saving === 'skip' ? L('Saving…', 'Đang lưu…') : L('Go to my roadmap', 'Đến lộ trình của tôi')}{' '}
                      <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                    </div>
                  </button>
                </div>
                {error && (
                  <div className="mt-4">
                    <ErrorState error={error} compact />
                  </div>
                )}
              </StepFrame>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {current !== 'welcome' && (
        <footer className="relative flex items-center justify-between border-t border-line px-8 py-4">
          <Button
            variant="ghost"
            onClick={() => go(-1)}
            icon={<ArrowLeft className="size-4" />}
            data-testid="onboarding-back"
          >
            {L('Back', 'Quay lại')}
          </Button>
          {current !== 'placement' && (
            <Button
              variant="primary"
              onClick={() => go(1)}
              disabled={!canNext}
              icon={<ArrowRight className="size-4" />}
              data-testid="onboarding-next"
            >
              {current === 'ai' && aiReady ? L('Continue', 'Tiếp tục') : L('Next', 'Tiếp')}
            </Button>
          )}
        </footer>
      )}
    </div>
  )
}

function StepFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-center font-display text-3xl font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-2 mb-6 text-center text-sm text-muted">{subtitle}</p>}
      {!subtitle && <div className="mb-6" />}
      {children}
    </div>
  )
}

function ChoiceCard({
  selected,
  onClick,
  children,
  testId,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={cx(
        'flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition',
        selected
          ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_var(--accent)]'
          : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      {children}
      <span
        className={cx(
          'flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition',
          selected ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
        )}
      >
        {selected && <Check className="size-3.5" strokeWidth={3} />}
      </span>
    </button>
  )
}

function Chip({
  selected,
  onClick,
  children,
  inline,
  testId,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
  inline?: boolean
  testId?: string
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={cx(
        'flex items-center gap-2 rounded-2xl border transition',
        inline ? 'px-4 py-2.5' : 'flex-col justify-center p-4 text-center',
        selected
          ? 'border-accent bg-accent/10 text-text shadow-[0_0_0_1px_var(--accent)]'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text',
      )}
    >
      {children}
    </motion.button>
  )
}
