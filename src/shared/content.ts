// Schemas for bundled, original learning content (src/content/*.json).
// Content is validated at test time and on load so a broken file can never crash a module.
import { z } from 'zod'

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export const CefrSchema = z.enum(CEFR_LEVELS)
export type Cefr = z.infer<typeof CefrSchema>

export const GlossaryEntrySchema = z.object({
  word: z.string().min(1),
  ipa: z.string().min(1),
  pos: z.string().min(1),
  meaningVi: z.string().min(1),
  meaningEn: z.string().min(1),
  example: z.string().min(1),
  cefr: CefrSchema.optional(),
})
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>

export const QuestionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['mcq', 'true-false-ng']),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(5),
    answerIndex: z.number().int().min(0),
    explanation: z.string().min(1),
  })
  .refine((q) => q.answerIndex < q.options.length, { message: 'answerIndex out of range' })
export type Question = z.infer<typeof QuestionSchema>

export const READING_CATEGORIES = [
  'short-story',
  'article',
  'news',
  'science',
  'technology',
  'business',
  'psychology',
  'philosophy',
  'fiction',
] as const
export const ReadingCategorySchema = z.enum(READING_CATEGORIES)

export const ReadingPassageSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  category: ReadingCategorySchema,
  cefr: CefrSchema,
  topicTags: z.array(z.string()).min(1),
  summaryVi: z.string().min(1),
  body: z.string().min(200),
  questions: z.array(QuestionSchema).min(3),
  glossary: z.array(GlossaryEntrySchema).min(4),
})
export type ReadingPassage = z.infer<typeof ReadingPassageSchema>

export const ACCENTS = ['en-US', 'en-GB', 'en-AU'] as const
export const AccentSchema = z.enum(ACCENTS)

export const ListeningTrackSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  cefr: CefrSchema,
  topic: z.string().min(1),
  accent: AccentSchema,
  kind: z.enum(['dialogue', 'monologue', 'announcement']),
  speakers: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), gender: z.enum(['female', 'male']) }))
    .min(1),
  lines: z
    .array(z.object({ speaker: z.string().min(1), text: z.string().min(1), translationVi: z.string().min(1) }))
    .min(4),
  questions: z.array(QuestionSchema).min(3),
  keyVocabulary: z.array(GlossaryEntrySchema).min(3),
})
export type ListeningTrack = z.infer<typeof ListeningTrackSchema>

export const BACKDROPS = [
  'city-night',
  'cafe',
  'office',
  'airport',
  'train',
  'lab',
  'street-rain',
  'interview-room',
  'apartment',
  'spaceship',
  'park',
  'hotel-lobby',
  'market',
  'museum',
] as const
export const BackdropSchema = z.enum(BACKDROPS)

export const STORY_GENRES = [
  'new-york-life',
  'travel',
  'detective',
  'sci-fi',
  'job-interview',
  'office',
  'business',
  'social',
  'real-life',
] as const
export const StoryGenreSchema = z.enum(STORY_GENRES)

export const ExpressionSchema = z.object({
  phrase: z.string().min(1),
  meaningVi: z.string().min(1),
  explanation: z.string().min(1),
})

export const SceneLineSchema = z.object({
  characterId: z.string().min(1), // a character id or "narrator"
  text: z.string().min(1),
  translationVi: z.string().min(1),
  expressions: z.array(ExpressionSchema).optional(),
})

export const SceneChoiceOptionSchema = z.object({
  text: z.string().min(1),
  nextSceneId: z.string().min(1),
  quality: z.enum(['great', 'ok', 'awkward']),
  feedbackVi: z.string().min(1),
})

export const SceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  backdrop: BackdropSchema,
  mood: z.enum(['calm', 'tense', 'warm', 'mysterious', 'upbeat', 'serious']),
  lines: z.array(SceneLineSchema).min(1),
  choice: z
    .object({ prompt: z.string().min(1), options: z.array(SceneChoiceOptionSchema).min(2).max(4) })
    .optional(),
  nextSceneId: z.string().optional(), // linear continuation when there is no choice
  quiz: z.array(QuestionSchema).optional(),
  ending: z
    .object({ type: z.enum(['good', 'neutral', 'bad']), summaryEn: z.string().min(1), summaryVi: z.string().min(1) })
    .optional(),
})
export type Scene = z.infer<typeof SceneSchema>

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  voiceGender: z.enum(['female', 'male']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})

