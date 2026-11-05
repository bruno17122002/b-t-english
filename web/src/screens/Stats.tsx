import { useMemo, useState } from 'react'
import { localDateKey, parseDateKey, weekStart } from '@core/dates'
import { BarChart, Card, Empty, Segmented, SectionTitle } from '../components/ui'
import { useT } from '../i18n'
import { activities, dailySeries, monthlySeries, sumBuckets, weeklySeries, type Bucket } from '../lib/stats'
import { useApp } from '../store'

type Range = 'day' | 'week' | 'month'
type Metric = 'minutes' | 'words' | 'reviews' | 'xp'

function label(range: Range, key: string, lang: 'vi' | 'en'): string {
  if (range === 'month') {
    const m = Number(key.slice(5, 7))
    return lang === 'vi' ? `T${m}` : new Date(2000, m - 1, 1).toLocaleString('en', { month: 'short' })
  }
  const d = parseDateKey(key)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

export function Stats() {
  const t = useT()
  const cache = useApp((s) => s.cache)
  const lang = useApp((s) => s.lang)
  const [range, setRange] = useState<Range>('day')
  const [metric, setMetric] = useState<Metric>('minutes')

  const data = useMemo(() => {
    if (!cache) return null
    const acts = activities(cache)
    const today = localDateKey()
    const series: Bucket[] =
      range === 'day'
        ? dailySeries(acts, today, 14)
        : range === 'week'
          ? weeklySeries(acts, today, 8)
          : monthlySeries(acts, today, 6)
    const currentKey = range === 'day' ? today : range === 'week' ? weekStart(today) : today.slice(0, 7)
    return {
      series,
      current: series.find((b) => b.key === currentKey) ?? sumBuckets([]),
      total: sumBuckets(series),
      any: acts.length > 0,
      currentKey,
    }
  }, [cache, range])

  if (!data) return null
  if (!data.any) return <Empty>{t('stats.empty')}</Empty>

  const metrics: { key: Metric; label: string }[] = [
    { key: 'minutes', label: t('stats.minutes') },
    { key: 'words', label: t('stats.words') },
    { key: 'reviews', label: t('stats.reviews') },
    { key: 'xp', label: t('stats.xp') },
  ]
  const rangeTitle = range === 'day' ? t('stats.last14') : range === 'week' ? t('stats.last8w') : t('stats.last6m')

  return (
    <div>
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: 'day', label: t('stats.day') },
          { value: 'week', label: t('stats.week') },
          { value: 'month', label: t('stats.month') },
        ]}
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        {metrics.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`rounded-2xl border bg-surface p-3 text-left shadow-card ${metric === m.key ? 'border-accent' : 'border-line'}`}
            aria-pressed={metric === m.key}
          >
            <div className="text-[13px] text-muted">{m.label}</div>
            <div className="mt-0.5 font-mono text-2xl font-semibold">{data.current[m.key]}</div>
            <div className="font-mono text-[11px] text-faint">Σ {data.total[m.key]}</div>
          </button>
        ))}
      </div>

      <SectionTitle>
        {metrics.find((m) => m.key === metric)?.label} · {rangeTitle}
      </SectionTitle>
      <Card>
        <BarChart
          data={data.series.map((b) => ({
            label: label(range, b.key, lang),
            value: b[metric],
            highlight: b.key === data.currentKey,
          }))}
          showEvery={range === 'day' ? 3 : 1}
        />
      </Card>
    </div>
  )
}
