// AI prompts for the speaking module: session feedback, role-play turns and phoneme estimation.
import { z } from 'zod'
import { CefrSchema, type Cefr } from '@shared/content'
import type { SpeakingMeasured } from '@shared/types'
import { normalizeAnswer } from '@core/text'
import { tokenizeIpa } from '@core/phonemes'
import { JSON_ONLY, jsonPrompt } from '../../../main/kernel/ai/prompt'

// ---------- session feedback ----------

const Score = z.number().min(0).max(10)
const Note = z.string().min(1).max(400)

export const SpeakingFeedbackSchema = z.object({
  pronunciation: z.object({ score: Score, notes: z.array(Note).max(6) }),
  fluency: z.object({ score: Score, notes: z.array(Note).max(6) }),
  grammar: z.object({
    score: Score,
    corrections: z
      .array(
        z.object({
          original: z.string().min(1).max(300),
          better: z.string().min(1).max(300),
          explanationVi: z.string().min(1).max(400),
        }),
      )
      .max(8),
  }),
  vocabulary: z.object({ score: Score, suggestions: z.array(Note).max(8) }),
  naturalVersion: z.string().max(2000),
  encouragement: z.string().min(1).max(400),
  cefrEstimate: CefrSchema,
})

export const MistakePatternSchema = z.object({
  category: z.enum(['grammar', 'vocabulary', 'pronunciation']),
  pattern: z.string().min(2).max(120),
  example: z.string().max(200).default(''),
  correction: z.string().max(200).default(''),
})

export const FeedbackOutputSchema = SpeakingFeedbackSchema.extend({
  mistakePatterns: z.array(MistakePatternSchema).max(4).default([]),
})
export type FeedbackOutput = z.infer<typeof FeedbackOutputSchema>

export interface FeedbackInput {
  mode: string
  prompt: string
  target: string | null
  transcript: string
  measured: SpeakingMeasured
  cefr: Cefr
}

