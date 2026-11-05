// AI prompt for Cinema Mode: writes a brand-new, original interactive story in the exact CinemaStory schema.
import { BACKDROPS, CinemaStorySchema, type Cefr, type CinemaStory } from '@shared/content'
import { JSON_ONLY, jsonPrompt, leaksAnswer } from '../../../main/kernel/ai/prompt'
import { storyProblems } from '../contract'

export interface StoryInput {
  genre: CinemaStory['genre']
  cefr: Cefr
  length: 'short' | 'medium'
  theme?: string
}

export const SCENE_RANGE: Record<StoryInput['length'], [number, number]> = { short: [4, 6], medium: [7, 10] }

const GENRE_HINTS: Record<CinemaStory['genre'], string> = {
  'new-york-life': 'everyday life of a newcomer in a big American city',
  travel: 'a trip abroad: airports, hotels, getting around, meeting locals',
  detective: 'a light, non-violent mystery to solve by asking good questions',
  'sci-fi': 'a near-future science-fiction adventure (space station, lab, strange signal)',
  'job-interview': 'preparing for and taking a job interview',
  office: 'a modern workplace: meetings, emails, colleagues, deadlines',
  business: 'a business negotiation or start-up pitch',
  social: 'making friends, parties, small talk, polite invitations',
  'real-life': 'a practical real-life situation (doctor, bank, landlord, shopping)',
}

const SCHEMA_TEXT = `{
  "id": "lowercase-words-with-dashes",
  "title": string,
  "genre": <genre>,
  "cefr": <level>,
  "synopsisEn": string (2 sentences),
  "synopsisVi": string (Vietnamese translation of synopsisEn),
  "setting": string,
  "characters": [{ "id": "short-lowercase-id", "name": string, "role": string, "voiceGender": "female"|"male", "color": "#RRGGBB" }],
  "startSceneId": "s1",
  "scenes": [{
    "id": "s1",
    "title": string,
    "backdrop": one of ${BACKDROPS.map((b) => `"${b}"`).join(', ')},
    "mood": "calm"|"tense"|"warm"|"mysterious"|"upbeat"|"serious",
    "lines": [{ "characterId": "narrator" or a character id, "text": English line, "translationVi": Vietnamese translation,
               "expressions": [{ "phrase": useful phrase from the line, "meaningVi": string, "explanation": short English usage note }] (optional) }],
    "quiz": [{ "id": "s1-q1", "type": "mcq", "prompt": string, "options": [3-4 strings], "answerIndex": number, "explanation": string }] (optional),
    EXACTLY ONE OF:
      "nextSceneId": "s2"
      "choice": { "prompt": string, "options": [{ "text": what the hero says, "nextSceneId": string, "quality": "great"|"ok"|"awkward", "feedbackVi": Vietnamese feedback on how natural/polite the line is }] (2-3 options) }
      "ending": { "type": "good"|"neutral"|"bad", "summaryEn": string, "summaryVi": string }
  }]
}`

