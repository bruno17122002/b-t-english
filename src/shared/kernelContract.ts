// IPC contract for Platform Kernel services (shared by every module).
import { z } from 'zod'
import { CefrSchema } from './content'
import { channel, NoInput } from './ipc'
import type {
  Achievement,
  ActivityEntry,
  AiConfigView,
  AppSettings,
  BackupInfo,
  Bookmark,
  ConnectionTestResult,
  DiagnosticsInfo,
  DictionaryResult,
  DueCard,
  Favorite,
  GameState,
  LearnerMistake,
  LearningGoal,
  ModelInfo,
  Profile,
  ProviderId,
  Quest,
  SearchResult,
  SkillLevel,
  StatsOverview,
  VocabItem,
  VocabStats,
} from './types'
import { MODULES, SKILLS, TUTOR_STYLES, USER_PROVIDERS } from './types'

const Provider = z.enum(USER_PROVIDERS)
const Id = z.object({ id: z.number().int().positive() })
const shortText = (max: number) => z.string().max(max)

export const ProfilePatchSchema = z.object({
  displayName: shortText(60).optional(),
  selfReportedLevel: z.enum(['beginner', 'elementary', 'intermediate', 'upper', 'advanced']).optional(),
  overallCefr: CefrSchema.nullable().optional(),
  targetCefr: CefrSchema.optional(),
  targetIelts: z.number().min(0).max(9).nullable().optional(),
  dailyMinutes: z.number().int().min(5).max(240).optional(),
  purposes: z.array(shortText(60)).max(12).optional(),
  interests: z.array(shortText(60)).max(20).optional(),
  learningStyle: z.enum(['visual', 'auditory', 'reading', 'kinesthetic', 'mixed']).optional(),
  onboardingCompleted: z.boolean().optional(),
})

export const SettingsPatchSchema = z.object({
  uiLanguage: z.enum(['en', 'vi']).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  accent: shortText(20).optional(),
  notificationsEnabled: z.boolean().optional(),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  ttsEngine: z.enum(['system', 'openai', 'gemini']).optional(),
  systemVoiceUri: shortText(300).optional(),
  speechRate: z.number().min(0.5).max(1.5).optional(),
  showVietnameseHints: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
  dailyGoalXp: z.number().int().min(10).max(1000).optional(),
})

export const SaveWordSchema = z.object({
  word: z.string().trim().min(1).max(80),
  ipa: shortText(80).optional(),
  pos: shortText(40).optional(),
  meaningVi: shortText(300).optional(),
  meaningEn: shortText(300).optional(),
  examples: z.array(shortText(400)).max(8).optional(),
  context: shortText(500).optional(),
  sourceModule: z.enum([...MODULES, 'manual', 'dictionary']),
  sourceRef: shortText(120).optional(),
  collocations: z.array(shortText(80)).max(10).optional(),
  idioms: z.array(shortText(120)).max(10).optional(),
  phrasalVerbs: z.array(shortText(80)).max(10).optional(),
  cefr: CefrSchema.nullable().optional(),
  topic: shortText(60).optional(),
  notes: shortText(1000).optional(),
})

export const VocabFilterSchema = z.object({
  query: shortText(80).optional(),
  topic: shortText(60).optional(),
  sourceModule: shortText(30).optional(),
  state: z.enum(['new', 'learning', 'review', 'relearning', 'difficult', 'due', 'favorite']).optional(),
  sort: z.enum(['recent', 'alpha', 'due', 'difficulty']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
})

const GoalSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(['short', 'long', 'custom']),
  title: z.string().trim().min(1).max(200),
  metric: z.enum(['minutes', 'words', 'lessons', 'xp', 'none']),
  targetValue: z.number().min(0).max(1_000_000),
  targetDate: z.string().nullable(),
  status: z.enum(['active', 'done', 'archived']),
})

const Bytes = z.instanceof(Uint8Array).refine((b) => b.byteLength <= 25 * 1024 * 1024, 'Audio is larger than 25 MB')

export interface BootstrapData {
  version: string
  profile: Profile
  settings: AppSettings
  ai: AiConfigView
  game: GameState
  dueCards: number
  contentIssues: number
  isFirstRun: boolean
}