function measuredLine(m: SpeakingMeasured): string {
  return [
    `recording ${m.durationSec}s`,
    `voiced speech ${m.speakingSec}s`,
    m.wordsPerMinute !== null ? `${m.wordsPerMinute} words per minute` : 'speech rate unknown',
    `${m.pauseCount} pauses ≥0.4s (longest ${m.longestPauseSec}s)`,
    m.wordAccuracy !== null ? `word accuracy vs target ${Math.round(m.wordAccuracy * 100)}%` : '',
    m.missingWords.length ? `missing words: ${m.missingWords.slice(0, 12).join(', ')}` : '',
    m.extraWords.length ? `unexpected words: ${m.extraWords.slice(0, 12).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ')
}

export const speakingFeedbackPrompt = jsonPrompt<FeedbackInput, FeedbackOutput>({
  id: 'speaking.feedback',
  version: 1,
  skill: 'speaking',
  temperature: 0.3,
  maxOutputTokens: 2500,
  schema: FeedbackOutputSchema,
  build: (input, ctx) => ({
    system: [
      'You are a warm but honest English speaking coach for Vietnamese learners preparing for IELTS Speaking (target band 6.5 / CEFR B2).',
      ctx.learnerLine,
      ctx.languageInstruction,
      'You receive a speech-to-text transcript plus objectively MEASURED metrics. You cannot hear the audio:',
      '- pronunciation: infer only from recognition evidence (words missing/changed versus the target, odd substitutions typical of Vietnamese speakers such as dropped final consonants, /θ/→/t/, /ʃ/→/s/). Say clearly when evidence is weak.',
      '- fluency: base it on the measured speech rate and pauses (natural conversational English ≈ 120–160 wpm; many long pauses lower the score).',
      '- grammar and vocabulary: judge the transcript; ignore punctuation and capitalisation (they come from the recogniser).',
      'Scores are 0–10 (10 = native-like). Be calibrated: a typical A2 learner scores 3–5, B2 scores 6–7.',
      'Fields: pronunciation {score, notes[≤4]}, fluency {score, notes[≤4]}, grammar {score, corrections[{original, better, explanationVi}] – only real mistakes, max 5},',
      'vocabulary {score, suggestions[≤4] – better words/collocations}, naturalVersion (the learner’s message rewritten naturally, one CEFR level above theirs, same meaning),',
      'encouragement (one short Vietnamese sentence), cefrEstimate, mistakePatterns[≤3] – generalisable recurring patterns actually seen, e.g. {category:"grammar", pattern:"missing third-person -s", example, correction}.',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Task type: ${input.mode} (level ${input.cefr}).`,
          `Task: ${input.prompt.slice(0, 1500) || '(free speaking)'}`,
          input.target ? `Target text the learner tried to say: ${input.target.slice(0, 1500)}` : '',
          `Measured: ${measuredLine(input.measured)}.`,
          `Transcript: ${input.transcript.slice(0, 4000)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  }),
  check: (_input, out) => {
    const same = out.grammar.corrections.find((c) => normalizeAnswer(c.original) === normalizeAnswer(c.better))
    return same ? `Correction "${same.original}" is identical to the original; remove it.` : null
  },
  mock: (input) => mockFeedback(input),
})

const THIRD_PERSON =
  /\b(he|she|it|my (?:mother|father|friend|teacher|sister|brother))\s+(go|do|have|like|want|work|live|play|need)\b/i

export function mockFeedback(input: FeedbackInput): FeedbackOutput {
  const m = input.measured
  const pron = m.wordAccuracy !== null ? Math.round(m.wordAccuracy * 10) : 6
  const wpm = m.wordsPerMinute
  const fluency = Math.max(
    2,
    Math.min(9, (wpm === null ? 6 : Math.round(wpm / 18)) - Math.min(3, Math.floor(m.pauseCount / 4))),
  )
  const tp = THIRD_PERSON.exec(input.transcript)
  const corrections = tp
    ? [
        {
          original: tp[0],
          better: `${tp[1]} ${tp[2] === 'have' ? 'has' : tp[2] === 'go' || tp[2] === 'do' ? `${tp[2]}es` : `${tp[2]}s`}`,
          explanationVi: 'Chủ ngữ ngôi thứ ba số ít (he/she/it) thì động từ thêm -s/-es.',
        },
      ]
    : []
  return {
    pronunciation: {
      score: pron,
      notes: m.missingWords.length
        ? [`Một số từ chưa được nhận ra: ${m.missingWords.slice(0, 5).join(', ')}. Hãy phát âm rõ phụ âm cuối.`]
        : ['Các từ được nhận ra rõ ràng.'],
    },
    fluency: {
      score: fluency,
      notes: [
        wpm === null ? 'Chưa đo được tốc độ nói.' : `Tốc độ khoảng ${wpm} từ/phút; ${m.pauseCount} lần ngắt quãng.`,
      ],
    },
    grammar: { score: corrections.length ? 6 : 7, corrections },
    vocabulary: { score: 6, suggestions: ['Try linking words such as "because", "however" and "for example".'] },
    naturalVersion: input.transcript.trim() ? input.transcript.trim().replace(/^./, (c) => c.toUpperCase()) : '',
    encouragement: 'Bạn đang tiến bộ – hãy luyện thêm một lượt nữa nhé!',
    cefrEstimate: input.cefr,
    mistakePatterns: corrections.length
      ? [
          {
            category: 'grammar',
            pattern: 'missing third-person -s',
            example: corrections[0]?.original ?? '',
            correction: corrections[0]?.better ?? '',
          },
        ]
      : [],
  }
}

// ---------- role-play ----------

export const RoleplayOutputSchema = z.object({
  reply: z.string().min(1).max(500),
  correction: z
    .object({
      original: z.string().min(1).max(300),
      better: z.string().min(1).max(300),
      explanationVi: z.string().min(1).max(400),
    })
    .nullable()
    .default(null),
  hintVi: z.string().max(300).default(''),
  done: z.boolean().default(false),
})
export type RoleplayOutput = z.infer<typeof RoleplayOutputSchema>

export interface RoleplayInput {
  title: string
  aiRole: string
  openingLine: string
  goalVi: string
  cefr: Cefr
  history: { role: 'user' | 'assistant'; content: string }[]
  userText: string
}

export const roleplayTurnPrompt = jsonPrompt<RoleplayInput, RoleplayOutput>({
  id: 'speaking.roleplayTurn',
  version: 1,
  skill: 'speaking',
  temperature: 0.7,
  maxOutputTokens: 700,
  schema: RoleplayOutputSchema,
  build: (input, ctx) => ({
    system: [
      `You are playing a character in an English speaking role-play for a Vietnamese learner. Scenario: "${input.title}".`,
      `Your role: ${input.aiRole}. Stay in character, be friendly and realistic.`,
      `Learner goal (Vietnamese): ${input.goalVi}`,
      ctx.constraints,
      'Reply in 1–3 short spoken sentences (max 40 words) that keep the conversation moving; usually end with a question.',
      'The learner speaks through speech recognition, so ignore punctuation/capitalisation and small recognition slips.',
      'correction: only when the learner made a clear grammar or word-choice mistake, give {original, better, explanationVi}; otherwise null.',
      'hintVi: one short Vietnamese suggestion of what the learner could say next (may include an English phrase).',
      'done: true when the scenario has reached a natural end (usually after 5–8 learner turns); then say goodbye in reply.',
      'Fields: reply, correction, hintVi, done.',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      { role: 'assistant', content: input.openingLine },
      ...input.history.slice(-12),
      { role: 'user', content: input.userText },
    ],
  }),
  mock: (input) => {
    const turn = input.history.filter((h) => h.role === 'user').length + 1
    const replies = [
      'Great, thank you. Could you tell me a little more about that?',
      'I see. And when would you like to do that?',
      'Perfect. Is there anything else I can help you with?',
      'No problem at all. How would you like to pay?',
      'Lovely. Thanks so much for your time – have a great day!',
    ]
    const tp = THIRD_PERSON.exec(input.userText)
    return {
      reply: replies[Math.min(turn - 1, replies.length - 1)] as string,
      correction: tp
        ? { original: tp[0], better: `${tp[1]} ${tp[2]}s`, explanationVi: 'Ngôi thứ ba số ít: động từ thêm -s.' }
        : null,
      hintVi: 'Gợi ý: trả lời đầy đủ một câu, ví dụ "I would like to…".',
      done: turn >= replies.length,
    }
  },
})

// ---------- phoneme estimation ----------

export const PhonemeEstimateSchema = z.object({
  heardIpa: z.string().min(1).max(120),
  confidence: z.enum(['low', 'medium', 'high']),
  tipVi: z.string().max(400).default(''),
})
export type PhonemeEstimate = z.infer<typeof PhonemeEstimateSchema>

export interface PhonemeEstimateInput {
  word: string
  targetIpa: string
  transcript: string
}

export const phonemeEstimatePrompt = jsonPrompt<PhonemeEstimateInput, PhonemeEstimate>({
  id: 'speaking.phonemeEstimate',
  version: 1,
  skill: 'speaking',
  temperature: 0.1,
  maxOutputTokens: 400,
  schema: PhonemeEstimateSchema,
  build: (input) => ({
    system: [
      'You estimate which English phonemes a Vietnamese learner most likely produced when trying to say a target word.',
      'You only get the speech-recogniser transcript (no audio). Reason from it: if the recogniser heard a different word,',
      'give the IPA of what it heard; if it heard the target exactly, return the target IPA (confidence "low" when evidence is thin).',
      'Use broad IPA, phonemes separated by single spaces, no slashes or stress marks (e.g. "θ ɪ ŋ k").',
      'tipVi: one short Vietnamese articulation tip for the most likely problem sound (or praise if none).',
      'Fields: heardIpa, confidence ("low" | "medium" | "high"), tipVi.',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Target word: ${input.word}\nTarget IPA: ${input.targetIpa}\nRecogniser transcript: ${input.transcript.slice(0, 300) || '(nothing recognised)'}`,
      },
    ],
  }),
  check: (input, out) => {
    const heard = tokenizeIpa(out.heardIpa)
    if (!heard.length) return 'heardIpa must contain IPA phonemes.'
    if (/[A-Z0-9]/.test(out.heardIpa)) return 'heardIpa must be IPA symbols only (no capital letters or digits).'
    if (heard.length > tokenizeIpa(input.targetIpa).length * 3 + 4) return 'heardIpa is far too long for one word.'
    return null
  },
  mock: (input) => {
    const target = tokenizeIpa(input.targetIpa)
    const heardTarget = normalizeAnswer(input.transcript).split(' ').includes(normalizeAnswer(input.word))
    if (heardTarget)
      return { heardIpa: target.join(' '), confidence: 'medium', tipVi: 'Phát âm khá rõ – giữ nguyên khẩu hình nhé.' }
    const vowel = target.findIndex((p) => /[aeiouæɛɪɒʌəɜɑɔʊ]/.test(p))
    const heard = target.map((p, i) => (i === vowel ? 'ə' : p))
    return {
      heardIpa: heard.join(' '),
      confidence: 'low',
      tipVi: 'Nguyên âm chưa rõ – mở miệng đúng khẩu hình và giữ âm cuối.',
    }
  },
})
