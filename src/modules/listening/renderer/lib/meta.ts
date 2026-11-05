// Small display helpers for the listening module.
import { Megaphone, MessagesSquare, Mic2, type LucideIcon } from 'lucide-react'
import type { ListeningTrack } from '@shared/content'
import type { ListeningMode } from '../../contract'

export const ACCENT_LABEL: Record<ListeningTrack['accent'], { short: string; en: string; vi: string }> = {
  'en-US': { short: 'US', en: 'American', vi: 'Giọng Mỹ' },
  'en-GB': { short: 'UK', en: 'British', vi: 'Giọng Anh' },
  'en-AU': { short: 'AU', en: 'Australian', vi: 'Giọng Úc' },
}

export const KIND_META: Record<ListeningTrack['kind'], { icon: LucideIcon; en: string; vi: string }> = {
  dialogue: { icon: MessagesSquare, en: 'Dialogue', vi: 'Hội thoại' },
  monologue: { icon: Mic2, en: 'Monologue', vi: 'Độc thoại' },
  announcement: { icon: Megaphone, en: 'Announcement', vi: 'Thông báo' },
}

export const MODE_LABEL: Record<ListeningMode, { en: string; vi: string }> = {
  gist: { en: 'Gist', vi: 'Ý chính' },
  dictation: { en: 'Dictation', vi: 'Chép chính tả' },
  gap: { en: 'Gap fill', vi: 'Điền từ' },
  shadow: { en: 'Shadow', vi: 'Nói đuổi' },
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
