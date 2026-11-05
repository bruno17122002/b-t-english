// Domain types shared by main, preload and renderer. Plain data only (IPC-serializable).
import type { Cefr, GlossaryEntry } from './content'

export const SKILLS = ['vocabulary', 'grammar', 'reading', 'listening', 'writing', 'speaking'] as const
export type Skill = (typeof SKILLS)[number]

export const MODULES = [
  'listening',
  'speaking',
  'reading',
  'writing',
  'cinema',
  'vocabulary',
  'grammar',
  'tutor',
  'assessment',
] as const
export type ModuleId = (typeof MODULES)[number]

export const PROVIDERS = ['gemini', 'openai', 'mock'] as const
export type ProviderId = (typeof PROVIDERS)[number]
export const USER_PROVIDERS = ['gemini', 'openai'] as const
export type UserProviderId = (typeof USER_PROVIDERS)[number]

export const TUTOR_STYLES = [
  'friendly',
  'strict',
  'grammar',
  'pronunciation',
  'professional',
  'ielts',
  'casual',
] as const
export type TutorStyle = (typeof TUTOR_STYLES)[number]

export type ResponseLanguage = 'en' | 'vi' | 'mixed'
export type UiLanguage = 'en' | 'vi'
export type ThemeMode = 'dark' | 'light' | 'system'
export type LearningStyle = 'visual' | 'auditory' | 'reading' | 'kinesthetic' | 'mixed'
export type SelfLevel = 'beginner' | 'elementary' | 'intermediate' | 'upper' | 'advanced'

export interface Profile {
  displayName: string
  selfReportedLevel: SelfLevel
  overallCefr: Cefr | null
  targetCefr: Cefr
  targetIelts: number | null
  dailyMinutes: number
  purposes: string[]
  interests: string[]
  learningStyle: LearningStyle
  onboardingCompletedAt: string | null
  createdAt: string
}

export interface SkillLevel {
  skill: Skill
  cefr: Cefr
  score: number // 0..100 progress inside the level
  source: 'assessment' | 'progress' | 'self'
  estimated: boolean // true when produced by AI/heuristics rather than an objective test
  updatedAt: string
}

export interface LearningGoal {
  id: number
  kind: 'short' | 'long' | 'custom'
  title: string
  metric: 'minutes' | 'words' | 'lessons' | 'xp' | 'none'
  targetValue: number
  currentValue: number
  targetDate: string | null
  status: 'active' | 'done' | 'archived'
  createdAt: string
}

// ---------- Assessment ----------
export interface AssessmentItemView {
  id: string
  skill: 'vocabulary' | 'grammar' | 'reading' | 'listening'
  cefr: Cefr
  prompt: string
  passage?: string
  options: string[]
  index: number // position within skill
  total: number // max items for this skill
}

export interface SkillResult {
  skill: Skill
  cefr: Cefr
  score: number
  correct?: number
  answered?: number
  estimated: boolean
  method: 'adaptive-test' | 'ai' | 'heuristic' | 'skipped'
  note?: string
}

export interface AssessmentResult {
  id: number
  completedAt: string
  overall: Cefr
  skills: SkillResult[]
}

// ---------- Roadmap & plan ----------
export interface RoadmapMilestone {
  title: string
  week: number
  cefr?: Cefr
}

export interface RoadmapSummary {
  headline: string
  shortTermGoals: string[]
  longTermGoals: string[]
  prioritySkills: Skill[]
  milestones: RoadmapMilestone[]
  projection: {
    currentCefr: Cefr
    targetCefr: Cefr
    hoursNeeded: number
    estimatedWeeks: number
    note: string
  }
  dailyRoutine: { skill: Skill | 'cinema' | 'review'; minutes: number; activity: string }[]
  interestThemes: string[]
}

export interface RoadmapWeek {
  id: number
  weekIndex: number
  theme: string
  focusSkills: Skill[]
  objectives: string[]
  status: 'upcoming' | 'current' | 'done'
}

export interface Roadmap {
  id: number
  createdAt: string
  source: 'ai' | 'offline'
  provider: ProviderId | null
  summary: RoadmapSummary
  userNotes: string
  weeks: RoadmapWeek[]
  startDate: string
}

export interface PlanLesson {
  id: number
  date: string
  module: ModuleId
  title: string
  description: string
  contentRef: string | null
  estimatedMinutes: number
  status: 'todo' | 'done' | 'skipped'
  completedAt: string | null
}

// ---------- Vocabulary ----------
export interface ReviewInfo {
  state: 'new' | 'learning' | 'review' | 'relearning'
  dueAt: string
  stability: number
  difficulty: number
  reps: number
  lapses: number
  lastReviewAt: string | null
  retrievability: number
  scheduledDays: number
}

