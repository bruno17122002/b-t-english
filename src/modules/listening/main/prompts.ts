// AI prompts for the listening module: generating a new, original listening track.
import { ListeningTrackSchema, type Cefr, type ListeningTrack } from '@shared/content'
import { JSON_ONLY, jsonPrompt, leaksAnswer } from '../../../main/kernel/ai/prompt'

export interface GenerateTrackInput {
  id: string
  cefr: Cefr
  topic: string
  accent: ListeningTrack['accent']
  kind: ListeningTrack['kind']
}

const LENGTH_BY_LEVEL: Record<Cefr, string> = {
  A1: '8–10 short lines (5–9 words each)',
  A2: '8–12 lines (6–12 words each)',
  B1: '10–12 lines (8–16 words each)',
  B2: '10–14 lines (10–20 words each)',
  C1: '10–14 lines (12–24 words each)',
  C2: '10–14 lines (12–26 words each)',
}

const ACCENT_NOTE: Record<ListeningTrack['accent'], string> = {
  'en-US': 'American English (US spelling, US vocabulary such as "apartment", "check")',
  'en-GB': 'British English (UK spelling, UK vocabulary such as "flat", "bill")',
  'en-AU': 'Australian English (UK spelling, light Australian vocabulary such as "arvo" only if explained by context)',
}

/**
 * Quality checks that zod cannot express. Returns a description of the first problem or null.
 * Exported for unit tests.
 */
export function checkGeneratedTrack(track: ListeningTrack): string | null {
  const speakerIds = new Set(track.speakers.map((s) => s.id))
  const unknown = track.lines.find((l) => !speakerIds.has(l.speaker))
  if (unknown) return `Line speaker "${unknown.speaker}" is not listed in speakers.`
  if (track.lines.length < 6) return 'Write at least 6 lines.'
  if (track.kind === 'dialogue' && speakerIds.size < 2) return 'A dialogue needs at least two speakers.'
  const transcript = track.lines.map((l) => l.text).join(' ')
  for (const q of track.questions) {
    const answer = q.options[q.answerIndex] ?? ''
    if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== q.options.length)
      return `Question "${q.id}" has duplicate options.`
    // True/False/Not given options are generic words – only check real answer texts for leaks.
    if (q.type === 'mcq' && answer.trim().length >= 3 && leaksAnswer(q.prompt, answer))
      return `Question "${q.id}" reveals its answer ("${answer}") in the question text.`
    if (
      q.type === 'mcq' &&
      q.prompt.length > 30 &&
      transcript.toLowerCase().includes(q.prompt.toLowerCase().replace(/\?$/, ''))
    )
      return `Question "${q.id}" copies a full line of the transcript; paraphrase it.`
  }
  const idx = track.questions.map((q) => q.answerIndex)
  if (idx.length >= 4 && idx.every((v) => v === idx[0]))
    return 'All correct answers use the same option position; vary them.'
  return null
}

export const generateTrackPrompt = jsonPrompt<GenerateTrackInput, ListeningTrack>({
  id: 'listening.generateTrack',
  version: 1,
  skill: 'listening',
  temperature: 0.8,
  maxOutputTokens: 6000,
  schema: ListeningTrackSchema,
  build: (input, ctx) => ({
    system: [
      'You write ORIGINAL listening practice scripts for Vietnamese learners of English (goal: IELTS 6.5 / CEFR B2).',
      ctx.learnerLine,
      ctx.constraints,
      'Never copy or imitate copyrighted films, songs, books, podcasts or textbook recordings. Invent names, places and details.',
      `Write a ${input.kind} at CEFR ${input.cefr} about "${input.topic}" in ${ACCENT_NOTE[input.accent]}.`,
      `Length: ${LENGTH_BY_LEVEL[input.cefr]}. Natural spoken English with contractions, fillers only where natural.`,
      'Every line has: speaker (an id from speakers), text (English), translationVi (natural Vietnamese with full diacritics).',
      'speakers: [{id (lowercase slug), name, gender ("female"|"male")}] – a monologue or announcement has one speaker.',
      'questions: 4 comprehension questions answerable ONLY by listening (not from general knowledge).',
      'Use type "mcq" with 3–4 options (or "true-false-ng" with options ["True","False","Not given"]).',
      'Paraphrase in questions: never repeat the exact wording of the answer; vary answerIndex; explanation quotes the key line briefly.',
      'keyVocabulary: 4–6 useful words or phrases from the script: {word, ipa (between slashes), pos, meaningVi, meaningEn, example, cefr}.',
      `Output fields: id ("${input.id}"), title (short English title), cefr ("${input.cefr}"), topic, accent ("${input.accent}"), kind ("${input.kind}"), speakers, lines, questions (ids "${input.id}-q1"…), keyVocabulary.`,
      JSON_ONLY,
    ].join('\n'),
    messages: [{ role: 'user', content: `Create the ${input.kind} now. Topic: ${input.topic}. Level: ${input.cefr}.` }],
  }),
  check: (_input, out) => checkGeneratedTrack(out),
  mock: (input) => mockTrack(input),
})