export const CinemaStorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    genre: StoryGenreSchema,
    cefr: CefrSchema,
    synopsisEn: z.string().min(1),
    synopsisVi: z.string().min(1),
    setting: z.string().min(1),
    characters: z.array(CharacterSchema).min(1),
    startSceneId: z.string().min(1),
    scenes: z.array(SceneSchema).min(2),
  })
  .superRefine((story, ctx) => {
    const ids = new Set(story.scenes.map((s) => s.id))
    const chars = new Set(story.characters.map((c) => c.id))
    if (!ids.has(story.startSceneId)) ctx.addIssue({ code: 'custom', message: `missing start scene ${story.startSceneId}` })
    for (const scene of story.scenes) {
      const exits = (scene.choice ? 1 : 0) + (scene.nextSceneId ? 1 : 0) + (scene.ending ? 1 : 0)
      if (exits !== 1) ctx.addIssue({ code: 'custom', message: `scene ${scene.id} must have exactly one of choice/nextSceneId/ending` })
      if (scene.nextSceneId && !ids.has(scene.nextSceneId))
        ctx.addIssue({ code: 'custom', message: `scene ${scene.id} -> unknown ${scene.nextSceneId}` })
      for (const opt of scene.choice?.options ?? [])
        if (!ids.has(opt.nextSceneId)) ctx.addIssue({ code: 'custom', message: `scene ${scene.id} option -> unknown ${opt.nextSceneId}` })
      for (const line of scene.lines)
        if (line.characterId !== 'narrator' && !chars.has(line.characterId))
          ctx.addIssue({ code: 'custom', message: `scene ${scene.id} unknown character ${line.characterId}` })
    }
  })
export type CinemaStory = z.infer<typeof CinemaStorySchema>

export const ASSESSMENT_SKILLS = ['vocabulary', 'grammar', 'reading', 'listening'] as const
export const AssessmentItemSchema = z
  .object({
    id: z.string().min(1),
    skill: z.enum(ASSESSMENT_SKILLS),
    cefr: CefrSchema,
    prompt: z.string().min(1),
    passage: z.string().optional(), // reading text or listening script (spoken via TTS)
    options: z.array(z.string().min(1)).min(3).max(4),
    answerIndex: z.number().int().min(0),
  })
  .refine((q) => q.answerIndex < q.options.length, { message: 'answerIndex out of range' })
export type AssessmentItem = z.infer<typeof AssessmentItemSchema>

export const DictionaryEntrySchema = GlossaryEntrySchema.extend({
  cefr: CefrSchema,
  topic: z.string().min(1),
  collocations: z.array(z.string()).default([]),
})
export type DictionaryEntry = z.infer<typeof DictionaryEntrySchema>

export const GrammarTopicSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  cefr: CefrSchema,
  summaryEn: z.string().min(1),
  explanationVi: z.string().min(1),
  patterns: z.array(z.string().min(1)).min(1),
  examples: z.array(z.object({ en: z.string().min(1), vi: z.string().min(1) })).min(2),
  commonMistakes: z.array(z.object({ wrong: z.string().min(1), right: z.string().min(1), why: z.string().min(1) })).min(1),
  exercises: z
    .array(
      z
        .object({
          id: z.string().min(1),
          type: z.enum(['mcq', 'gap']),
          prompt: z.string().min(1), // for gap: sentence containing "___"
          options: z.array(z.string()).default([]),
          answer: z.string().min(1),
          explanation: z.string().min(1),
        })
        .refine((e) => e.type === 'gap' || e.options.includes(e.answer), { message: 'mcq answer must be an option' }),
    )
    .min(4),
})
export type GrammarTopic = z.infer<typeof GrammarTopicSchema>

export const WRITING_TASK_TYPES = [
  'sentence',
  'grammar',
  'paragraph',
  'journal',
  'email',
  'business',
  'essay',
  'creative',
  'free',
] as const
export const WritingTaskTypeSchema = z.enum(WRITING_TASK_TYPES)

export const WritingPromptSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  taskType: WritingTaskTypeSchema,
  cefr: CefrSchema,
  title: z.string().min(1),
  instructions: z.string().min(1),
  instructionsVi: z.string().min(1),
  minWords: z.number().int().min(1),
  maxWords: z.number().int().min(1),
  hints: z.array(z.string()).default([]),
})
export type WritingPrompt = z.infer<typeof WritingPromptSchema>

export const SPEAKING_KINDS = ['shadowing', 'repeat', 'roleplay', 'real-world', 'challenge', 'ielts'] as const
export const SpeakingPromptSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(SPEAKING_KINDS),
  cefr: CefrSchema,
  title: z.string().min(1),
  instructionsVi: z.string().min(1),
  // shadowing/repeat: target sentences; roleplay/real-world: AI role + opening line; challenge/ielts: cue card
  sentences: z.array(z.string().min(1)).default([]),
  aiRole: z.string().optional(),
  openingLine: z.string().optional(),
  cueCard: z.array(z.string()).default([]),
  durationSec: z.number().int().min(15).max(600),
})
export type SpeakingPrompt = z.infer<typeof SpeakingPromptSchema>
