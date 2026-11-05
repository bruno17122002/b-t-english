// AI prompts of the in-app Telegram bot: tutor replies (text, voice transcript or photo), word of the day,
// quick quizzes and image planning for the free Pollinations renderer. Each prompt has a deterministic mock.
import { z } from 'zod'
import { CefrSchema } from '@shared/content'
import { JSON_ONLY, jsonPrompt } from '../ai/prompt'
import type { ChatMessage } from '../ai/types'

const PLAIN_TELEGRAM =
  'Write for a Telegram chat: plain text only – no Markdown (no **bold**, no # headings, no tables, no code fences) and no HTML. Use line breaks, "-" bullets and a few emoji.'

// ---------- tutor ----------
export type TutorMode = 'text' | 'voice' | 'photo'

export interface TgTutorInput {
  message: string
  /** Earlier turns, oldest first, without `message`. */
  history: ChatMessage[]
  /** Pre-rendered learner context (levels, mistakes, plan, activity). */
  context: string
  mode: TutorMode
  image?: { data: Uint8Array; mimeType: string }
}

const CorrectionSchema = z.object({
  original: z.string().trim().min(1).max(300),
  correction: z.string().trim().min(1).max(300),
  explanationVi: z.string().max(600).default(''),
  category: z.string().max(40).default('grammar'),
  pattern: z.string().max(120).nullable().optional(),
})

const NewWordSchema = z.object({
  word: z.string().trim().min(1).max(60),
  ipa: z.string().max(80).default(''),
  meaningVi: z.string().trim().min(1).max(200),
  example: z.string().max(300).default(''),
})

export const TgTutorSchema = z.object({
  reply: z.string().trim().min(1).max(3500),
  corrections: z.array(CorrectionSchema).max(6).default([]),
  newWords: z.array(NewWordSchema).max(4).default([]),
  pronunciationTips: z.array(z.string().max(300)).max(4).default([]),
  correctedSentence: z.string().max(500).nullable().optional(),
})
export type TgTutorOutput = z.infer<typeof TgTutorSchema>

const MODE_RULES: Record<TutorMode, string> = {
  text: 'The learner typed the message.',
  voice:
    'The message is an automatic transcript of the learner SPEAKING English (ignore punctuation/capitalisation; odd words may be recognition errors). ' +
    'Correct grammar and word choice, put 1–3 pronunciation tips with IPA in pronunciationTips (sounds Vietnamese speakers often get wrong: final consonants, /θ/ /ð/, word stress, linking), ' +
    'and set correctedSentence to a natural corrected version of what they said (English, at most 30 words).',
  photo:
    'The learner sent a photo (attached). Read it carefully. If it shows handwriting or an exercise, quote the key part, correct mistakes and explain; ' +
    'if it is an IELTS Task 1 chart, describe the main trends; otherwise explain the English in it. Corrections refer to English written in the photo or caption.',
}

