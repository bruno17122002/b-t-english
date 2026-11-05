// Listening Lab library: built-in and AI-generated tracks with filters, progress and favourites.
import { motion } from 'framer-motion'
import { CheckCircle2, Clock, Headphones, ListMusic, Search, Sparkles, Target, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CEFR_LEVELS, type Cefr } from '@shared/content'
import { AiBadge, FavoriteButton } from '@/components/learning'
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
  Select,
  StatTile,
  Tabs,
  cx,
} from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import type { TrackSummary } from '../../contract'
import { GenerateTrackModal } from '../components/GenerateTrackModal'
import { ACCENT_LABEL, KIND_META, MODE_LABEL, formatDuration, pct } from '../lib/meta'

type StatusFilter = 'all' | 'new' | 'done' | 'favorite' | 'ai'

export default function LibraryPage() {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi('listening:list', undefined, [])
  const skills = useApi('learner:skills', undefined, [])
  const [status, setStatus] = useState<StatusFilter>('all')
  const [cefr, setCefr] = useState<Cefr | ''>('')
  const [topic, setTopic] = useState('')
  const [accent, setAccent] = useState('')
  const [query, setQuery] = useState('')
  const [genOpen, setGenOpen] = useState(false)

  const level = skills.data?.find((s) => s.skill === 'listening')?.cefr
  const tracks = useMemo(() => data ?? [], [data])
  const topics = useMemo(() => [...new Set(tracks.map((t) => t.topic))].sort((a, b) => a.localeCompare(b)), [tracks])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tracks.filter(
      (t) =>
        (!cefr || t.cefr === cefr) &&
        (!topic || t.topic === topic) &&
        (!accent || t.accent === accent) &&
        (!q || t.title.toLowerCase().includes(q) || t.topic.toLowerCase().includes(q)) &&
        (status === 'all' ||
          (status === 'new' && t.attempts === 0) ||
          (status === 'done' && t.attempts > 0) ||
          (status === 'favorite' && t.favorite) ||
          (status === 'ai' && t.source === 'ai')),
    )
  }, [tracks, cefr, topic, accent, query, status])

  const done = tracks.filter((t) => t.attempts > 0)
  const avgBest = done.length ? done.reduce((s, t) => s + (t.bestAccuracy ?? 0), 0) / done.length : null
  const recommended = level ? tracks.find((t) => t.attempts === 0 && t.cefr === level) : undefined

  return (
    <div data-testid="page-listening">
      <PageHeader
        icon={<Headphones />}
        title={L('Listening Lab', 'Phòng nghe')}
        subtitle={L(
          'Listen for the gist, write what you hear, then shadow every line – three stages per track.',
          'Nghe ý chính, chép lại những gì nghe được, rồi nói đuổi từng câu – ba chặng cho mỗi bài.',
        )}
        actions={
          <Button
            variant="primary"
            icon={<Wand2 className="size-4" />}
            onClick={() => setGenOpen(true)}
            data-testid="listening-generate"
          >
            {L('Create with AI', 'Tạo bài bằng AI')}
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={<ListMusic />}
              label={L('Tracks', 'Bài nghe')}
              value={tracks.length}
              sub={L(
                `${tracks.filter((t) => t.source === 'ai').length} created with AI`,
                `${tracks.filter((t) => t.source === 'ai').length} bài do AI tạo`,
              )}
            />
            <StatTile
              icon={<CheckCircle2 />}
              label={L('Practised', 'Đã luyện')}
              value={`${done.length}/${tracks.length}`}
            />
            <StatTile icon={<Target />} label={L('Average best score', 'Điểm cao nhất TB')} value={pct(avgBest)} />
            <StatTile
              icon={<Sparkles />}
              label={L('Your listening level', 'Trình độ nghe')}
              value={level ? <CefrBadge level={level} className="text-base" /> : '—'}
              sub={recommended ? L(`Try: ${recommended.title}`, `Gợi ý: ${recommended.title}`) : undefined}
            />
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Tabs<StatusFilter>
              value={status}
              onChange={setStatus}
              items={[
                { value: 'all', label: L('All', 'Tất cả'), count: tracks.length },
                { value: 'new', label: L('New', 'Chưa nghe') },
                { value: 'done', label: L('Done', 'Đã nghe'), count: done.length },
                { value: 'favorite', label: L('Favourites', 'Yêu thích') },
                { value: 'ai', label: 'AI' },
              ]}
            />
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={L('Search tracks…', 'Tìm bài nghe…')}
                className="pl-9"
                aria-label={L('Search tracks', 'Tìm bài nghe')}
              />
            </div>
            <Select
              value={cefr}
              onChange={(e) => setCefr(e.target.value as Cefr | '')}
              className="w-28"
              aria-label="CEFR"
            >
              <option value="">CEFR</option>
              {CEFR_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-44"
              aria-label={L('Topic', 'Chủ đề')}
            >
              <option value="">{L('All topics', 'Mọi chủ đề')}</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="w-40"
              aria-label={L('Accent', 'Giọng')}
            >
              <option value="">{L('All accents', 'Mọi giọng')}</option>
              {Object.entries(ACCENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {tx(v)}
                </option>
              ))}
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Headphones />}
              title={L('No tracks match these filters', 'Không có bài nghe phù hợp')}
              body={L('Clear a filter or create a new track with AI.', 'Bỏ bớt bộ lọc hoặc tạo bài mới bằng AI.')}
              action={
                <Button
                  variant="secondary"
                  onClick={() => (setStatus('all'), setCefr(''), setTopic(''), setAccent(''), setQuery(''))}
                >
                  {L('Clear filters', 'Xoá bộ lọc')}
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((t, i) => (
                <TrackCard key={t.id} track={t} index={i} onOpen={() => navigate(`/listening/${t.id}`)} />
              ))}
            </div>
          )}
        </>
      )}

      <GenerateTrackModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        defaultLevel={level ?? 'A2'}
        onCreated={(t) => {
          setGenOpen(false)
          void reload()
          navigate(`/listening/${t.id}`)
        }}
      />
    </div>
  )
}

