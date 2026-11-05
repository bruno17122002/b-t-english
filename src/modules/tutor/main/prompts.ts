// AI prompts of the tutor module: one structured reply per learner message (reply + corrections + new
// words, an idea shared by many tutor apps, written from scratch here) and a rolling summary for long chats.
import { z } from 'zod'
import type { TutorStyle } from '@shared/types'
import { TUTOR_STYLE_RULES } from '../../../main/kernel/ai/cefrConstraints'
import { JSON_ONLY, jsonPrompt, textPrompt } from '../../../main/kernel/ai/prompt'
import type { ChatMessage } from '../../../main/kernel/ai/types'
import { CORRECTION_CATEGORIES, type TutorCorrection } from '../contract'

export interface TutorReplyInput {
  mode: TutorStyle
  message: string
  /** Last turns of the conversation, oldest first (without `message`). */
  history: ChatMessage[]
  /** Rolling summary of older turns ('' for short chats). */
  summary: string
  viaVoice?: boolean
}

const CorrectionSchema = z.object({
  original: z.string().trim().min(1).max(300),
  correction: z.string().trim().min(1).max(300),
  explanationVi: z.string().max(600).default(''),
  category: z.enum(CORRECTION_CATEGORIES).catch('grammar'),
  /** Short English rule name used to group recurring mistakes. */
  pattern: z.string().max(120).nullable().optional(),
})

const NewWordSchema = z.object({
  word: z.string().trim().min(1).max(80),
  meaningVi: z.string().trim().min(1).max(300),
  example: z.string().max(400).default(''),
})

export const TutorReplySchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  corrections: z.array(CorrectionSchema).max(8).default([]),
  newWords: z.array(NewWordSchema).max(6).default([]),
  followUpQuestion: z.string().max(400).nullable().optional(),
})
export type TutorReplyOutput = z.infer<typeof TutorReplySchema>

const MODE_FOCUS: Record<TutorStyle, string> = {
  friendly: 'Correct only the mistakes that matter most; keep the chat flowing.',
  strict: 'List every meaningful mistake in corrections and ask the learner to rewrite the sentence correctly.',
  grammar: 'In the reply, add a mini-rule (one line) and one example for the main grammar point of the learner message.',
  pronunciation:
    'In the reply, pick 1–2 words from the conversation that Vietnamese speakers often mispronounce and give IPA plus a tip. Use category "pronunciation" only for clear spelling-based evidence.',
  professional: 'Keep a professional, polite register; suggest more formal alternatives as "style" corrections.',
  ielts: 'Ask IELTS Speaking-style questions (Part 1–3). When useful, mention which band descriptor an improvement helps (Fluency, Lexical Resource, Grammar, Pronunciation).',
  casual: 'Sound like a relaxed native friend; teach natural everyday expressions; correct gently.',
}

