// Original SVG scene illustrations for Cinema Mode – one composition per BACKDROP plus a mood tint.
// Everything here is drawn from simple shapes; no external images or copyrighted artwork.
import { memo, type ReactNode } from 'react'
import type { Scene } from '@shared/content'
import { cx } from '@/components/ui'

export type BackdropId = Scene['backdrop']
export type Mood = Scene['mood']

const W = 1600
const H = 900

/** Deterministic pseudo-random numbers so illustrations are stable between renders. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function Sky({ id, top, bottom }: { id: string; top: string; bottom: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={top} />
          <stop offset="100%" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id})`} />
    </>
  )
}

function Stars({ count, seed, maxY = 500 }: { count: number; seed: number; maxY?: number }) {
  const r = rng(seed)
  return (
    <g className="lq-twinkle">
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} cx={r() * W} cy={r() * maxY} r={r() * 1.8 + 0.4} fill="#fff" opacity={0.3 + r() * 0.6} />
      ))}
    </g>
  )
}

function Skyline({
  seed,
  base,
  color,
  windowColor,
  minH,
  maxH,
  litRatio = 0.35,
}: {
  seed: number
  base: number
  color: string
  windowColor: string
  minH: number
  maxH: number
  litRatio?: number
}) {
  const r = rng(seed)
  const out: ReactNode[] = []
  let x = -20
  let i = 0
  while (x < W + 20) {
    const w = 70 + r() * 110
    const h = minH + r() * (maxH - minH)
    out.push(<rect key={`b${i}`} x={x} y={base - h} width={w} height={h} fill={color} />)
    for (let wy = base - h + 18; wy < base - 20; wy += 26)
      for (let wx = x + 10; wx < x + w - 14; wx += 20)
        if (r() < litRatio)
          out.push(
            <rect
              key={`w${i}-${wx}-${wy}`}
              x={wx}
              y={wy}
              width="9"
              height="12"
              fill={windowColor}
              opacity={0.5 + r() * 0.5}
            />,
          )
    x += w + 4
    i++
  }
  return <g>{out}</g>
}

function Rain({ seed, count = 140, color = '#cbd5e1' }: { seed: number; count?: number; color?: string }) {
  const r = rng(seed)
  return (
    <g className="lq-rain" stroke={color} strokeWidth="1.4" opacity="0.45">
      {Array.from({ length: count }, (_, i) => {
        const x = r() * (W + 200) - 100
        const y = r() * H
        return <line key={i} x1={x} y1={y} x2={x - 14} y2={y + 46} />
      })}
    </g>
  )
}

function Glow({
  cx,
  cy,
  r,
  color,
  opacity = 0.5,
  id,
}: {
  cx: number
  cy: number
  r: number
  color: string
  opacity?: number
  id: string
}) {
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </>
  )
}

function Plant({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-30 0 L30 0 L22 60 L-22 60 Z" fill="#7c4a2d" />
      {[-40, -15, 10, 35, -55, 50].map((a, i) => (
        <ellipse
          key={i}
          cx={Math.sin((a * Math.PI) / 180) * 40}
          cy={-40 - (i % 3) * 20}
          rx="16"
          ry="44"
          fill={i % 2 ? '#2f7d4f' : '#3f9a62'}
          transform={`rotate(${a} ${Math.sin((a * Math.PI) / 180) * 40} ${-40 - (i % 3) * 20})`}
        />
      ))}
    </g>
  )
}

function Person({ x, y, color, s = 1 }: { x: number; y: number; color: string; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity="0.85">
      <circle cx="0" cy="-150" r="26" fill="#1e2433" />
      <path d="M-42 0 L-36 -100 Q0 -126 36 -100 L42 0 Z" fill={color} />
    </g>
  )
}

const SCENES: Record<BackdropId, () => ReactNode> = {
  'city-night': () => (
    <>
      <Sky id="cn-sky" top="#070a1a" bottom="#26205a" />
      <Stars count={90} seed={11} maxY={420} />
      <circle cx="1290" cy="150" r="58" fill="#f8f3d6" />
      <circle cx="1270" cy="138" r="58" fill="#0d1130" opacity="0.18" />
      <Glow id="cn-moon" cx={1290} cy={150} r={220} color="#f8f3d6" opacity={0.25} />
      <Skyline seed={3} base={760} color="#141a36" windowColor="#fbbf24" minH={160} maxH={420} litRatio={0.2} />
      <Skyline seed={7} base={800} color="#0c1027" windowColor="#fde68a" minH={110} maxH={300} litRatio={0.32} />
      <rect y="790" width={W} height="110" fill="#0a0d1c" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={i * 200 + 40} y="842" width="110" height="8" rx="4" fill="#fbbf24" opacity="0.35" />
      ))}
      {[300, 900, 1450].map((x) => (
        <g key={x}>
          <rect x={x} y="640" width="8" height="160" fill="#2a2f45" />
          <Glow id={`cn-l${x}`} cx={x + 4} cy={640} r={90} color="#fde68a" opacity={0.6} />
        </g>
      ))}
    </>
  ),
  cafe: () => (
    <>
      <Sky id="cf-wall" top="#3b2418" bottom="#1e120c" />
      <rect x="140" y="140" width="720" height="440" rx="10" fill="#203045" />
      <Skyline seed={21} base={580} color="#2c4060" windowColor="#fcd34d" minH={120} maxH={330} litRatio={0.25} />
      <rect x="140" y="140" width="720" height="440" rx="10" fill="none" stroke="#5a3a28" strokeWidth="18" />
      <line x1="500" y1="140" x2="500" y2="580" stroke="#5a3a28" strokeWidth="12" />
      <rect x={0} y={0} width="140" height={H} fill="#2a1a12" />
      <rect x={860} y={0} width={W - 860} height={H} fill="#2c1b13" />
      {[1000, 1200, 1400].map((x, i) => (
        <g key={x}>
          <line x1={x} y1="0" x2={x} y2={150 + i * 10} stroke="#111" strokeWidth="3" />
          <path
            d={`M${x - 46} ${190 + i * 10} L${x - 20} ${150 + i * 10} L${x + 20} ${150 + i * 10} L${x + 46} ${190 + i * 10} Z`}
            fill="#c2410c"
          />
          <Glow id={`cf-g${i}`} cx={x} cy={210 + i * 10} r={170} color="#fdba74" opacity={0.45} />
        </g>
      ))}
      <rect x="900" y="300" width="660" height="40" fill="#4a2f20" />
      {[960, 1080, 1220, 1360, 1480].map((x, i) => (
        <rect
          key={x}
          x={x}
          y={250 - (i % 2) * 14}
          width="44"
          height={50 + (i % 2) * 14}
          rx="6"
          fill={['#7c2d12', '#365314', '#1e3a8a', '#713f12', '#831843'][i]}
        />
      ))}
      <rect y="700" width={W} height="200" fill="#1a0f0a" />
      <rect x="0" y="640" width={W} height="70" fill="#5b3a25" />
      {[420, 1040].map((x) => (
        <g key={x}>
          <path d={`M${x} 640 q 0 -40 34 -40 h 40 q 34 0 34 40 Z`} fill="#f5f5f4" />
          <ellipse cx={x + 54} cy="604" rx="40" ry="8" fill="#78350f" />
          <path
            className="lq-steam"
            d={`M${x + 40} 590 q -12 -30 4 -60 q 14 -26 -2 -56`}
            stroke="#fff"
            strokeOpacity="0.35"
            strokeWidth="5"
            fill="none"
          />
        </g>
      ))}
    </>
  ),
  office: () => (
    <>
      <Sky id="of-wall" top="#cfd8e3" bottom="#9aa8ba" />
      {[120, 620, 1120].map((x) => (
        <g key={x}>
          <rect x={x} y="110" width="380" height="380" fill="#dbeafe" />
          <Skyline seed={x} base={490} color="#93a7c4" windowColor="#e0f2fe" minH={90} maxH={300} litRatio={0.15} />
          {Array.from({ length: 13 }, (_, i) => (
            <rect key={i} x={x} y={110 + i * 29} width="380" height="9" fill="#f1f5f9" opacity="0.85" />
          ))}
          <rect x={x} y="110" width="380" height="380" fill="none" stroke="#64748b" strokeWidth="10" />
        </g>
      ))}
      <rect x="0" y="0" width="120" height="900" fill="#a3b1c2" />
      <rect x="500" y="0" width="120" height="900" fill="#a3b1c2" />
      <rect x="1000" y="0" width="120" height="900" fill="#a3b1c2" />
      <rect x="1500" y="0" width="100" height="900" fill="#a3b1c2" />
      <rect y="660" width={W} height="240" fill="#57606f" />
      {[220, 860].map((x) => (
        <g key={x}>
          <rect x={x} y="600" width="520" height="22" fill="#e2e8f0" />
          <rect x={x + 20} y="622" width="14" height="140" fill="#334155" />
          <rect x={x + 486} y="622" width="14" height="140" fill="#334155" />
          <rect x={x + 150} y="470" width="220" height="130" rx="8" fill="#1e293b" />
          <rect x={x + 162} y="482" width="196" height="106" rx="4" fill="#38bdf8" opacity="0.65" />
          <rect x={x + 250} y="600" width="20" height="0" />
          <path d={`M${x + 236} 600 h48 l10 -10 h-68 Z`} fill="#334155" />
          <rect x={x + 60} y="560" width="44" height="40" rx="6" fill="#f8fafc" />
        </g>
      ))}
      <Plant x={1480} y={600} s={1.3} />
    </>
  ),
  airport: () => (
    <>
      <Sky id="ap-sky" top="#7dd3fc" bottom="#fde4cf" />
      <circle cx="320" cy="200" r="70" fill="#fff7d6" opacity="0.9" />
      <rect y="560" width={W} height="60" fill="#94a3b8" />
      <g transform="translate(980 470)">
        <path
          d="M-260 30 Q-250 0 -200 -6 L220 -6 Q280 0 300 30 Q280 54 220 54 L-200 54 Q-250 50 -260 30 Z"
          fill="#f8fafc"
        />
        <path d="M-40 10 L120 -120 L170 -120 L80 20 Z" fill="#cbd5e1" />
        <path d="M-40 44 L120 150 L170 150 L80 40 Z" fill="#cbd5e1" />
        <path d="M220 -6 L290 -90 L320 -90 L290 20 Z" fill="#2563eb" />
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} cx={-170 + i * 26} cy="18" r="6" fill="#1e3a8a" />
        ))}
      </g>
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={i * 200} y="0" width="16" height="640" fill="#334155" />
      ))}
      <rect y="0" width={W} height="40" fill="#334155" />
      <rect y="620" width={W} height="280" fill="#cbd5e1" />
      <rect y="620" width={W} height="20" fill="#64748b" />
      <rect x="1180" y="80" width="360" height="200" rx="10" fill="#0f172a" />
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <rect x="1200" y={100 + i * 28} width="150" height="12" rx="3" fill="#fbbf24" opacity="0.9" />
          <rect x="1370" y={100 + i * 28} width="60" height="12" rx="3" fill="#fbbf24" opacity="0.6" />
          <rect
            x="1450"
            y={100 + i * 28}
            width="70"
            height="12"
            rx="3"
            fill={i === 2 ? '#f87171' : '#4ade80'}
            opacity="0.8"
          />
        </g>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <g key={i} transform={`translate(${120 + i * 110} 760)`}>
          <rect x="0" y="-50" width="90" height="60" rx="14" fill="#1d4ed8" />
          <rect x="0" y="10" width="90" height="16" rx="6" fill="#1e3a8a" />
          <rect x="40" y="26" width="10" height="40" fill="#475569" />
        </g>
      ))}
    </>
  ),
  train: () => (
    <>
      <Sky id="tr-wall" top="#334155" bottom="#1e293b" />
      {[100, 560, 1020].map((x, i) => (
        <g key={x}>
          <rect x={x} y="170" width="420" height="300" rx="40" fill="#87ceeb" />
          <g className="lq-scroll">
            <path
              d={`M${x} 400 Q${x + 120} ${330 + i * 10} ${x + 220} 380 T${x + 420} 360 L${x + 420} 470 L${x} 470 Z`}
              fill="#4d7c0f"
            />
            <path
              d={`M${x} 430 Q${x + 160} 390 ${x + 300} 430 T${x + 420} 420 L${x + 420} 470 L${x} 470 Z`}
              fill="#365314"
            />
            {[60, 180, 320].map((tx) => (
              <g key={tx}>
                <rect x={x + tx} y="380" width="8" height="40" fill="#422006" />
                <circle cx={x + tx + 4} cy="370" r="24" fill="#166534" />
              </g>
            ))}
          </g>
          <rect x={x} y="170" width="420" height="300" rx="40" fill="none" stroke="#cbd5e1" strokeWidth="16" />
        </g>
      ))}
      <rect x="1460" y="120" width="140" height="460" fill="#475569" />
      <rect y="90" width={W} height="26" fill="#64748b" />
      <rect y="116" width={W} height="10" fill="#94a3b8" />
      <rect y="560" width={W} height="340" fill="#0f172a" />
      {[60, 520, 980].map((x) => (
        <g key={x}>
          <rect x={x} y="520" width="200" height="260" rx="24" fill="#b91c1c" />
          <rect x={x + 240} y="520" width="200" height="260" rx="24" fill="#b91c1c" />
          <rect x={x + 10} y="530" width="180" height="40" rx="14" fill="#f8fafc" opacity="0.8" />
          <rect x={x + 250} y="530" width="180" height="40" rx="14" fill="#f8fafc" opacity="0.8" />
        </g>
      ))}
    </>
  ),
  lab: () => (
    <>
      <Sky id="lb-wall" top="#0b2a33" bottom="#06161c" />
      {Array.from({ length: 4 }, (_, i) => (
        <g key={i}>
          <rect x={120 + i * 360} y="0" width="200" height="16" fill="#e0f2fe" />
          <Glow id={`lb-g${i}`} cx={220 + i * 360} cy={30} r={260} color="#67e8f9" opacity={0.18} />
        </g>
      ))}
      {[180, 640, 1100].map((x, i) => (
        <g key={x}>
          <rect x={x} y="170" width="320" height="200" rx="10" fill="#020617" stroke="#155e75" strokeWidth="6" />
          <polyline
            points={Array.from(
              { length: 12 },
              (_, k) => `${x + 20 + k * 26},${270 - Math.sin(k * 0.9 + i) * 50 - k * 3}`,
            ).join(' ')}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="4"
          />
          <polyline
            points={Array.from({ length: 12 }, (_, k) => `${x + 20 + k * 26},${320 - Math.cos(k * 0.7 + i) * 26}`).join(
              ' ',
            )}
            fill="none"
            stroke="#a78bfa"
            strokeWidth="3"
            opacity="0.8"
          />
        </g>
      ))}
      <rect y="600" width={W} height="40" fill="#cbd5e1" />
      <rect y="640" width={W} height="260" fill="#0f2730" />
      {[220, 420, 760, 980, 1300].map((x, i) => {
        const liquid = ['#22d3ee', '#a3e635', '#f472b6', '#facc15', '#60a5fa'][i] as string
        return (
          <g key={x}>
            <path
              d={`M${x - 14} 470 L${x - 14} 520 L${x - 50} 598 Q${x - 54} 604 ${x - 46} 604 L${x + 46} 604 Q${x + 54} 604 ${x + 50} 598 L${x + 14} 520 L${x + 14} 470 Z`}
              fill="#e0f2fe"
              opacity="0.25"
              stroke="#e0f2fe"
              strokeWidth="3"
            />
            <path
              d={`M${x - 34} 566 L${x - 50} 598 Q${x - 54} 604 ${x - 46} 604 L${x + 46} 604 Q${x + 54} 604 ${x + 50} 598 L${x + 34} 566 Z`}
              fill={liquid}
              opacity="0.85"
            />
            <Glow id={`lb-f${i}`} cx={x} cy={580} r={80} color={liquid} opacity={0.35} />
          </g>
        )
      })}
    </>
  ),
  'street-rain': () => (
    <>
      <Sky id="sr-sky" top="#1b2433" bottom="#3a4659" />
      <Skyline seed={31} base={700} color="#222b3b" windowColor="#fcd34d" minH={220} maxH={520} litRatio={0.18} />
      <rect y="700" width={W} height="200" fill="#151b26" />
      <rect y="700" width={W} height="200" fill="url(#sr-sky)" opacity="0.15" />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={i * 170 + 30} y="790" width="90" height="6" rx="3" fill="#e2e8f0" opacity="0.25" />
      ))}
      {[260, 1180].map((x) => (
        <g key={x}>
          <rect x={x} y="380" width="12" height="330" fill="#111827" />
          <path d={`M${x + 6} 380 q 0 -40 60 -40`} stroke="#111827" strokeWidth="10" fill="none" />
          <rect x={x + 46} y="336" width="44" height="18" rx="6" fill="#111827" />
          <path d={`M${x + 50} 354 L${x - 60} 710 L${x + 200} 710 L${x + 86} 354 Z`} fill="#fde68a" opacity="0.12" />
          <Glow id={`sr-l${x}`} cx={x + 68} cy={360} r={110} color="#fde68a" opacity={0.5} />
          <ellipse cx={x + 70} cy="760" rx="120" ry="14" fill="#fde68a" opacity="0.18" />
        </g>
      ))}
      <Person x={760} y={720} color="#334155" />
      <path d="M690 560 Q760 480 830 560 Z" fill="#7f1d1d" />
      <line x1="760" y1="520" x2="760" y2="600" stroke="#111" strokeWidth="4" />
      <Rain seed={5} />
    </>
  ),
  'interview-room': () => (
    <>
      <Sky id="ir-wall" top="#e7e2d9" bottom="#c9c1b3" />
      <rect x="1040" y="120" width="400" height="320" fill="#bae6fd" />
      <rect x="1040" y="120" width="400" height="320" fill="none" stroke="#f8fafc" strokeWidth="16" />
      <line x1="1240" y1="120" x2="1240" y2="440" stroke="#f8fafc" strokeWidth="10" />
      <rect x="200" y="150" width="300" height="200" fill="#f8fafc" stroke="#78716c" strokeWidth="10" />
      <path d="M220 330 L300 230 L360 290 L410 240 L480 330 Z" fill="#94a3b8" />
      <circle cx="430" cy="200" r="22" fill="#fbbf24" />
      <rect y="640" width={W} height="260" fill="#8b7a66" />
      <rect x="380" y="560" width="840" height="34" rx="6" fill="#57452f" />
      <rect x="420" y="594" width="22" height="200" fill="#3f3122" />
      <rect x="1160" y="594" width="22" height="200" fill="#3f3122" />
      {[300, 1300].map((x) => (
        <g key={x}>
          <rect x={x - 60} y="420" width="120" height="160" rx="18" fill="#1f2937" />
          <rect x={x - 70} y="580" width="140" height="30" rx="10" fill="#111827" />
          <rect x={x - 6} y="610" width="12" height="150" fill="#374151" />
        </g>
      ))}
      <rect x="640" y="520" width="120" height="40" rx="4" fill="#f8fafc" />
      <rect x="650" y="514" width="120" height="40" rx="4" fill="#ffffff" />
      {[880, 960].map((x) => (
        <path key={x} d={`M${x} 500 L${x + 36} 500 L${x + 32} 560 L${x + 4} 560 Z`} fill="#bfdbfe" opacity="0.7" />
      ))}
      <Plant x={1500} y={580} s={1.1} />
    </>
  ),
  apartment: () => (
    <>
      <Sky id="apt-wall" top="#3a3150" bottom="#231d33" />
      <rect x="160" y="130" width="460" height="360" fill="#0f1733" />
      <Stars count={25} seed={41} maxY={360} />
      <Skyline seed={43} base={490} color="#1b2448" windowColor="#fde68a" minH={80} maxH={250} litRatio={0.3} />
      <rect x="0" y="0" width="160" height={H} fill="#3a3150" />
      <rect x="620" y="0" width="980" height={H} fill="#352c4a" />
      <rect x="160" y="130" width="460" height="360" fill="none" stroke="#e7e5e4" strokeWidth="14" />
      <line x1="390" y1="130" x2="390" y2="490" stroke="#e7e5e4" strokeWidth="8" />
      <rect x="1180" y="160" width="300" height="440" fill="#4a3b2a" />
      {[0, 1, 2, 3].map((r) => (
        <g key={r}>
          <rect x="1180" y={250 + r * 100} width="300" height="12" fill="#2f2419" />
          {Array.from({ length: 7 }, (_, i) => (
            <rect
              key={i}
              x={1196 + i * 38}
              y={186 + r * 100}
              width="26"
              height={60 + ((i * 7 + r) % 3) * 6}
              fill={['#b45309', '#1d4ed8', '#15803d', '#9d174d', '#a16207', '#6d28d9', '#0e7490'][(i + r) % 7]}
            />
          ))}
        </g>
      ))}
      <rect y="700" width={W} height="200" fill="#1c1626" />
      <ellipse cx="760" cy="790" rx="420" ry="60" fill="#7c2d12" opacity="0.6" />
      <g transform="translate(520 560)">
        <rect x="0" y="40" width="520" height="120" rx="30" fill="#0f766e" />
        <rect x="-30" y="20" width="70" height="150" rx="30" fill="#115e59" />
        <rect x="480" y="20" width="70" height="150" rx="30" fill="#115e59" />
        <rect x="40" y="-10" width="440" height="80" rx="26" fill="#14b8a6" />
      </g>
      <line x1="1100" y1="400" x2="1100" y2="720" stroke="#1c1917" strokeWidth="8" />
      <path d="M1050 400 L1150 400 L1130 330 L1070 330 Z" fill="#fde68a" />
      <Glow id="apt-lamp" cx={1100} cy={380} r={220} color="#fde68a" opacity={0.35} />
    </>
  ),
  spaceship: () => (
    <>
      <rect width={W} height={H} fill="#05060f" />
      <Stars count={160} seed={51} maxY={H} />
      <defs>
        <clipPath id="sp-port">
          <circle cx="800" cy="400" r="300" />
        </clipPath>
        <radialGradient id="sp-planet" cx="35%" cy="35%">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="60%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </radialGradient>
      </defs>
      <g clipPath="url(#sp-port)">
        <rect x="500" y="100" width="600" height="600" fill="#0a0820" />
        <Stars count={60} seed={57} maxY={H} />
        <circle cx="900" cy="520" r="210" fill="url(#sp-planet)" />
        <ellipse
          cx="900"
          cy="520"
          rx="320"
          ry="40"
          fill="none"
          stroke="#c4b5fd"
          strokeWidth="6"
          opacity="0.6"
          transform="rotate(-14 900 520)"
        />
      </g>
      <path d={`M0 0 H${W} V${H} H0 Z M800 100 a300 300 0 1 0 0.1 0 Z`} fill="#1f2937" fillRule="evenodd" />
      <circle cx="800" cy="400" r="300" fill="none" stroke="#475569" strokeWidth="26" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2
        return <circle key={i} cx={800 + Math.cos(a) * 300} cy={400 + Math.sin(a) * 300} r="7" fill="#94a3b8" />
      })}
      {[60, 1300].map((x) => (
        <g key={x}>
          <rect x={x} y="160" width="240" height="460" rx="16" fill="#111827" stroke="#334155" strokeWidth="4" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect
              key={i}
              x={x + 24}
              y={190 + i * 52}
              width={60 + ((i * 37) % 140)}
              height="14"
              rx="7"
              fill={i % 3 === 0 ? '#22d3ee' : i % 3 === 1 ? '#a78bfa' : '#4ade80'}
              opacity="0.7"
              className={i % 2 ? 'lq-blink' : undefined}
            />
          ))}
        </g>
      ))}
      <path d={`M0 760 L${W} 760 L${W} ${H} L0 ${H} Z`} fill="#0b1220" />
      <path d="M380 760 L520 680 L1080 680 L1220 760 Z" fill="#1e293b" />
      {Array.from({ length: 10 }, (_, i) => (
        <circle
          key={i}
          cx={580 + i * 48}
          cy="720"
          r="9"
          fill={['#f87171', '#fbbf24', '#4ade80', '#22d3ee'][i % 4]}
          className={i % 3 === 0 ? 'lq-blink' : undefined}
        />
      ))}
    </>
  ),
  park: () => (
    <>
      <Sky id="pk-sky" top="#60a5fa" bottom="#dbeafe" />
      <circle cx="1320" cy="160" r="70" fill="#fef08a" />
      <Glow id="pk-sun" cx={1320} cy={160} r={240} color="#fef9c3" opacity={0.6} />
      {[
        [260, 150, 1],
        [760, 110, 0.8],
        [1060, 230, 0.6],
      ].map(([x, y, s], i) => (
        <g key={i} className="lq-drift" transform={`translate(${x} ${y}) scale(${s})`} opacity="0.95">
          <ellipse cx="0" cy="0" rx="90" ry="34" fill="#fff" />
          <ellipse cx="50" cy="-22" rx="60" ry="40" fill="#fff" />
          <ellipse cx="-50" cy="-12" rx="50" ry="30" fill="#fff" />
        </g>
      ))}
      <path d={`M0 560 Q300 470 620 540 T1200 520 T${W} 540 V${H} H0 Z`} fill="#65a30d" />
      <path d={`M0 640 Q400 580 800 640 T${W} 620 V${H} H0 Z`} fill="#4d7c0f" />
      <path d="M700 900 Q760 760 900 640 L960 640 Q860 760 860 900 Z" fill="#d6c7a1" />
      {[160, 420, 1150, 1440].map((x, i) => (
        <g key={x}>
          <rect x={x - 12} y={480 + (i % 2) * 40} width="24" height="160" fill="#713f12" />
          <circle cx={x} cy={450 + (i % 2) * 40} r={90} fill={i % 2 ? '#166534' : '#15803d'} />
          <circle cx={x - 50} cy={490 + (i % 2) * 40} r={60} fill="#15803d" />
          <circle cx={x + 55} cy={485 + (i % 2) * 40} r={64} fill="#14532d" />
        </g>
      ))}
      <g transform="translate(1040 720)">
        <rect x="0" y="0" width="240" height="18" rx="4" fill="#92400e" />
        <rect x="0" y="-50" width="240" height="14" rx="4" fill="#92400e" />
        <rect x="10" y="18" width="12" height="60" fill="#1c1917" />
        <rect x="218" y="18" width="12" height="60" fill="#1c1917" />
      </g>
    </>
  ),
  'hotel-lobby': () => (
    <>
      <Sky id="hl-wall" top="#3d2f22" bottom="#5e4a35" />
      {[160, 560, 1040, 1440].map((x) => (
        <g key={x}>
          <rect x={x - 40} y="0" width="80" height="660" fill="#d6cbb8" />
          <rect x={x - 54} y="0" width="108" height="30" fill="#c1b39c" />
          <rect x={x - 54} y="630" width="108" height="30" fill="#c1b39c" />
        </g>
      ))}
      <line x1="800" y1="0" x2="800" y2="110" stroke="#a16207" strokeWidth="4" />
      <g transform="translate(800 150)">
        <path d="M-160 0 Q0 80 160 0" fill="none" stroke="#fbbf24" strokeWidth="6" />
        {Array.from({ length: 9 }, (_, i) => (
          <g key={i}>
            <line
              x1={-160 + i * 40}
              y1={Math.sin((i / 8) * Math.PI) * 40}
              x2={-160 + i * 40}
              y2={Math.sin((i / 8) * Math.PI) * 40 + 50}
              stroke="#fde68a"
              strokeWidth="3"
            />
            <circle cx={-160 + i * 40} cy={Math.sin((i / 8) * Math.PI) * 40 + 56} r="8" fill="#fef3c7" />
          </g>
        ))}
        <circle cx="0" cy="-30" r="30" fill="#fbbf24" />
      </g>
      <Glow id="hl-ch" cx={800} cy={190} r={360} color="#fde68a" opacity={0.35} />
      <rect y="660" width={W} height="240" fill="#e7dfd0" />
      {Array.from({ length: 16 }, (_, i) => (
        <path key={i} d={`M${i * 100} 660 L${(i - 8) * 260 + 800} 900`} stroke="#c8bba3" strokeWidth="3" />
      ))}
      {[700, 760, 840].map((y) => (
        <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#c8bba3" strokeWidth="3" />
      ))}
      <rect x="600" y="520" width="400" height="160" rx="8" fill="#5b3a1e" />
      <rect x="586" y="508" width="428" height="24" rx="6" fill="#1c1917" />
      <rect x="640" y="560" width="320" height="8" fill="#a16207" />
      <circle cx="930" cy="500" r="10" fill="#fbbf24" />
      <Plant x={330} y={600} s={1.2} />
      <Plant x={1270} y={600} s={1.2} />
    </>
  ),
  market: () => (
    <>
      <Sky id="mk-sky" top="#f97316" bottom="#fcd34d" />
      <circle cx="800" cy="330" r="110" fill="#fff7ed" opacity="0.8" />
      <Skyline seed={61} base={460} color="#9a3412" windowColor="#fed7aa" minH={60} maxH={200} litRatio={0.15} />
      <path d={`M0 120 Q400 200 800 130 T${W} 140`} fill="none" stroke="#1f2937" strokeWidth="3" />
      {Array.from({ length: 18 }, (_, i) => (
        <circle
          key={i}
          cx={i * 92 + 20}
          cy={150 + Math.sin(i * 0.9) * 30}
          r="9"
          fill="#fef08a"
          className={i % 3 === 0 ? 'lq-blink' : undefined}
        />
      ))}
      {[40, 560, 1080].map((x, i) => {
        const stripe = ['#dc2626', '#2563eb', '#16a34a'][i] as string
        return (
          <g key={x}>
            {Array.from({ length: 8 }, (_, k) => (
              <path
                key={k}
                d={`M${x + k * 60} 360 L${x + k * 60 + 60} 360 L${x + k * 60 + 60} 430 Q${x + k * 60 + 30} 460 ${x + k * 60} 430 Z`}
                fill={k % 2 ? '#fff7ed' : stripe}
              />
            ))}
            <rect x={x + 10} y="430" width="12" height="300" fill="#422006" />
            <rect x={x + 458} y="430" width="12" height="300" fill="#422006" />
            <rect x={x} y="600" width="480" height="130" fill="#78350f" />
            {Array.from({ length: 18 }, (_, k) => (
              <circle
                key={k}
                cx={x + 30 + (k % 9) * 52}
                cy={590 - Math.floor(k / 9) * 26}
                r="20"
                fill={['#ef4444', '#f97316', '#facc15', '#84cc16', '#a855f7'][(k + i) % 5]}
              />
            ))}
          </g>
        )
      })}
      <rect y="730" width={W} height="170" fill="#57534e" />
      <Person x={520} y={850} color="#0e7490" s={0.9} />
      <Person x={1040} y={860} color="#7c3aed" s={0.95} />
    </>
  ),
  museum: () => (
    <>
      <Sky id="mu-wall" top="#2a2a30" bottom="#3f3f46" />
      {[200, 680, 1160].map((x, i) => (
        <g key={x}>
          <Glow id={`mu-s${i}`} cx={x + 120} cy={330} r={260} color="#fef3c7" opacity={0.22} />
          <path d={`M${x + 120} 0 L${x - 40} 600 L${x + 280} 600 Z`} fill="#fef3c7" opacity="0.05" />
          <rect x={x} y="190" width="240" height="280" fill="#a16207" />
          <rect x={x + 14} y="204" width="212" height="252" fill={['#1e3a8a', '#7f1d1d', '#14532d'][i]} />
          {i === 0 && <circle cx={x + 120} cy="320" r="70" fill="#fbbf24" />}
          {i === 1 && <path d={`M${x + 30} 440 L${x + 110} 260 L${x + 200} 440 Z`} fill="#fca5a5" />}
          {i === 2 && (
            <>
              <rect x={x + 40} y="250" width="70" height="150" fill="#86efac" />
              <rect x={x + 120} y="300" width="80" height="80" fill="#fde047" />
            </>
          )}
        </g>
      ))}
      <rect y="640" width={W} height="260" fill="#57534e" />
      <rect y="640" width={W} height="10" fill="#78716c" />
      <g transform="translate(1480 640)">
        <rect x="-60" y="-160" width="120" height="160" fill="#e7e5e4" />
        <path d="M-30 -160 Q-40 -260 0 -290 Q40 -260 30 -160 Z" fill="#d6d3d1" />
        <circle cx="0" cy="-310" r="26" fill="#d6d3d1" />
      </g>
      <rect x="560" y="700" width="480" height="30" rx="6" fill="#292524" />
      <rect x="590" y="730" width="16" height="70" fill="#1c1917" />
      <rect x="994" y="730" width="16" height="70" fill="#1c1917" />
      <path d="M120 640 h80 v-30 h-80 Z" fill="#b91c1c" opacity="0.7" />
      <line x1="80" y1="610" x2="80" y2="640" stroke="#d6d3d1" strokeWidth="6" />
      <line x1="240" y1="610" x2="240" y2="640" stroke="#d6d3d1" strokeWidth="6" />
    </>
  ),
}

const MOOD_TINT: Record<Mood, string> = {
  calm: 'linear-gradient(180deg, rgb(96 165 250 / 0.10), rgb(15 23 42 / 0.25))',
  tense: 'linear-gradient(180deg, rgb(127 29 29 / 0.25), rgb(2 6 23 / 0.45))',
  warm: 'linear-gradient(180deg, rgb(251 146 60 / 0.18), rgb(67 20 7 / 0.25))',
  mysterious: 'linear-gradient(180deg, rgb(91 33 182 / 0.28), rgb(2 6 23 / 0.45))',
  upbeat: 'linear-gradient(180deg, rgb(250 204 21 / 0.14), rgb(255 255 255 / 0.02))',
  serious: 'linear-gradient(180deg, rgb(30 41 59 / 0.35), rgb(2 6 23 / 0.45))',
}

const KEYFRAMES = `
@keyframes lq-rain { from { transform: translate(0, -60px) } to { transform: translate(-20px, 60px) } }
@keyframes lq-twinkle { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
@keyframes lq-blink { 0%, 100% { opacity: 0.9 } 50% { opacity: 0.3 } }
@keyframes lq-drift { from { translate: -30px 0 } to { translate: 30px 0 } }
@keyframes lq-scroll { from { translate: 0 0 } to { translate: -60px 0 } }
@keyframes lq-steam { 0%, 100% { opacity: 0.2; translate: 0 6px } 50% { opacity: 0.6; translate: 0 -6px } }
.lq-backdrop .lq-rain { animation: lq-rain 0.6s linear infinite }
.lq-backdrop .lq-twinkle { animation: lq-twinkle 4s ease-in-out infinite }
.lq-backdrop .lq-blink { animation: lq-blink 2.4s ease-in-out infinite }
.lq-backdrop .lq-drift { animation: lq-drift 18s ease-in-out infinite alternate }
.lq-backdrop .lq-scroll { animation: lq-scroll 3s linear infinite alternate }
.lq-backdrop .lq-steam { animation: lq-steam 3s ease-in-out infinite }
.lq-backdrop.lq-still * { animation: none !important }
`

/** Full-bleed scene illustration with a mood tint and vignette. `still` disables the ambient animation. */
export const Backdrop = memo(function Backdrop({
  backdrop,
  mood,
  className,
  still,
}: {
  backdrop: BackdropId
  mood?: Mood
  className?: string
  still?: boolean
}) {
  const draw = SCENES[backdrop] ?? SCENES['city-night']
  return (
    <div
      className={cx('lq-backdrop absolute inset-0 overflow-hidden', still && 'lq-still', className)}
      aria-hidden="true"
    >
      <style>{KEYFRAMES}</style>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        {draw()}
      </svg>
      {mood && <div className="absolute inset-0" style={{ background: MOOD_TINT[mood] }} />}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / 0.55) 100%)' }}
      />
    </div>
  )
})
