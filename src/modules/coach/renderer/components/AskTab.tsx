// "Ask AI about my habits": free question with suggested prompts; answers use the habit statistics as context.
import { MessageCircleQuestion, Send } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Select, Textarea } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, useAction, useApi } from '@/lib/api'
import type { AskResult, CoachPeriod } from '../../types'
import { PERIOD_LABELS } from '../meta'
import { SourceBadge } from './shared'

const SUGGESTIONS = [
  { en: 'When is my best time to study?', vi: 'Khi nào là giờ học hiệu quả nhất của tôi?' },
  { en: 'Which skill am I neglecting?', vi: 'Tôi đang bỏ bê kỹ năng nào?' },
  { en: 'Am I on track for IELTS 6.5?', vi: 'Tôi có đang đúng hướng để đạt IELTS 6.5 không?' },
  { en: 'How can I study more regularly?', vi: 'Làm sao để học đều đặn hơn?' },
]

export function AskTab() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const [question, setQuestion] = useState('')
  const [period, setPeriod] = useState<CoachPeriod>('week')
  const history = useApi('coach:qaHistory', undefined, [])
  const ask = useAction((q: string) => api('coach:askHabits', { question: q, period }))
  const submit = async (q: string) => {
    if (q.trim().length < 2) return
    const res = await ask.run(q.trim())
    if (res) {
      setQuestion('')
      history.setData((prev: AskResult[] | undefined) => [res, ...(prev ?? [])])
    }
  }

  return (
    <div data-testid="coach-ask" className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      <Card>
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <MessageCircleQuestion className="size-4 text-accent" />
          {L('Ask about your habits', 'Hỏi về thói quen học')}
        </h3>
        <Textarea
          value={question}
          maxLength={500}
          data-testid="coach-question"
          placeholder={L('e.g. Why did I study less this week?', 'VD: Vì sao tuần này tôi học ít hơn?')}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(question)
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Select
            className="w-36"
            value={period}
            onChange={(e) => setPeriod(e.target.value as CoachPeriod)}
            aria-label={L('Period', 'Kỳ')}
          >
            {(['day', 'week', 'month'] as const).map((p) => (
              <option key={p} value={p}>
                {tx(PERIOD_LABELS[p])}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            icon={<Send className="size-4" />}
            loading={ask.pending}
            disabled={question.trim().length < 2}
            onClick={() => void submit(question)}
            data-testid="coach-ask-submit"
          >
            {L('Ask', 'Hỏi')}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.en}
              type="button"
              className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-muted hover:text-text"
              onClick={() => void submit(tx(s))}
            >
              {tx(s)}
            </button>
          ))}
        </div>
        {ask.error && (
          <div className="mt-3">
            <ErrorState error={ask.error} compact />
          </div>
        )}
      </Card>
      <div className="space-y-3" data-testid="coach-answers">
        {history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.reload()} />
        ) : !history.data ? (
          <LoadingBlock rows={3} />
        ) : history.data.length === 0 ? (
          <EmptyState
            icon={<MessageCircleQuestion />}
            title={L('No questions yet', 'Chưa có câu hỏi')}
            body={L(
              'The AI answers using your real study data from the coach.',
              'AI trả lời dựa trên dữ liệu học thật của bạn mà AI Coach ghi lại.',
            )}
          />
        ) : (
          history.data.map((h) => (
            <Card key={h.id} className="!p-4">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{h.question}</span>
                <span className="flex items-center gap-2 text-xs text-faint">
                  <SourceBadge source={h.source} />
                  {fmt.relative(h.createdAt)}
                </span>
              </div>
              <p className="text-sm whitespace-pre-line text-muted">{h.answer}</p>
              {h.source === 'offline' && (
                <Badge tone="neutral" className="mt-2">
                  {L('Rough rule-based answer', 'Trả lời thô theo quy tắc')}
                </Badge>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
