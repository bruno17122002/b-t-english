// Result of a writing submission: AI feedback (scores, diff, clickable errors, vocabulary) or the offline
// rough estimate, plus a second round where the learner self-corrects and resubmits.
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  BookmarkPlus,
  CheckCircle2,
  GraduationCap,
  History,
  ListChecks,
  PenLine,
  RotateCcw,
  Send,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { WritingFeedback } from '@shared/types'
import { AiBadge, SaveWordButton } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  cx,
  EmptyState,
  ErrorState,
  LoadingBlock,
  ProgressBar,
  ProgressRing,
  Section,
  Tabs,
  Textarea,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, ApiError, toApiError, useAction, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { AiFailure, WritingRecheck, WritingSubmissionView } from '../../contract'
import { CATEGORY_LABELS, Checklist, DiffView, MetricsPanel, SCORE_LABELS, taskMeta } from '../components/shared'

interface NavState {
  aiError?: AiFailure | null
  xp?: number
}

export default function ResultPage() {
  const { id = '' } = useParams()
  const numericId = Number(id)
  const L = useL()
  const navigate = useNavigate()
  const location = useLocation()
  const navState = (location.state ?? {}) as NavState
  const q = useApi('writing:get', Number.isInteger(numericId) && numericId > 0 ? { id: numericId } : null, [numericId])

  if (!Number.isInteger(numericId) || numericId <= 0 || q.error)
    return (
      <div data-testid="page-writing" className="mx-auto max-w-3xl space-y-4">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/writing')}>
          {L('Writing Workshop', 'Xưởng viết')}
        </Button>
        {q.error ? (
          <ErrorState error={q.error} onRetry={q.reload} />
        ) : (
          <EmptyState title={L('Submission not found', 'Không tìm thấy bài viết')} />
        )}
      </div>
    )
  if (!q.data)
    return (
      <div data-testid="page-writing" className="mx-auto max-w-5xl">
        <LoadingBlock rows={6} />
      </div>
    )
  return <Result key={numericId} view={q.data} setView={(v) => q.setData(v)} navState={navState} />
}

function Result({
  view,
  setView,
  navState,
}: {
  view: WritingSubmissionView
  setView: (v: WritingSubmissionView) => void
  navState: NavState
}) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const { submission: s, prompt } = view
  const fb = s.feedback
  const meta = taskMeta(s.taskType)
  const [aiFailure, setAiFailure] = useState<AiFailure | null>(navState.aiError ?? null)
  const analyze = useAction(() => api('writing:analyze', { id: s.id }))
  const runAnalyze = async () => {
    setAiFailure(null)
    const res = await analyze.run()
    if (res) setView(res)
  }

  return (
    <div data-testid="page-writing" className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/writing')}>
          {L('Writing Workshop', 'Xưởng viết')}
        </Button>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={<History className="size-4" />}
            onClick={() => navigate('/writing/history')}
          >
            {L('History', 'Lịch sử')}
          </Button>
          <Button
            variant="secondary"
            icon={<PenLine className="size-4" />}
            onClick={() => navigate(prompt ? `/writing?prompt=${encodeURIComponent(prompt.id)}` : '/writing?free=1')}
          >
            {L('Write again', 'Viết bài mới')}
          </Button>
        </div>
      </div>

      <header>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="accent">
            <meta.icon className="size-3" />
            {tx(meta)}
          </Badge>
          {prompt && <CefrBadge level={prompt.cefr} />}
          <span>
            {fmt.date(s.createdAt, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {navState.xp ? (
            <Badge tone="warning">
              <Trophy className="size-3" />+{navState.xp} XP
            </Badge>
          ) : null}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {prompt?.title ?? (s.promptText || L('Free writing', 'Viết tự do'))}
        </h1>
      </header>

      {aiFailure && !fb && (
        <ErrorState
          error={new ApiError({ code: aiFailure.code, message: aiFailure.message, hint: aiFailure.hint })}
          onRetry={aiFailure.hint === 'ai-settings' ? undefined : () => void runAnalyze()}
        />
      )}

      {fb ? (
        <FeedbackView view={view} feedback={fb} />
      ) : (
        <OfflineView view={view} onAnalyze={runAnalyze} analyzing={analyze.pending} error={analyze.error} />
      )}

      <SelfCorrect view={view} setView={setView} />
    </div>
  )
}

// ---------- offline result ----------
function OfflineView({
  view,
  onAnalyze,
  analyzing,
  error,
}: {
  view: WritingSubmissionView
  onAnalyze: () => void
  analyzing: boolean
  error: ApiError | null
}) {
  const L = useL()
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="writing-offline">
      <div className="space-y-5">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">{L('Offline check', 'Kiểm tra offline')}</h2>
            <Badge>{L('rough estimate', 'ước lượng thô')}</Badge>
          </div>
          <p className="mb-4 text-sm text-muted">
            {L(
              'These checks are measured automatically without AI. They cannot find every grammar mistake – use the hints to review your text yourself.',
              'Các mục này được đo tự động, không dùng AI. Chúng không phát hiện hết lỗi ngữ pháp – hãy dùng gợi ý để tự rà soát bài.',
            )}
          </p>
          <Checklist items={view.checklist} />
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold tracking-wider text-muted uppercase">
            {L('Your text', 'Bài của bạn')}
          </h2>
          <p className="leading-loose whitespace-pre-wrap">{view.submission.originalText}</p>
        </Card>
      </div>
      <aside className="space-y-4">
        <Card className="p-4">
          <MetricsPanel metrics={view.submission.metrics} />
        </Card>
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-info" /> {L('Want detailed feedback?', 'Muốn nhận xét chi tiết?')}
          </p>
          <Button
            variant="primary"
            className="w-full"
            loading={analyzing}
            onClick={onAnalyze}
            data-testid="writing-analyze"
          >
            {L('Get AI feedback', 'Nhận xét bằng AI')}
          </Button>
          {error && <ErrorState error={error} compact />}
        </Card>
      </aside>
    </div>
  )
}

