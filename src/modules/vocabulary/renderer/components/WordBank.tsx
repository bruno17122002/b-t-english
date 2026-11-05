// Word bank list: search, filters (state / topic / source), sort, grid or list layout, quick favorite.
import { Heart, LayoutGrid, Library, List, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { VocabItem } from '@shared/types'
import { SpeakButton } from '@/components/learning'
import { Badge, Button, CefrBadge, cx, EmptyState, ErrorState, IconButton, Input, LoadingBlock, Select } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import { readPref, SORTS, SOURCE_LABEL, STATE_FILTERS, writePref } from '../lib/labels'
import { StrengthMeter } from './bits'

const PAGE = 60

type StateFilter = (typeof STATE_FILTERS)[number]['value']
type Sort = (typeof SORTS)[number]['value']

export function WordBank({ version, onOpen, onAdd, onChanged }: { version: number; onOpen: (v: VocabItem) => void; onAdd: () => void; onChanged: (v: VocabItem) => void }) {
  const L = useL()
  const tx = useTx()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [state, setState] = useState<StateFilter>('')
  const [sort, setSort] = useState<Sort>('recent')
  const [topic, setTopic] = useState('')
  const [source, setSource] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [layout, setLayout] = useState<'grid' | 'list'>(() => (readPref('layout', 'grid') === 'list' ? 'list' : 'grid'))

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])
  useEffect(() => setLimit(PAGE), [debounced, state, sort, topic, source])

  const filter = {
    ...(debounced ? { query: debounced.slice(0, 80) } : {}),
    ...(state ? { state } : {}),
    ...(topic ? { topic } : {}),
    ...(source ? { sourceModule: source } : {}),
    sort,
    limit,
  }
  const list = useApi('vocab:list', filter, [debounced, state, sort, topic, source, limit, version])
  const topics = useApi('vocab:topics', undefined, [version])
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const filtered = !!(debounced || state || topic || source)

  const toggleFav = async (v: VocabItem) => {
    try {
      const updated = await api('vocab:update', { id: v.id, patch: { isFavorite: !v.isFavorite } })
      list.setData((prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.id === v.id ? updated : x)) } : prev ?? { items: [], total: 0 }))
      onChanged(updated)
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  return (
    <div data-testid="vocab-bank">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L('Search words or meanings…', 'Tìm từ hoặc nghĩa…')} className="pl-9" aria-label={L('Search words', 'Tìm từ')} data-testid="vocab-search" />
        </div>
        <Select value={state} onChange={(e) => setState(e.target.value as StateFilter)} className="w-40" aria-label={L('Filter', 'Lọc')}>
          {STATE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {tx(f.label)}
            </option>
          ))}
        </Select>
        <Select value={topic} onChange={(e) => setTopic(e.target.value)} className="w-40" aria-label={L('Topic', 'Chủ đề')}>
          <option value="">{L('All topics', 'Mọi chủ đề')}</option>
          {(topics.data ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-40" aria-label={L('Source', 'Nguồn')}>
          <option value="">{L('All sources', 'Mọi nguồn')}</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {tx(v)}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-44" aria-label={L('Sort', 'Sắp xếp')}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {tx(s.label)}
            </option>
          ))}
        </Select>
        <div className="flex rounded-xl border border-line bg-surface p-0.5">
          {(['grid', 'list'] as const).map((l) => (
            <IconButton
              key={l}
              label={l === 'grid' ? L('Grid view', 'Dạng lưới') : L('List view', 'Dạng danh sách')}
              className={cx('size-8', layout === l && 'bg-surface-3 text-text')}
              onClick={() => {
                setLayout(l)
                writePref('layout', l)
              }}
            >
              {l === 'grid' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
            </IconButton>
          ))}
        </div>
      </div>

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <LoadingBlock rows={4} />
      ) : !items.length ? (
        <EmptyState
          icon={<Library />}
          title={filtered ? L('No words match these filters', 'Không có từ phù hợp bộ lọc') : L('Your word bank is empty', 'Kho từ đang trống')}
          body={
            filtered
              ? L('Try another search or clear the filters.', 'Thử từ khóa khác hoặc bỏ bộ lọc.')
              : L(
                  'Save words while reading, listening or chatting with the tutor – or add one yourself. They are scheduled for review automatically.',
                  'Lưu từ khi đọc, nghe hoặc trò chuyện với gia sư – hoặc tự thêm. Từ sẽ được tự động lên lịch ôn.',
                )
          }
          action={
            !filtered && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={onAdd}>
                {L('Add a word', 'Thêm từ')}
              </Button>
            )
          }
        />
      ) : layout === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((v) => (
            <WordTile key={v.id} v={v} onOpen={() => onOpen(v)} onFav={() => void toggleFav(v)} />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((v) => (
            <WordRow key={v.id} v={v} onOpen={() => onOpen(v)} onFav={() => void toggleFav(v)} />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>{L(`Showing ${items.length} of ${total}`, `Hiển thị ${items.length} / ${total}`)}</span>
          {items.length < total && limit < 500 && (
            <Button size="sm" loading={list.loading} onClick={() => setLimit((l) => Math.min(500, l + PAGE))}>
              {L('Load more', 'Xem thêm')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function FavButton({ v, onFav }: { v: VocabItem; onFav: () => void }) {
  const L = useL()
  return (
    <IconButton
      label={v.isFavorite ? L('Remove from favorites', 'Bỏ yêu thích') : L('Add to favorites', 'Thêm vào yêu thích')}
      onClick={(e) => {
        e.stopPropagation()
        onFav()
      }}
    >
      <Heart className={cx('size-4', v.isFavorite && 'fill-danger text-danger')} />
    </IconButton>
  )
}

function DueLabel({ v }: { v: VocabItem }) {
  const L = useL()
  const fmt = useFormat()
  if (v.review.state === 'new') return <Badge tone="info">{L('New', 'Mới')}</Badge>
  const due = new Date(v.review.dueAt).getTime() <= Date.now()
  return due ? <Badge tone="warning">{L('Due', 'Đến hạn')}</Badge> : <span className="text-xs text-faint">{fmt.relative(v.review.dueAt).replace(/^-/, '')}</span>
}

function WordTile({ v, onOpen, onFav }: { v: VocabItem; onOpen: () => void; onFav: () => void }) {
  const tx = useTx()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group flex cursor-pointer flex-col rounded-2xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-line-strong"
      data-testid="vocab-word"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg font-semibold">{v.word}</span>
            {v.cefr && <CefrBadge level={v.cefr} />}
          </div>
          {v.ipa && <div className="font-mono text-xs text-muted">{v.ipa}</div>}
        </div>
        <SpeakButton text={v.word} />
        <FavButton v={v} onFav={onFav} />
      </div>
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-muted">{v.meaningVi || v.meaningEn || '—'}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StrengthMeter review={v.review} />
        <span className="flex-1" />
        <DueLabel v={v} />
        <Badge tone="neutral">{tx(SOURCE_LABEL[v.sourceModule] ?? { en: v.sourceModule, vi: v.sourceModule })}</Badge>
      </div>
    </div>
  )
}

function WordRow({ v, onOpen, onFav }: { v: VocabItem; onOpen: () => void; onFav: () => void }) {
  const tx = useTx()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2"
      data-testid="vocab-word"
    >
      <SpeakButton text={v.word} />
      <div className="w-48 min-w-0">
        <div className="truncate font-semibold">{v.word}</div>
        {v.ipa && <div className="truncate font-mono text-xs text-muted">{v.ipa}</div>}
      </div>
      <div className="min-w-0 flex-1 truncate text-sm text-muted">{v.meaningVi || v.meaningEn}</div>
      {v.topic && <Badge tone="accent">{v.topic}</Badge>}
      <Badge tone="neutral">{tx(SOURCE_LABEL[v.sourceModule] ?? { en: v.sourceModule, vi: v.sourceModule })}</Badge>
      <StrengthMeter review={v.review} />
      <div className="w-20 text-right">
        <DueLabel v={v} />
      </div>
      <FavButton v={v} onFav={onFav} />
    </div>
  )
}
