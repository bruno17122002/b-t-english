// Cinema library: bundled and AI-generated interactive films with poster art, progress and favourites,
// plus the "create a story with AI" dialog.
import { motion } from 'framer-motion'
import { Clapperboard, Film, Play, RotateCcw, Trash2, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CEFR_LEVELS, STORY_GENRES, type Cefr } from '@shared/content'
import { AiBadge, FavoriteButton } from '@/components/learning'
import {
  Badge,
  Button,
  CefrBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  ProgressBar,
  Section,
  Select,
  Tabs,
} from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { CinemaLibrary } from '../../contract'
import { genreMeta, GENRES, Poster, type Genre } from '../components/genre'

type Filter = 'all' | 'progress' | 'completed' | 'favorites' | 'ai'
type Item = CinemaLibrary['stories'][number]

const ENDING_TONE = { good: 'success', neutral: 'warning', bad: 'danger' } as const

export default function LibraryPage() {
  const L = useL()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi('cinema:list', undefined, [])
  const [filter, setFilter] = useState<Filter>('all')
  const [genre, setGenre] = useState<Genre | ''>('')
  const [level, setLevel] = useState<Cefr | ''>('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const toast = useApp((s) => s.toast)

  const stories = useMemo(() => {
    const all = data?.stories ?? []
    return all.filter((s) => {
      if (genre && s.genre !== genre) return false
      if (level && s.cefr !== level) return false
      if (filter === 'progress') return !!s.progress && !s.progress.completedAt
      if (filter === 'completed') return !!s.progress?.completedAt
      if (filter === 'favorites') return s.favorite
      if (filter === 'ai') return s.source === 'ai'
      return true
    })
  }, [data, filter, genre, level])
  const continuing = (data?.stories ?? []).filter(
    (s) => s.progress && !s.progress.completedAt && s.progress.path.length > 1,
  )

  const remove = async () => {
    if (!deleting) return
    try {
      await api('cinema:deleteStory', { id: deleting.id })
      toast({ kind: 'success', title: L('Story deleted', 'Đã xóa phim') })
      void reload()
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div data-testid="page-cinema">
      <PageHeader
        icon={<Clapperboard />}
        title={L('Cinema Mode', 'Rạp phim')}
        subtitle={L(
          'Interactive mini-films: listen, choose what to say, and change the ending.',
          'Phim tương tác: nghe, chọn câu nói và thay đổi cái kết.',
        )}
        actions={
          <Button
            variant="primary"
            icon={<WandSparkles className="size-4" />}
            onClick={() => setCreating(true)}
            data-testid="cinema-create"
          >
            {L('Create a story with AI', 'Tạo phim bằng AI')}
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          {continuing.length > 0 && filter === 'all' && (
            <Section title={L('Continue watching', 'Xem tiếp')}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {continuing.slice(0, 3).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/cinema/${s.id}`)}
                    className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-2 text-left transition hover:border-line-strong"
                  >
                    <Poster
                      title=""
                      genre={s.genre}
                      backdrop={s.startBackdrop}
                      mood={s.startMood}
                      className="h-16 w-28 shrink-0 rounded-xl"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.title}</span>
                      <span className="text-xs text-muted">
                        {L(`Scene ${s.progress?.path.length ?? 1}`, `Cảnh ${s.progress?.path.length ?? 1}`)}
                      </span>
                    </span>
                    <Play className="mr-2 size-5 text-accent transition group-hover:scale-110" />
                  </button>
                ))}
              </div>
            </Section>
          )}

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Tabs<Filter>
              value={filter}
              onChange={(f) => {
                setFilter(f)
                if (f === 'favorites') void reload()
              }}
              items={[
                { value: 'all', label: L('All', 'Tất cả'), count: data?.stories.length },
                { value: 'progress', label: L('In progress', 'Đang xem') },
                { value: 'completed', label: L('Finished', 'Đã xem hết') },
                { value: 'favorites', label: L('Favourites', 'Yêu thích') },
                { value: 'ai', label: 'AI' },
              ]}
            />
            <Select
              value={genre}
              onChange={(e) => setGenre(e.target.value as Genre | '')}
              className="w-auto min-w-44"
              aria-label={L('Genre', 'Thể loại')}
            >
              <option value="">{L('All genres', 'Mọi thể loại')}</option>
              {STORY_GENRES.map((g) => (
                <option key={g} value={g}>
                  {L(GENRES[g].en, GENRES[g].vi)}
                </option>
              ))}
            </Select>
            <Select
              value={level}
              onChange={(e) => setLevel(e.target.value as Cefr | '')}
              className="w-auto min-w-28"
              aria-label={L('Level', 'Trình độ')}
            >
              <option value="">{L('All levels', 'Mọi trình độ')}</option>
              {CEFR_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          {stories.length === 0 ? (
            <EmptyState
              icon={<Film />}
              title={L('No films here yet', 'Chưa có phim nào ở đây')}
              body={
                filter === 'ai'
                  ? L('Create your own original story with AI.', 'Hãy tạo một bộ phim của riêng bạn bằng AI.')
                  : L('Try another filter.', 'Thử bộ lọc khác.')
              }
              action={
                filter === 'ai' ? (
                  <Button onClick={() => setCreating(true)}>{L('Create a story', 'Tạo phim')}</Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {stories.map((s, i) => (
                <StoryCard
                  key={s.id}
                  story={s}
                  index={i}
                  onOpen={() => navigate(`/cinema/${s.id}`)}
                  onDelete={() => setDeleting(s)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <CreateStoryModal
        open={creating}
        onClose={() => setCreating(false)}
        aiAvailable={data?.aiAvailable ?? false}
        onCreated={(id) => navigate(`/cinema/${id}`)}
      />
      <ConfirmDialog
        open={!!deleting}
        title={L('Delete this AI story?', 'Xóa phim AI này?')}
        body={L(
          `“${deleting?.title ?? ''}” and its progress will be removed.`,
          `“${deleting?.title ?? ''}” và tiến độ xem sẽ bị xóa.`,
        )}
        confirmLabel={L('Delete', 'Xóa')}
        danger
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

function StoryCard({
  story,
  index,
  onOpen,
  onDelete,
}: {
  story: Item
  index: number
  onOpen: () => void
  onDelete: () => void
}) {
  const L = useL()
  const tx = useTx()
  const g = genreMeta(story.genre)
  const p = story.progress
  const done = !!p?.completedAt
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
        data-testid={`cinema-story-${story.id}`}
        className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-1 hover:border-line-strong"
      >
        <Poster
          title={story.title}
          genre={story.genre}
          backdrop={story.startBackdrop}
          mood={story.startMood}
          className="aspect-[16/10]"
        >
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            {story.source === 'ai' && <AiBadge estimated={false} />}
            <CefrBadge level={story.cefr} className="bg-black/50 backdrop-blur" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
            <span className="flex size-14 items-center justify-center rounded-full bg-white/90 text-black shadow-xl">
              {done ? <RotateCcw className="size-6" /> : <Play className="ml-1 size-6" />}
            </span>
          </div>
        </Poster>
        <div className="flex flex-1 flex-col p-4">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted">
            <span className="font-semibold" style={{ color: g.from }}>
              {tx(g)}
            </span>
            <span>·</span>
            <span>{L(`${story.sceneCount} scenes`, `${story.sceneCount} cảnh`)}</span>
            <span className="ml-auto flex" onClick={(e) => e.stopPropagation()}>
              <FavoriteButton kind="story" refId={story.id} title={story.title} />
              {story.source === 'ai' && (
                <IconButton label={L('Delete', 'Xóa')} onClick={onDelete}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </span>
          </div>
          <p className="line-clamp-3 text-sm text-muted">{L(story.synopsisEn, story.synopsisVi)}</p>
          <div className="mt-auto pt-3">
            {done && p?.endingType ? (
              <Badge tone={ENDING_TONE[p.endingType]}>
                {p.endingType === 'good'
                  ? L('Good ending', 'Kết có hậu')
                  : p.endingType === 'neutral'
                    ? L('Neutral ending', 'Kết bình thường')
                    : L('Bad ending', 'Kết chưa vui')}
              </Badge>
            ) : p ? (
              <div className="flex items-center gap-2 text-xs text-muted">
                <ProgressBar
                  value={Math.min(p.path.length, story.sceneCount)}
                  max={Math.max(4, Math.round(story.sceneCount * 0.6))}
                  className="flex-1"
                />
                {L(`Scene ${p.path.length}`, `Cảnh ${p.path.length}`)}
              </div>
            ) : (
              <span className="text-xs text-faint">{L('Not started', 'Chưa xem')}</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function CreateStoryModal({
  open,
  onClose,
  aiAvailable,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  aiAvailable: boolean
  onCreated: (id: string) => void
}) {
  const L = useL()
  const overall = useApp((s) => s.profile?.overallCefr) ?? 'A2'
  const [genre, setGenre] = useState<Genre>('social')
  const [cefr, setCefr] = useState<Cefr>(overall)
  const [length, setLength] = useState<'short' | 'medium'>('short')
  const [theme, setTheme] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const create = async () => {
    setPending(true)
    setError(null)
    try {
      const res = await api('cinema:generate', { genre, cefr, length, theme: theme.trim() || undefined })
      onClose()
      onCreated(res.summary.id)
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !pending && onClose()}
      title={L('Create an original story', 'Tạo một bộ phim mới')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {L('Cancel', 'Hủy')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={create}
            icon={<WandSparkles className="size-4" />}
            data-testid="cinema-generate"
          >
            {pending ? L('Writing your film…', 'Đang viết kịch bản…') : L('Create', 'Tạo phim')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!aiAvailable && (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            {L(
              'This feature needs an AI key (Gemini or OpenAI). The 7 bundled films work offline.',
              'Tính năng này cần API key (Gemini hoặc OpenAI). 7 phim có sẵn vẫn xem được offline.',
            )}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={L('Genre', 'Thể loại')}>
            <Select value={genre} onChange={(e) => setGenre(e.target.value as Genre)}>
              {STORY_GENRES.map((g) => (
                <option key={g} value={g}>
                  {L(GENRES[g].en, GENRES[g].vi)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L('Level', 'Trình độ')}>
            <Select value={cefr} onChange={(e) => setCefr(e.target.value as Cefr)}>
              {CEFR_LEVELS.slice(0, 5).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={L('Length', 'Độ dài')}>
          <Tabs<'short' | 'medium'>
            value={length}
            onChange={setLength}
            items={[
              { value: 'short', label: L('Short · 4–6 scenes', 'Ngắn · 4–6 cảnh') },
              { value: 'medium', label: L('Medium · 7–10 scenes', 'Vừa · 7–10 cảnh') },
            ]}
          />
        </Field>
        <Field
          label={L('Story idea (optional)', 'Ý tưởng (không bắt buộc)')}
          hint={L('e.g. “a lost dog at the airport”', 'ví dụ: “một chú chó lạc ở sân bay”')}
        >
          <Input value={theme} maxLength={160} onChange={(e) => setTheme(e.target.value)} />
        </Field>
        <p className="text-xs text-faint">
          {L(
            'Stories are original and checked automatically: every path must reach an ending.',
            'Phim do AI viết mới hoàn toàn và được kiểm tra tự động: mọi nhánh đều phải dẫn tới một cái kết.',
          )}
        </p>
        {error && <ErrorState error={error} />}
      </div>
    </Modal>
  )
}
