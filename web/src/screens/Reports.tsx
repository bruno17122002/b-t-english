import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, Empty, SectionTitle } from '../components/ui'
import { useT, type MsgKey } from '../i18n'
import { coachReports } from '../lib/stats'
import type { CoachReport } from '../lib/sync'
import { useApp } from '../store'

const PERIOD: Record<CoachReport['period'], MsgKey> = {
  day: 'reports.day',
  week: 'reports.week',
  month: 'reports.month',
}

function List({ items, title }: { items: string[]; title: string }) {
  if (!items.length) return null
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function Detail({ report, onBack }: { report: CoachReport; onBack: () => void }) {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const a = report.advice
  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-accent">
        <ChevronLeft className="size-4" /> {t('reports.back')}
      </button>
      <Card>
        <div className="text-xs text-faint">
          {t(PERIOD[report.period])} · {report.label[lang] || report.label.vi || report.period_key}
        </div>
        <h2 className="mt-1 text-lg font-semibold">{a.headline}</h2>
        {a.summary && <p className="mt-2 text-sm text-muted">{a.summary}</p>}
        {a.motivation && <p className="mt-3 border-l-2 border-accent pl-2 text-sm">{a.motivation}</p>}
      </Card>

      {a.recommendations.length > 0 && (
        <>
          <SectionTitle>{t('reports.recommendations')}</SectionTitle>
          <div className="space-y-2">
            {a.recommendations.map((r, i) => (
              <Card key={`${r.title}-${i}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{r.title}</div>
                  {r.minutes > 0 && (
                    <span className="shrink-0 font-mono text-xs text-faint">{t('reports.min', { n: r.minutes })}</span>
                  )}
                </div>
                {r.why && <p className="mt-1 text-sm text-muted">{r.why}</p>}
                {r.action && <p className="mt-1.5 text-sm">→ {r.action}</p>}
              </Card>
            ))}
          </div>
        </>
      )}

      {a.nextPeriodPlan.length > 0 && (
        <>
          <SectionTitle>{t('reports.plan')}</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {a.nextPeriodPlan.map((d, i) => (
              <div key={`${d.day}-${i}`} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs text-faint">{d.day}</span>
                  {d.minutes > 0 && (
                    <span className="font-mono text-xs text-faint">{t('reports.min', { n: d.minutes })}</span>
                  )}
                </div>
                <div className="mt-0.5 font-semibold">{d.focus}</div>
                {d.activities.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
                    {d.activities.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      <List title={t('reports.strengths')} items={a.strengths} />
      <List title={t('reports.concerns')} items={a.concerns} />
      {a.ieltsOutlook && (
        <>
          <SectionTitle>{t('reports.ielts')}</SectionTitle>
          <Card>
            <p className="text-sm">{a.ieltsOutlook}</p>
          </Card>
        </>
      )}
    </div>
  )
}

export function Reports() {
  const t = useT()
  const cache = useApp((s) => s.cache)
  const lang = useApp((s) => s.lang)
  const reports = useMemo(() => (cache ? coachReports(cache) : []), [cache])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const open = reports.find((r) => r.key === openKey)

  if (open) return <Detail report={open} onBack={() => setOpenKey(null)} />
  if (!reports.length) return <Empty icon={<Sparkles className="size-10" />}>{t('reports.empty')}</Empty>

  return (
    <div className="space-y-2">
      {reports.map((r) => (
        <button
          key={r.key}
          onClick={() => setOpenKey(r.key)}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card active:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <div className="text-xs text-faint">
              {t(PERIOD[r.period])} · {r.label[lang] || r.label.vi || r.period_key}
              {r.source === 'ai' ? ' · AI' : ''}
            </div>
            <div className="mt-0.5 line-clamp-2 font-semibold">{r.advice.headline || r.period_key}</div>
            {r.advice.recommendations[0] && (
              <div className="mt-1 line-clamp-1 text-sm text-muted">
                → {r.advice.recommendations[0].action || r.advice.recommendations[0].title}
              </div>
            )}
          </div>
          <ChevronRight className="size-4 shrink-0 text-faint" />
        </button>
      ))}
    </div>
  )
}
