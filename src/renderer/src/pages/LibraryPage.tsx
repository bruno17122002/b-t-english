// Favorites and bookmarks collected across modules.
import { Bookmark, Heart, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Tabs } from '../components/ui'
import { useFormat, useL } from '../i18n'
import { api, useApi } from '../lib/api'

/** Maps a favorite/bookmark kind to the route that opens it. */
export function routeFor(kind: string, ref: string): string {
  switch (kind) {
    case 'reading':
      return `/reading/${ref}`
    case 'listening':
      return `/listening/${ref}`
    case 'story':
      return `/cinema/${ref}`
    case 'grammar':
      return `/grammar/${ref}`
    case 'writing-prompt':
      return `/writing?prompt=${ref}`
    case 'speaking-prompt':
      return `/speaking?prompt=${ref}`
    case 'vocab':
      return `/vocabulary?word=${ref}`
    case 'tutor':
      return `/tutor/${ref}`
    default:
      return '/'
  }
}

const KIND_LABEL: Record<string, { en: string; vi: string }> = {
  reading: { en: 'Reading', vi: 'Bài đọc' },
  listening: { en: 'Listening', vi: 'Bài nghe' },
  story: { en: 'Cinema', vi: 'Phim' },
  grammar: { en: 'Grammar', vi: 'Ngữ pháp' },
  'writing-prompt': { en: 'Writing', vi: 'Bài viết' },
  'speaking-prompt': { en: 'Speaking', vi: 'Bài nói' },
  vocab: { en: 'Word', vi: 'Từ vựng' },
  tutor: { en: 'Tutor', vi: 'Gia sư' },
}

export function LibraryPage() {
  const L = useL()
  const f = useFormat()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'favorites' | 'bookmarks'>('favorites')
  const favorites = useApi('library:favorites', undefined)
  const bookmarks = useApi('library:bookmarks', undefined)
  const kindLabel = (k: string) => (KIND_LABEL[k] ? L(KIND_LABEL[k].en, KIND_LABEL[k].vi) : k)

  return (
    <div data-testid="page-library">
      <PageHeader
        icon={<Heart />}
        title={L('Favorites & bookmarks', 'Yêu thích & đánh dấu')}
        subtitle={L('Everything you saved to come back to.', 'Mọi thứ bạn đã lưu để quay lại.')}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        items={[
          { value: 'favorites', label: L('Favorites', 'Yêu thích'), count: favorites.data?.length },
          { value: 'bookmarks', label: L('Bookmarks', 'Đánh dấu'), count: bookmarks.data?.length },
        ]}
      />
      {tab === 'favorites' ? (
        favorites.loading && !favorites.data ? (
          <LoadingBlock />
        ) : favorites.error ? (
          <ErrorState error={favorites.error} onRetry={favorites.reload} />
        ) : !favorites.data?.length ? (
          <EmptyState
            icon={<Heart />}
            title={L('No favorites yet', 'Chưa có mục yêu thích')}
            body={L(
              'Tap the heart on any lesson, story or track.',
              'Nhấn biểu tượng trái tim trên bài học, phim hay bài nghe bất kỳ.',
            )}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {favorites.data.map((fav) => (
              <Card
                key={fav.id}
                onClick={() => navigate(routeFor(fav.kind, fav.ref))}
                className="flex items-center gap-3 p-4"
              >
                <Heart className="size-4 shrink-0 fill-danger text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{fav.title}</div>
                  <div className="text-xs text-muted">
                    {kindLabel(fav.kind)} · {f.date(fav.createdAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={L('Remove', 'Bỏ')}
                  onClick={async (e) => {
                    e.stopPropagation()
                    await api('library:toggleFavorite', { kind: fav.kind, ref: fav.ref, title: fav.title })
                    void favorites.reload()
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </Card>
            ))}
          </div>
        )
      ) : bookmarks.loading && !bookmarks.data ? (
        <LoadingBlock />
      ) : bookmarks.error ? (
        <ErrorState error={bookmarks.error} onRetry={bookmarks.reload} />
      ) : !bookmarks.data?.length ? (
        <EmptyState
          icon={<Bookmark />}
          title={L('No bookmarks yet', 'Chưa có đánh dấu')}
          body={L(
            'Bookmark a passage or scene to continue later.',
            'Đánh dấu một đoạn đọc hoặc cảnh phim để học tiếp sau.',
          )}
        />
      ) : (
        <div className="space-y-3">
          {bookmarks.data.map((b) => (
            <Card key={b.id} onClick={() => navigate(routeFor(b.kind, b.ref))} className="flex items-start gap-3 p-4">
              <Bookmark className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{b.title}</div>
                {b.note && <p className="mt-1 text-sm text-muted">{b.note}</p>}
                <div className="mt-1 text-xs text-faint">
                  {kindLabel(b.kind)} · {f.date(b.createdAt)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={L('Delete', 'Xóa')}
                onClick={async (e) => {
                  e.stopPropagation()
                  await api('library:removeBookmark', { id: b.id })
                  void bookmarks.reload()
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
