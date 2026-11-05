// Speaking Studio home: practice types, prompt library, Cadence scenarios and the pronunciation path entry.
import { motion } from 'framer-motion'
import { ArrowRight, AudioLines, Clock, History, Mic, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Section,
  Tabs,
  cx,
} from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import type { SpeakingPromptView } from '../../contract'
import { KIND_META, formatClock, useAiReady } from '../lib/shared'

type Filter = 'all' | 'shadowing' | 'repeat' | 'roleplay' | 'real-world' | 'challenge' | 'ielts' | 'scenario'

export default function HomePage() {
  const [params] = useSearchParams()
  const promptId = params.get('prompt')
  if (promptId && /^[a-z0-9][a-z0-9-]*$/.test(promptId))
    return <Navigate to={`/speaking/practice/${promptId}`} replace />
  return <Home />
}

function Home() {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const ai = useAiReady()
  const { data, error, loading, reload } = useApi('speaking:prompts', undefined, [])
  const pron = useApi('speaking:pronOverview', undefined, [])
  const [filter, setFilter] = useState<Filter>('all')

  const prompts = useMemo(() => data ?? [], [data])
  const kindOf = (p: SpeakingPromptView): Filter => (p.source === 'cadence' ? 'scenario' : p.kind)
  const shown = prompts.filter((p) => filter === 'all' || kindOf(p) === filter)
  const pronLessons = pron.data?.modules.flatMap((m) => m.lessons) ?? []
  const pronDone = pronLessons.filter((l) => l.completed).length
  const count = (f: Filter) => prompts.filter((p) => kindOf(p) === f).length

  return (
    <div data-testid="page-speaking">
      <PageHeader
        icon={<Mic />}
        title={L('Speaking Studio', 'Phòng nói')}
        subtitle={L(
          'Shadow native sentences, hold real conversations and train every English sound.',
          'Nói đuổi câu mẫu, hội thoại thực tế và luyện từng âm tiếng Anh.',
        )}
        actions={
          <Button
            variant="secondary"
            icon={<History className="size-4" />}
            onClick={() => navigate('/speaking/history')}
          >
            {L('History', 'Lịch sử')}
          </Button>
        }
      />

      {!ai.loading && !ai.ready && (
        <Card className="mb-6 flex flex-wrap items-center gap-3 border-warning/30 bg-warning/5">
          <p className="flex-1 text-sm text-muted">
            {L(
              'No AI key yet: you can still record, play back and see measured timing and pauses, and practise scripted scenarios. Transcription, AI role-play and feedback need a Gemini or OpenAI key.',
              'Chưa có API key: bạn vẫn ghi âm, nghe lại, xem thời lượng và ngắt quãng, và luyện kịch bản hội thoại. Chuyển giọng nói thành chữ, nhập vai với AI và nhận xét cần key Gemini hoặc OpenAI.',
            )}
          </p>
          <Button
            size="sm"
            variant="secondary"
            icon={<Settings2 className="size-4" />}
            onClick={() => navigate('/settings/ai')}
          >
            {L('AI Settings', 'Cài đặt AI')}
          </Button>
        </Card>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card
          onClick={() => navigate('/speaking/pronunciation')}
          className="relative mb-8 overflow-hidden"
          data-testid="speaking-pron-entry"
        >
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-accent/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-5">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <AudioLines className="size-7" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold tracking-wider text-accent uppercase">
                {L('Pronunciation Path', 'Lộ trình phát âm')}
              </div>
              <div className="font-display text-xl font-semibold">
                {L('10 modules · every English sound', '10 chặng · mọi âm tiếng Anh')}
              </div>
              <p className="text-sm text-muted">
                {L(
                  'Short vowels, TH, V/W, R/L, final consonants, linking and schwa – with tips for Vietnamese speakers.',
                  'Nguyên âm ngắn, TH, V/W, R/L, phụ âm cuối, nối âm và âm schwa – kèm mẹo cho người Việt.',
                )}
              </p>
            </div>
            <div className="text-right">
              <div className="font-display text-2xl font-semibold tabular-nums">
                {pronDone}/{pronLessons.length || '–'}
              </div>
              <div className="text-xs text-muted">{L('lessons done', 'bài đã học')}</div>
            </div>
            <ArrowRight className="size-5 text-muted" />
          </div>
        </Card>
      </motion.div>

      <Section title={L('Practice', 'Luyện tập')}>
        <Tabs<Filter>
          className="mb-4"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: L('All', 'Tất cả'), count: prompts.length },
            ...(['shadowing', 'repeat', 'roleplay', 'real-world', 'challenge', 'ielts', 'scenario'] as const).map(
              (k) => ({ value: k, label: tx(KIND_META[k]), count: count(k) }),
            ),
          ]}
        />
        {loading && !data ? (
          <LoadingBlock rows={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Mic />} title={L('Nothing here yet', 'Chưa có bài nào')} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((p, i) => (
              <PromptCard key={p.id} p={p} index={i} onOpen={() => navigate(`/speaking/practice/${p.id}`)} />
            ))}
          </div>
        )}
        {filter === 'scenario' && (
          <p className="mt-4 text-xs text-faint">
            {L('Scripted scenarios adapted from Cadence (MIT).', 'Kịch bản hội thoại chuyển thể từ Cadence (MIT).')}
          </p>
        )}
      </Section>
    </div>
  )
}

function PromptCard({ p, index, onOpen }: { p: SpeakingPromptView; index: number; onOpen: () => void }) {
  const L = useL()
  const tx = useTx()
  const meta = KIND_META[p.source === 'cadence' ? 'scenario' : p.kind]
  const Icon = meta.icon
  const needsAi = p.source === 'builtin' && (p.kind === 'roleplay' || p.kind === 'real-world')
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.03 }}
    >
      <Card onClick={onOpen} className="flex h-full flex-col" data-testid={`speaking-prompt-${p.id}`}>
        <div className="mb-3 flex items-center gap-1.5">
          <CefrBadge level={p.cefr} />
          <Badge tone="neutral">
            <Icon className="size-3" /> {tx(meta)}
          </Badge>
          {p.source === 'cadence' && <Badge tone="info">Cadence</Badge>}
          {needsAi && <Badge tone="accent">AI</Badge>}
        </div>
        <h3 className="font-display text-lg leading-snug font-semibold">{p.title}</h3>
        <p className="mt-1 mb-4 line-clamp-2 text-sm text-muted">{p.scenario?.summary ?? p.instructionsVi}</p>
        <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs text-faint">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            {formatClock(p.durationSec)}
            {p.sentences.length > 0 &&
              p.source === 'builtin' &&
              ` · ${L(`${p.sentences.length} sentences`, `${p.sentences.length} câu`)}`}
            {p.scenario && ` · ${L(`${p.scenario.turns.length} turns`, `${p.scenario.turns.length} lượt`)}`}
          </span>
          <span className={cx('font-semibold', p.attempts ? 'text-text' : '')}>
            {p.attempts
              ? `${p.bestScore !== null ? `${Math.round(p.bestScore * 100)}% · ` : ''}${L(`${p.attempts}×`, `${p.attempts} lần`)}`
              : L('New', 'Mới')}
          </span>
        </div>
      </Card>
    </motion.div>
  )
}
