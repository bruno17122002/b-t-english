// Offline dictionary search (472 entries + content glossaries) with AI explanation on demand and save.
import { BookOpen, Check, Search, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DictionaryResult, SearchResult } from '@shared/types'
import { AiBadge, SpeakButton } from '@/components/learning'
import { Badge, Button, CefrBadge, cx, EmptyState, ErrorState, Input, Spinner } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, type ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'

export function DictionaryPanel({ initialWord, onSaved }: { initialWord?: string; onSaved: () => void }) {
  const L = useL()
  const [q, setQ] = useState(initialWord ?? '')
  const [hits, setHits] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<string | null>(initialWord?.trim() || null)

  useEffect(() => {
    if (initialWord?.trim()) {
      setQ(initialWord)
      setSelected(initialWord.trim())
    }
  }, [initialWord])

  // Browse (empty query) or search the whole offline dictionary; saved words are merged in by the lookup itself.
  useEffect(() => {
    const term = q.trim()
    let alive = true
    setSearching(true)
    const t = setTimeout(
      () => {
        api('vocab:dictionary', { query: term.slice(0, 80) || undefined, limit: 200 })
          .then(
            (res) =>
              alive &&
              setHits(
                res.items.map((e) => ({
                  kind: 'dictionary' as const,
                  id: e.word,
                  title: e.word,
                  subtitle: e.meaningVi,
                  route: '',
                })),
              ),
          )
          .catch(() => alive && setHits([]))
          .finally(() => alive && setSearching(false))
      },
      term ? 200 : 0,
    )
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])

  const exactListed = hits?.some((h) => h.title.toLowerCase() === q.trim().toLowerCase())

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]" data-testid="vocab-dictionary">
      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && q.trim() && setSelected(q.trim())}
            placeholder={L('English word or Vietnamese meaning…', 'Từ tiếng Anh hoặc nghĩa tiếng Việt…')}
            className="pl-9"
            aria-label={L('Search the dictionary', 'Tra từ điển')}
            data-testid="dictionary-search"
          />
        </div>
        <div className="mt-2 max-h-[55vh] overflow-y-auto">
          {searching && !hits ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : hits === null ? (
            <p className="p-4 text-sm text-muted">
              {L('Type to search the offline dictionary.', 'Gõ để tra từ điển offline.')}
            </p>
          ) : (
            <ul className="space-y-0.5 pt-1">
              {q.trim() && !exactListed && (
                <li>
                  <button
                    onClick={() => setSelected(q.trim())}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-accent hover:bg-surface-2"
                  >
                    {L(`Look up “${q.trim()}”`, `Tra “${q.trim()}”`)}
                  </button>
                </li>
              )}
              {hits.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <button
                    onClick={() => setSelected(h.title)}
                    className={cx(
                      'flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2',
                      selected?.toLowerCase() === h.title.toLowerCase() && 'bg-surface-3',
                    )}
                  >
                    <span className="font-semibold">{h.title}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{h.subtitle}</span>
                    {h.kind === 'vocab' && (
                      <Check className="size-3.5 shrink-0 text-success" aria-label={L('Saved', 'Đã lưu')} />
                    )}
                  </button>
                </li>
              ))}
              {!hits.length && !searching && (
                <li className="px-3 py-2 text-sm text-muted">
                  {L('No dictionary matches.', 'Không tìm thấy trong từ điển.')}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      <div>
        {selected ? (
          <Entry key={selected} word={selected} onSaved={onSaved} />
        ) : (
          <EmptyState
            icon={<BookOpen />}
            title={L('Pick a word', 'Chọn một từ')}
            body={L(
              'Meanings, IPA, examples and collocations appear here.',
              'Nghĩa, phiên âm, ví dụ và cụm từ đi kèm sẽ hiện ở đây.',
            )}
          />
        )}
      </div>
    </div>
  )
}

