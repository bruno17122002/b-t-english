// Illustrated adventure map: seven landmarks on a winding trail, coloured by stage with a progress ring,
// plus a details panel (hover previews, click/Enter selects) with a "train here" shortcut.
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  Castle,
  Lock,
  type LucideIcon,
  Mic,
  MountainSnow,
  PenLine,
  Sparkles,
  Trees,
  Waves,
} from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RegionKey, RegionProgress } from '@shared/types'
import { Badge, Button, cx, ProgressBar } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { arcPath } from '../charts/scale'
import {
  type Landmark,
  MAP_SIZE,
  MASTERY_REQUIRED_STAGE,
  MAX_STAGE,
  REGION_LAYOUT,
  REGION_RADIUS,
  regionMeta,
  regionsBlockingMastery,
  STAGE_NAMES,
  stageColor,
  stageFraction,
  stageName,
  trailSegments,
  xpToNextStage,
} from '../lib/regions'
import { LandmarkArt } from './Landmarks'

const LANDMARK_ICONS: Record<Landmark, LucideIcon> = {
  forest: Trees,
  castle: Castle,
  ocean: Waves,
  arena: Mic,
  library: BookOpen,
  academy: PenLine,
  summit: MountainSnow,
}

/** Region to suggest first: the unlocked skill region with the least XP. */
function recommendedRegion(regions: RegionProgress[]): RegionKey {
  const candidates = regions.filter((r) => r.unlocked && r.key !== 'mastery-challenge')
  const pick = candidates.sort((a, b) => a.xp - b.xp)[0]
  const mastery = regions.find((r) => r.key === 'mastery-challenge')
  if (mastery?.unlocked && mastery.stage < MAX_STAGE && (!pick || pick.stage >= MASTERY_REQUIRED_STAGE))
    return mastery.key
  return pick?.key ?? 'vocabulary-forest'
}

function MapBackdrop() {
  const W = MAP_SIZE.width
  const H = MAP_SIZE.height
  return (
    <g aria-hidden>
      <defs>
        <pattern id="lq-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0 H0 V40" fill="none" style={{ stroke: 'var(--line)' }} strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={W} height={H} style={{ fill: 'var(--surface)' }} />
      <rect width={W} height={H} fill="url(#lq-map-grid)" opacity={0.5} />
      <ellipse cx={420} cy={500} rx={210} ry={130} style={{ fill: 'var(--info)' }} opacity={0.1} />
      {/* contour lines – a hint of terrain */}
      <g fill="none" style={{ stroke: 'var(--line-strong)' }} opacity={0.35} strokeWidth={1}>
        <path d="M560 40 C640 10 820 10 900 60 C960 100 940 160 880 170" />
        <path d="M590 70 C650 45 800 45 860 80 C900 105 890 140 850 150" />
        <path d="M20 200 C80 160 150 170 170 210" />
        <path d="M40 230 C90 200 140 205 150 235" />
      </g>
      {/* distant mountains */}
      <g opacity={0.35} style={{ fill: 'var(--surface-3)' }}>
        <path d="M0 150 L50 90 L90 130 L140 70 L200 150 Z" />
        <path d="M880 470 L930 410 L970 450 L1000 420 L1000 520 L880 520 Z" />
      </g>
      {/* stars */}
      <g style={{ fill: 'var(--muted)' }} opacity={0.5}>
        {[
          [330, 60],
          [390, 120],
          [470, 40],
          [930, 40],
          [180, 600],
          [600, 610],
          [960, 600],
          [60, 300],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} />
        ))}
      </g>
      {/* compass rose */}
      <g transform="translate(70 70)" opacity={0.75}>
        <circle r={30} fill="none" style={{ stroke: 'var(--line-strong)' }} />
        <circle r={22} fill="none" style={{ stroke: 'var(--line)' }} strokeDasharray="2 4" />
        <path d="M0 -26 L6 0 L0 26 L-6 0 Z" style={{ fill: 'var(--muted)' }} opacity={0.6} />
        <path d="M-26 0 L0 -6 L26 0 L0 6 Z" style={{ fill: 'var(--muted)' }} opacity={0.35} />
        <path d="M0 -26 L6 0 L-6 0 Z" style={{ fill: 'var(--accent)' }} />
        <text y={-36} textAnchor="middle" fontSize={13} fontWeight={700} style={{ fill: 'var(--muted)' }}>
          N
        </text>
      </g>
    </g>
  )
}

interface NodeProps {
  region: RegionProgress
  index: number
  selected: boolean
  hovered: boolean
  label: string
  stageLabel: string
  ariaLabel: string
  onSelect: () => void
  onHover: (on: boolean) => void
}

