// Renderer helpers shared by the journey pages: skill / module metadata, CEFR descriptions, small widgets.
import {
  BookOpen,
  BookText,
  Clapperboard,
  Ear,
  GraduationCap,
  Layers,
  MessageCircle,
  Mic,
  PenLine,
  Puzzle,
  type LucideIcon,
} from 'lucide-react'
import type { Cefr } from '@shared/content'
import type { Skill } from '@shared/types'

export type Bi = { en: string; vi: string }

export const SKILL_META: Record<Skill, { label: Bi; icon: LucideIcon }> = {
  vocabulary: { label: { en: 'Vocabulary', vi: 'Từ vựng' }, icon: Layers },
  grammar: { label: { en: 'Grammar', vi: 'Ngữ pháp' }, icon: Puzzle },
  reading: { label: { en: 'Reading', vi: 'Đọc' }, icon: BookOpen },
  listening: { label: { en: 'Listening', vi: 'Nghe' }, icon: Ear },
  writing: { label: { en: 'Writing', vi: 'Viết' }, icon: PenLine },
  speaking: { label: { en: 'Speaking', vi: 'Nói' }, icon: Mic },
}

export const MODULE_META: Record<string, { label: Bi; icon: LucideIcon; tone: string }> = {
  vocabulary: { label: { en: 'Flashcards', vi: 'Thẻ từ' }, icon: Layers, tone: 'text-emerald-400 bg-emerald-500/12' },
  grammar: { label: { en: 'Grammar', vi: 'Ngữ pháp' }, icon: Puzzle, tone: 'text-violet-400 bg-violet-500/12' },
  reading: { label: { en: 'Reading', vi: 'Đọc' }, icon: BookOpen, tone: 'text-sky-400 bg-sky-500/12' },
  listening: { label: { en: 'Listening', vi: 'Nghe' }, icon: Ear, tone: 'text-cyan-400 bg-cyan-500/12' },
  writing: { label: { en: 'Writing', vi: 'Viết' }, icon: PenLine, tone: 'text-amber-400 bg-amber-500/12' },
  speaking: { label: { en: 'Speaking', vi: 'Nói' }, icon: Mic, tone: 'text-rose-400 bg-rose-500/12' },
  cinema: { label: { en: 'Cinema', vi: 'Điện ảnh' }, icon: Clapperboard, tone: 'text-fuchsia-400 bg-fuchsia-500/12' },
  tutor: { label: { en: 'AI Tutor', vi: 'Gia sư AI' }, icon: MessageCircle, tone: 'text-indigo-400 bg-indigo-500/12' },
  journey: { label: { en: 'Course', vi: 'Khóa học' }, icon: GraduationCap, tone: 'text-teal-400 bg-teal-500/12' },
  review: { label: { en: 'Review', vi: 'Ôn tập' }, icon: BookText, tone: 'text-emerald-400 bg-emerald-500/12' },
}

export const moduleMeta = (m: string) => MODULE_META[m] ?? (MODULE_META.journey as (typeof MODULE_META)[string])

export const CEFR_INFO: Record<Cefr, { name: Bi; can: Bi; ielts: string }> = {
  A1: {
    name: { en: 'Beginner', vi: 'Mới bắt đầu' },
    can: {
      en: 'Understands and uses familiar everyday expressions and very basic phrases.',
      vi: 'Hiểu và dùng được các cụm từ quen thuộc hằng ngày và câu rất cơ bản.',
    },
    ielts: '< 3.0',
  },
  A2: {
    name: { en: 'Elementary', vi: 'Sơ cấp' },
    can: {
      en: 'Communicates in simple, routine tasks about familiar topics.',
      vi: 'Giao tiếp được trong các tình huống đơn giản, quen thuộc.',
    },
    ielts: '3.0–3.5',
  },
  B1: {
    name: { en: 'Intermediate', vi: 'Trung cấp' },
    can: {
      en: 'Handles most travel situations and describes experiences, plans and opinions.',
      vi: 'Xử lý được hầu hết tình huống khi đi du lịch, kể lại trải nghiệm và nêu ý kiến.',
    },
    ielts: '4.0–5.0',
  },
  B2: {
    name: { en: 'Upper intermediate', vi: 'Trung cao cấp' },
    can: {
      en: 'Understands complex texts and talks fluently and spontaneously with native speakers.',
      vi: 'Hiểu văn bản phức tạp, nói trôi chảy và tự nhiên với người bản ngữ.',
    },
    ielts: '5.5–6.5',
  },
  C1: {
    name: { en: 'Advanced', vi: 'Cao cấp' },
    can: {
      en: 'Uses English flexibly for social, academic and professional purposes.',
      vi: 'Dùng tiếng Anh linh hoạt cho mục đích xã hội, học thuật và công việc.',
    },
    ielts: '7.0–8.0',
  },
  C2: {
    name: { en: 'Proficient', vi: 'Thành thạo' },
    can: {
      en: 'Understands virtually everything and expresses ideas with precision.',
      vi: 'Hiểu gần như mọi thứ và diễn đạt ý tưởng chính xác, tinh tế.',
    },
    ielts: '8.5+',
  },
}

export const THEMES: { key: string; label: Bi; emoji: string }[] = [
  { key: 'travel', label: { en: 'Travel', vi: 'Du lịch' }, emoji: '✈️' },
  { key: 'technology', label: { en: 'Technology', vi: 'Công nghệ' }, emoji: '💻' },
  { key: 'business', label: { en: 'Business', vi: 'Kinh doanh' }, emoji: '💼' },
  { key: 'movies', label: { en: 'Movies', vi: 'Phim ảnh' }, emoji: '🎬' },
  { key: 'music', label: { en: 'Music', vi: 'Âm nhạc' }, emoji: '🎵' },
  { key: 'food', label: { en: 'Food', vi: 'Ẩm thực' }, emoji: '🍜' },
  { key: 'science', label: { en: 'Science', vi: 'Khoa học' }, emoji: '🔬' },
  { key: 'sports', label: { en: 'Sports', vi: 'Thể thao' }, emoji: '⚽' },
  { key: 'psychology', label: { en: 'Psychology', vi: 'Tâm lý học' }, emoji: '🧠' },
  { key: 'culture', label: { en: 'Culture', vi: 'Văn hóa' }, emoji: '🏛️' },
  { key: 'ielts', label: { en: 'IELTS topics', vi: 'Chủ đề IELTS' }, emoji: '🎯' },
  { key: 'daily', label: { en: 'Daily life', vi: 'Đời sống' }, emoji: '☕' },
]

export function dayPartGreeting(hour: number): Bi {
  if (hour >= 5 && hour < 12) return { en: 'Good morning', vi: 'Chào buổi sáng' }
  if (hour >= 12 && hour < 18) return { en: 'Good afternoon', vi: 'Chào buổi chiều' }
  if (hour >= 18 && hour < 22) return { en: 'Good evening', vi: 'Chào buổi tối' }
  return { en: 'Studying late', vi: 'Học khuya nhỉ' }
}

/** Safe sessionStorage access (private windows / tests may throw). */
export const session = {
  get<T>(key: string): T | null {
    try {
      const raw = sessionStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  set(key: string, value: unknown) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}