function Entry({ word, onSaved }: { word: string; onSaved: () => void }) {
  const L = useL()
  const [result, setResult] = useState<DictionaryResult | null | undefined>(undefined)
  const [error, setError] = useState<ApiError | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api('vocab:lookup', { word })
      .then((r) => alive && setResult(r))
      .catch((err) => {
        if (!alive) return
        setError(toApiError(err))
        setResult(null)
      })
    return () => {
      alive = false
    }
  }, [word])

  const askAi = async () => {
    setAiLoading(true)
    setError(null)
    try {
      setResult(await api('vocab:lookup', { word, useAi: true }))
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setAiLoading(false)
    }
  }

  const save = async () => {
    if (!result) return
    const e = result.entry
    setSaving(true)
    try {
      const res = await api('vocab:save', {
        word: e.word,
        ipa: e.ipa === '-' ? '' : e.ipa,
        pos: e.pos === '-' ? '' : e.pos,
        meaningVi: e.meaningVi,
        meaningEn: e.meaningEn,
        examples: e.example ? [e.example] : [],
        collocations: (e.collocations ?? []).slice(0, 10),
        topic: e.topic,
        cefr: e.cefr ?? null,
        sourceModule: 'dictionary',
      })
      setResult({ ...result, saved: true })
      useApp.getState().toast({
        kind: 'success',
        title: res.created
          ? L(`Saved “${e.word}”`, `Đã lưu “${e.word}”`)
          : L(`“${e.word}” is already in your word bank`, `“${e.word}” đã có trong kho từ`),
      })
      void useApp.getState().refreshGame()
      onSaved()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setSaving(false)
    }
  }

  if (result === undefined)
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <Spinner />
      </div>
    )
  const e = result?.entry
  return (
    <div className="rounded-2xl border border-line bg-surface p-6" data-testid="dictionary-entry">
      {e ? (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-3xl font-semibold">{e.word}</h2>
                {e.cefr && <CefrBadge level={e.cefr} />}
                {result.source === 'ai' ? (
                  <AiBadge estimated={false} />
                ) : (
                  <Badge tone="neutral">
                    {result.source === 'offline'
                      ? L('Offline dictionary', 'Từ điển offline')
                      : L('From a lesson', 'Từ bài học')}
                  </Badge>
                )}
              </div>
              <div className="mt-1 font-mono text-muted">
                {e.ipa !== '-' && e.ipa} {e.pos !== '-' && <span className="italic">· {e.pos}</span>}
              </div>
            </div>
            <SpeakButton text={e.word} size="sm" />
          </div>
          <div className="mt-5 space-y-3">
            <p className="text-lg font-medium">{e.meaningVi}</p>
            <p className="text-muted">{e.meaningEn}</p>
            {e.example && (
              <div className="flex items-start gap-2 border-l-2 border-accent/50 pl-3">
                <p className="pt-2 text-muted italic">{e.example}</p>
                <SpeakButton text={e.example} />
              </div>
            )}
            {!!e.collocations?.length && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {e.collocations.map((c) => (
                  <span key={c} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs">
                    {c}
                  </span>
                ))}
              </div>
            )}
            {e.topic && <Badge tone="accent">{e.topic}</Badge>}
          </div>
        </>
      ) : (
        <EmptyState
          icon={<BookOpen />}
          title={L(`“${word}” is not in the offline dictionary`, `“${word}” chưa có trong từ điển offline`)}
          body={L(
            'Ask AI for a learner-friendly explanation, then save it.',
            'Hỏi AI để có giải thích dễ hiểu, rồi lưu lại.',
          )}
        />
      )}
      {error && (
        <div className="mt-4">
          <ErrorState compact error={error} />
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {e && (
          <Button
            variant={result.saved ? 'success' : 'primary'}
            disabled={result.saved}
            loading={saving}
            icon={<Check className="size-4" />}
            onClick={() => void save()}
            data-testid="dictionary-save"
          >
            {result.saved ? L('In your word bank', 'Đã có trong kho từ') : L('Save to word bank', 'Lưu vào kho từ')}
          </Button>
        )}
        {result?.source !== 'ai' && (
          <Button
            variant="secondary"
            loading={aiLoading}
            icon={<Sparkles className="size-4" />}
            onClick={() => void askAi()}
          >
            {L('Explain with AI', 'Giải thích bằng AI')}
          </Button>
        )}
      </div>
    </div>
  )
}
