// Grammar Kingdom overview: CEFR castles on a kingdom path, topic mastery, recommended next topic and
// the learner's recurring grammar mistakes.
import { motion } from 'framer-motion'
import { ArrowRight, Castle, Crown, Flame, Shield, Sparkles, Swords, Target } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  ProgressRing,
  Section,
  StatTile,
  cx,
} from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import type { GrammarCastle, GrammarTopicCard } from '../../contract'
import { CastleArt, Stars } from '../components/art'

export default function KingdomPage() {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi('grammar:overview', undefined, [])

  return (
    <div data-testid="page-grammar">
      <PageHeader
        icon={<Shield />}
        title={L('Grammar Kingdom', 'Vương quốc ngữ pháp')}
        subtitle={L(
          'Conquer each castle – from your first sentences to IELTS-ready structures.',
          'Chinh phục từng lâu đài – từ những câu đầu tiên đến cấu trúc sẵn sàng cho IELTS.',
        )}
        actions={
          data && (
            <div className="flex items-center gap-2 text-sm text-muted">
              {L('Your grammar level', 'Trình độ ngữ pháp')} <CefrBadge level={data.level} />
            </div>
          )
        }
      />
      {loading && !data ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data || data.castles.length === 0 ? (
        <EmptyState
          icon={<Castle />}
          title={L('No grammar topics yet', 'Chưa có chủ điểm ngữ pháp')}
          body={L('The bundled content could not be loaded.', 'Không tải được nội dung có sẵn.')}
        />
      ) : (
        <>
          <div className="mb-8 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            {data.recommended ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="relative h-full overflow-hidden">
                  <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-accent/20 blur-3xl" />
                  <div className="relative flex h-full flex-col">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wider text-accent uppercase">
                      {data.recommended.reason === 'mistakes' ? (
                        <Target className="size-4" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      {L('Recommended next', 'Gợi ý tiếp theo')}
                    </div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-2xl font-semibold">{data.recommended.title}</h2>
                      <CefrBadge level={data.recommended.cefr} />
                    </div>
                    <p className="mt-2 text-sm text-muted">{L(data.recommended.reasonEn, data.recommended.reasonVi)}</p>
                    <div className="mt-auto pt-5">
                      <Button
                        variant="primary"
                        icon={<Swords className="size-4" />}
                        onClick={() => navigate(`/grammar/${data.recommended?.topicId}`)}
                        data-testid="grammar-recommended"
                      >
                        {L('Enter the castle', 'Vào lâu đài')}
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ) : (
              <Card className="flex items-center gap-4">
                <Crown className="size-10 text-warning" />
                <div>
                  <div className="font-display text-xl font-semibold">
                    {L('The whole kingdom is yours!', 'Cả vương quốc đã là của bạn!')}
                  </div>
                  <p className="text-sm text-muted">
                    {L(
                      'Every topic is mastered. Review any castle to stay sharp.',
                      'Bạn đã thành thạo mọi chủ điểm. Hãy ôn lại để giữ phong độ.',
                    )}
                  </p>
                </div>
              </Card>
            )}
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                icon={<Crown />}
                label={L('Mastered', 'Thành thạo')}
                value={`${data.totals.mastered}/${data.totals.topics}`}
                sub={L('topics ≥ 80%', 'chủ điểm ≥ 80%')}
              />
              <StatTile
                icon={<Swords />}
                label={L('Drills', 'Lượt luyện')}
                value={data.totals.attempts}
                sub={L(`${data.totals.exercises} exercises`, `${data.totals.exercises} bài tập`)}
              />
              <div className="col-span-2 rounded-2xl border border-line bg-surface p-4">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
                  <span>{L('Kingdom conquered', 'Đã chinh phục')}</span>
                  <span className="tabular-nums">
                    {Math.round((data.totals.mastered / Math.max(1, data.totals.topics)) * 100)}%
                  </span>
                </div>
                <ProgressBar value={data.totals.mastered} max={data.totals.topics} />
              </div>
            </div>
          </div>

          {data.recurringMistakes.length > 0 && (
            <Section title={L('Your recurring mistakes', 'Lỗi bạn hay lặp lại')}>
              <div className="grid gap-2 md:grid-cols-2">
                {data.recurringMistakes.map((m) => (
                  <button
                    key={m.pattern}
                    disabled={!m.topicId}
                    onClick={() => m.topicId && navigate(`/grammar/${m.topicId}`)}
                    className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left text-sm transition enabled:hover:border-line-strong"
                  >
                    <Flame className="mt-0.5 size-4 shrink-0 text-danger" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{m.pattern}</span>
                      {m.correction && <span className="block truncate text-muted">✓ {m.correction}</span>}
                    </span>
                    <Badge tone="danger">×{m.count}</Badge>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title={L('The kingdom path', 'Con đường vương quốc')}>
            <div className="relative space-y-6">
              <div className="absolute top-6 bottom-6 left-[3.25rem] hidden w-0.5 border-l-2 border-dashed border-line-strong md:block" />
              {data.castles.map((castle, i) => (
                <CastleSection
                  key={castle.cefr}
                  castle={castle}
                  index={i}
                  recommendedId={data.recommended?.topicId}
                  onOpen={(id) => navigate(`/grammar/${id}`)}
                  tx={tx}
                />
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

function CastleSection({
  castle,
  index,
  recommendedId,
  onOpen,
  tx,
}: {
  castle: GrammarCastle
  index: number
  recommendedId?: string
  onOpen: (id: string) => void
  tx: (b: { en: string; vi: string }) => string
}) {
  const L = useL()
  const progress = castle.mastered / Math.max(1, castle.topics.length)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="relative md:pl-28"
      data-testid={`grammar-castle-${castle.cefr}`}
    >
      <div className="absolute top-0 left-0 hidden w-26 md:block">
        <CastleArt cefr={castle.cefr} progress={progress} className="w-full drop-shadow-lg" />
      </div>
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <CefrBadge level={castle.cefr} className="text-sm" />
          <h3 className="font-display text-xl font-semibold">{tx(castle.name)}</h3>
          {castle.aboveLevel && <Badge tone="warning">{L('Challenge', 'Thử thách')}</Badge>}
          {progress >= 1 && (
            <Badge tone="success">
              <Crown className="size-3" /> {L('Conquered', 'Đã chinh phục')}
            </Badge>
          )}
          <span className="ml-auto text-sm text-muted tabular-nums">
            {castle.mastered}/{castle.topics.length} {L('mastered', 'thành thạo')}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {castle.topics.map((t) => (
            <TopicTile key={t.id} topic={t} recommended={t.id === recommendedId} onOpen={() => onOpen(t.id)} />
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

function TopicTile({
  topic,
  recommended,
  onOpen,
}: {
  topic: GrammarTopicCard
  recommended: boolean
  onOpen: () => void
}) {
  const L = useL()
  return (
    <button
      onClick={onOpen}
      data-testid={`grammar-topic-${topic.id}`}
      className={cx(
        'group flex items-center gap-3 rounded-xl border bg-surface-2 p-3 text-left transition hover:-translate-y-0.5 hover:border-line-strong',
        recommended
          ? 'border-accent/60 shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)]'
          : 'border-line',
      )}
    >
      <ProgressRing value={topic.mastery} size={44} stroke={4}>
        <span className="text-[11px] tabular-nums">{Math.round(topic.mastery * 100)}</span>
      </ProgressRing>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium">{topic.title}</span>
        <span className="mt-1 flex items-center gap-2 text-xs text-muted">
          <Stars mastery={topic.mastery} />
          {topic.mistakeCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-danger">
              <Flame className="size-3" />
              {topic.mistakeCount}
            </span>
          )}
          {topic.status === 'new' && <span>{L('New', 'Mới')}</span>}
        </span>
      </span>
      <ArrowRight className="size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
    </button>
  )
}
