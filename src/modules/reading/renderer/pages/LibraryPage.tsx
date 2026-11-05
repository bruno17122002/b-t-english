// Reading Adventure library: recommendations, filters, bookmarks, history and AI-generated passages.
import { motion } from 'framer-motion'
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  Clock,
  Gauge,
  Library,
  Search,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CEFR_LEVELS, type Cefr, type ReadingPassage } from '@shared/content'
import { AiBadge, FavoriteButton } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  LoadingBlock,
  PageHeader,
  Section,
  Select,
  StatTile,
  Tabs,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { PassageSummary } from '../../contract'
import { GenerateModal } from '../components/GenerateModal'
import { CATEGORIES, CATEGORY_META, CategoryCover, formatClock, Sparkline } from '../components/shared'

type StatusFilter = 'all' | 'unread' | 'read' | 'favorites' | 'ai'

export default function LibraryPage() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const toast = useApp((s) => s.toast)
  const lib = useApi('reading:library', undefined)
  const history = useApi('reading:history', { limit: 30 })
  const favorites = useApi('library:favorites', { kind: 'reading' })
  const bookmarks = useApi('library:bookmarks', { kind: 'reading' })
  const [status, setStatus] = useState<StatusFilter>('all')
  const [level, setLevel] = useState<Cefr | 'all'>('all')
  const [category, setCategory] = useState<ReadingPassage['category'] | 'all'>('all')
  const [query, setQuery] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [toDelete, setToDelete] = useState<PassageSummary | null>(null)

  const favSet = useMemo(() => new Set((favorites.data ?? []).map((f) => f.ref)), [favorites.data])
  const passages = useMemo(() => lib.data?.passages ?? [], [lib.data])
  const byId = useMemo(() => new Map(passages.map((p) => [p.id, p])), [passages])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return passages.filter((p) => {
      if (level !== 'all' && p.cefr !== level) return false
      if (category !== 'all' && p.category !== category) return false
      if (status === 'unread' && p.readCount > 0) return false
      if (status === 'read' && p.readCount === 0) return false
      if (status === 'favorites' && !favSet.has(p.id)) return false
      if (status === 'ai' && p.source !== 'ai') return false
      if (q && !`${p.title} ${p.topicTags.join(' ')} ${p.summaryVi}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [passages, level, category, status, query, favSet])

  const continueList = useMemo(() => {
    const seen = new Set<string>()
    return (bookmarks.data ?? []).filter((b) => byId.has(b.ref) && !seen.has(b.ref) && seen.add(b.ref)).slice(0, 3)
  }, [bookmarks.data, byId])

  const deleteGenerated = async (p: PassageSummary) => {
    setToDelete(null)
    try {
      await api('reading:deleteGenerated', { id: p.id })
      toast({ kind: 'success', title: L('Passage deleted', 'Đã xóa bài đọc') })
      void lib.reload()
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  if (lib.error)
    return (
      <div data-testid="page-reading">
        <ErrorState error={lib.error} onRetry={lib.reload} />
      </div>
    )

  const data = lib.data
  const recommended = (data?.recommended ?? []).map((id) => byId.get(id)).filter((p): p is PassageSummary => !!p)
  const wpmSeries = [...(history.data ?? [])].reverse().map((h) => h.wpm)

  return (
    <div data-testid="page-reading" className="mx-auto max-w-6xl">
      <PageHeader
        icon={<BookOpen />}
        title={L('Reading Adventure', 'Phiêu lưu đọc')}
        subtitle={L(
          'Read original stories and articles, tap any word to look it up, then test your understanding.',
          'Đọc truyện và bài viết gốc, bấm vào từ bất kỳ để tra nghĩa, rồi kiểm tra mức hiểu bài.',
        )}
        actions={
          <Button
            variant="primary"
            icon={<Sparkles className="size-4" />}
            onClick={() => setGenOpen(true)}
            data-testid="reading-generate"
          >
            {L('New passage with AI', 'Tạo bài bằng AI')}
          </Button>
        }
      />

      {!data ? (
        <LoadingBlock rows={4} />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              icon={<Target />}
              label={L('Reading level', 'Trình độ đọc')}
              value={<CefrBadge level={data.readingLevel} className="text-base" />}
            />
            <StatTile
              icon={<CheckCircle2 />}
              label={L('Completed', 'Đã đọc')}
              value={fmt.number(data.stats.completed)}
            />
            <StatTile
              icon={<Gauge />}
              label={L('Average speed', 'Tốc độ TB')}
              value={data.stats.averageWpm ? `${data.stats.averageWpm} wpm` : '—'}
              sub={L('words per minute', 'từ mỗi phút')}
            />
            <StatTile
              icon={<Library />}
              label={L('Quiz accuracy', 'Độ chính xác')}
              value={data.stats.averageScore !== null ? `${Math.round(data.stats.averageScore * 100)}%` : '—'}
            />
          </div>

          {continueList.length > 0 && (
            <Section title={L('Continue reading', 'Đọc tiếp')}>
              <div className="flex flex-wrap gap-2">
                {continueList.map((b) => (
                  <Button
                    key={b.id}
                    variant="secondary"
                    icon={<BookMarked className="size-4 text-accent" />}
                    onClick={() => navigate(`/reading/${b.ref}`)}
                  >
                    {byId.get(b.ref)?.title ?? b.title}
                  </Button>
                ))}
              </div>
            </Section>
          )}

          {recommended.length > 0 && (
            <Section title={L(`Recommended for you · ${data.readingLevel}`, `Gợi ý cho bạn · ${data.readingLevel}`)}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="reading-recommended">
                {recommended.map((p, i) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Card interactive onClick={() => navigate(`/reading/${p.id}`)} className="h-full p-4">
                      <CategoryCover category={p.category} className="mb-3 h-20" />
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                        <CefrBadge level={p.cefr} /> {tx(CATEGORY_META[p.category])}
                      </div>
                      <h3 className="font-display text-lg leading-snug font-semibold">{p.title}</h3>
                      <p className="mt-1 flex items-center gap-1 text-xs text-faint">
                        <Clock className="size-3" /> {L(`${p.minutes} min`, `${p.minutes} phút`)} · {p.words}{' '}
                        {L('words', 'từ')}
                      </p>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </Section>
          )}

          <Section title={L('Library', 'Thư viện')}>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Tabs<StatusFilter>
                value={status}
                onChange={setStatus}
                items={[
                  { value: 'all', label: L('All', 'Tất cả'), count: passages.length },
                  { value: 'unread', label: L('Unread', 'Chưa đọc') },
                  { value: 'read', label: L('Read', 'Đã đọc') },
                  { value: 'favorites', label: L('Favorites', 'Yêu thích') },
                  { value: 'ai', label: 'AI' },
                ]}
              />
              <Select
                className="w-36"
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
              <Select
                className="w-44"
                value={category}
                onChange={(e) => setCategory(e.target.value as ReadingPassage['category'] | 'all')}
                aria-label={L('Category', 'Thể loại')}
              >
                <option value="all">{L('All categories', 'Mọi thể loại')}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {tx(CATEGORY_META[c])}
                  </option>
                ))}
              </Select>
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <Input
                  className="pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={L('Search title or topic…', 'Tìm tiêu đề hoặc chủ đề…')}
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<BookOpen />}
                title={L('No passages match', 'Không có bài phù hợp')}
                body={L(
                  'Try another filter, or create a new passage with AI.',
                  'Thử bộ lọc khác, hoặc tạo bài mới bằng AI.',
                )}
                action={
                  <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => setGenOpen(true)}>
                    {L('New passage with AI', 'Tạo bài bằng AI')}
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2" data-testid="reading-list">
                {filtered.map((p) => (
                  <Card
                    key={p.id}
                    interactive
                    onClick={() => navigate(`/reading/${p.id}`)}
                    className="flex gap-4 p-4"
                    data-testid={`reading-item-${p.id}`}
                  >
                    <CategoryCover category={p.category} className="size-16 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-display text-lg leading-snug font-semibold">{p.title}</h3>
                        <div className="-mt-1 -mr-1 flex shrink-0" onClick={(e) => e.stopPropagation()}>
                          <FavoriteButton kind="reading" refId={p.id} title={p.title} />
                          {p.source === 'ai' && (
                            <IconButton label={L('Delete passage', 'Xóa bài đọc')} onClick={() => setToDelete(p)}>
                              <Trash2 className="size-4" />
                            </IconButton>
                          )}
                        </div>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.summaryVi}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-faint">
                        <CefrBadge level={p.cefr} />
                        <span>{tx(CATEGORY_META[p.category])}</span>
                        <span>·</span>
                        <span>
                          {L(`${p.minutes} min`, `${p.minutes} phút`)} · {p.words} {L('words', 'từ')}
                        </span>
                        {p.source === 'ai' && <AiBadge estimated={false} />}
                        {p.readCount > 0 && (
                          <Badge tone="success">
                            <CheckCircle2 className="size-3" />
                            {p.bestScore !== null ? `${Math.round(p.bestScore * 100)}%` : L('Read', 'Đã đọc')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section title={L('Recent reading', 'Lịch sử đọc')}>
            {history.error ? (
              <ErrorState error={history.error} compact onRetry={history.reload} />
            ) : !history.data ? (
              <LoadingBlock rows={2} />
            ) : history.data.length === 0 ? (
              <EmptyState
                icon={<Clock />}
                title={L('Nothing read yet', 'Chưa có bài nào')}
                body={L(
                  'Finish a passage and its quiz to see your speed here.',
                  'Hoàn thành một bài và phần câu hỏi để xem tốc độ đọc ở đây.',
                )}
              />
            ) : (
              <Card className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted">
                    {L('Reading speed trend (wpm)', 'Xu hướng tốc độ đọc (từ/phút)')}
                  </span>
                  <Sparkline values={wpmSeries} width={220} label={L('Reading speed trend', 'Xu hướng tốc độ đọc')} />
                </div>
                <ul className="divide-y divide-line">
                  {history.data.slice(0, 8).map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <button
                        className="font-medium hover:text-accent"
                        onClick={() => navigate(`/reading/${h.passageId}`)}
                      >
                        {h.title}
                      </button>
                      <span className="flex items-center gap-3 text-muted tabular-nums">
                        <span>{h.wpm} wpm</span>
                        <span>{formatClock(h.seconds)}</span>
                        <span>
                          {h.quizCorrect}/{h.quizTotal}
                        </span>
                        <span className="text-faint">{fmt.relative(h.createdAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>
        </>
      )}

      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} defaultLevel={data?.readingLevel ?? 'A2'} />
      <ConfirmDialog
        open={toDelete !== null}
        danger
        title={L('Delete this AI passage?', 'Xóa bài đọc AI này?')}
        body={L(
          'Its highlights will be deleted too. Reading history is kept.',
          'Các đoạn đánh dấu cũng bị xóa. Lịch sử đọc vẫn được giữ.',
        )}
        confirmLabel={L('Delete', 'Xóa')}
        onConfirm={() => toDelete && void deleteGenerated(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