export interface VocabItem {
  id: number
  word: string
  ipa: string
  pos: string
  meaningVi: string
  meaningEn: string
  examples: string[]
  context: string
  sourceModule: ModuleId | 'manual' | 'dictionary'
  sourceRef: string
  collocations: string[]
  idioms: string[]
  phrasalVerbs: string[]
  cefr: Cefr | null
  topic: string
  notes: string
  isFavorite: boolean
  createdAt: string
  review: ReviewInfo
}

export interface ReviewPreview {
  1: string
  2: string
  3: string
  4: string
}

export interface DueCard extends VocabItem {
  preview: ReviewPreview
}

export interface VocabStats {
  total: number
  dueNow: number
  dueToday: number
  learning: number
  mature: number // stability >= 21 days
  difficult: number // lapses >= 2 or difficulty >= 7
  averageRetention: number
  reviewsToday: number
  forecast: { date: string; count: number }[]
}

export interface DictionaryResult {
  entry: GlossaryEntry & { collocations?: string[]; topic?: string }
  source: 'offline' | 'content' | 'ai'
  saved: boolean
}

// ---------- Gamification ----------
export interface StreakInfo {
  current: number
  longest: number
  activeToday: boolean
  restDayAvailable: boolean
  restDaysUsedRecently: string[]
}

export interface RegionProgress {
  key: RegionKey
  skill: Skill | 'all'
  xp: number
  stage: number // 0..5
  stageXp: number
  nextStageXp: number | null
  unlocked: boolean
}

export const REGION_KEYS = [
  'vocabulary-forest',
  'grammar-kingdom',
  'listening-ocean',
  'speaking-arena',
  'reading-library',
  'writing-academy',
  'mastery-challenge',
] as const
export type RegionKey = (typeof REGION_KEYS)[number]

export interface GameState {
  totalXp: number
  level: number
  levelTitle: string
  xpIntoLevel: number
  xpForNextLevel: number
  streak: StreakInfo
  totalActiveDays: number
  todayXp: number
  regions: RegionProgress[]
  unlockedAccents: string[]
}

export interface Quest {
  id: number
  period: 'daily' | 'weekly'
  periodKey: string
  key: string
  metric: QuestMetric
  title: string
  titleVi: string
  target: number
  progress: number
  xpReward: number
  completedAt: string | null
  route: string
}

export type QuestMetric =
  | 'words_saved'
  | 'reviews_done'
  | 'listening_done'
  | 'speaking_seconds'
  | 'reading_done'
  | 'writing_done'
  | 'grammar_done'
  | 'cinema_scenes'
  | 'tutor_messages'
  | 'minutes'
  | 'lessons_done'
  | 'active_days'
  | 'xp'

export interface Achievement {
  key: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  icon: string
  tier: 'bronze' | 'silver' | 'gold' | 'legend'
  progress: number // 0..1
  current: number
  target: number
  unlockedAt: string | null
}

export interface Reward {
  xpGained: number
  levelUp: number | null
  questsCompleted: Quest[]
  achievementsUnlocked: Achievement[]
}

export type ActivityType =
  | 'word_saved'
  | 'review_done'
  | 'lesson_completed'
  | 'listening_done'
  | 'speaking_done'
  | 'reading_done'
  | 'writing_submitted'
  | 'grammar_done'
  | 'cinema_scene'
  | 'story_completed'
  | 'tutor_message'
  | 'assessment_done'

// ---------- Skills modules ----------
export interface WritingFeedback {
  correctedText: string
  overallComment: string
  cefrEstimate: Cefr
  ieltsBandEstimate: number | null
  scores: {
    grammar: number
    spelling: number
    vocabulary: number
    sentenceStructure: number
    clarity: number
    coherence: number
    naturalness: number
    toneRegister: number
  } // 0..10
  errors: {
    original: string
    correction: string
    category: 'grammar' | 'spelling' | 'vocabulary' | 'punctuation' | 'structure' | 'register' | 'coherence'
    explanationVi: string
  }[]
  naturalAlternatives: { original: string; better: string; why: string }[]
  studyTopics: string[]
  newVocabulary: { word: string; meaningVi: string; example: string }[]
}

export interface WritingSubmission {
  id: number
  promptId: string | null
  taskType: string
  promptText: string
  originalText: string
  selfCorrectedText: string | null
  feedback: WritingFeedback | null
  metrics: TextMetrics
  provider: ProviderId | null
  createdAt: string
}

export interface TextMetrics {
  words: number
  sentences: number
  avgSentenceLength: number
  lexicalDiversity: number // type-token ratio 0..1
  longWordRatio: number
  linkingWords: number
  heuristicCefr: Cefr
}