function RegionNode({ region, index, selected, hovered, label, stageLabel, ariaLabel, onSelect, onHover }: NodeProps) {
  const meta = regionMeta(region.key)
  const R = REGION_RADIUS
  const color = stageColor(region.stage, region.unlocked)
  const frac = region.unlocked ? stageFraction(region) : 0
  const maxed = region.stage >= MAX_STAGE
  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
  return (
    <motion.g
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.08 * index, ease: 'easeOut' }}
    >
      <g
        transform={`translate(${meta.x} ${meta.y})`}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-pressed={selected}
        data-testid={`region-${region.key}`}
        className="cursor-pointer outline-none"
        onClick={onSelect}
        onKeyDown={onKeyDown}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
      >
        {/* hit area + base disc */}
        <circle r={R + 10} fill="transparent" />
        <circle
          r={R}
          style={{
            fill: 'color-mix(in oklab, var(--surface) 75%, transparent)',
            stroke: 'var(--surface-3)',
          }}
          strokeWidth={6}
        />
        {/* progress to next stage */}
        {region.unlocked &&
          (maxed ? (
            <circle r={R} fill="none" strokeWidth={6} style={{ stroke: 'var(--warning)' }} />
          ) : (
            frac > 0 && (
              <motion.path
                d={arcPath(0, 0, R, frac)}
                fill="none"
                strokeWidth={6}
                strokeLinecap="round"
                style={{ stroke: 'var(--accent)' }}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1, delay: 0.3 + 0.08 * index, ease: 'easeOut' }}
              />
            )
          ))}
        {(selected || hovered) && (
          <motion.circle
            r={R + 9}
            fill="none"
            strokeWidth={2}
            strokeDasharray="6 7"
            style={{ stroke: selected ? 'var(--accent-2)' : 'var(--line-strong)' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          />
        )}
        <motion.g
          animate={{ scale: hovered || selected ? 1.06 : 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          style={{ filter: region.unlocked ? undefined : 'grayscale(1)', opacity: region.unlocked ? 1 : 0.6 }}
        >
          <LandmarkArt kind={meta.landmark} color={color} locked={!region.unlocked} />
        </motion.g>
        {!region.unlocked && (
          <g transform={`translate(${R * 0.62} ${-R * 0.62})`}>
            <circle r={14} style={{ fill: 'var(--surface-2)', stroke: 'var(--line-strong)' }} />
            <Lock x={-7} y={-7} width={14} height={14} style={{ color: 'var(--muted)' }} />
          </g>
        )}
        {/* stage badge */}
        <g transform={`translate(${-R * 0.7} ${R * 0.62})`}>
          <circle
            r={13}
            style={{ fill: maxed ? 'var(--warning)' : 'var(--surface-2)', stroke: color }}
            strokeWidth={2}
          />
          <text
            textAnchor="middle"
            dy="0.35em"
            fontSize={13}
            fontWeight={700}
            style={{ fill: maxed ? 'var(--accent-ink)' : 'var(--text)' }}
          >
            {region.stage}
          </text>
        </g>
        {/* name plaque */}
        <g transform={`translate(0 ${R + 14})`}>
          <rect
            x={-86}
            y={0}
            width={172}
            height={42}
            rx={12}
            style={{
              fill: 'color-mix(in oklab, var(--surface) 88%, transparent)',
              stroke: selected ? 'var(--accent-2)' : 'var(--line-strong)',
            }}
          />
          <text y={18} textAnchor="middle" fontSize={15} fontWeight={700} style={{ fill: 'var(--text)' }}>
            {label}
          </text>
          <text
            y={34}
            textAnchor="middle"
            fontSize={12}
            style={{ fill: region.unlocked ? 'var(--muted)' : 'var(--faint)' }}
          >
            {stageLabel}
          </text>
        </g>
      </g>
    </motion.g>
  )
}

export function AdventureMap({ regions }: { regions: RegionProgress[] }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const recommended = useMemo(() => recommendedRegion(regions), [regions])
  const [selected, setSelected] = useState<RegionKey>(recommended)
  const [hovered, setHovered] = useState<RegionKey | null>(null)
  const shown = hovered ?? selected
  const region = regions.find((r) => r.key === shown) ?? (regions[0] as RegionProgress)
  const meta = regionMeta(region.key)
  const segments = useMemo(() => trailSegments(regions), [regions])
  const blocking = regionsBlockingMastery(regions)
  const Icon = LANDMARK_ICONS[meta.landmark]
  const maxed = region.stage >= MAX_STAGE
  const nextName = stageName(region.stage + 1)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="adventure-map">
      <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
        <svg
          viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}
          className="block h-auto w-full select-none"
          role="group"
          aria-label={L('Adventure map with seven regions', 'Bản đồ phiêu lưu với bảy vùng đất')}
        >
          <MapBackdrop />
          {/* trail */}
          <g fill="none" strokeLinecap="round">
            {segments.map((s) => (
              <path
                key={`${s.from}-base`}
                d={s.d}
                strokeWidth={10}
                style={{ stroke: 'var(--surface-3)' }}
                opacity={0.7}
              />
            ))}
            {segments.map((s, i) => (
              <motion.path
                key={`${s.from}-dash`}
                d={s.d}
                strokeWidth={3}
                strokeDasharray={s.active ? undefined : '2 10'}
                style={{ stroke: s.active ? 'var(--accent)' : 'var(--faint)' }}
                opacity={s.active ? 0.9 : 0.8}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, delay: 0.1 * i, ease: 'easeOut' }}
              />
            ))}
          </g>
          {REGION_LAYOUT.map((m, i) => {
            const r = regions.find((x) => x.key === m.key)
            if (!r) return null
            const stageLabel = r.unlocked
              ? `${tx(stageName(r.stage))} · ${fmt.number(r.xp)} XP`
              : L('Locked', 'Đang khóa')
            return (
              <RegionNode
                key={m.key}
                region={r}
                index={i}
                selected={selected === m.key}
                hovered={hovered === m.key}
                label={tx(m.name)}
                stageLabel={stageLabel}
                ariaLabel={`${tx(m.name)} – ${r.unlocked ? `${L('stage', 'cấp')} ${r.stage}/${MAX_STAGE}, ${tx(stageName(r.stage))}` : L('locked', 'đang khóa')}`}
                onSelect={() => setSelected(m.key)}
                onHover={(on) => setHovered((h) => (on ? m.key : h === m.key ? null : h))}
              />
            )
          })}
        </svg>
      </div>

      {/* Details panel */}
      <div
        className="rounded-3xl border border-line bg-surface p-5 shadow-card"
        aria-live="polite"
        data-testid="region-details"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={region.key}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            className="flex h-full flex-col"
          >
            <div className="flex items-start gap-3">
              <div
                className={cx(
                  'flex size-12 shrink-0 items-center justify-center rounded-2xl',
                  region.unlocked ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-faint',
                )}
              >
                {region.unlocked ? <Icon className="size-6" /> : <Lock className="size-6" />}
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-xl leading-tight font-semibold">{tx(meta.name)}</h3>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span>{tx(meta.skill)}</span>
                  {region.key === recommended && region.unlocked && !maxed && (
                    <Badge tone="accent">
                      <Sparkles className="size-3" /> {L('Recommended', 'Nên luyện')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-muted">{tx(meta.lore)}</p>

            {/* stage pips */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-text">
                  {region.unlocked ? tx(stageName(region.stage)) : L('Locked', 'Đang khóa')}
                </span>
                <span className="text-faint">
                  {L('Stage', 'Cấp')} {region.stage}/{MAX_STAGE}
                </span>
              </div>
              <div className="flex gap-1" aria-hidden>
                {STAGE_NAMES.slice(1).map((s, i) => (
                  <div
                    key={s.en}
                    title={tx(s)}
                    className={cx(
                      'h-1.5 flex-1 rounded-full',
                      i < region.stage ? (maxed ? 'bg-warning' : 'bg-accent') : 'bg-surface-3',
                    )}
                  />
                ))}
              </div>
            </div>

            {region.unlocked ? (
              <div className="mt-4 rounded-2xl bg-surface-2 p-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">{L('Region XP', 'XP của vùng')}</span>
                  <span className="font-display text-lg font-semibold">{fmt.number(region.xp)}</span>
                </div>
                {maxed ? (
                  <p className="mt-1 text-xs text-warning">
                    {L(
                      'Fully conquered – a legend of this land!',
                      'Đã chinh phục hoàn toàn – huyền thoại của vùng đất này!',
                    )}
                  </p>
                ) : (
                  <>
                    <ProgressBar value={region.stageXp} max={region.nextStageXp ?? 1} className="mt-2" />
                    <p className="mt-1.5 text-xs text-muted">
                      {L(
                        `${fmt.number(xpToNextStage(region))} XP to ${nextName.en}`,
                        `Còn ${fmt.number(xpToNextStage(region))} XP để lên ${nextName.vi}`,
                      )}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-line p-3 text-xs text-muted">
                <p>
                  {L(
                    `Unlocks when every region reaches stage ${MASTERY_REQUIRED_STAGE} (${STAGE_NAMES[MASTERY_REQUIRED_STAGE]?.en}).`,
                    `Mở khóa khi mọi vùng đạt cấp ${MASTERY_REQUIRED_STAGE} (${STAGE_NAMES[MASTERY_REQUIRED_STAGE]?.vi}).`,
                  )}
                </p>
                {blocking.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {blocking.map((b) => (
                      <li key={b.key} className="flex items-center justify-between gap-2">
                        <button
                          className="truncate text-left text-text hover:text-accent"
                          onClick={() => setSelected(b.key)}
                        >
                          {tx(regionMeta(b.key).name)}
                        </button>
                        <span className="shrink-0 text-faint">
                          {b.stage}/{MASTERY_REQUIRED_STAGE}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-auto pt-4">
              <Button
                variant="primary"
                className="w-full"
                icon={<ArrowRight className="size-4" />}
                onClick={() => navigate(meta.route)}
                data-testid={`region-train-${region.key}`}
              >
                {region.unlocked ? L('Train here', 'Luyện tại đây') : L('Open your journey', 'Mở lộ trình')}
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