/** Deterministic, schema-valid track used for E2E runs and tests. */
export function mockTrack(input: GenerateTrackInput): ListeningTrack {
  const topic = input.topic.trim()
  return {
    id: input.id,
    title: `A Chat About ${topic.charAt(0).toUpperCase()}${topic.slice(1)}`,
    cefr: input.cefr,
    topic,
    accent: input.accent,
    kind: input.kind,
    speakers:
      input.kind === 'dialogue'
        ? [
            { id: 'linh', name: 'Linh', gender: 'female' },
            { id: 'owen', name: 'Owen', gender: 'male' },
          ]
        : [{ id: 'linh', name: 'Linh', gender: 'female' }],
    lines: [
      {
        speaker: 'linh',
        text: `I started reading about ${topic} last month.`,
        translationVi: `Tháng trước tôi bắt đầu tìm hiểu về ${topic}.`,
      },
      {
        speaker: input.kind === 'dialogue' ? 'owen' : 'linh',
        text: 'Really? What made you interested in it?',
        translationVi: 'Thật à? Điều gì khiến bạn quan tâm đến nó?',
      },
      {
        speaker: 'linh',
        text: 'My cousin talks about it every weekend.',
        translationVi: 'Anh họ tôi nói về nó mỗi cuối tuần.',
      },
      {
        speaker: input.kind === 'dialogue' ? 'owen' : 'linh',
        text: 'Do you practise on your own or with a group?',
        translationVi: 'Bạn luyện tập một mình hay theo nhóm?',
      },
      {
        speaker: 'linh',
        text: 'With a small group on Tuesday evenings.',
        translationVi: 'Với một nhóm nhỏ vào các tối thứ Ba.',
      },
      {
        speaker: input.kind === 'dialogue' ? 'owen' : 'linh',
        text: 'That sounds fun. Is it expensive?',
        translationVi: 'Nghe vui đấy. Có tốn kém không?',
      },
      {
        speaker: 'linh',
        text: 'Not really. It costs about ten dollars a month.',
        translationVi: 'Không hẳn. Khoảng mười đô la một tháng.',
      },
      {
        speaker: input.kind === 'dialogue' ? 'owen' : 'linh',
        text: 'Maybe I can join you next week.',
        translationVi: 'Có lẽ tuần sau tôi tham gia cùng bạn.',
      },
    ],
    questions: [
      {
        id: `${input.id}-q1`,
        type: 'mcq',
        prompt: 'Who first got Linh interested?',
        options: ['Her teacher', 'A relative', 'A neighbour'],
        answerIndex: 1,
        explanation: '"My cousin talks about it every weekend."',
      },
      {
        id: `${input.id}-q2`,
        type: 'mcq',
        prompt: 'When does the group meet?',
        options: ['On weekend mornings', 'Every day', 'One evening a week'],
        answerIndex: 2,
        explanation: '"With a small group on Tuesday evenings."',
      },
      {
        id: `${input.id}-q3`,
        type: 'mcq',
        prompt: 'How much does it cost each month?',
        options: ['About $10', 'About $50', 'It is free'],
        answerIndex: 0,
        explanation: '"It costs about ten dollars a month."',
      },
      {
        id: `${input.id}-q4`,
        type: 'true-false-ng',
        prompt: 'Linh has been learning about this topic for a year.',
        options: ['True', 'False', 'Not given'],
        answerIndex: 1,
        explanation: '"I started reading about it last month."',
      },
    ],
    keyVocabulary: [
      {
        word: 'interested in',
        ipa: '/ˈɪntrəstɪd ɪn/',
        pos: 'phrase',
        meaningVi: 'quan tâm đến',
        meaningEn: 'wanting to know more about something',
        example: 'I am interested in music.',
        cefr: 'A2',
      },
      {
        word: 'practise',
        ipa: '/ˈpræktɪs/',
        pos: 'verb',
        meaningVi: 'luyện tập',
        meaningEn: 'to do something regularly to improve',
        example: 'I practise English every day.',
        cefr: 'A2',
      },
      {
        word: 'expensive',
        ipa: '/ɪkˈspensɪv/',
        pos: 'adjective',
        meaningVi: 'đắt',
        meaningEn: 'costing a lot of money',
        example: 'This phone is too expensive.',
        cefr: 'A1',
      },
      {
        word: 'join',
        ipa: '/dʒɔɪn/',
        pos: 'verb',
        meaningVi: 'tham gia',
        meaningEn: 'to become part of a group or activity',
        example: 'Can I join your team?',
        cefr: 'A2',
      },
    ],
  }
}
