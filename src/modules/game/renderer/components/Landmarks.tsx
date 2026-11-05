// Original illustrated landmarks for the adventure map. Each is drawn around (0, 0) inside a ~50px radius.
// `c` is the stage colour (theme-driven); a few natural colours (wood, sand, water) are illustration-only.
import type { Landmark } from '../lib/regions'

const shade = (c: string, pct: number) => `color-mix(in oklab, ${c} ${100 - pct}%, black)`
const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${100 - pct}%, white)`
const WOOD = '#7a5a3f'
const DARK = 'color-mix(in oklab, var(--bg) 85%, black)'

function Ground({ c, y = 28, rx = 46 }: { c: string; y?: number; rx?: number }) {
  return <ellipse cx={0} cy={y} rx={rx} ry={9} style={{ fill: shade(c, 55) }} opacity={0.55} />
}

function Pine({ x, y, h, c }: { x: number; y: number; h: number; c: string }) {
  return (
    <g>
      <rect x={x - 2.5} y={y - 2} width={5} height={9} rx={1} fill={WOOD} />
      <polygon
        points={`${x},${y - h} ${x - h * 0.42},${y - h * 0.38} ${x + h * 0.42},${y - h * 0.38}`}
        style={{ fill: tint(c, 12) }}
      />
      <polygon points={`${x},${y - h * 0.72} ${x - h * 0.55},${y} ${x + h * 0.55},${y}`} style={{ fill: c }} />
      <polygon points={`${x},${y - h * 0.72} ${x + h * 0.55},${y} ${x},${y}`} style={{ fill: shade(c, 22) }} />
    </g>
  )
}

function Forest({ c }: { c: string }) {
  return (
    <g>
      <Ground c={c} />
      <Pine x={-24} y={22} h={40} c={c} />
      <Pine x={24} y={24} h={36} c={c} />
      <Pine x={0} y={16} h={54} c={c} />
      <circle cx={-34} cy={-8} r={2} style={{ fill: 'var(--accent-2)' }} opacity={0.8} />
      <circle cx={36} cy={-14} r={1.6} style={{ fill: 'var(--accent-2)' }} opacity={0.7} />
    </g>
  )
}

function Crenels({ x, y, w }: { x: number; y: number; w: number }) {
  const n = Math.max(2, Math.floor(w / 6))
  const step = w / n
  return (
    <g>
      {Array.from({ length: n }, (_, i) =>
        i % 2 === 0 ? <rect key={i} x={x + i * step} y={y - 4} width={step} height={4} /> : null,
      )}
    </g>
  )
}

function Castle({ c }: { c: string }) {
  return (
    <g>
      <Ground c={c} y={30} />
      <g style={{ fill: shade(c, 18) }}>
        <rect x={-44} y={-22} width={18} height={50} rx={1.5} />
        <rect x={26} y={-22} width={18} height={50} rx={1.5} />
        <Crenels x={-44} y={-22} w={18} />
        <Crenels x={26} y={-22} w={18} />
      </g>
      <g style={{ fill: c }}>
        <rect x={-30} y={-2} width={60} height={30} />
        <Crenels x={-30} y={-2} w={60} />
        <rect x={-13} y={-36} width={26} height={64} />
        <Crenels x={-13} y={-36} w={26} />
      </g>
      <path d="M-7 28 V14 a7 7 0 0 1 14 0 V28 Z" style={{ fill: DARK }} />
      <rect x={-3} y={-24} width={6} height={9} rx={3} style={{ fill: DARK }} />
      <rect x={-38} y={-8} width={5} height={8} rx={2.5} style={{ fill: DARK }} />
      <rect x={33} y={-8} width={5} height={8} rx={2.5} style={{ fill: DARK }} />
      <line x1={0} y1={-40} x2={0} y2={-58} strokeWidth={2} style={{ stroke: tint(c, 30) }} />
      <path d="M0 -58 L16 -53 L0 -48 Z" style={{ fill: 'var(--accent-2)' }} />
    </g>
  )
}

function Ocean({ c }: { c: string }) {
  const wave = (y: number, amp: number) => `M-48 ${y} q 8 -${amp} 16 0 t 16 0 t 16 0 t 16 0 t 16 0 t 16 0`
  return (
    <g>
      <ellipse cx={0} cy={18} rx={50} ry={22} style={{ fill: shade(c, 45) }} opacity={0.6} />
      {/* island + lighthouse */}
      <ellipse cx={-14} cy={10} rx={18} ry={6} fill="#c8a96b" opacity={0.9} />
      <path d="M-20 8 L-17 -32 L-11 -32 L-8 8 Z" style={{ fill: tint(c, 70) }} />
      <path d="M-19.2 -2 L-8.8 -2 L-8.4 3 L-19.6 3 Z M-18.3 -16 L-9.7 -16 L-9.4 -11 L-18.6 -11 Z" style={{ fill: c }} />
      <rect x={-18} y={-38} width={8} height={6} rx={1} style={{ fill: 'var(--warning)' }} />
      <path d="M-21 -38 L-14 -45 L-7 -38 Z" style={{ fill: shade(c, 25) }} />
      <path d="M-10 -36 L30 -48 L30 -24 Z" style={{ fill: 'var(--warning)' }} opacity={0.18} />
      {/* sailboat */}
      <path d="M14 8 L36 8 L32 14 L18 14 Z" fill={WOOD} />
      <line x1={25} y1={8} x2={25} y2={-16} strokeWidth={1.5} style={{ stroke: tint(c, 60) }} />
      <path d="M26 -15 L26 6 L40 6 Z" style={{ fill: tint(c, 75) }} />
      <path d="M24 -12 L24 6 L13 6 Z" style={{ fill: tint(c, 45) }} />
      <g fill="none" strokeWidth={2.4} strokeLinecap="round">
        <path d={wave(20, 5)} style={{ stroke: c }} />
        <path d={wave(30, 4)} style={{ stroke: tint(c, 25) }} opacity={0.8} />
      </g>
    </g>
  )
}

function Arena({ c }: { c: string }) {
  const arches = [-36, -24, -12, 0, 12, 24, 36]
  return (
    <g>
      <Ground c={c} y={30} rx={50} />
      <path d="M-46 -6 L-46 18 A46 14 0 0 0 46 18 L46 -6 Z" style={{ fill: shade(c, 18) }} />
      <ellipse cx={0} cy={-6} rx={46} ry={16} style={{ fill: c }} />
      <ellipse cx={0} cy={-6} rx={32} ry={9.5} fill="#d6b97c" />
      <ellipse cx={0} cy={-6} rx={32} ry={9.5} fill="none" strokeWidth={2} style={{ stroke: shade(c, 30) }} />
      {arches.map((x) => (
        <path
          key={x}
          d={`M${x - 3.5} ${16 + Math.abs(x) * -0.12} v-9 a3.5 3.5 0 0 1 7 0 v9 Z`}
          style={{ fill: DARK }}
          opacity={0.85}
        />
      ))}
      <line x1={-30} y1={-14} x2={-30} y2={-34} strokeWidth={1.6} style={{ stroke: tint(c, 40) }} />
      <path d="M-30 -34 L-18 -30 L-30 -26 Z" style={{ fill: 'var(--accent-2)' }} />
      <line x1={30} y1={-14} x2={30} y2={-34} strokeWidth={1.6} style={{ stroke: tint(c, 40) }} />
      <path d="M30 -34 L42 -30 L30 -26 Z" style={{ fill: 'var(--accent-2)' }} />
      {/* microphone at centre stage */}
      <rect x={-2} y={-22} width={4} height={8} rx={2} style={{ fill: 'var(--text)' }} />
      <line x1={0} y1={-14} x2={0} y2={-7} strokeWidth={1.4} style={{ stroke: 'var(--text)' }} />
    </g>
  )
}

function Library({ c }: { c: string }) {
  const cols = [-30, -16, -2, 12, 26]
  return (
    <g>
      <Ground c={c} y={32} />
      <rect x={-46} y={24} width={92} height={6} rx={1} style={{ fill: shade(c, 30) }} />
      <rect x={-42} y={19} width={84} height={6} rx={1} style={{ fill: shade(c, 18) }} />
      <rect x={-38} y={-14} width={76} height={34} style={{ fill: shade(c, 35) }} />
      {cols.map((x) => (
        <rect key={x} x={x - 1} y={-14} width={6} height={33} rx={1} style={{ fill: tint(c, 25) }} />
      ))}
      <rect x={-44} y={-20} width={88} height={7} rx={1} style={{ fill: c }} />
      <path d="M-46 -20 L0 -44 L46 -20 Z" style={{ fill: c }} />
      <path d="M-34 -23 L0 -40 L34 -23 Z" style={{ fill: shade(c, 20) }} />
      {/* open book emblem */}
      <path d="M-8 -30 q4 -3 8 0 q4 -3 8 0 v6 q-4 -3 -8 0 q-4 -3 -8 0 Z" style={{ fill: tint(c, 70) }} />
    </g>
  )
}

function Academy({ c }: { c: string }) {
  return (
    <g>
      <Ground c={c} y={30} />
      <rect x={-48} y={-22} width={16} height={50} style={{ fill: shade(c, 18) }} />
      <rect x={32} y={-22} width={16} height={50} style={{ fill: shade(c, 18) }} />
      <path d="M-50 -22 L-40 -40 L-30 -22 Z M30 -22 L40 -40 L50 -22 Z" style={{ fill: c }} />
      <rect x={-34} y={-10} width={68} height={38} style={{ fill: c }} />
      <path d="M-22 -10 A22 22 0 0 1 22 -10 Z" style={{ fill: tint(c, 18) }} />
      <rect x={-3} y={-38} width={6} height={8} style={{ fill: tint(c, 30) }} />
      <circle cx={0} cy={-41} r={3} style={{ fill: 'var(--warning)' }} />
      {[-22, -8, 6, 20].map((x) => (
        <path key={x} d={`M${x - 3} 10 v-8 a4 4 0 0 1 8 0 v8 Z`} style={{ fill: DARK }} opacity={0.85} />
      ))}
      <path d="M-5 28 V18 a5 5 0 0 1 10 0 V28 Z" style={{ fill: DARK }} />
      {/* quill */}
      <path d="M40 -6 q10 -18 2 -30 q-4 14 -6 28 Z" style={{ fill: tint(c, 75) }} opacity={0.9} />
    </g>
  )
}

function Summit({ c, locked }: { c: string; locked: boolean }) {
  return (
    <g>
      <Ground c={c} y={32} rx={54} />
      <path d="M-56 32 L-24 -12 L-4 14 Z" style={{ fill: shade(c, 30) }} />
      <path d="M-40 32 L2 -48 L46 32 Z" style={{ fill: c }} />
      <path d="M2 -48 L46 32 L14 32 Z" style={{ fill: shade(c, 22) }} />
      <path d="M14 32 L36 0 L60 32 Z" style={{ fill: shade(c, 12) }} />
      <path d="M2 -48 L-12 -22 L-5 -26 L2 -18 L9 -27 L15 -23 Z" style={{ fill: tint(c, 80) }} />
      {!locked && (
        <>
          <line x1={2} y1={-48} x2={2} y2={-66} strokeWidth={2} style={{ stroke: 'var(--text)' }} />
          <path d="M2 -66 L20 -61 L2 -56 Z" style={{ fill: 'var(--warning)' }} />
        </>
      )}
    </g>
  )
}

export function LandmarkArt({ kind, color, locked = false }: { kind: Landmark; color: string; locked?: boolean }) {
  switch (kind) {
    case 'forest':
      return <Forest c={color} />
    case 'castle':
      return <Castle c={color} />
    case 'ocean':
      return <Ocean c={color} />
    case 'arena':
      return <Arena c={color} />
    case 'library':
      return <Library c={color} />
    case 'academy':
      return <Academy c={color} />
    case 'summit':
      return <Summit c={color} locked={locked} />
  }
}
