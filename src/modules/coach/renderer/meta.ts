// Bilingual labels used by the coach pages.
import type { Skill } from '@shared/types'
import type { CoachPeriod, ScheduleKind } from '../types'

type B = { en: string; vi: string }

export const PERIOD_LABELS: Record<CoachPeriod, B> = {
  day: { en: 'Day', vi: 'Ngày' },
  week: { en: 'Week', vi: 'Tuần' },
  month: { en: 'Month', vi: 'Tháng' },
}

export const SCHEDULE_META: Record<ScheduleKind, { title: B; body: B }> = {
  morningBrief: {
    title: { en: 'Morning brief', vi: 'Bản tin buổi sáng' },
    body: {
      en: 'AI-written plan for the day and the best time to study.',
      vi: 'AI viết kế hoạch trong ngày và giờ học phù hợp.',
    },
  },
  eveningReminder: {
    title: { en: 'Evening reminder', vi: 'Nhắc học buổi tối' },
    body: {
      en: 'Only if you have not studied today – tailored to your habits.',
      vi: 'Chỉ gửi khi hôm nay bạn chưa học – nội dung theo thói quen của bạn.',
    },
  },
  dailyReport: {
    title: { en: 'Daily report', vi: 'Báo cáo ngày' },
    body: {
      en: 'Today’s habits with an AI comment and tomorrow’s plan.',
      vi: 'Thói quen hôm nay, nhận xét của AI và kế hoạch ngày mai.',
    },
  },
  weeklyReport: {
    title: { en: 'Weekly report', vi: 'Báo cáo tuần' },
    body: {
      en: 'AI analysis of the week and a plan you can apply.',
      vi: 'AI phân tích cả tuần và đề xuất kế hoạch có thể áp dụng.',
    },
  },
  monthlyReport: {
    title: { en: 'Monthly report', vi: 'Báo cáo tháng' },
    body: { en: 'The previous month at a glance, with an IELTS outlook.', vi: 'Tổng kết tháng trước và dự báo IELTS.' },
  },
}

export const SKILL_LABELS: Record<Skill, B> = {
  vocabulary: { en: 'Vocabulary', vi: 'Từ vựng' },
  grammar: { en: 'Grammar', vi: 'Ngữ pháp' },
  reading: { en: 'Reading', vi: 'Đọc' },
  listening: { en: 'Listening', vi: 'Nghe' },
  writing: { en: 'Writing', vi: 'Viết' },
  speaking: { en: 'Speaking', vi: 'Nói' },
}

export const MODULE_LABELS: Record<string, B> = {
  dashboard: { en: 'Dashboard', vi: 'Tổng quan' },
  journey: { en: 'Journey', vi: 'Hành trình' },
  listening: { en: 'Listening', vi: 'Nghe' },
  speaking: { en: 'Speaking', vi: 'Nói' },
  reading: { en: 'Reading', vi: 'Đọc' },
  writing: { en: 'Writing', vi: 'Viết' },
  grammar: { en: 'Grammar', vi: 'Ngữ pháp' },
  vocabulary: { en: 'Vocabulary', vi: 'Từ vựng' },
  cinema: { en: 'Cinema', vi: 'Rạp phim' },
  tutor: { en: 'AI tutor', vi: 'Gia sư AI' },
  game: { en: 'Adventure & stats', vi: 'Phiêu lưu & thống kê' },
  coach: { en: 'AI Coach', vi: 'Huấn luyện AI' },
  settings: { en: 'Settings', vi: 'Cài đặt' },
  library: { en: 'Library', vi: 'Thư viện' },
  other: { en: 'Other', vi: 'Khác' },
}

export const moduleLabel = (m: string): B => MODULE_LABELS[m] ?? { en: m, vi: m }

export const WEEKDAYS_MON_FIRST: B[] = [
  { en: 'Mon', vi: 'T2' },
  { en: 'Tue', vi: 'T3' },
  { en: 'Wed', vi: 'T4' },
  { en: 'Thu', vi: 'T5' },
  { en: 'Fri', vi: 'T6' },
  { en: 'Sat', vi: 'T7' },
  { en: 'Sun', vi: 'CN' },
]

/** Sunday-first names for the weekly-report weekday picker (Date.getDay()). */
export const WEEKDAYS_SUN_FIRST: B[] = [
  { en: 'Sunday', vi: 'Chủ nhật' },
  { en: 'Monday', vi: 'Thứ Hai' },
  { en: 'Tuesday', vi: 'Thứ Ba' },
  { en: 'Wednesday', vi: 'Thứ Tư' },
  { en: 'Thursday', vi: 'Thứ Năm' },
  { en: 'Friday', vi: 'Thứ Sáu' },
  { en: 'Saturday', vi: 'Thứ Bảy' },
]

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
