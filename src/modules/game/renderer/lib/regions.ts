// Adventure map data: where each region sits on the illustrated map, its landmark, route, names and stage styling.
// Pure data + helpers (no React) so the layout can be unit-tested.
import { REGION_SKILL, REGION_STAGE_XP } from '@core/game'
import { REGION_KEYS, type RegionKey, type RegionProgress } from '@shared/types'
import { curveSegment, smoothPath, type Point } from '../charts/scale'

export type Bi = { en: string; vi: string }
export type Landmark = 'forest' | 'castle' | 'ocean' | 'arena' | 'library' | 'academy' | 'summit'

export interface RegionMeta {
  key: RegionKey
  landmark: Landmark
  /** Centre of the landmark in map coordinates (MAP_SIZE). */
  x: number
  y: number
  route: string
  name: Bi
  skill: Bi
  lore: Bi
}

export const MAP_SIZE = { width: 1000, height: 640 } as const
/** Radius of the progress ring drawn around each landmark. */
export const REGION_RADIUS = 62
const TRAIL_TENSION = 0.6

/** Regions in path order: the trail winds through the six skills and climbs to the summit. */
export const REGION_LAYOUT: RegionMeta[] = [
  {
    key: 'vocabulary-forest',
    landmark: 'forest',
    x: 110,
    y: 470,
    route: '/vocabulary',
    name: { en: 'Vocabulary Forest', vi: 'Rừng Từ Vựng' },
    skill: { en: 'Vocabulary', vi: 'Từ vựng' },
    lore: {
      en: 'Every word you collect plants a tree. Review them and the forest grows deep and green.',
      vi: 'Mỗi từ bạn thu thập là một cái cây. Ôn tập đều đặn để khu rừng ngày càng xanh tốt.',
    },
  },
  {
    key: 'grammar-kingdom',
    landmark: 'castle',
    x: 250,
    y: 290,
    route: '/grammar',
    name: { en: 'Grammar Kingdom', vi: 'Vương quốc Ngữ pháp' },
    skill: { en: 'Grammar', vi: 'Ngữ pháp' },
    lore: {
      en: 'Rules are the walls of the kingdom. Clear drills to raise towers and earn your knighthood.',
      vi: 'Quy tắc là tường thành của vương quốc. Vượt thử thách để xây tháp và được phong hiệp sĩ.',
    },
  },
  {
    key: 'listening-ocean',
    landmark: 'ocean',
    x: 420,
    y: 480,
    route: '/listening',
    name: { en: 'Listening Ocean', vi: 'Đại dương Nghe' },
    skill: { en: 'Listening', vi: 'Nghe' },
    lore: {
      en: 'Sail through accents and speeds. The more you listen, the further the lighthouse shines.',
      vi: 'Vượt qua nhiều giọng đọc và tốc độ. Nghe càng nhiều, ngọn hải đăng càng sáng xa.',
    },
  },
  {
    key: 'speaking-arena',
    landmark: 'arena',
    x: 575,
    y: 290,
    route: '/speaking',
    name: { en: 'Speaking Arena', vi: 'Đấu trường Nói' },
    skill: { en: 'Speaking', vi: 'Nói' },
    lore: {
      en: 'Step into the arena and use your voice. Every minute spoken makes the crowd roar louder.',
      vi: 'Bước vào đấu trường và cất tiếng nói. Mỗi phút luyện nói khiến khán đài reo hò lớn hơn.',
    },
  },
  {
    key: 'reading-library',
    landmark: 'library',
    x: 735,
    y: 480,
    route: '/reading',
    name: { en: 'Reading Library', vi: 'Thư viện Đọc' },
    skill: { en: 'Reading', vi: 'Đọc' },
    lore: {
      en: 'Stories and articles fill the shelves. Read to unlock new wings of the great library.',
      vi: 'Truyện và bài báo xếp đầy kệ. Đọc thêm để mở những gian mới của thư viện lớn.',
    },
  },
  {
    key: 'writing-academy',
    landmark: 'academy',
    x: 885,
    y: 290,
    route: '/writing',
    name: { en: 'Writing Academy', vi: 'Học viện Viết' },
    skill: { en: 'Writing', vi: 'Viết' },
    lore: {
      en: 'Masters of the quill train here. Submit writing and earn your place in the hall of scholars.',
      vi: 'Nơi rèn luyện ngòi bút. Nộp bài viết để có chỗ đứng trong sảnh học giả.',
    },
  },
  {
    key: 'mastery-challenge',
    landmark: 'summit',
    x: 730,
    y: 105,
    route: '/journey',
    name: { en: 'Mastery Summit', vi: 'Đỉnh Thông thạo' },
    skill: { en: 'All skills', vi: 'Mọi kỹ năng' },
    lore: {
      en: 'The final climb to B2 / IELTS 6.5. Only explorers who have built an outpost in every region may ascend.',
      vi: 'Chặng leo cuối cùng tới B2 / IELTS 6.5. Chỉ ai đã dựng tiền đồn ở mọi vùng mới được leo lên.',
    },
  },
]