export const kernelContract = {
  // ---------- app ----------
  'app:bootstrap': channel<BootstrapData>()(NoInput),
  'app:diagnostics': channel<DiagnosticsInfo>()(NoInput),
  'app:logs': channel<string>()(NoInput),
  'app:openExternal': channel<null>()(z.object({ url: z.url().max(500) })),
  'app:openFolder': channel<null>()(z.object({ which: z.enum(['data', 'backups', 'logs']) })),
  'app:testNotification': channel<null>()(NoInput),

  // ---------- learner ----------
  'learner:profile': channel<Profile>()(NoInput),
  'learner:updateProfile': channel<Profile>()(ProfilePatchSchema),
  'learner:skills': channel<SkillLevel[]>()(NoInput),
  'learner:setSkill': channel<SkillLevel[]>()(
    z.object({ skill: z.enum(SKILLS), cefr: CefrSchema, score: z.number().min(0).max(100) }),
  ),
  'learner:goals': channel<LearningGoal[]>()(NoInput),
  'learner:saveGoal': channel<LearningGoal[]>()(GoalSchema),
  'learner:deleteGoal': channel<LearningGoal[]>()(Id),
  'learner:mistakes': channel<LearnerMistake[]>()(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()),
  'learner:deleteMistake': channel<null>()(Id),

  // ---------- settings ----------
  'settings:get': channel<AppSettings>()(NoInput),
  'settings:update': channel<AppSettings>()(SettingsPatchSchema),

  // ---------- AI ----------
  'ai:config': channel<AiConfigView>()(NoInput),
  'ai:updateConfig': channel<AiConfigView>()(
    z.object({
      defaultProvider: Provider.nullable().optional(),
      geminiModel: shortText(100).optional(),
      openaiModel: shortText(100).optional(),
      responseLanguage: z.enum(['en', 'vi', 'mixed']).optional(),
      tutorStyle: z.enum(TUTOR_STYLES).optional(),
      sttProvider: z.enum([...USER_PROVIDERS, 'auto']).optional(),
    }),
  ),
  'ai:setKey': channel<{ persisted: boolean; config: AiConfigView }>()(
    z.object({ provider: Provider, key: z.string().min(1).max(400) }),
  ),
  'ai:removeKey': channel<AiConfigView>()(z.object({ provider: Provider })),
  'ai:test': channel<ConnectionTestResult>()(z.object({ provider: Provider })),
  'ai:models': channel<ModelInfo[]>()(z.object({ provider: Provider })),

  // ---------- audio ----------
  'audio:tts': channel<{ data: Uint8Array; mimeType: string }>()(
    z.object({
      text: z.string().min(1).max(4000),
      engine: Provider,
      voice: shortText(40).optional(),
      speed: z.number().min(0.5).max(1.5).optional(),
    }),
  ),
  'audio:stt': channel<{ text: string; provider: ProviderId }>()(
    z.object({ audio: Bytes, mimeType: shortText(60), hint: shortText(1000).optional() }),
  ),

  // ---------- vocabulary hub ----------
  'vocab:save': channel<{ item: VocabItem; created: boolean }>()(SaveWordSchema),
  'vocab:list': channel<{ items: VocabItem[]; total: number }>()(VocabFilterSchema.optional()),
  'vocab:get': channel<VocabItem | null>()(Id),
  'vocab:update': channel<VocabItem>()(
    z.object({
      id: z.number().int().positive(),
      patch: SaveWordSchema.omit({ word: true, sourceModule: true }).partial().extend({ isFavorite: z.boolean().optional() }),
    }),
  ),
  'vocab:delete': channel<null>()(Id),
  'vocab:due': channel<DueCard[]>()(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional()),
  'vocab:review': channel<VocabItem>()(
    z.object({
      id: z.number().int().positive(),
      rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      durationMs: z.number().min(0).max(3_600_000).optional(),
    }),
  ),
  'vocab:stats': channel<VocabStats>()(NoInput),
  'vocab:topics': channel<string[]>()(NoInput),
  'vocab:lookup': channel<DictionaryResult | null>()(
    z.object({ word: z.string().trim().min(1).max(80), context: shortText(500).optional(), useAi: z.boolean().optional() }),
  ),

  // ---------- progress / game ----------
  'progress:game': channel<GameState>()(NoInput),
  'progress:quests': channel<{ daily: Quest[]; weekly: Quest[] }>()(NoInput),
  'progress:achievements': channel<Achievement[]>()(NoInput),
  'progress:stats': channel<StatsOverview>()(NoInput),
  'progress:activity': channel<ActivityEntry[]>()(
    z.object({ limit: z.number().int().min(1).max(200).optional(), beforeId: z.number().int().optional() }).optional(),
  ),
  'progress:calendar': channel<{ date: string; minutes: number; xp: number }[]>()(
    z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  ),

  // ---------- library ----------
  'library:favorites': channel<Favorite[]>()(z.object({ kind: shortText(30).optional() }).optional()),
  'library:toggleFavorite': channel<boolean>()(
    z.object({ kind: shortText(30), ref: shortText(120), title: shortText(200) }),
  ),
  'library:isFavorite': channel<boolean>()(z.object({ kind: shortText(30), ref: shortText(120) })),
  'library:bookmarks': channel<Bookmark[]>()(
    z.object({ kind: shortText(30).optional(), ref: shortText(120).optional() }).optional(),
  ),
  'library:addBookmark': channel<Bookmark[]>()(
    z.object({
      kind: shortText(30),
      ref: shortText(120),
      title: shortText(200),
      note: shortText(1000).default(''),
      position: shortText(200).default(''),
    }),
  ),
  'library:removeBookmark': channel<null>()(Id),

  // ---------- search ----------
  'search:query': channel<SearchResult[]>()(z.object({ q: z.string().max(100) })),

  // ---------- data ----------
  'data:backups': channel<BackupInfo[]>()(NoInput),
  'data:createBackup': channel<BackupInfo>()(NoInput),
  'data:deleteBackup': channel<BackupInfo[]>()(z.object({ file: shortText(1000) })),
  /** Validates the backup, writes a safety copy, replaces the database and relaunches the app. */
  'data:restoreBackup': channel<null>()(z.object({ file: shortText(1000).optional() })),
  'data:exportJson': channel<{ file: string } | null>()(NoInput),
  'data:exportVocabCsv': channel<{ file: string } | null>()(NoInput),
  'data:importVocab': channel<{ added: number; merged: number; skipped: number } | null>()(NoInput),
}
