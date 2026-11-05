// One speaking prompt: chooses the practice UI by kind and lists recent sessions for it.
import { ArrowLeft, Mic } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, CefrBadge, EmptyState, ErrorState, LoadingBlock, Section } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import { CueCardPractice } from '../components/CueCardPractice'
import { RoleplayPractice } from '../components/RoleplayPractice'
import { ScenarioPractice } from '../components/ScenarioPractice'
import { SentencePractice } from '../components/SentencePractice'
import { KIND_META, useAiReady } from '../lib/shared'

export default function PracticePage() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const ai = useAiReady()
  const { data: prompt, error, loading, reload } = useApi('speaking:prompt', { id }, [id])
  const history = useApi('speaking:history', { promptId: id, limit: 10 }, [id])

  const back = (
    <Button
      variant="ghost"
      size="sm"
      icon={<ArrowLeft className="size-4" />}
      onClick={() => navigate('/speaking')}
      className="mb-4"
    >
      {L('Speaking Studio', 'Phòng nói')}
    </Button>
  )

  if ((loading && !prompt) || ai.loading)
    return (
      <div data-testid="page-speaking">
        {back}
        <LoadingBlock rows={4} />
      </div>
    )
  if (error || !prompt)
    return (
      <div data-testid="page-speaking">
        {back}
        {error?.code === 'not_found' ? (
          <EmptyState icon={<Mic />} title={L('Practice not found', 'Không tìm thấy bài luyện')} body={error.message} />
        ) : (
          <ErrorState error={error ?? L('Not found', 'Không tìm thấy')} onRetry={reload} />
        )}
      </div>
    )

  const meta = KIND_META[prompt.source === 'cadence' ? 'scenario' : prompt.kind]
  const Icon = meta.icon
  const onSaved = () => void history.reload()

  return (
    <div data-testid="page-speaking">
      {back}
      <header className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <CefrBadge level={prompt.cefr} />
          <Badge tone="neutral">
            <Icon className="size-3" /> {tx(meta)}
          </Badge>
          {prompt.source === 'cadence' && <Badge tone="info">Cadence (MIT)</Badge>}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{prompt.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{prompt.scenario?.summary ?? prompt.instructionsVi}</p>
      </header>

      {prompt.scenario ? (
        <ScenarioPractice
          key={prompt.id}
          prompt={prompt}
          scenario={prompt.scenario}
          aiReady={ai.ready}
          onSaved={onSaved}
        />
      ) : prompt.kind === 'shadowing' || prompt.kind === 'repeat' ? (
        <SentencePractice key={prompt.id} prompt={prompt} aiReady={ai.ready} onSaved={onSaved} />
      ) : prompt.kind === 'roleplay' || prompt.kind === 'real-world' ? (
        <RoleplayPractice key={prompt.id} prompt={prompt} aiReady={ai.ready} onSaved={onSaved} />
      ) : (
        <CueCardPractice key={prompt.id} prompt={prompt} aiReady={ai.ready} onSaved={onSaved} />
      )}

      {(history.data?.length ?? 0) > 0 && (
        <Section title={L('Recent sessions', 'Các lượt gần đây')} className="mt-10">
          <div className="overflow-hidden rounded-2xl border border-line">
            <table className="w-full text-sm">
              <tbody>
                {history.data?.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap text-muted">{fmt.relative(s.createdAt)}</td>
                    <td className="max-w-md truncate px-4 py-2">
                      {s.transcript || (
                        <span className="text-faint">{L('(no transcript)', '(chưa có bản chép lời)')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums">{s.measured.speakingSec}s</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {s.measured.wordAccuracy !== null
                        ? `${Math.round(s.measured.wordAccuracy * 100)}%`
                        : s.feedback
                          ? `${s.feedback.cefrEstimate}`
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  )
}
