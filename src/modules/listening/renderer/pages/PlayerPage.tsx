// Listening track page: player plus the three practice stages (gist → dictation → shadow & review).
import { ArrowLeft, Check, Clock, Ear, History, Mic, PenLine, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AiBadge, FavoriteButton } from '@/components/learning'
import {
  Badge,
  Button,
  CefrBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingBlock,
  Section,
  Tabs,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { TrackDetail } from '../../contract'
import { DictationStage } from '../components/DictationStage'
import { GistStage } from '../components/GistStage'
import { PlayerBar } from '../components/PlayerBar'
import { ShadowStage } from '../components/ShadowStage'
import { ACCENT_LABEL, KIND_META, MODE_LABEL, formatDuration, pct } from '../lib/meta'
import { useTrackPlayer } from '../lib/usePlayer'

type Stage = 'gist' | 'dictation' | 'shadow'

export default function PlayerPage() {
  const L = useL()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data, error, loading, reload, setData } = useApi('listening:get', { id }, [id])

  return (
    <div data-testid="page-listening">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="size-4" />}
        onClick={() => navigate('/listening')}
        className="mb-4"
      >
        {L('All tracks', 'Tất cả bài nghe')}
      </Button>
      {loading && !data ? (
        <LoadingBlock rows={5} />
      ) : error ? (
        error.code === 'not_found' ? (
          <EmptyState
            icon={<Ear />}
            title={L('Track not found', 'Không tìm thấy bài nghe')}
            body={error.message}
            action={<Button onClick={() => navigate('/listening')}>{L('Back to library', 'Về thư viện')}</Button>}
          />
        ) : (
          <ErrorState error={error} onRetry={reload} />
        )
      ) : data ? (
        <TrackView
          key={data.track.id}
          detail={data}
          onSaved={() => {
            void api('listening:get', { id }).then(setData, () => undefined)
            void useApp.getState().refreshGame()
          }}
        />
      ) : null}
    </div>
  )
}

function TrackView({ detail, onSaved }: { detail: TrackDetail; onSaved: () => void }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const { track, summary, history, gaps } = detail
  const player = useTrackPlayer(track)
  const [stage, setStage] = useState<Stage>(() =>
    summary.modesDone.includes('gist')
      ? summary.modesDone.some((m) => m === 'dictation' || m === 'gap')
        ? 'shadow'
        : 'dictation'
      : 'gist',
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toast = useApp((s) => s.toast)
  const Kind = KIND_META[track.kind].icon

  useEffect(() => player.stop, [stage, player.stop])

  const doneMark = (s: Stage) =>
    (
      s === 'dictation'
        ? summary.modesDone.some((m) => m === 'dictation' || m === 'gap')
        : summary.modesDone.includes(s)
    ) ? (
      <Check className="ml-1 inline size-3.5 text-success" aria-label="done" />
    ) : null

  const remove = async () => {
    setConfirmDelete(false)
    try {
      await api('listening:deleteGenerated', { id: track.id })
      toast({ kind: 'success', title: L('Track deleted', 'Đã xoá bài nghe') })
      navigate('/listening')
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <CefrBadge level={track.cefr} />
            <Badge tone="neutral">{tx(ACCENT_LABEL[track.accent])}</Badge>
            <Badge tone="neutral">
              <Kind className="size-3" /> {tx(KIND_META[track.kind])}
            </Badge>
            <Badge tone="neutral">
              <Clock className="size-3" />~{formatDuration(summary.estSeconds)}
            </Badge>
            {summary.source === 'ai' && <AiBadge estimated={false} />}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{track.title}</h1>
          <p className="mt-1 text-sm text-muted capitalize">
            {track.topic} · {track.speakers.map((s) => s.name).join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <FavoriteButton kind="listening" refId={track.id} title={track.title} />
          {summary.source === 'ai' && (
            <IconButton label={L('Delete this AI track', 'Xoá bài do AI tạo')} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </header>

      <div className="sticky top-0 z-20 -mx-1 mb-5 bg-bg px-1 py-2">
        <PlayerBar track={track} player={player} />
      </div>

      <Tabs<Stage>
        value={stage}
        onChange={setStage}
        className="mb-5"
        items={[
          {
            value: 'gist',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Ear className="size-4" />
                1. {L('Gist', 'Ý chính')}
                {doneMark('gist')}
              </span>
            ),
          },
          {
            value: 'dictation',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <PenLine className="size-4" />
                2. {L('Dictation', 'Chép chính tả')}
                {doneMark('dictation')}
              </span>
            ),
          },
          {
            value: 'shadow',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Mic className="size-4" />
                3. {L('Shadow & review', 'Nói đuổi & ôn')}
                {doneMark('shadow')}
              </span>
            ),
          },
        ]}
      />

      {stage === 'gist' && (
        <GistStage track={track} player={player} onSaved={onSaved} onNext={() => setStage('dictation')} />
      )}
      {stage === 'dictation' && (
        <DictationStage track={track} gaps={gaps} player={player} onSaved={onSaved} onNext={() => setStage('shadow')} />
      )}
      {stage === 'shadow' && <ShadowStage track={track} player={player} onSaved={onSaved} />}

      {history.length > 0 && (
        <Section
          title={
            <span className="inline-flex items-center gap-2">
              <History className="size-4" />
              {L('Your attempts', 'Lịch sử luyện')}
            </span>
          }
          className="mt-10"
        >
          <div className="overflow-hidden rounded-2xl border border-line">
            <table className="w-full text-sm">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 text-muted">
                      {fmt.date(h.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2">{tx(MODE_LABEL[h.mode])}</td>
                    <td className="px-4 py-2 text-muted tabular-nums">
                      {h.correct}/{h.total}
                    </td>
                    <td className="px-4 py-2 font-semibold tabular-nums">{pct(h.accuracy)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-faint">{h.speed.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={L('Delete this track?', 'Xoá bài nghe này?')}
        body={L(
          'The AI-generated script will be removed. Your attempt history is kept.',
          'Kịch bản do AI tạo sẽ bị xoá. Lịch sử luyện tập vẫn được giữ.',
        )}
        confirmLabel={L('Delete', 'Xoá')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
