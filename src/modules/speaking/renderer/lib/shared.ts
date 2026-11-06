// Shared renderer helpers for the speaking module: kind metadata, AI readiness and recording processing.
import { BookOpenCheck, Ear, Globe2, MessagesSquare, Repeat, Timer, Trophy, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { SpeakingPrompt } from '@shared/content'
import { ApiError, toApiError, useApi } from '@/lib/api'
import { transcribe, type Recording } from '@/lib/audio'
import type { RecordingAnalysis } from '../../contract'

export const KIND_META: Record<SpeakingPrompt['kind'] | 'scenario', { icon: LucideIcon; en: string; vi: string }> = {
  shadowing: { icon: Ear, en: 'Shadowing', vi: 'Nói đuổi' },
  repeat: { icon: Repeat, en: 'Listen & repeat', vi: 'Nghe & nhắc lại' },
  roleplay: { icon: MessagesSquare, en: 'Role-play', vi: 'Nhập vai' },
  'real-world': { icon: Globe2, en: 'Real world', vi: 'Tình huống thực tế' },
  challenge: { icon: Timer, en: 'Challenge', vi: 'Thử thách' },
  ielts: { icon: Trophy, en: 'IELTS', vi: 'IELTS' },
  scenario: { icon: BookOpenCheck, en: 'Scripted scenario', vi: 'Kịch bản hội thoại' },
}

/** True when an AI provider (and therefore speech-to-text and feedback) is configured. */
export function useAiReady(): { ready: boolean; loading: boolean } {
  const cfg = useApi('ai:config', undefined, [])
  return useMemo(
    () => ({ ready: cfg.data ? cfg.data.activeProvider !== null : false, loading: cfg.loading }),
    [cfg.data, cfg.loading],
  )
}

export function noKeyError(message: string): ApiError {
  return new ApiError({ code: 'ai_no_key', message, hint: 'ai-settings' })
}

export const analysisOf = (rec: Recording): RecordingAnalysis => ({
  durationSec: rec.analysis.durationSec,
  speakingSec: rec.analysis.speakingSec,
  pauseCount: rec.analysis.pauseCount,
  longestPauseSec: rec.analysis.longestPauseSec,
})

/** Sums several recordings, capped at the contract limits so a very long session can still be saved. */
export function sumAnalyses(list: RecordingAnalysis[]): RecordingAnalysis {
  const r1 = (v: number) => Math.min(3600, Math.round(v * 10) / 10)
  return {
    durationSec: r1(list.reduce((s, a) => s + a.durationSec, 0)),
    speakingSec: r1(list.reduce((s, a) => s + a.speakingSec, 0)),
    pauseCount: Math.min(
      5000,
      list.reduce((s, a) => s + a.pauseCount, 0),
    ),
    longestPauseSec: r1(list.reduce((m, a) => Math.max(m, a.longestPauseSec), 0)),
  }
}

/** Transcribes a recording when AI is available. Never throws: returns the error for display instead. */
export async function transcribeSafe(
  rec: Recording,
  hint: string | undefined,
  aiReady: boolean,
): Promise<{ text: string | null; error: ApiError | null }> {
  if (!aiReady) return { text: null, error: null }
  try {
    const res = await transcribe(rec, hint)
    return { text: res.text.trim() || null, error: null }
  } catch (err) {
    return { text: null, error: toApiError(err) }
  }
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