export interface SpeakingMeasured {
  durationSec: number
  speakingSec: number
  wordsPerMinute: number | null
  pauseCount: number
  longestPauseSec: number
  wordAccuracy: number | null // vs target text, 0..1
  matchedWords: number | null
  missingWords: string[]
  extraWords: string[]
}

export interface SpeakingFeedback {
  pronunciation: { score: number; notes: string[] } // AI estimate from transcript/audio
  fluency: { score: number; notes: string[] }
  grammar: { score: number; corrections: { original: string; better: string; explanationVi: string }[] }
  vocabulary: { score: number; suggestions: string[] }
  naturalVersion: string
  encouragement: string
  cefrEstimate: Cefr
}

export interface SpeakingSession {
  id: number
  mode: string
  promptId: string | null
  prompt: string
  transcript: string
  measured: SpeakingMeasured
  feedback: SpeakingFeedback | null
  provider: ProviderId | null
  createdAt: string
}

export interface StoryProgress {
  storyId: string
  currentSceneId: string
  path: string[]
  choices: { sceneId: string; optionIndex: number; quality: 'great' | 'ok' | 'awkward' }[]
  quizCorrect: number
  quizTotal: number
  completedAt: string | null
  endingType: 'good' | 'neutral' | 'bad' | null
}

export interface StorySummaryView {
  id: string
  title: string
  genre: string
  cefr: Cefr
  synopsisEn: string
  synopsisVi: string
  source: 'builtin' | 'ai'
  sceneCount: number
  progress: StoryProgress | null
}

// ---------- Tutor ----------
export interface TutorConversation {
  id: number
  mode: TutorStyle
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface TutorMessage {
  id: number
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface LearnerMistake {
  id: number
  category: string
  pattern: string
  example: string
  correction: string
  count: number
  lastSeenAt: string
}

// ---------- Settings ----------
export interface AppSettings {
  uiLanguage: UiLanguage
  theme: ThemeMode
  accent: string
  notificationsEnabled: boolean
  reminderTime: string // HH:MM
  ttsEngine: 'system' | 'openai' | 'gemini'
  systemVoiceUri: string
  speechRate: number
  showVietnameseHints: boolean
  reduceMotion: boolean
  dailyGoalXp: number
}

export interface ProviderStatus {
  hasKey: boolean
  keyHint: string | null // e.g. "••••3xQz"
  model: string
}

export interface AiConfigView {
  defaultProvider: UserProviderId | null
  activeProvider: ProviderId | null
  providers: Record<UserProviderId, ProviderStatus>
  responseLanguage: ResponseLanguage
  tutorStyle: TutorStyle
  sttProvider: UserProviderId | 'auto'
  encryptionAvailable: boolean
  mockMode: boolean
}

export interface ModelInfo {
  id: string
  label: string
  supportsAudio?: boolean
}

export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  model: string
  message: string
  errorCode?: string
}

// ---------- Stats / search ----------
export interface DailyStat {
  date: string
  minutes: number
  xp: number
  wordsSaved: number
  reviews: number
  lessons: number
}

export interface StatsOverview {
  today: DailyStat
  last7: DailyStat[]
  last30: DailyStat[]
  totals: {
    xp: number
    minutes: number
    words: number
    reviews: number
    listening: number
    reading: number
    writing: number
    speakingMinutes: number
    cinemaScenes: number
    storiesCompleted: number
    activeDays: number
  }
  skillMinutes: Record<Skill, number>
  skillLevels: SkillLevel[]
  readingWpm: { date: string; wpm: number }[]
  listeningAccuracy: { date: string; accuracy: number }[]
  writingScores: { date: string; score: number }[]
}

export interface ActivityEntry {
  id: number
  module: string
  action: string
  title: string
  ref: string
  minutes: number
  xp: number
  createdAt: string
}

export interface SearchResult {
  kind:
    | 'reading'
    | 'listening'
    | 'story'
    | 'grammar'
    | 'vocab'
    | 'writing-prompt'
    | 'speaking-prompt'
    | 'page'
    | 'dictionary'
  id: string
  title: string
  subtitle: string
  route: string
}

export interface Favorite {
  id: number
  kind: string
  ref: string
  title: string
  createdAt: string
}

export interface Bookmark {
  id: number
  kind: string
  ref: string
  title: string
  note: string
  position: string
  createdAt: string
}

export interface BackupInfo {
  file: string
  name: string
  sizeBytes: number
  createdAt: string
}

export interface DiagnosticsInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  userDataPath: string
  dbPath: string
  dbSizeBytes: number
  schemaVersion: number
  tableCounts: Record<string, number>
  encryptionAvailable: boolean
  aiProviders: Record<UserProviderId, { hasKey: boolean; model: string }>
  logPath: string
  online: boolean | null
}
