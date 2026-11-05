// Writing Workshop entry: prompt picker, or the editor when `?prompt=<id>` / `?free=1` is in the URL.
import { motion } from 'framer-motion'
import { History, PenLine, Search, Settings2, Sparkles, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CEFR_LEVELS, type Cefr, type WritingPrompt } from '@shared/content'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Section,
  Select,
} from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { useApi, type Query } from '@/lib/api'
import type { WritingCatalog, WritingPromptInfo } from '../../contract'
import { Editor } from '../components/Editor'
import { TASK_META, TASK_TYPES } from '../components/shared'

export default function WritingPage() {
  const [params] = useSearchParams()
  const promptId = params.get('prompt')
  const free = params.get('free') === '1'
  const catalog = useApi('writing:catalog', undefined)
  const L = useL()
  const navigate = useNavigate()

  if (promptId || free) {
    if (catalog.error)
      return (
        <div data-testid="page-writing">
          <ErrorState error={catalog.error} onRetry={catalog.reload} />
        </div>
      )
    if (!catalog.data)
      return (
        <div data-testid="page-writing" className="mx-auto max-w-5xl">
          <LoadingBlock rows={5} />
        </div>
      )
    const prompt = promptId ? (catalog.data.prompts.find((p) => p.id === promptId) ?? null) : null
    if (promptId && !prompt)
      return (
        <div data-testid="page-writing" className="mx-auto max-w-3xl">
          <EmptyState
            icon={<PenLine />}
            title={L('Prompt not found', 'Không tìm thấy đề bài')}
            action={<Button onClick={() => navigate('/writing')}>{L('All prompts', 'Tất cả đề bài')}</Button>}
          />
        </div>
      )
    return (
      <div data-testid="page-writing" className="mx-auto max-w-6xl">
        <Editor key={promptId ?? 'free'} prompt={prompt} aiAvailable={catalog.data.aiAvailable} />
      </div>
    )
  }
  return <Picker catalog={catalog} />
}

function Picker({ catalog }: { catalog: Query<WritingCatalog> }) {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const [type, setType] = useState<WritingPrompt['taskType'] | 'all'>('all')
  const [level, setLevel] = useState<Cefr | 'all'>('all')
  const [query, setQuery] = useState('')
  const prompts = useMemo(() => catalog.data?.prompts ?? [], [catalog.data])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return prompts.filter(
      (p) =>
        (type === 'all' || p.taskType === type) &&
        (level === 'all' || p.cefr === level) &&
        (!q || `${p.title} ${p.instructions} ${p.instructionsVi}`.toLowerCase().includes(q)),
    )
  }, [prompts, type, level, query])
  const open = (p: WritingPromptInfo) => navigate(`/writing?prompt=${encodeURIComponent(p.id)}`)
  const recommended = (catalog.data?.recommended ?? [])
    .map((id) => prompts.find((p) => p.id === id))
    .filter((p): p is WritingPromptInfo => !!p)

  return (
    <div data-testid="page-writing" className="mx-auto max-w-6xl">
      <PageHeader
        icon={<PenLine />}
        title={L('Writing Workshop', 'Xưởng viết')}
        subtitle={L(
          'Write, get detailed feedback, fix your own mistakes and watch your scores grow.',
          'Viết bài, nhận nhận xét chi tiết, tự sửa lỗi và theo dõi điểm số tiến bộ.',
        )}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<History className="size-4" />}
              onClick={() => navigate('/writing/history')}
              data-testid="writing-history-link"
            >
              {L('History', 'Lịch sử')}
            </Button>
            <Button
              variant="primary"
              icon={<PenLine className="size-4" />}
              onClick={() => navigate('/writing?free=1')}
              data-testid="writing-free"
            >
              {L('Free writing', 'Viết tự do')}
            </Button>
          </>
        }
      />

      {catalog.error ? (
        <ErrorState error={catalog.error} onRetry={catalog.reload} />
      ) : !catalog.data ? (
        <LoadingBlock rows={4} />
      ) : (
        <>
          {!catalog.data.aiAvailable && (
            <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 border-info/30 bg-info/5 p-4">
              <p className="max-w-2xl text-sm text-muted">
                <Sparkles className="mr-1 inline size-4 text-info" />
                {L(
                  'AI feedback needs a Gemini or OpenAI key. Without it you still get offline metrics, a level estimate (rough) and a checklist.',
                  'Nhận xét bằng AI cần API key Gemini hoặc OpenAI. Không có key, bạn vẫn nhận số liệu offline, cấp độ ước lượng thô và danh sách tự kiểm tra.',
                )}
              </p>
              <Button
                size="sm"
                variant="secondary"
                icon={<Settings2 className="size-4" />}
                onClick={() => navigate('/settings/ai')}
              >
                {L('Open AI Settings', 'Mở Cài đặt AI')}
              </Button>
            </Card>
          )}

          {recommended.length > 0 && (
            <Section
              title={L(
                `Recommended · your writing level ${catalog.data.writingLevel}`,
                `Gợi ý · trình độ viết ${catalog.data.writingLevel}`,
              )}
            >
              <div className="grid gap-4 md:grid-cols-3">
                {recommended.map((p, i) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <PromptCard p={p} onOpen={() => open(p)} featured />
                  </motion.div>
                ))}
              </div>
            </Section>
          )}

          <Section title={L('All prompts', 'Tất cả đề bài')}>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Select
                className="w-52"
                value={type}
                onChange={(e) => setType(e.target.value as WritingPrompt['taskType'] | 'all')}
                aria-label={L('Task type', 'Dạng bài')}
              >
                <option value="all">{L('All task types', 'Mọi dạng bài')}</option>
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {tx(TASK_META[t])}
                  </option>
                ))}
              </Select>
              <Select
                className="w-28"
                value={level}
                onChange={(e) => setLevel(e.target.value as Cefr | 'all')}
                aria-label={L('Level', 'Trình độ')}
              >
                <option value="all">{L('All levels', 'Mọi cấp')}</option>
                {CEFR_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <Input
                  className="pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={L('Search prompts…', 'Tìm đề bài…')}
                />
              </div>
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<PenLine />}
                title={L('No prompts match', 'Không có đề phù hợp')}
                body={L('Try another filter or write freely.', 'Thử bộ lọc khác hoặc viết tự do.')}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="writing-prompts">
                {filtered.map((p) => (
                  <PromptCard key={p.id} p={p} onOpen={() => open(p)} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function PromptCard({ p, onOpen, featured }: { p: WritingPromptInfo; onOpen: () => void; featured?: boolean }) {
  const L = useL()
  const tx = useTx()
  const meta = TASK_META[p.taskType]
  const Icon = meta.icon
  return (
    <Card
      interactive
      onClick={onOpen}
      className={featured ? 'h-full border-accent/30 p-4' : 'h-full p-4'}
      data-testid={`writing-prompt-${p.id}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Icon className="size-4" />
          </span>
          {tx(meta)}
        </span>
        <CefrBadge level={p.cefr} />
      </div>
      <h3 className="font-display text-lg leading-snug font-semibold">{p.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{p.instructionsVi}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
        <span>
          {p.minWords}–{p.maxWords} {L('words', 'từ')}
        </span>
        {meta.timerMinutes && <span>· {L(`${meta.timerMinutes} min timer`, `bấm giờ ${meta.timerMinutes} phút`)}</span>}
        {p.attempts > 0 && (
          <Badge tone="success">
            <Trophy className="size-3" />
            {p.bestScore !== null ? `${p.bestScore}/10` : L(`${p.attempts}×`, `${p.attempts} lần`)}
          </Badge>
        )}
      </div>
    </Card>
  )
}
