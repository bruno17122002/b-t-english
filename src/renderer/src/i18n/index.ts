// Bilingual UI helpers. Strings live next to the component that uses them: `L('Start', 'Bắt đầu')`.
// This keeps modules self-contained (no shared dictionary to edit) while every label exists in both languages.
import { useCallback } from 'react'
import { useLang } from '../lib/store'

export type Bilingual = { en: string; vi: string }

/** Returns a translator picking the English or Vietnamese variant for the current UI language. */
export function useL() {
  const lang = useLang()
  return useCallback((en: string, vi: string) => (lang === 'vi' ? vi : en), [lang])
}

/** Picks a variant from a {en, vi} object. */
export function useTx() {
  const lang = useLang()
  return useCallback((b: Bilingual) => (lang === 'vi' ? b.vi : b.en), [lang])
}

/** Formats numbers and dates for the current language. */
export function useFormat() {
  const lang = useLang()
  const locale = lang === 'vi' ? 'vi-VN' : 'en-GB'
  return {
    number: (n: number, digits = 0) => n.toLocaleString(locale, { maximumFractionDigits: digits }),
    date: (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
      new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(locale, opts),
    time: (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    relative(iso: string) {
      const diff = (Date.now() - new Date(iso).getTime()) / 1000
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
      if (Math.abs(diff) < 60) return rtf.format(-Math.round(diff), 'second')
      if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
      if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
      return rtf.format(-Math.round(diff / 86400), 'day')
    },
  }
}
