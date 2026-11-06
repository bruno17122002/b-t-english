// Learner context for the Telegram tutor and the /today summary. Kernel-only: reads profile, levels,
// mistakes, progress, due cards and today's plan rows from the `lessons` table.
import { localDateKey } from '@core/dates'
import type { ChatMessage } from '../ai/types'
import type { Kernel } from '..'
import type { TelegramButton } from './port'
import { escapeHtml } from './format'

interface LessonRow {
  id: number
  module: string
  title: string
  status: 'todo' | 'done' | 'skipped'
  estimated_minutes: number
}

const MODULE_VI: Record<string, string> = {
  listening: 'Nghe',
  speaking: 'Nói',
  reading: 'Đọc',
  writing: 'Viết',
  grammar: 'Ngữ pháp',
  vocabulary: 'Từ vựng',
  cinema: 'Phim',
  tutor: 'Gia sư',
  assessment: 'Kiểm tra',
}

export const SKILL_VI: Record<string, string> = {
  vocabulary: 'Từ vựng',
  grammar: 'Ngữ pháp',
  reading: 'Đọc',
  listening: 'Nghe',
  writing: 'Viết',
  speaking: 'Nói',
}

const WEEKDAY_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

export function todayLessons(k: Kernel): LessonRow[] {
  return k.db.all<LessonRow>(
    'SELECT id, module, title, status, estimated_minutes FROM lessons WHERE date = ? ORDER BY position, id',
    [localDateKey(k.now())],
  )
}

/** Compact English/Vietnamese context block handed to the tutor prompt. */
export function learnerContext(k: Kernel): string {
  const profile = k.learner.profile()
  const skills = k.learner.skillLevels()
  const mistakes = k.learner.mistakes(6)
  const game = k.progress.gameState()
  const lessons = todayLessons(k)
  const done = lessons.filter((l) => l.status === 'done').length
  const todo = lessons.filter((l) => l.status === 'todo')
  const activity = k.progress.activity(8)
  const lines = [
    `Name: ${profile.displayName || 'learner'}; overall CEFR ${k.learner.overallCefr()}, target ${profile.targetCefr}${profile.targetIelts ? ` (IELTS ${profile.targetIelts})` : ''}; daily goal ${profile.dailyMinutes} min.`,
    `Skill levels: ${skills.map((s) => `${s.skill} ${s.cefr}`).join(', ')}.`,
    mistakes.length
      ? `Recurring mistakes:\n${mistakes.map((m) => `- [${m.category}] ${m.pattern}${m.correction ? ` → ${m.correction}` : ''} (×${m.count})`).join('\n')}`
      : 'Recurring mistakes: none recorded yet.',
    `Flashcards due now: ${k.vocab.dueCount()}.`,
    `Streak: ${game.streak.current} day(s); studied today: ${game.streak.activeToday ? 'yes' : 'not yet'}; minutes today: ${Math.round(k.progress.minutesToday())}; XP today: ${game.todayXp}.`,
    lessons.length
      ? `Today's plan: ${done}/${lessons.length} done.${todo.length ? ` Still to do: ${todo.map((l) => `${l.title} (${l.module})`).join('; ')}.` : ''}`
      : "Today's plan: no plan generated for today.",
    activity.length
      ? `Recent activity: ${activity
          .slice(0, 6)
          .map((a) => `${a.action}${a.title ? ` "${a.title.slice(0, 40)}"` : ''}`)
          .join('; ')}.`
      : 'Recent activity: none yet.',
  ]
  if (profile.interests.length) lines.push(`Interests: ${profile.interests.slice(0, 6).join(', ')}.`)
  return lines.join('\n')
}

