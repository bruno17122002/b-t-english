// Global search across bundled content, the word bank and app pages (Ctrl+K palette).
import type { SearchResult } from '@shared/types'
import type { AppDatabase } from '../../db/database'
import type { ContentRegistry } from '../content/registry'

export const PAGES: { id: string; title: string; titleVi: string; route: string; keywords: string }[] = [
  { id: 'dashboard', title: 'Dashboard', titleVi: 'Trang chủ', route: '/', keywords: 'home today plan' },
  {
    id: 'journey',
    title: 'Journey',
    titleVi: 'Hành trình',
    route: '/journey',
    keywords: 'roadmap plan goals lộ trình',
  },
  {
    id: 'listening',
    title: 'Listening Lab',
    titleVi: 'Phòng nghe',
    route: '/listening',
    keywords: 'nghe audio dictation',
  },
  {
    id: 'speaking',
    title: 'Speaking Studio',
    titleVi: 'Phòng nói',
    route: '/speaking',
    keywords: 'nói phát âm shadowing pronunciation',
  },
  {
    id: 'reading',
    title: 'Reading Adventure',
    titleVi: 'Phiêu lưu đọc',
    route: '/reading',
    keywords: 'đọc truyện article',
  },
  { id: 'writing', title: 'Writing Workshop', titleVi: 'Xưởng viết', route: '/writing', keywords: 'viết essay email' },
  {
    id: 'grammar',
    title: 'Grammar Kingdom',
    titleVi: 'Vương quốc ngữ pháp',
    route: '/grammar',
    keywords: 'ngữ pháp tense',
  },
  { id: 'cinema', title: 'Cinema Mode', titleVi: 'Rạp phim', route: '/cinema', keywords: 'phim story interactive' },
  {
    id: 'vocabulary',
    title: 'Vocabulary',
    titleVi: 'Từ vựng',
    route: '/vocabulary',
    keywords: 'từ vựng flashcard ôn tập',
  },
  { id: 'tutor', title: 'AI Tutor', titleVi: 'Gia sư AI', route: '/tutor', keywords: 'chat gia sư hỏi' },
  {
    id: 'game',
    title: 'Adventure Map',
    titleVi: 'Bản đồ phiêu lưu',
    route: '/game',
    keywords: 'map quest achievement xp level',
  },
  { id: 'stats', title: 'Statistics', titleVi: 'Thống kê', route: '/stats', keywords: 'thống kê biểu đồ progress' },
  {
    id: 'library',
    title: 'Favorites & Bookmarks',
    titleVi: 'Yêu thích & đánh dấu',
    route: '/library',
    keywords: 'yêu thích bookmark',
  },
  {
    id: 'settings',
    title: 'Settings',
    titleVi: 'Cài đặt',
    route: '/settings',
    keywords: 'cài đặt theme language backup',
  },
  {
    id: 'ai-settings',
    title: 'AI Settings',
    titleVi: 'Cài đặt AI',
    route: '/settings/ai',
    keywords: 'api key gemini openai model',
  },
]

/** Lower-cases and strips Vietnamese diacritics so "hai dang" matches "hải đăng". */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd')

export class SearchService {
  constructor(
    private readonly db: AppDatabase,
    private readonly content: ContentRegistry,
  ) {}

  search(query: string, limit = 30): SearchResult[] {
    const q = norm(query.trim())
    if (q.length < 1) return []
    const hit = (...fields: string[]) => fields.some((f) => norm(f).includes(q))
    const out: SearchResult[] = []
    for (const p of PAGES)
      if (hit(p.title, p.titleVi, p.keywords))
        out.push({ kind: 'page', id: p.id, title: p.title, subtitle: p.titleVi, route: p.route })
    for (const r of this.content.reading())
      if (hit(r.title, r.topicTags.join(' '), r.summaryVi))
        out.push({
          kind: 'reading',
          id: r.id,
          title: r.title,
          subtitle: `Reading · ${r.cefr}`,
          route: `/reading/${r.id}`,
        })
    for (const t of this.content.listening())
      if (hit(t.title, t.topic))
        out.push({
          kind: 'listening',
          id: t.id,
          title: t.title,
          subtitle: `Listening · ${t.cefr}`,
          route: `/listening/${t.id}`,
        })
    for (const s of this.content.stories())
      if (hit(s.title, s.synopsisEn, s.synopsisVi, s.genre))
        out.push({ kind: 'story', id: s.id, title: s.title, subtitle: `Cinema · ${s.cefr}`, route: `/cinema/${s.id}` })
    // AI-generated films live in the database rather than the bundled content.
    for (const s of this.db.all<{ id: string; title: string; genre: string; cefr: string }>(
      "SELECT id, title, genre, cefr FROM stories WHERE source = 'ai'",
    ))
      if (hit(s.title, s.genre))
        out.push({
          kind: 'story',
          id: s.id,
          title: s.title,
          subtitle: `Cinema · AI · ${s.cefr}`,
          route: `/cinema/${s.id}`,
        })
    for (const g of this.content.grammar())
      if (hit(g.title, g.summaryEn, g.patterns.join(' ')))
        out.push({
          kind: 'grammar',
          id: g.id,
          title: g.title,
          subtitle: `Grammar · ${g.cefr}`,
          route: `/grammar/${g.id}`,
        })
    for (const w of this.content.writingPrompts())
      if (hit(w.title, w.instructions))
        out.push({
          kind: 'writing-prompt',
          id: w.id,
          title: w.title,
          subtitle: `Writing · ${w.cefr}`,
          route: `/writing?prompt=${w.id}`,
        })
    for (const s of this.content.speakingPrompts())
      if (hit(s.title, s.kind))
        out.push({
          kind: 'speaking-prompt',
          id: s.id,
          title: s.title,
          subtitle: `Speaking · ${s.cefr}`,
          route: `/speaking?prompt=${s.id}`,
        })
    // Diacritic-insensitive match ("hai dang" finds "hải đăng"), so filter in JS rather than with LIKE.
    let vocabHits = 0
    for (const v of this.db.all<{ id: number; word: string; meaning_vi: string }>(
      'SELECT id, word, meaning_vi FROM vocabulary',
    )) {
      if (vocabHits >= 10) break
      if (!hit(v.word, v.meaning_vi)) continue
      vocabHits++
      out.push({
        kind: 'vocab',
        id: String(v.id),
        title: v.word,
        subtitle: v.meaning_vi,
        route: `/vocabulary?word=${v.id}`,
      })
    }
    for (const d of this.content.dictionary())
      if (norm(d.word).startsWith(q) || (q.length >= 3 && norm(d.meaningVi).includes(q)))
        out.push({
          kind: 'dictionary',
          id: d.word,
          title: d.word,
          subtitle: d.meaningVi,
          route: `/vocabulary?lookup=${encodeURIComponent(d.word)}`,
        })
    return out.slice(0, limit)
  }
}