/** Stage names (index = stage 0..5). */
export const STAGE_NAMES: Bi[] = [
  { en: 'Uncharted', vi: 'Chưa khai phá' },
  { en: 'Campsite', vi: 'Trại dừng chân' },
  { en: 'Outpost', vi: 'Tiền đồn' },
  { en: 'Stronghold', vi: 'Thành lũy' },
  { en: 'Citadel', vi: 'Thành trì' },
  { en: 'Legendary', vi: 'Huyền thoại' },
]

export const MAX_STAGE = REGION_STAGE_XP.length - 1
/** Stage the six skill regions need before the Mastery Summit opens (see computeRegions in core/game). */
export const MASTERY_REQUIRED_STAGE = 2

export function stageName(stage: number): Bi {
  return STAGE_NAMES[Math.max(0, Math.min(STAGE_NAMES.length - 1, Math.floor(stage)))] as Bi
}

export function regionMeta(key: RegionKey): RegionMeta {
  return (REGION_LAYOUT.find((r) => r.key === key) ?? REGION_LAYOUT[0]) as RegionMeta
}

export function regionRoute(key: RegionKey): string {
  return regionMeta(key).route
}

/** Progress inside the current stage, 0..1 (1 at the final stage). */
export function stageFraction(r: Pick<RegionProgress, 'stageXp' | 'nextStageXp'>): number {
  if (r.nextStageXp === null || r.nextStageXp <= 0) return 1
  return Math.max(0, Math.min(1, r.stageXp / r.nextStageXp))
}

/** XP still needed to reach the next stage (0 at the final stage). */
export function xpToNextStage(r: Pick<RegionProgress, 'stageXp' | 'nextStageXp'>): number {
  if (r.nextStageXp === null) return 0
  return Math.max(0, r.nextStageXp - r.stageXp)
}

/**
 * Fill colour for a landmark at a given stage. Uses theme variables so accent themes recolour the map;
 * stage 5 turns gold. Locked regions are greyed out.
 */
export function stageColor(stage: number, unlocked = true): string {
  if (!unlocked) return 'var(--surface-3)'
  const s = Math.max(0, Math.min(MAX_STAGE, Math.floor(stage)))
  if (s === 0) return 'color-mix(in oklab, var(--muted) 45%, var(--surface-3))'
  if (s >= MAX_STAGE) return 'var(--warning)'
  const pct = 35 + s * 15 // 50, 65, 80, 95
  return `color-mix(in oklab, var(--accent) ${pct}%, var(--surface-3))`
}

/** Fills missing regions with an empty stage-0 entry so the map always draws all seven. */
export function normalizeRegions(regions: RegionProgress[] | undefined): RegionProgress[] {
  return REGION_KEYS.map((key) => {
    const found = regions?.find((r) => r.key === key)
    if (found) return found
    return {
      key,
      skill: REGION_SKILL[key],
      xp: 0,
      stage: 0,
      stageXp: 0,
      nextStageXp: (REGION_STAGE_XP[1] as number) - (REGION_STAGE_XP[0] as number),
      unlocked: key !== 'mastery-challenge',
    }
  })
}

/** The winding trail through the regions in layout order. */
export function trailPath(): string {
  return smoothPath(
    REGION_LAYOUT.map((r): Point => ({ x: r.x, y: r.y })),
    TRAIL_TENSION,
  )
}

/** Trail segments between consecutive regions; `active` when the learner has started both ends. */
export function trailSegments(
  regions: RegionProgress[],
): { from: RegionKey; to: RegionKey; d: string; active: boolean }[] {
  const byKey = new Map(regions.map((r) => [r.key, r]))
  const out: { from: RegionKey; to: RegionKey; d: string; active: boolean }[] = []
  const points = REGION_LAYOUT.map((r): Point => ({ x: r.x, y: r.y }))
  for (let i = 0; i < REGION_LAYOUT.length - 1; i++) {
    const a = REGION_LAYOUT[i] as RegionMeta
    const b = REGION_LAYOUT[i + 1] as RegionMeta
    // Same Catmull-Rom curve as trailPath, one segment at a time so segments can be coloured independently.
    const d = `M${a.x} ${a.y} ${curveSegment(points, i, TRAIL_TENSION)}`
    const ra = byKey.get(a.key)
    const rb = byKey.get(b.key)
    out.push({ from: a.key, to: b.key, d, active: !!ra && !!rb && ra.stage > 0 && rb.stage > 0 && rb.unlocked })
  }
  return out
}

/** Regions that still block the summit (below the required stage). */
export function regionsBlockingMastery(regions: RegionProgress[]): RegionProgress[] {
  return regions.filter((r) => r.key !== 'mastery-challenge' && r.stage < MASTERY_REQUIRED_STAGE)
}

/** Minimum distance between any two region centres – used by tests to make sure landmarks never overlap. */
export function minRegionDistance(layout: RegionMeta[] = REGION_LAYOUT): number {
  let best = Infinity
  for (let i = 0; i < layout.length; i++)
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i] as RegionMeta
      const b = layout[j] as RegionMeta
      best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y))
    }
  return best
}