export const tgTutorPrompt = jsonPrompt<TgTutorInput, TgTutorOutput>({
  id: 'telegram.tutor',
  version: 1,
  skill: 'writing',
  temperature: 0.6,
  maxOutputTokens: 1800,
  schema: TgTutorSchema,
  build: (input, ctx) => ({
    system: [
      'You are the friendly, patient IELTS tutor of the Lingua Quest app, chatting on Telegram with a Vietnamese self-learner whose goal is IELTS 6.5 (CEFR B2).',
      ctx.learnerLine,
      ctx.constraints,
      'Explain in Vietnamese (with diacritics); use English for examples, corrected sentences and vocabulary.',
      'Be concise: 2–5 sentences of explanation with 1–3 concrete examples, longer only when the learner asks for an exercise, a model answer or a list.',
      'When the learner writes English: point out the important mistakes (grammar, vocabulary, phrasing) in corrections, praise what is good, then answer the content.',
      'When asked about a word: meaning, IPA, part of speech, 1–2 examples and common collocations. When grading Writing/Speaking: estimate a band for the four IELTS criteria and give the 2–3 most important fixes.',
      'Recycle the correct forms of the learner’s recurring mistakes when natural. Use the learner context below to suggest the next useful step (due flashcards, unfinished lessons) – briefly.',
      'The bot can also: /review (flashcards), /word (word of the day), /quiz (quick question), /anh <description> (draw a picture). Mention them only when relevant.',
      MODE_RULES[input.mode],
      `Learner context:\n${input.context}`,
      `Fields: reply (${PLAIN_TELEGRAM}); corrections (array of {original, correction, explanationVi, category: grammar|vocabulary|spelling|word_choice|style|pronunciation, pattern: short English rule name}; empty when the learner wrote no English or made no mistake);`,
      'newWords (0–3 useful words from your reply worth saving: {word, ipa, meaningVi, example}); pronunciationTips (array of short strings, may be empty); correctedSentence (string or null).',
      JSON_ONLY,
    ]
      .filter(Boolean)
      .join('\n'),
    messages: [...input.history, { role: 'user', content: input.message }],
    ...(input.image ? { image: input.image } : {}),
  }),
  mock: (input) => {
    const pastMistake = /\byesterday\b/i.test(input.message) && /\b(go|eat|see)\b/i.test(input.message)
    return {
      reply: `${input.mode === 'photo' ? '📷 ' : input.mode === 'voice' ? '🎙 ' : ''}Mình đã đọc: "${input.message.slice(0, 80)}". Bạn làm tốt lắm, tiếp tục luyện nhé! 💪`,
      corrections: pastMistake
        ? [
            {
              original: 'go',
              correction: 'went',
              explanationVi: 'Có "yesterday" nên dùng thì quá khứ đơn.',
              category: 'grammar',
              pattern: 'past simple with past time markers',
            },
          ]
        : [],
      newWords: [
        { word: 'improve', ipa: '/ɪmˈpruːv/', meaningVi: 'cải thiện', example: 'I want to improve my English.' },
      ],
      pronunciationTips: input.mode === 'voice' ? ['improve /ɪmˈpruːv/ – nhấn âm thứ hai, bật rõ âm /v/ cuối.'] : [],
      correctedSentence: input.mode === 'voice' ? input.message.slice(0, 200) : null,
    }
  },
})

// ---------- word of the day ----------
export interface WordOfDayInput {
  date: string
  /** Words the learner already has (do not suggest them). */
  avoid: string[]
}

export const WordOfDaySchema = z.object({
  word: z.string().trim().min(1).max(60),
  ipa: z.string().max(80).default(''),
  pos: z.string().max(40).default(''),
  meaningVi: z.string().trim().min(1).max(200),
  meaningEn: z.string().trim().min(1).max(300),
  examples: z.array(z.string().max(300)).min(1).max(3),
  collocations: z.array(z.string().max(80)).max(5).default([]),
  tipVi: z.string().max(400).default(''),
  cefr: CefrSchema.nullable().default(null),
})
export type WordOfDay = z.infer<typeof WordOfDaySchema>

const MOCK_WORDS: WordOfDay[] = [
  {
    word: 'resilient',
    ipa: '/rɪˈzɪliənt/',
    pos: 'adjective',
    meaningVi: 'kiên cường, mau phục hồi',
    meaningEn: 'able to recover quickly from difficulties',
    examples: ['She is resilient and never gives up.', 'Resilient cities recover quickly after floods.'],
    collocations: ['remarkably resilient', 'resilient economy'],
    tipVi: 'Nhấn âm thứ hai: re-ZIL-ient.',
    cefr: 'B2',
  },
  {
    word: 'commute',
    ipa: '/kəˈmjuːt/',
    pos: 'verb / noun',
    meaningVi: 'đi lại (giữa nhà và nơi làm việc)',
    meaningEn: 'to travel regularly between home and work',
    examples: ['I commute to work by bus.', 'My daily commute takes forty minutes.'],
    collocations: ['daily commute', 'commute to work'],
    tipVi: 'Hay gặp trong IELTS Speaking Part 1 (Work/Study).',
    cefr: 'B1',
  },
  {
    word: 'significant',
    ipa: '/sɪɡˈnɪfɪkənt/',
    pos: 'adjective',
    meaningVi: 'đáng kể, quan trọng',
    meaningEn: 'large or important enough to be noticed',
    examples: ['There was a significant increase in sales.', 'This is a significant change.'],
    collocations: ['significant increase', 'statistically significant'],
    tipVi: 'Rất hữu ích cho Writing Task 1 khi mô tả số liệu.',
    cefr: 'B2',
  },
]

