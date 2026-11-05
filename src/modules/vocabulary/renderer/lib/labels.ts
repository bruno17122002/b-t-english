// Bilingual labels used across the vocabulary pages.
import type { Strength } from './practice'

type Bi = { en: string; vi: string }

export const SOURCE_LABEL: Record<string, Bi> = {
  listening: { en: 'Listening', vi: 'Nghe' },
  speaking: { en: 'Speaking', vi: 'Nói' },
  reading: { en: 'Reading', vi: 'Đọc' },
  writing: { en: 'Writing', vi: 'Viết' },
  cinema: { en: 'Cinema', vi: 'Rạp phim' },
  vocabulary: { en: 'Vocabulary', vi: 'Từ vựng' },
  grammar: { en: 'Grammar', vi: 'Ngữ pháp' },
  tutor: { en: 'AI Tutor', vi: 'Gia sư AI' },
  assessment: { en: 'Assessment', vi: 'Kiểm tra' },
  manual: { en: 'Added by me', vi: 'Tự thêm' },
  dictionary: { en: 'Dictionary', vi: 'Từ điển' },
}

export const STATE_FILTERS: { value: '' | 'new' | 'learning' | 'review' | 'relearning' | 'difficult' | 'due' | 'favorite'; label: Bi }[] = [
  { value: '', label: { en: 'All words', vi: 'Tất cả' } },
  { value: 'due', label: { en: 'Due now', vi: 'Đến hạn' } },
  { value: 'new', label: { en: 'New', vi: 'Mới' } },
  { value: 'learning', label: { en: 'Learning', vi: 'Đang học' } },
  { value: 'review', label: { en: 'Reviewing', vi: 'Đang ôn' } },
  { value: 'relearning', label: { en: 'Relearning', vi: 'Học lại' } },
  { value: 'difficult', label: { en: 'Difficult', vi: 'Khó nhớ' } },
  { value: 'favorite', label: { en: 'Favorites', vi: 'Yêu thích' } },
]

export const SORTS: { value: 'recent' | 'alpha' | 'due' | 'difficulty'; label: Bi }[] = [
  { value: 'recent', label: { en: 'Recently added', vi: 'Mới thêm' } },
  { value: 'alpha', label: { en: 'A → Z', vi: 'A → Z' } },
  { value: 'due', label: { en: 'Due date', vi: 'Ngày đến hạn' } },
  { value: 'difficulty', label: { en: 'Hardest first', vi: 'Khó nhất trước' } },
]

export const REVIEW_STATE_LABEL: Record<string, Bi> = {
  new: { en: 'New', vi: 'Mới' },
  learning: { en: 'Learning', vi: 'Đang học' },
  review: { en: 'Review', vi: 'Ôn tập' },
  relearning: { en: 'Relearning', vi: 'Học lại' },
}

export const STRENGTH_LABEL: Record<Strength, Bi> = {
  new: { en: 'Not reviewed yet', vi: 'Chưa ôn' },
  weak: { en: 'Fading', vi: 'Sắp quên' },
  fair: { en: 'Getting there', vi: 'Khá nhớ' },
  strong: { en: 'Strong memory', vi: 'Nhớ chắc' },
}

export const RATINGS: { value: 1 | 2 | 3 | 4; label: Bi; tone: string; key: string }[] = [
  { value: 1, label: { en: 'Again', vi: 'Lại' }, tone: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20', key: '1' },
  { value: 2, label: { en: 'Hard', vi: 'Khó' }, tone: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20', key: '2' },
  { value: 3, label: { en: 'Good', vi: 'Tốt' }, tone: 'border-success/40 bg-success/10 text-success hover:bg-success/20', key: '3' },
  { value: 4, label: { en: 'Easy', vi: 'Dễ' }, tone: 'border-info/40 bg-info/10 text-info hover:bg-info/20', key: '4' },
]

export const CEFR_OPTIONS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

/** Per-viewer UI preferences (best-effort; storage may be unavailable). */
export function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`lq.vocab.${key}`) ?? fallback
  } catch {
    return fallback
  }
}
export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`lq.vocab.${key}`, value)
  } catch {
    /* ignore */
  }
}