/** HTML for /today with quick-action buttons. */
export function todayReply(k: Kernel): { html: string; buttons: TelegramButton[][] } {
  const now = k.now()
  const date = `${WEEKDAY_VI[now.getDay()]}, ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
  const game = k.progress.gameState()
  const profile = k.learner.profile()
  const lessons = todayLessons(k)
  const done = lessons.filter((l) => l.status === 'done').length
  const quests = k.progress.quests().daily
  const due = k.vocab.dueCount()
  const minutes = Math.round(k.progress.minutesToday())

  const out: string[] = [
    `📅 <b>Hôm nay – ${date}</b>`,
    `🔥 Chuỗi: <b>${game.streak.current} ngày</b> ${game.streak.activeToday ? '(hôm nay đã học ✅)' : '(hôm nay chưa học)'}`,
    `⭐ XP hôm nay: <b>${game.todayXp}</b> · ⏱ ${minutes}/${profile.dailyMinutes} phút · Cấp ${game.level}`,
    `🎯 Trình độ: <b>${k.learner.overallCefr()}</b> → mục tiêu ${profile.targetCefr}${profile.targetIelts ? ` (IELTS ${profile.targetIelts})` : ''}`,
    '',
  ]
  if (lessons.length) {
    out.push(`📚 <b>Kế hoạch hôm nay</b> (${done}/${lessons.length})`)
    for (const l of lessons) {
      const mark = l.status === 'done' ? '✅' : l.status === 'skipped' ? '⏭' : '⬜'
      out.push(`${mark} ${escapeHtml(l.title)} <i>(${MODULE_VI[l.module] ?? l.module}, ${l.estimated_minutes}′)</i>`)
    }
  } else {
    out.push('📚 Chưa có kế hoạch cho hôm nay – mở B&amp;T English → Hành trình để tạo lộ trình.')
  }
  if (quests.length) {
    out.push('', '🏆 <b>Nhiệm vụ ngày</b>')
    for (const q of quests) {
      out.push(
        `${q.completedAt ? '✅' : '▫️'} ${escapeHtml(q.titleVi || q.title)} – ${Math.round(q.progress)}/${q.target} (+${q.xpReward} XP)`,
      )
    }
  }
  out.push('', due ? `🃏 Thẻ từ cần ôn: <b>${due}</b> → /review` : '🃏 Không có thẻ từ nào cần ôn. Tuyệt vời!')
  const buttons: TelegramButton[][] = [
    [
      ...(due ? [{ text: `🃏 Ôn ${due} thẻ`, data: 'review:start' }] : []),
      { text: '❓ Quiz', data: 'quiz:new' },
      { text: '📖 Từ mới', data: 'word:new' },
    ],
  ]
  return { html: out.join('\n'), buttons }
}

// ---------- chat memory ----------
/** Number of stored messages per chat (≈ 20 learner/tutor turns). */
export const MEMORY_LIMIT = 40

export class ChatMemory {
  constructor(private readonly k: Kernel) {}

  history(chatId: string, turns = 20): ChatMessage[] {
    const rows = this.k.db.all<{ role: 'user' | 'assistant'; content: string }>(
      'SELECT role, content FROM telegram_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?',
      [chatId, turns * 2],
    )
    const msgs = rows.reverse().map((r) => ({ role: r.role, content: r.content }))
    // Providers expect the conversation to start with the learner.
    while (msgs.length && msgs[0]?.role !== 'user') msgs.shift()
    return msgs
  }

  add(chatId: string, role: 'user' | 'assistant', content: string, kind = 'text'): void {
    this.k.db.transaction(() => {
      this.k.db.run('INSERT INTO telegram_messages(chat_id, role, content, kind, created_at) VALUES (?, ?, ?, ?, ?)', [
        chatId,
        role,
        content.slice(0, 4000),
        kind,
        this.k.now().toISOString(),
      ])
      this.k.db.run(
        `DELETE FROM telegram_messages WHERE chat_id = ? AND id NOT IN
         (SELECT id FROM telegram_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?)`,
        [chatId, chatId, MEMORY_LIMIT],
      )
    })
  }

  clear(chatId: string): void {
    this.k.db.run('DELETE FROM telegram_messages WHERE chat_id = ?', [chatId])
  }

  count(chatId: string): number {
    return Number(this.k.db.value('SELECT COUNT(*) FROM telegram_messages WHERE chat_id = ?', [chatId]) ?? 0)
  }
}