export const wordOfDayPrompt = jsonPrompt<WordOfDayInput, WordOfDay>({
  id: 'telegram.wordOfDay',
  version: 1,
  skill: 'vocabulary',
  temperature: 0.9,
  schema: WordOfDaySchema,
  build: (input, ctx) => ({
    system: [
      'You choose a "word of the day" for a Vietnamese learner preparing for IELTS 6.5.',
      ctx.learnerLine,
      `Pick ONE genuinely useful English word or short phrase slightly above the learner's vocabulary level (${ctx.level}), useful for IELTS Speaking or Writing and, if possible, related to the learner's interests.`,
      'Fields: word, ipa (between slashes), pos, meaningVi (Vietnamese with diacritics), meaningEn (simple English definition),',
      'examples (exactly 2 natural sentences), collocations (2–4), tipVi (one short Vietnamese tip on usage or pronunciation), cefr.',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Date: ${input.date}.${input.avoid.length ? ` Do not choose any of these words: ${input.avoid.slice(0, 80).join(', ')}.` : ''}`,
      },
    ],
  }),
  check: (input, out) =>
    input.avoid.some((w) => w.toLowerCase() === out.word.toLowerCase()) ? 'The learner already knows this word' : null,
  mock: (input) => {
    const fresh = MOCK_WORDS.filter((w) => !input.avoid.some((a) => a.toLowerCase() === w.word))
    const pool = fresh.length ? fresh : MOCK_WORDS
    const day = Number(input.date.replace(/\D/g, '')) || 0
    return pool[day % pool.length] as WordOfDay
  },
})

// ---------- quiz ----------
export const QUIZ_SKILLS = ['grammar', 'vocabulary', 'reading'] as const
export type QuizSkill = (typeof QUIZ_SKILLS)[number]

export interface QuizInput {
  skill: QuizSkill
  /** Recurring mistakes / weak points to target. */
  focus: string[]
  /** Recent quiz questions to avoid repeating. */
  recent: string[]
}

export const QuizSchema = z.object({
  passage: z.string().max(700).nullable().optional(),
  question: z.string().trim().min(5).max(400),
  options: z.array(z.string().trim().min(1).max(120)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanationVi: z.string().trim().min(1).max(700),
  topic: z.string().max(80).default(''),
})
export type Quiz = z.infer<typeof QuizSchema>

export const quizPrompt = jsonPrompt<QuizInput, Quiz>({
  id: 'telegram.quiz',
  version: 1,
  skill: 'grammar',
  temperature: 0.8,
  schema: QuizSchema,
  build: (input, ctx) => ({
    system: [
      'You write ONE quick multiple-choice question for a Vietnamese learner preparing for IELTS 6.5.',
      ctx.learnerLine,
      ctx.constraints,
      input.skill === 'reading'
        ? 'Skill: reading – give a short passage (40–80 words) in passage and ask one comprehension question about it.'
        : input.skill === 'vocabulary'
          ? 'Skill: vocabulary – test meaning, collocation or word form in a sentence with a gap ("___"). passage is null.'
          : 'Skill: grammar – a sentence with a gap ("___") testing one grammar point. passage is null.',
      input.focus.length
        ? `Target these weak points / recurring mistakes of the learner:\n${input.focus.map((f) => `- ${f}`).join('\n')}`
        : 'Target a common problem for Vietnamese learners (tenses, articles, plurals, prepositions, word forms).',
      'Fields: passage (string or null), question, options (exactly 4 distinct short options), answerIndex (0–3, the only correct option),',
      'explanationVi (Vietnamese: why the answer is right and the most tempting wrong option is wrong, 1–3 sentences), topic (short English label of the point tested).',
      'The question must not reveal the answer.',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: input.recent.length
          ? `Avoid repeating these recent questions:\n${input.recent.slice(0, 8).join('\n')}`
          : 'Write the question.',
      },
    ],
  }),
  check: (_input, out) => {
    if (new Set(out.options.map((o) => o.toLowerCase())).size !== out.options.length) return 'Options must be distinct'
    return null
  },
  mock: (input) =>
    input.skill === 'reading'
      ? {
          passage:
            'Mai started learning English last year. At first she studied only grammar, but now she listens to podcasts every morning and her listening has improved a lot.',
          question: 'What helped Mai improve her listening?',
          options: ['Grammar books', 'Podcasts every morning', 'Evening classes', 'Watching films'],
          answerIndex: 1,
          explanationVi: 'Đoạn văn nói "now she listens to podcasts every morning and her listening has improved".',
          topic: 'detail question',
        }
      : {
          passage: null,
          question: 'Yesterday I ___ to the library to borrow two books.',
          options: ['go', 'went', 'have gone', 'am going'],
          answerIndex: 1,
          explanationVi: 'Có "Yesterday" (mốc thời gian quá khứ) nên dùng quá khứ đơn: went.',
          topic: 'past simple',
        },
})

// ---------- image planning (Pollinations) ----------
export interface ImagePlanInput {
  request: string
  /** Last few chat lines, so "vẽ minh họa cho từ vừa rồi" works. */
  recent: string
  image?: { data: Uint8Array; mimeType: string }
}

export const ImagePlanSchema = z.object({
  promptEn: z.string().trim().min(3).max(900),
  captionVi: z.string().trim().min(1).max(900),
})
export type ImagePlan = z.infer<typeof ImagePlanSchema>

export const imagePlanPrompt = jsonPrompt<ImagePlanInput, ImagePlan>({
  id: 'telegram.imagePlan',
  version: 1,
  skill: 'vocabulary',
  temperature: 0.7,
  schema: ImagePlanSchema,
  build: (input) => ({
    system: [
      'A Vietnamese IELTS learner wants a picture. It will be drawn by a service that only understands English and CANNOT write text correctly, so everything to learn goes in the caption, never in the image.',
      'promptEn: English description of at most 60 words. Always ONE simple scene or subject – no grids, cards, panels, diagrams or tables. Several vocabulary items go into one natural scene with clear positions ("from left to right: …"), at most 4 objects.',
      'Name each object concretely with visible features (e.g. "a tall man with glasses (the father)"); avoid vague words like "cute" or "abstract". Style: simple colorful cartoon illustration, clear shapes, realistic proportions, plain white background.',
      'If the learner attached a photo, describe that photo plus the change they want.',
      'captionVi: Vietnamese caption, plain text without Markdown, at most 700 characters: the text that would have been in the picture (vocabulary + IPA + meaning, in the same positions, e.g. "từ trái sang phải"; or grammar notes / figures) plus one sentence on how to study with the picture.',
      'Never put personal information into promptEn.',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `${input.recent ? `Recent chat:\n${input.recent}\n\n` : ''}Learner request: ${input.request}`,
      },
    ],
    ...(input.image ? { image: input.image } : {}),
  }),
  mock: (input) => ({
    promptEn:
      'simple colorful cartoon illustration, from left to right: a red apple, a yellow banana, a green pear on a wooden table, plain white background',
    captionVi: `Từ trái sang phải: apple /ˈæp.əl/ quả táo · banana /bəˈnæn.ə/ quả chuối · pear /peər/ quả lê. (Yêu cầu: ${input.request.slice(0, 80)})`,
  }),
})
