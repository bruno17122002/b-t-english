// AI prompts for Grammar Kingdom: extra drill exercises for a topic and "explain my mistake".
import { z } from 'zod'
import type { GrammarTopic } from '@shared/content'
import { JSON_ONLY, jsonPrompt, leaksAnswer } from '../../../main/kernel/ai/prompt'
import { acceptedAnswers, fillGap } from '../contract'

export const GeneratedExerciseSchema = z
  .object({
    type: z.enum(['mcq', 'gap']),
    prompt: z.string().min(3).max(300),
    options: z.array(z.string().min(1).max(160)).max(4).default([]),
    answer: z.string().min(1).max(120),
    explanation: z.string().min(1).max(600),
  })
  .superRefine((e, ctx) => {
    if (e.type === 'mcq') {
      if (e.options.length < 3) ctx.addIssue({ code: 'custom', message: 'mcq needs 3 or 4 options' })
      if (!e.options.includes(e.answer))
        ctx.addIssue({ code: 'custom', message: 'mcq answer must be exactly one of the options' })
      if (new Set(e.options.map((o) => o.trim().toLowerCase())).size !== e.options.length)
        ctx.addIssue({ code: 'custom', message: 'mcq options must be different' })
    } else if (!e.prompt.includes('___')) {
      ctx.addIssue({ code: 'custom', message: 'gap prompt must contain ___ where the answer goes' })
    }
  })
export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>

export const GeneratedExercisesSchema = z.object({ exercises: z.array(GeneratedExerciseSchema).length(6) })
export type GeneratedExercisesOutput = z.infer<typeof GeneratedExercisesSchema>

export interface ExercisesInput {
  topic: GrammarTopic
}

/** Returns a problem description when an exercise gives its answer away, else null. */
export function exerciseLeak(e: Pick<GeneratedExercise, 'type' | 'prompt' | 'answer'>): string | null {
  // Only the prompt is checked: mcq options are supposed to contain the answer. A gap hint such as "(live)"
  // is fine for "lives" (word-bounded match), but "(go)" for the answer "go" is a leak.
  for (const a of acceptedAnswers(e.answer))
    if (leaksAnswer(e.prompt, a)) return `the prompt "${e.prompt}" already contains the answer "${a}"`
  return null
}

export const exercisesPrompt = jsonPrompt<ExercisesInput, GeneratedExercisesOutput>({
  id: 'grammar.exercises',
  version: 1,
  skill: 'grammar',
  temperature: 0.7,
  schema: GeneratedExercisesSchema,
  check: (_input, out) => {
    for (const [i, e] of out.exercises.entries()) {
      const leak = exerciseLeak(e)
      if (leak) return `exercises[${i}]: ${leak}. Rewrite it so the answer is not visible in the prompt.`
    }
    const prompts = new Set(out.exercises.map((e) => e.prompt.trim().toLowerCase()))
    if (prompts.size !== out.exercises.length) return 'Two exercises have the same prompt – make all six different.'
    return null
  },
  build: (input, ctx) => {
    const t = input.topic
    const mistakes = ctx.learner.mistakes
      .filter((m) => m.category === 'grammar')
      .slice(0, 3)
      .map((m) => `${m.pattern}${m.correction ? ` (e.g. ${m.correction})` : ''}`)
    return {
      system: [
        'You write grammar practice exercises for Vietnamese learners of English.',
        ctx.learnerLine,
        ctx.constraints,
        `Grammar topic: "${t.title}" (${t.cefr}). ${t.summaryEn}`,
        `Key patterns: ${t.patterns.join(' | ')}`,
        mistakes.length ? `The learner keeps making these mistakes – target them: ${mistakes.join('; ')}.` : '',
        'Write exactly 6 NEW exercises (not copies of the examples) at the learner level, mixing types: 3 "mcq" and 3 "gap".',
        'Output JSON shape: {"exercises":[{"type":"mcq"|"gap","prompt":string,"options":string[],"answer":string,"explanation":string}]}',
        'Rules:',
        '- "gap": prompt is one natural sentence with "___" where the missing word(s) go; a base-verb hint in brackets is allowed, e.g. "She ___ (go) to work by bus." options must be []. answer is the exact missing words; give alternatives separated by "/" only if several answers are equally correct.',
        '- "mcq": prompt is a sentence with "___" or a question like "Which sentence is correct?"; options are 3–4 different strings and answer is copied exactly from options.',
        '- NEVER put the answer inside the prompt.',
        '- explanation: 1–2 short sentences in Vietnamese explaining the rule (English examples allowed).',
        '- Everyday topics, no names of real celebrities or brands.',
        JSON_ONLY,
      ]
        .filter(Boolean)
        .join('\n'),
      messages: [{ role: 'user', content: `Create 6 exercises for "${t.title}".` }],
    }
  },
  mock: (input) => {
    const id = input.topic.id
    return {
      exercises: [
        {
          type: 'gap',
          prompt: 'My sister ___ (live) in Da Nang.',
          options: [],
          answer: 'lives',
          explanation: `Bài tập luyện thêm (${id}): chủ ngữ số ít ở thì hiện tại đơn thêm -s.`,
        },
        {
          type: 'gap',
          prompt: 'We ___ (not / like) cold weather.',
          options: [],
          answer: "don't like",
          explanation: 'Phủ định với "we" dùng "do not / don\'t" + động từ nguyên mẫu.',
        },
        {
          type: 'gap',
          prompt: 'Yesterday I ___ (visit) my grandmother.',
          options: [],
          answer: 'visited',
          explanation: '"Yesterday" là dấu hiệu của quá khứ đơn: động từ thêm -ed.',
        },
        {
          type: 'mcq',
          prompt: 'They ___ football every Sunday.',
          options: ['play', 'plays', 'playing'],
          answer: 'play',
          explanation: '"They" là số nhiều nên động từ giữ nguyên mẫu.',
        },
        {
          type: 'mcq',
          prompt: 'Which sentence is correct?',
          options: ['He is a doctor.', 'He a doctor.', 'He are a doctor.'],
          answer: 'He is a doctor.',
          explanation: 'Câu tiếng Anh cần động từ "be"; "he" đi với "is".',
        },
        {
          type: 'mcq',
          prompt: 'I have lived here ___ 2019.',
          options: ['for', 'since', 'in'],
          answer: 'since',
          explanation: '"Since" + mốc thời gian; "for" + khoảng thời gian.',
        },
      ],
    }
  },
})