export const storyPrompt = jsonPrompt<StoryInput, CinemaStory>({
  id: 'cinema.story',
  version: 1,
  temperature: 0.9,
  maxOutputTokens: 12000,
  schema: CinemaStorySchema,
  check: (input, story) => {
    const [min, max] = SCENE_RANGE[input.length]
    if (story.scenes.length < min || story.scenes.length > max + 2)
      return `Write between ${min} and ${max} scenes (you wrote ${story.scenes.length}).`
    if (new Set(story.scenes.map((s) => s.id)).size !== story.scenes.length) return 'Scene ids must be unique.'
    const problems = storyProblems(story)
    if (problems.length) return `The scene graph is broken: ${problems.join('; ')}.`
    if (!story.scenes.some((s) => s.choice)) return 'Include at least one choice scene.'
    for (const s of story.scenes)
      for (const q of s.quiz ?? []) {
        const answer = q.options[q.answerIndex]
        if (answer === undefined) return `Quiz ${q.id}: answerIndex is out of range.`
        if (leaksAnswer(q.prompt, answer)) return `Quiz ${q.id}: the question already contains the answer "${answer}".`
      }
    return null
  },
  build: (input, ctx) => {
    const [min, max] = SCENE_RANGE[input.length]
    return {
      system: [
        'You are a screenwriter creating ORIGINAL interactive mini-films for Vietnamese learners of English.',
        'Never copy or imitate real films, TV series, books, scripts or characters; invent everything. No real celebrities or brands. Keep it friendly and safe (no violence, romance kept light).',
        ctx.learnerLine,
        ctx.constraints,
        `Genre: ${input.genre} – ${GENRE_HINTS[input.genre]}. Target level: ${input.cefr}.`,
        input.theme ? `Story idea from the learner: ${input.theme}` : '',
        `Write ${min}–${max} scenes. Each scene has 3–7 short dialogue lines; narrator lines describe the action in present tense.`,
        'Structure rules (very important):',
        '- Every scene has EXACTLY ONE of "nextSceneId", "choice" or "ending" – never two, never none.',
        '- Every nextSceneId must be the id of a scene in the story; startSceneId must exist; no loops (always move forward).',
        '- Every scene must be reachable from the start scene and every path must reach an ending.',
        '- Include 1–2 choice scenes (2–3 options each, qualities great/ok/awkward judged on politeness and naturalness) and 2–3 endings of different types.',
        '- Put a quiz (1–2 comprehension questions) in at least two scenes; the question must not contain its answer.',
        '- Every "characterId" must be "narrator" or the id of a character; 2–4 characters, each with a distinct colour.',
        '- Every line and summary has an accurate, natural Vietnamese translation (with diacritics).',
        '- Add "expressions" to the most useful lines (natural phrases a learner should save).',
        'JSON schema:',
        SCHEMA_TEXT.replace('<genre>', `"${input.genre}"`).replace('<level>', `"${input.cefr}"`),
        JSON_ONLY,
      ]
        .filter(Boolean)
        .join('\n'),
      messages: [{ role: 'user', content: `Write a new ${input.length} ${input.genre} story at ${input.cefr} level.` }],
    }
  },
  mock: (input) => ({
    id: 'ai-mock-story',
    title: 'The Rooftop Garden',
    genre: input.genre,
    cefr: input.cefr,
    synopsisEn:
      'Vy finds a secret garden on the roof of her new building. Can she make friends with the old man who looks after it?',
    synopsisVi:
      'Vy phát hiện một khu vườn bí mật trên sân thượng tòa nhà mới. Liệu cô có kết bạn được với ông cụ chăm sóc nó?',
    setting: 'The roof of an apartment building on a sunny Saturday morning.',
    characters: [
      { id: 'vy', name: 'Vy', role: 'A student who just moved in', voiceGender: 'female', color: '#F4A261' },
      { id: 'sam', name: 'Mr. Sam', role: 'A retired gardener', voiceGender: 'male', color: '#7BD389' },
    ],
    startSceneId: 's1',
    scenes: [
      {
        id: 's1',
        title: 'The Door to the Roof',
        backdrop: 'apartment',
        mood: 'mysterious',
        lines: [
          {
            characterId: 'narrator',
            text: 'SATURDAY MORNING. Vy opens a small door at the top of the stairs.',
            translationVi: 'SÁNG THỨ BẢY. Vy mở một cánh cửa nhỏ ở đầu cầu thang.',
          },
          { characterId: 'vy', text: 'Wow. There are flowers everywhere!', translationVi: 'Ồ. Có hoa ở khắp nơi!' },
          {
            characterId: 'sam',
            text: 'Good morning! Do you like plants?',
            translationVi: 'Chào buổi sáng! Cháu có thích cây cối không?',
            expressions: [
              {
                phrase: 'Good morning!',
                meaningVi: 'Chào buổi sáng!',
                explanation: 'A friendly greeting used before about 12 p.m.',
              },
            ],
          },
        ],
        quiz: [
          {
            id: 's1-q1',
            type: 'mcq',
            prompt: 'Where does Vy find the garden?',
            options: ['On the roof', 'In the park', 'At school'],
            answerIndex: 0,
            explanation: 'She opens a door at the top of the stairs: the roof.',
          },
        ],
        nextSceneId: 's2',
      },
      {
        id: 's2',
        title: 'Hello, Neighbour',
        backdrop: 'park',
        mood: 'warm',
        lines: [
          {
            characterId: 'sam',
            text: 'I grow tomatoes and herbs up here. My name is Sam.',
            translationVi: 'Ông trồng cà chua và rau thơm ở đây. Ông tên là Sam.',
          },
          {
            characterId: 'vy',
            text: 'Nice to meet you. I live on the fifth floor.',
            translationVi: 'Rất vui được gặp ông. Cháu sống ở tầng năm.',
            expressions: [
              {
                phrase: 'Nice to meet you',
                meaningVi: 'Rất vui được gặp bạn',
                explanation: 'Said when you meet someone for the first time.',
              },
            ],
          },
        ],
        choice: {
          prompt: 'What do you say to Mr. Sam?',
          options: [
            {
              text: 'Could I help you with the garden sometimes?',
              nextSceneId: 's3',
              quality: 'great',
              feedbackVi: 'Rất lịch sự và thân thiện: "Could I...?" là cách xin phép nhẹ nhàng.',
            },
            {
              text: 'Give me some tomatoes.',
              nextSceneId: 's4',
              quality: 'awkward',
              feedbackVi: 'Câu mệnh lệnh nghe thiếu lịch sự với người mới quen. Hãy dùng "Could I have...?"',
            },
          ],
        },
      },
      {
        id: 's3',
        title: 'Green Friends',
        backdrop: 'park',
        mood: 'upbeat',
        lines: [
          {
            characterId: 'sam',
            text: 'Of course! Come every Saturday. I will teach you.',
            translationVi: 'Tất nhiên rồi! Thứ bảy nào cũng đến nhé. Ông sẽ dạy cháu.',
          },
          {
            characterId: 'vy',
            text: 'Thank you so much! See you next week.',
            translationVi: 'Cảm ơn ông rất nhiều! Hẹn gặp ông tuần sau.',
          },
        ],
        quiz: [
          {
            id: 's3-q1',
            type: 'mcq',
            prompt: 'When can Vy come back?',
            options: ['Every Monday', 'Every Saturday', 'Never'],
            answerIndex: 1,
            explanation: 'Mr. Sam says: "Come every Saturday."',
          },
        ],
        ending: {
          type: 'good',
          summaryEn: 'Vy asked politely and found a new friend and a new hobby.',
          summaryVi: 'Vy hỏi lịch sự và có thêm một người bạn cùng một sở thích mới.',
        },
      },
      {
        id: 's4',
        title: 'A Cold Answer',
        backdrop: 'apartment',
        mood: 'serious',
        lines: [
          {
            characterId: 'sam',
            text: 'Hmm. These are not for sale. Please close the door when you leave.',
            translationVi: 'Hừm. Những thứ này không bán. Khi đi nhớ đóng cửa giúp ông.',
          },
          {
            characterId: 'narrator',
            text: 'Vy walks downstairs alone.',
            translationVi: 'Vy đi xuống cầu thang một mình.',
          },
        ],
        ending: {
          type: 'bad',
          summaryEn: 'Vy sounded rude, so Mr. Sam did not want to talk.',
          summaryVi: 'Vy nói nghe thô lỗ nên ông Sam không muốn nói chuyện.',
        },
      },
    ],
  }),
})
