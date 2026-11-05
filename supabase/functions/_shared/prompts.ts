// AI prompts of the server bot and the tutor function, ported from src/main/kernel/telegram/prompts.ts with the same
// wording and output fields. Validation is hand-written (no zod in the Edge bundle). Voice messages are sent to
// Gemini as inline audio: one call returns the transcript and the feedback.
import {
  generateJson,
  InvalidOutput,
  isObj,
  objList,
  str,
  strList,
  type AiModel,
  type ChatMessage,
  type Media,
} from './gemini.ts'
import type { Cefr } from './learner.ts'

const JSON_ONLY =
  'Respond with a single valid JSON object only – no markdown fences, no commentary. Use exactly the fields described.'
const PLAIN_TELEGRAM =
  'Write for a Telegram chat: plain text only – no Markdown (no **bold**, no # headings, no tables, no code fences) and no HTML. Use line breaks, "-" bullets and a few emoji.'

// ---------- tutor ----------
export type TutorMode = 'text' | 'voice' | 'photo'

export interface Correction {
  original: string
  correction: string
  explanationVi: string
  category: string
  pattern: string | null
}

export interface NewWord {
  word: string
  ipa: string
  meaningVi: string
  example: string
}

export interface TutorOutput {
  reply: string
  corrections: Correction[]
  newWords: NewWord[]
  pronunciationTips: string[]
  correctedSentence: string | null
  /** Voice mode: what the learner said. */
  transcript: string | null
}

const MODE_RULES: Record<TutorMode, string> = {
  text: 'The learner typed the message.',
  voice:
    'The learner sent a VOICE MESSAGE (attached audio) speaking English. First transcribe exactly what they said into "transcript" (English, as spoken). ' +
    'Correct grammar and word choice, put 1–3 pronunciation tips with IPA in pronunciationTips (sounds Vietnamese speakers often get wrong: final consonants, /θ/ /ð/, word stress, linking), ' +
    'and set correctedSentence to a natural corrected version of what they said (English, at most 30 words). If the audio is silent or unclear, set transcript to "" and say so kindly in reply.',
  photo:
    'The learner sent a photo (attached). Read it carefully. If it shows handwriting or an exercise, quote the key part, correct mistakes and explain; ' +
    'if it is an IELTS Task 1 chart, describe the main trends; otherwise explain the English in it. Corrections refer to English written in the photo or caption.',
}

export interface TutorInput {
  message: string
  history: ChatMessage[]
  context: string
  learnerLine: string
  mode: TutorMode
  image?: Media
  audio?: Media
  /** 'telegram' (bot) or 'app' (PWA tutor function). */
  surface?: 'telegram' | 'app'
}

export function validateTutor(raw: unknown, mode: TutorMode): TutorOutput {
  if (!isObj(raw)) throw new InvalidOutput('Expected a JSON object.')
  const corrections = objList(raw.corrections, 6)
    .map((c) => ({
      original: str(c.original, 300),
      correction: str(c.correction, 300),
      explanationVi: str(c.explanationVi, 600),
      category: str(c.category, 40, { fallback: 'grammar' }),
      pattern: str(c.pattern, 120) || null,
    }))
    .filter((c) => c.original && c.correction)
  const newWords = objList(raw.newWords, 4)
    .map((w) => ({
      word: str(w.word, 60),
      ipa: str(w.ipa, 80),
      meaningVi: str(w.meaningVi, 200),
      example: str(w.example, 300),
    }))
    .filter((w) => w.word && w.meaningVi)
  return {
    reply: str(raw.reply, 3500, { required: 'reply' }),
    corrections,
    newWords,
    pronunciationTips: strList(raw.pronunciationTips, 4, 300),
    correctedSentence: str(raw.correctedSentence, 500) || null,
    transcript: mode === 'voice' ? str(raw.transcript, 2000) : null,
  }
}