function TrackCard({ track: t, index, onOpen }: { track: TrackSummary; index: number; onOpen: () => void }) {
  const L = useL()
  const tx = useTx()
  const Kind = KIND_META[t.kind].icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.03 }}
    >
      <Card onClick={onOpen} className="flex h-full flex-col" data-testid={`listening-track-${t.id}`}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <CefrBadge level={t.cefr} />
            <Badge tone="neutral" className="font-mono">
              {ACCENT_LABEL[t.accent].short}
            </Badge>
            <Badge tone="neutral">
              <Kind className="size-3" />
              {tx(KIND_META[t.kind])}
            </Badge>
            {t.source === 'ai' && <AiBadge estimated={false} />}
          </div>
          <FavoriteButton kind="listening" refId={t.id} title={t.title} />
        </div>
        <h3 className="font-display text-lg leading-snug font-semibold">{t.title}</h3>
        <p className="mt-1 mb-4 text-sm text-muted capitalize">{t.topic}</p>
        <div className="mt-3 flex items-center gap-3 text-xs text-faint">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />~{formatDuration(t.estSeconds)}
          </span>
          <span>{L(`${t.lineCount} lines`, `${t.lineCount} câu`)}</span>
          <span>{L(`${t.wordCount} words`, `${t.wordCount} từ`)}</span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap gap-1">
            {(['gist', 'dictation', 'shadow'] as const).map((m) => {
              const doneMode = t.modesDone.includes(m) || (m === 'dictation' && t.modesDone.includes('gap'))
              return (
                <span
                  key={m}
                  className={cx(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    doneMode ? 'bg-success/15 text-success' : 'bg-surface-3 text-faint',
                  )}
                >
                  {tx(MODE_LABEL[m])}
                </span>
              )
            })}
          </div>
          <span
            className={cx('text-sm font-semibold tabular-nums', t.bestAccuracy === null ? 'text-faint' : 'text-text')}
          >
            {pct(t.bestAccuracy)}
          </span>
        </div>
      </Card>
    </motion.div>
  )
}