export const tutorReplyPrompt = jsonPrompt<TutorReplyInput, TutorReplyOutput>({
  id: 'tutor.reply',
  version: 1,
  skill: 'writing',
  temperature: 0.6,
  maxOutputTokens: 1400,
  schema: TutorReplySchema,
  build: (input, ctx) => {
    const mistakes = ctx.learner.mistakes
      .slice(0, 5)
      .map((m) => `- [${m.category}] ${m.pattern}${m.correction ? ` → ${m.correction}` : ''} (seen ${m.count}×)`)
    return {
      system: [
        "You are the AI English tutor inside Lingua Quest, chatting with a Vietnamese learner who is working towards IELTS 6.5 (CEFR B2).",
        `Tutor mode: ${TUTOR_STYLE_RULES[input.mode]} ${MODE_FOCUS[input.mode]}`,
        ctx.learnerLine,
        ctx.constraints,
        ctx.languageInstruction,
        mistakes.length
          ? `Recurring mistakes of this learner (notice them again and recycle the correct form in your reply):\n${mistakes.join('\n')}`
          : '',
        input.summary ? `Summary of the earlier part of this conversation:\n${input.summary}` : '',
        input.viaVoice
          ? 'The latest message was spoken and transcribed automatically: ignore punctuation and capitalisation, and treat odd words as possible recognition errors.'
          : '',
        'If the learner writes in Vietnamese, answer in simple English and show how to say their message in English.',
        'Stay on friendly conversation and language learning. Never ask for personal data such as addresses or phone numbers.',
        'Return a JSON object with these fields:',
        '- reply: your answer to the latest learner message, in English within the level limits, 1–4 short paragraphs. You may use **bold**, *italic* and lines starting with "- " for lists. No headings, links, tables or HTML.',
        `- corrections: mistakes in the LATEST learner message only (never earlier ones). Each item: original (the wrong words copied exactly from the learner message), correction (the corrected words), explanationVi (one or two short sentences in Vietnamese with diacritics), category (one of ${CORRECTION_CATEGORIES.join(', ')}), pattern (a short English rule name such as "past simple of irregular verbs", reused for the same kind of mistake). Use [] when the message is correct.`,
        `- newWords: 0–3 useful words or phrases from your reply that are probably new for a ${ctx.level} learner. Each: word, meaningVi (Vietnamese), example (a short sentence).`,
        '- followUpQuestion: one short question that keeps the conversation going, or "".',
        JSON_ONLY,
      ]
        .filter(Boolean)
        .join('\n'),
      messages: [...input.history, { role: 'user', content: input.message }],
    }
  },
  mock: (input) => {
    const corrections = mockCorrections(input.message)
    return {
      reply: `Thanks for your message! (${input.mode} tutor) **Good effort.** I read ${input.history.length} earlier messages.\n- Keep sentences short.\n- Try one new word today.`,
      corrections,
      newWords: [{ word: 'routine', meaningVi: 'thói quen hằng ngày', example: 'My morning routine is simple.' }],
      followUpQuestion: 'What do you usually do after that?',
    }
  },
})

/** Deterministic corrections used by the offline mock (and therefore by E2E tests). */
export function mockCorrections(message: string): TutorReplyOutput['corrections'] {
  const rules: (TutorCorrection & { re: RegExp; pattern: string })[] = [
    { re: /\bgoed\b/i, original: 'goed', correction: 'went', category: 'grammar', explanationVi: '"go" là động từ bất quy tắc: quá khứ là "went".', pattern: 'past simple of irregular verbs' },
    { re: /\bhe go\b/i, original: 'he go', correction: 'he goes', category: 'grammar', explanationVi: 'Ngôi thứ ba số ít ở hiện tại đơn cần thêm "-s/-es".', pattern: 'third person -s' },
    { re: /\bpeoples\b/i, original: 'peoples', correction: 'people', category: 'vocabulary', explanationVi: '"people" đã là số nhiều.', pattern: 'irregular plurals' },
    { re: /(^|\s)i(\s|$)/, original: 'i', correction: 'I', category: 'spelling', explanationVi: 'Đại từ "I" luôn viết hoa.', pattern: 'capital I' },
  ]
  return rules
    .filter((r) => r.re.test(message))
    .map(({ original, correction, category, explanationVi, pattern }) => ({ original, correction, category, explanationVi, pattern }))
}

export interface TutorSummaryInput {
  previous: string
  lines: string[]
}

export const tutorSummaryPrompt = textPrompt<TutorSummaryInput>({
  id: 'tutor.summary',
  version: 1,
  skill: 'writing',
  temperature: 0.2,
  maxOutputTokens: 300,
  build: (input) => ({
    system: [
      'You keep a short running summary of a chat between an English tutor and a Vietnamese learner.',
      'Merge the previous summary with the new lines into at most 80 words of plain English.',
      'Keep: topics discussed, facts the learner shared about themselves, tasks or promises the tutor made, recurring mistakes.',
      'Drop greetings and small talk. Output the summary text only.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Previous summary:\n${input.previous || '(none)'}\n\nNew lines:\n${input.lines.join('\n')}`,
      },
    ],
  }),
  mock: (input) => {
    const first = input.lines.find((l) => l.startsWith('Learner:')) ?? input.lines[0] ?? ''
    return [input.previous, `Earlier the learner and tutor exchanged ${input.lines.length} messages. ${first.slice(0, 120)}`]
      .filter(Boolean)
      .join(' ')
      .slice(0, 600)
  },
})