export function tutorSystem(input: TutorInput): string {
  const surface =
    input.surface === 'app'
      ? 'You are chatting inside the Lingua Quest app on the learner’s phone.'
      : 'You are chatting on Telegram. The bot can also: /review (flashcards), /word (word of the day), /quiz (quick question), /report, /plan. Mention them only when relevant.'
  return [
    'You are the friendly, patient IELTS tutor of the Lingua Quest app, helping a Vietnamese self-learner whose goal is IELTS 6.5 (CEFR B2).',
    surface,
    input.learnerLine,
    'Explain in Vietnamese (with diacritics); use English for examples, corrected sentences and vocabulary.',
    'Be concise: 2–5 sentences of explanation with 1–3 concrete examples, longer only when the learner asks for an exercise, a model answer or a list.',
    'When the learner writes English: point out the important mistakes (grammar, vocabulary, phrasing) in corrections, praise what is good, then answer the content.',
    'When asked about a word: meaning, IPA, part of speech, 1–2 examples and common collocations. When grading Writing/Speaking: estimate a band for the four IELTS criteria and give the 2–3 most important fixes.',
    'Recycle the correct forms of the learner’s recurring mistakes when natural. Use the learner context below to suggest the next useful step (due flashcards, unfinished lessons) – briefly.',
    MODE_RULES[input.mode],
    `Learner context:\n${input.context}`,
    `Fields: reply (${PLAIN_TELEGRAM}); corrections (array of {original, correction, explanationVi, category: grammar|vocabulary|spelling|word_choice|style|pronunciation, pattern: short English rule name}; empty when the learner wrote no English or made no mistake);`,
    `newWords (0–3 useful words from your reply worth saving: {word, ipa, meaningVi, example}); pronunciationTips (array of short strings, may be empty); correctedSentence (string or null)${input.mode === 'voice' ? '; transcript (string)' : ''}.`,
    JSON_ONLY,
  ].join('\n')
}

export function runTutor(ai: AiModel, input: TutorInput): Promise<TutorOutput> {
  return generateJson(
    ai,
    {
      temperature: 0.6,
      maxOutputTokens: 1800,
      system: tutorSystem(input),
      messages: [...input.history, { role: 'user', content: input.message.slice(0, 3000) }],
      ...(input.image ? { image: input.image } : {}),
      ...(input.audio ? { audio: input.audio } : {}),
    },
    (raw) => validateTutor(raw, input.mode),
  )
}

// ---------- word of the day ----------
export interface WordOfDay {
  word: string
  ipa: string
  pos: string
  meaningVi: string
  meaningEn: string
  examples: string[]
  collocations: string[]
  tipVi: string
  cefr: Cefr | null
}

const CEFRS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

export function validateWord(raw: unknown, avoid: string[]): WordOfDay {
  if (!isObj(raw)) throw new InvalidOutput('Expected a JSON object.')
  const word = str(raw.word, 60, { required: 'word' })
  if (avoid.some((w) => w.toLowerCase() === word.toLowerCase()))
    throw new InvalidOutput('The learner already knows this word.')
  const examples = strList(raw.examples, 3, 300)
  if (!examples.length) throw new InvalidOutput('examples must contain 2 sentences.')
  return {
    word,
    ipa: str(raw.ipa, 80),
    pos: str(raw.pos, 40),
    meaningVi: str(raw.meaningVi, 200, { required: 'meaningVi' }),
    meaningEn: str(raw.meaningEn, 300, { required: 'meaningEn' }),
    examples,
    collocations: strList(raw.collocations, 5, 80),
    tipVi: str(raw.tipVi, 400),
    cefr: CEFRS.includes(String(raw.cefr)) ? (raw.cefr as Cefr) : null,
  }
}

/** Offline words (no AI or quota exhausted), same as the in-app mock list. */
export const OFFLINE_WORDS: WordOfDay[] = [
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
  {
    word: 'sustainable',
    ipa: '/səˈsteɪnəbl/',
    pos: 'adjective',
    meaningVi: 'bền vững',
    meaningEn: 'able to continue for a long time without causing damage',
    examples: ['We need more sustainable transport.', 'Is this growth sustainable?'],
    collocations: ['sustainable development', 'environmentally sustainable'],
    tipVi: 'Chủ đề Environment trong IELTS Writing Task 2 rất hay dùng.',
    cefr: 'B2',
  },
]