// ---------- explain my mistake ----------
export const ExplanationSchema = z.object({
  explanationVi: z.string().min(1).max(1200),
  explanationEn: z.string().min(1).max(800),
  rule: z.string().min(1).max(300),
  correctedSentence: z.string().min(1).max(400),
  tip: z.string().min(1).max(400),
})
export type ExplanationOutput = z.infer<typeof ExplanationSchema>

export interface ExplainInput {
  topic: GrammarTopic
  exercise: { type: 'mcq' | 'gap'; prompt: string; options: string[]; answer: string; explanation: string }
  given: string
}

export const explainPrompt = jsonPrompt<ExplainInput, ExplanationOutput>({
  id: 'grammar.explain',
  version: 1,
  skill: 'grammar',
  temperature: 0.3,
  schema: ExplanationSchema,
  build: (input, ctx) => ({
    system: [
      'You are a patient English grammar teacher for Vietnamese learners.',
      ctx.learnerLine,
      ctx.languageInstruction,
      `Topic: "${input.topic.title}" (${input.topic.cefr}).`,
      "Explain why the learner's answer is wrong and why the correct answer is right. Mention the typical Vietnamese-speaker reason for the error when relevant (e.g. no verb endings or articles in Vietnamese).",
      'Fields: explanationVi (2–4 sentences in Vietnamese), explanationEn (1–2 simple English sentences), rule (the rule as a short pattern, e.g. "he/she/it + V-s"),',
      'correctedSentence (the full correct sentence), tip (one memorable Vietnamese tip to avoid the mistake next time).',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Exercise (${input.exercise.type}): ${input.exercise.prompt}`,
          input.exercise.options.length ? `Options: ${input.exercise.options.join(' | ')}` : '',
          `Correct answer: ${input.exercise.answer}`,
          `Learner answered: ${input.given || '(blank)'}`,
          input.exercise.explanation ? `Short key: ${input.exercise.explanation}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  }),
  mock: (input) => {
    const corrected =
      input.exercise.type === 'gap' ? fillGap(input.exercise.prompt, input.exercise.answer) : input.exercise.answer
    return {
      explanationVi: `Bạn trả lời "${input.given || '(để trống)'}", nhưng đáp án đúng là "${input.exercise.answer}". ${input.exercise.explanation || 'Hãy xem lại quy tắc của chủ điểm này.'}`,
      explanationEn: `The correct answer is "${input.exercise.answer}" because of the rule for ${input.topic.title}.`,
      rule: input.topic.patterns[0] ?? input.topic.title,
      correctedSentence: corrected,
      tip: 'Đọc to cả câu sau khi điền để nghe xem đã tự nhiên chưa.',
    }
  },
})