// ---------- AI feedback ----------
function FeedbackView({ view, feedback: fb }: { view: WritingSubmissionView; feedback: WritingFeedback }) {
  const L = useL()
  const tx = useTx()
  const toast = useApp((s) => s.toast)
  const refreshGame = useApp((s) => s.refreshGame)
  const [tab, setTab] = useState<'diff' | 'marked' | 'corrected' | 'original'>('diff')
  const [selected, setSelected] = useState<number | null>(null)
  const errorRefs = useRef<(HTMLLIElement | null)[]>([])
  const [savingAll, setSavingAll] = useState(false)
  const [savedAll, setSavedAll] = useState(false)
  const score = view.score ?? 0

  useEffect(() => {
    if (selected !== null) errorRefs.current[selected]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selected])

  const saveAll = async () => {
    setSavingAll(true)
    let created = 0
    try {
      for (const v of fb.newVocabulary) {
        const res = await api('vocab:save', {
          word: v.word,
          meaningVi: v.meaningVi,
          examples: v.example ? [v.example] : [],
          sourceModule: 'writing',
          sourceRef: `writing:${view.submission.id}`,
        })
        if (res.created) created++
      }
      setSavedAll(true)
      toast({ kind: 'success', title: L(`Saved ${created} new words`, `Đã lưu ${created} từ mới`) })
      void refreshGame()
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setSavingAll(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="writing-feedback">
      <Card className="grid gap-6 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          <ProgressRing value={score / 10} size={112} stroke={9}>
            <span className="font-display text-3xl">{score}</span>
          </ProgressRing>
          <span className="text-xs text-muted">{L('Overall / 10', 'Tổng / 10')}</span>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <AiBadge />
            <span className="flex items-center gap-1 text-sm text-muted">
              CEFR <CefrBadge level={fb.cefrEstimate} />
            </span>
            {fb.ieltsBandEstimate !== null && (
              <Badge tone="accent">
                <GraduationCap className="size-3" /> IELTS ≈ {fb.ieltsBandEstimate.toFixed(1)}
              </Badge>
            )}
          </div>
          <p className="leading-relaxed">{fb.overallComment}</p>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="writing-scores">
            {(Object.keys(SCORE_LABELS) as (keyof WritingFeedback['scores'])[]).map((k) => (
              <div key={k}>
                <div className="mb-0.5 flex justify-between text-xs">
                  <span className="text-muted">{tx(SCORE_LABELS[k])}</span>
                  <span className="font-semibold tabular-nums">{fb.scores[k]}</span>
                </div>
                <ProgressBar
                  value={fb.scores[k]}
                  max={10}
                  tone={fb.scores[k] >= 7 ? 'success' : fb.scores[k] >= 5 ? 'accent' : 'warning'}
                />
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            className="mb-4"
            items={[
              { value: 'diff', label: L('Corrections', 'Chỗ sửa') },
              { value: 'marked', label: L('Your mistakes', 'Lỗi của bạn'), count: fb.errors.length },
              { value: 'corrected', label: L('Corrected', 'Bản sửa') },
              { value: 'original', label: L('Original', 'Bản gốc') },
            ]}
          />
          {tab === 'diff' && view.diff && <DiffView ops={view.diff} />}
          {tab === 'marked' && view.marked && (
            <div className="leading-loose whitespace-pre-wrap" data-testid="writing-marked">
              {view.marked.map((seg, i) => {
                if (seg.errorIndex === null) return <span key={i}>{seg.text}</span>
                const err = fb.errors[seg.errorIndex]
                const idx = seg.errorIndex
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(idx)}
                    title={err ? `${err.correction} – ${err.explanationVi}` : undefined}
                    className={cx(
                      'rounded px-0.5 underline decoration-danger decoration-wavy underline-offset-4 transition hover:bg-danger/10',
                      selected === idx && 'bg-danger/15',
                    )}
                  >
                    {seg.text}
                  </button>
                )
              })}
            </div>
          )}
          {tab === 'corrected' && <p className="leading-loose whitespace-pre-wrap">{fb.correctedText}</p>}
          {tab === 'original' && <p className="leading-loose whitespace-pre-wrap">{view.submission.originalText}</p>}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold tracking-wider text-muted uppercase">
              {L('Mistakes', 'Lỗi sai')} ({fb.errors.length})
            </h2>
            {fb.errors.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />{' '}
                {L('No mistakes found – great job!', 'Không phát hiện lỗi – tuyệt vời!')}
              </p>
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1" data-testid="writing-errors">
                {fb.errors.map((e, i) => {
                  const cat = CATEGORY_LABELS[e.category]
                  return (
                    <li
                      key={i}
                      ref={(el) => {
                        errorRefs.current[i] = el
                      }}
                    >
                      <button
                        onClick={() => {
                          setSelected(i)
                          setTab('marked')
                        }}
                        className={cx(
                          'w-full rounded-xl border p-3 text-left text-sm transition',
                          selected === i
                            ? 'border-accent bg-accent/10'
                            : 'border-line bg-surface-2 hover:border-line-strong',
                        )}
                      >
                        <Badge tone={cat.tone}>{tx(cat)}</Badge>
                        <div className="mt-1.5">
                          <span className="text-danger line-through">{e.original}</span> →{' '}
                          <span className="font-medium text-success">{e.correction || '∅'}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted">{e.explanationVi}</p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <MetricsPanel metrics={view.submission.metrics} />
          </Card>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {fb.naturalAlternatives.length > 0 && (
          <Section title={L('Sound more natural', 'Diễn đạt tự nhiên hơn')} className="mb-0">
            <ul className="space-y-2">
              {fb.naturalAlternatives.map((a, i) => (
                <li key={i} className="rounded-xl border border-line bg-surface p-3 text-sm">
                  <span className="text-muted">{a.original}</span> →{' '}
                  <span className="font-medium text-accent">{a.better}</span>
                  <p className="mt-1 text-xs text-faint">{a.why}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {fb.newVocabulary.length > 0 && (
          <Section
            title={L('New vocabulary', 'Từ vựng mới')}
            className="mb-0"
            actions={
              <Button
                size="sm"
                variant={savedAll ? 'success' : 'secondary'}
                loading={savingAll}
                disabled={savedAll}
                icon={<BookmarkPlus className="size-4" />}
                onClick={saveAll}
                data-testid="writing-save-words"
              >
                {savedAll ? L('Saved', 'Đã lưu') : L('Save all', 'Lưu tất cả')}
              </Button>
            }
          >
            <ul className="space-y-2">
              {fb.newVocabulary.map((v) => (
                <li
                  key={v.word}
                  className="flex items-start justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-sm"
                >
                  <div>
                    <span className="font-display text-base font-semibold">{v.word}</span>{' '}
                    <span className="text-muted">– {v.meaningVi}</span>
                    {v.example && <p className="mt-0.5 text-xs text-faint italic">{v.example}</p>}
                  </div>
                  <SaveWordButton
                    compact
                    sourceModule="writing"
                    sourceRef={`writing:${view.submission.id}`}
                    seed={{ word: v.word, meaningVi: v.meaningVi, example: v.example }}
                  />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {fb.studyTopics.length > 0 && (
        <Section title={L('Study next', 'Nên ôn tiếp')}>
          <div className="flex flex-wrap gap-2">
            {fb.studyTopics.map((t) => (
              <Badge key={t} tone="info" className="px-3 py-1 text-sm">
                {t}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      <details className="rounded-2xl border border-line bg-surface p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-muted">
          <ListChecks className="size-4" /> {L('Offline checklist', 'Danh sách tự kiểm tra')}
        </summary>
        <div className="mt-3">
          <Checklist items={view.checklist} />
        </div>
      </details>
    </div>
  )
}

// ---------- round 2: self-correction ----------
function SelfCorrect({ view, setView }: { view: WritingSubmissionView; setView: (v: WritingSubmissionView) => void }) {
  const L = useL()
  const s = view.submission
  const fb = s.feedback
  const [text, setText] = useState(s.selfCorrectedText ?? s.originalText)
  const [recheck, setRecheck] = useState<WritingRecheck | null>(null)
  const submit = useAction(() => api('writing:selfCorrect', { id: s.id, text, useAi: !!fb }))
  const changed = text.trim() !== (s.selfCorrectedText ?? s.originalText).trim()
  const fixes = recheck ? { fixed: recheck.fixed, remaining: recheck.remaining } : view.fixes
  const errors = fb?.errors ?? []
  const pct = fixes && errors.length ? fixes.fixed.length / errors.length : null

  const run = async () => {
    const res = await submit.run()
    if (!res) return
    setRecheck(res.recheck)
    setView(res.view)
  }

  return (
    <Card className="space-y-4" data-testid="writing-selfcorrect">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold">{L('Round 2: fix it yourself', 'Vòng 2: tự sửa bài')}</h2>
          <p className="text-sm text-muted">
            {fb
              ? L(
                  'Correct your mistakes without copying the corrected version – it is the fastest way to stop repeating them.',
                  'Tự sửa lỗi mà không chép bản sửa – đây là cách nhanh nhất để không lặp lại lỗi.',
                )
              : L(
                  'Re-read your text with the checklist and improve it.',
                  'Đọc lại bài theo danh sách kiểm tra và cải thiện bài viết.',
                )}
          </p>
        </div>
        {fb && <AiBadge />}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={12000}
        className="min-h-40 text-[16px] leading-7"
        data-testid="writing-selfcorrect-text"
        aria-label={L('Your revised text', 'Bài đã sửa')}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {s.selfCorrectedText !== null && !changed ? (
          <span className="text-sm text-success">{L('Revision saved', 'Đã lưu bản sửa')}</span>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setText(s.originalText)}>
            {L('Reset', 'Đặt lại')}
          </Button>
          <Button
            variant="primary"
            icon={<Send className="size-4" />}
            loading={submit.pending}
            disabled={!text.trim() || !changed}
            onClick={run}
            data-testid="writing-selfcorrect-submit"
          >
            {L('Check my revision', 'Kiểm tra bản sửa')}
          </Button>
        </div>
      </div>
      {submit.error && <ErrorState error={submit.error} compact />}

      {fixes && errors.length > 0 && pct !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3 rounded-xl border border-line bg-surface-2 p-4"
          data-testid="writing-recheck"
        >
          <div className="flex items-center justify-between text-sm">
            <span>
              {L(
                `Fixed ${fixes.fixed.length} of ${errors.length} mistakes`,
                `Đã sửa ${fixes.fixed.length}/${errors.length} lỗi`,
              )}
              <Badge className="ml-2">{L('rough estimate', 'ước lượng thô')}</Badge>
            </span>
            <span className="font-semibold tabular-nums">{Math.round(pct * 100)}%</span>
          </div>
          <ProgressBar value={pct} tone={pct >= 0.8 ? 'success' : 'accent'} />
          {fixes.remaining.length > 0 && (
            <ul className="space-y-1 text-sm">
              {fixes.remaining.map((i) => {
                const e = errors[i]
                return e ? (
                  <li key={i} className="text-muted">
                    • <span className="text-danger">{e.original}</span> – {e.explanationVi}
                  </li>
                ) : null
              })}
            </ul>
          )}
          {recheck?.ai && (
            <div className="space-y-2 border-t border-line pt-3 text-sm">
              <div className="flex items-center gap-2">
                <AiBadge /> <span className="font-semibold">{recheck.ai.score}/10</span>
              </div>
              <p>{recheck.ai.comment}</p>
              {recheck.ai.remainingIssues.map((r, i) => (
                <p key={i} className="text-muted">
                  <span className="text-danger line-through">{r.original}</span> →{' '}
                  <span className="text-success">{r.correction}</span> · {r.explanationVi}
                </p>
              ))}
            </div>
          )}
          {recheck?.aiError && (
            <ErrorState
              compact
              error={
                new ApiError({
                  code: recheck.aiError.code,
                  message: recheck.aiError.message,
                  hint: recheck.aiError.hint,
                })
              }
            />
          )}
        </motion.div>
      )}
      {view.revisionDiff && (
        <details className="rounded-xl border border-line p-3 text-sm">
          <summary className="cursor-pointer text-muted">
            {L('Compare your revision with your first draft', 'So sánh bản sửa với bản đầu')}
          </summary>
          <DiffView ops={view.revisionDiff} className="mt-2" />
        </details>
      )}
    </Card>
  )
}