export function wordOfDay(
  ai: AiModel,
  date: string,
  avoid: string[],
  learnerLine: string,
  level: Cefr,
): Promise<WordOfDay> {
  return generateJson(
    ai,
    {
      temperature: 0.9,
      maxOutputTokens: 800,
      system: [
        'You choose a "word of the day" for a Vietnamese learner preparing for IELTS 6.5.',
        learnerLine,
        `Pick ONE genuinely useful English word or short phrase slightly above the learner's vocabulary level (${level}), useful for IELTS Speaking or Writing and, if possible, related to the learner's interests.`,
        'Fields: word, ipa (between slashes), pos, meaningVi (Vietnamese with diacritics), meaningEn (simple English definition),',
        'examples (exactly 2 natural sentences), collocations (2–4), tipVi (one short Vietnamese tip on usage or pronunciation), cefr.',
        JSON_ONLY,
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: `Date: ${date}.${avoid.length ? ` Do not choose any of these words: ${avoid.slice(0, 80).join(', ')}.` : ''}`,
        },
      ],
    },
    (raw) => validateWord(raw, avoid),
  )
}

// ---------- quiz ----------
export const QUIZ_SKILLS = ['grammar', 'vocabulary', 'reading'] as const
export type QuizSkill = (typeof QUIZ_SKILLS)[number]

export interface Quiz {
  passage: string | null
  question: string
  options: string[]
  answerIndex: number
  explanationVi: string
  topic: string
}

export function validateQuiz(raw: unknown): Quiz {
  if (!isObj(raw)) throw new InvalidOutput('Expected a JSON object.')
  const options = strList(raw.options, 4, 120)
  if (options.length !== 4) throw new InvalidOutput('options must contain exactly 4 strings.')
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) throw new InvalidOutput('Options must be distinct.')
  const answerIndex = Number(raw.answerIndex)
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3)
    throw new InvalidOutput('answerIndex must be 0–3.')
  const question = str(raw.question, 400, { required: 'question' })
  if (question.length < 5) throw new InvalidOutput('question is too short.')
  return {
    passage: str(raw.passage, 700) || null,
    question,
    options,
    answerIndex,
    explanationVi: str(raw.explanationVi, 700, { required: 'explanationVi' }),
    topic: str(raw.topic, 80),
  }
}

export function quizPrompt(
  ai: AiModel,
  skill: QuizSkill,
  focus: string[],
  recent: string[],
  learnerLine: string,
): Promise<Quiz> {
  return generateJson(
    ai,
    {
      temperature: 0.8,
      maxOutputTokens: 900,
      system: [
        'You write ONE quick multiple-choice question for a Vietnamese learner preparing for IELTS 6.5.',
        learnerLine,
        skill === 'reading'
          ? 'Skill: reading – give a short passage (40–80 words) in passage and ask one comprehension question about it.'
          : skill === 'vocabulary'
            ? 'Skill: vocabulary – test meaning, collocation or word form in a sentence with a gap ("___"). passage is null.'
            : 'Skill: grammar – a sentence with a gap ("___") testing one grammar point. passage is null.',
        focus.length
          ? `Target these weak points / recurring mistakes of the learner:\n${focus.map((f) => `- ${f}`).join('\n')}`
          : 'Target a common problem for Vietnamese learners (tenses, articles, plurals, prepositions, word forms).',
        'Fields: passage (string or null), question, options (exactly 4 distinct short options), answerIndex (0–3, the only correct option),',
        'explanationVi (Vietnamese: why the answer is right and the most tempting wrong option is wrong, 1–3 sentences), topic (short English label of the point tested).',
        'The question must not reveal the answer.',
        JSON_ONLY,
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: recent.length
            ? `Avoid repeating these recent questions:\n${recent.slice(0, 8).join('\n')}`
            : 'Write the question.',
        },
      ],
    },
    validateQuiz,
  )
}
