// Vocabulary hub page: word bank (stats, filters, edit), practice modes and dictionary.
// Handles /vocabulary?word=<id> (open that word) and /vocabulary?lookup=<word> (open the dictionary).
import { BookOpen, Library, Play, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { VocabItem } from '@shared/types'
import { Button, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import { DictionaryPanel } from '../components/DictionaryPanel'
import { PracticePanel } from '../components/PracticePanel'
import { StatsHeader } from '../components/StatsHeader'
import { WordBank } from '../components/WordBank'
import { WordDetail } from '../components/WordDetail'
import { WordEditor } from '../components/WordEditor'

type Tab = 'bank' | 'practice' | 'dictionary'

const tabFromPath = (path: string): Tab =>
  path.startsWith('/vocabulary/practice') ? 'practice' : path.startsWith('/vocabulary/dictionary') ? 'dictionary' : 'bank'

export default function VocabularyPage() {
  const L = useL()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const lookup = params.get('lookup')?.trim().slice(0, 80) || ''
  const wordParam = params.get('word')
  const tab: Tab = lookup ? 'dictionary' : tabFromPath(location.pathname)

  const [version, setVersion] = useState(0)
  const stats = useApi('vocab:stats', undefined, [version])
  const [detail, setDetail] = useState<VocabItem | null>(null)
  const [editing, setEditing] = useState<VocabItem | null>(null)
  const [adding, setAdding] = useState(false)

  const bump = () => setVersion((v) => v + 1)

  // ?word=<id> → open that word.
  useEffect(() => {
    if (!wordParam || !/^\d+$/.test(wordParam)) return
    let alive = true
    api('vocab:get', { id: Number(wordParam) })
      .then((item) => {
        if (!alive) return
        if (item) setDetail(item)
        else useApp.getState().toast({ kind: 'info', title: L('That word is no longer in your word bank.', 'Từ này không còn trong kho từ.') })
      })
      .catch((err) => alive && useApp.getState().toast({ kind: 'error', title: toApiError(err).message }))
    return () => {
      alive = false
    }
  }, [wordParam, L])

  const closeDetail = () => {
    setDetail(null)
    if (wordParam) {
      const next = new URLSearchParams(params)
      next.delete('word')
      setParams(next, { replace: true })
    }
  }

  const goTab = (t: Tab) => navigate(t === 'bank' ? '/vocabulary' : `/vocabulary/${t}`)
  const due = stats.data?.dueNow ?? 0

  return (
    <div data-testid="page-vocabulary">
      <PageHeader
        icon={<Library />}
        title={L('Vocabulary', 'Từ vựng')}
        subtitle={L('Every word you save is scheduled with spaced repetition (FSRS).', 'Mọi từ bạn lưu đều được lên lịch ôn theo phương pháp lặp lại ngắt quãng (FSRS).')}
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)} data-testid="vocab-add">
              {L('Add word', 'Thêm từ')}
            </Button>
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => navigate('/vocabulary/review')} data-testid="vocab-review-start">
              {due ? L(`Review ${due} due`, `Ôn ${due} thẻ đến hạn`) : L('Review', 'Ôn tập')}
            </Button>
          </>
        }
      />

      <div className="mb-6">
        {stats.error ? (
          <ErrorState compact error={stats.error} onRetry={stats.reload} />
        ) : stats.data ? (
          <StatsHeader stats={stats.data} />
        ) : (
          <Skeleton className="h-44" />
        )}
      </div>

      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={goTab}
        items={[
          { value: 'bank', label: L('Word bank', 'Kho từ'), count: stats.data?.total },
          { value: 'practice', label: L('Practice', 'Luyện tập') },
          { value: 'dictionary', label: (
              <span className="flex items-center gap-1.5">
                <BookOpen className="size-4" />
                {L('Dictionary', 'Từ điển')}
              </span>
            ) },
        ]}
      />

      {tab === 'bank' && <WordBank version={version} onOpen={setDetail} onAdd={() => setAdding(true)} onChanged={bump} />}
      {tab === 'practice' && <PracticePanel onGoToBank={() => goTab('bank')} />}
      {tab === 'dictionary' && <DictionaryPanel initialWord={lookup || undefined} onSaved={bump} />}

      <WordDetail
        item={editing ? null : detail}
        onClose={closeDetail}
        onEdit={(v) => setEditing(v)}
        onChanged={(v) => {
          setDetail(v)
          bump()
        }}
        onDeleted={() => {
          closeDetail()
          bump()
        }}
      />
      <WordEditor
        open={adding || !!editing}
        item={editing}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSaved={(v) => {
          if (editing) setDetail(v)
          setAdding(false)
          setEditing(null)
          bump()
        }}
      />
    </div>
  )
}
