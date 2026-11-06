// Level-aware language constraints injected into every learner-facing prompt, so AI output stays
// comprehensible (i+1) for the learner. Idea inspired by Babblr's per-level prompt templates
// (AGPL – ideas only, wording and rules written for B&T English).
import type { Cefr } from '@shared/content'
import type { ResponseLanguage, TutorStyle } from '@shared/types'

interface LevelRule {
  sentence: string
  vocabulary: string
  grammar: string
  correction: string
}

export const CEFR_RULES: Record<Cefr, LevelRule> = {
  A1: {
    sentence: 'Use very short sentences (5–8 words). One idea per sentence.',
    vocabulary: 'Use only the ~800 most common English words. Avoid idioms and phrasal verbs.',
    grammar: 'Present simple, present continuous, can, imperatives. No passive, no conditionals.',
    correction: 'Correct at most one important mistake per turn, gently, with the right sentence repeated back.',
  },
  A2: {
    sentence: 'Use short sentences (8–12 words), joined with and / but / because.',
    vocabulary: 'Use everyday words (~1,500 most common). Explain any less common word in brackets.',
    grammar: 'Past simple, going to, comparatives, simple modals. Avoid perfect tenses and passives.',
    correction: 'Correct the one or two mistakes that block meaning. Praise what was right first.',
  },
  B1: {
    sentence: 'Use clear sentences up to ~15 words; some complex sentences with when / if / that.',
    vocabulary: 'Common words plus topic vocabulary. Introduce at most 2 new useful words per answer.',
    grammar: 'Present perfect, first/second conditionals, simple passive, relative clauses.',
    correction: 'Correct repeated or important mistakes; explain the rule briefly.',
  },
  B2: {
    sentence: 'Natural sentences of varied length, including complex sentences.',
    vocabulary: 'Wider vocabulary, common collocations, some phrasal verbs and idioms (explain idioms).',
    grammar: 'All common structures including third conditional, passive forms, reported speech.',
    correction: 'Correct mistakes and suggest more natural or precise alternatives.',
  },
  C1: {
    sentence: 'Fluent, idiomatic sentences; vary rhythm and structure.',
    vocabulary: 'Precise and nuanced vocabulary, collocations, idiomatic expressions.',
    grammar: 'Advanced structures: inversion, cleft sentences, mixed conditionals.',
    correction: 'Focus on precision, register and style, not only errors.',
  },
  C2: {
    sentence: 'Native-like, natural English of any complexity.',
    vocabulary: 'Full range including low-frequency and idiomatic language.',
    grammar: 'Any structure.',
    correction: 'Point out subtle unnaturalness, register and stylistic choices.',
  },
}

export function cefrConstraintBlock(level: Cefr): string {
  const r = CEFR_RULES[level]
  return [
    `LEARNER LEVEL: CEFR ${level}. Every English sentence you write for the learner must respect these limits:`,
    `- Sentences: ${r.sentence}`,
    `- Vocabulary: ${r.vocabulary}`,
    `- Grammar: ${r.grammar}`,
    `- Corrections: ${r.correction}`,
  ].join('\n')
}

export function languageInstruction(lang: ResponseLanguage, level: Cefr): string {
  if (lang === 'en') return 'Write explanations in simple English.'
  if (lang === 'vi')
    return 'Write explanations and feedback in Vietnamese (tiếng Việt có dấu). Keep English examples in English.'
  const beginner = level === 'A1' || level === 'A2'
  return beginner
    ? 'Write explanations mainly in Vietnamese (tiếng Việt có dấu) with key English phrases; keep English examples in English.'
    : 'Write explanations in English, adding a short Vietnamese gloss (tiếng Việt có dấu) for difficult points.'
}

export const TUTOR_STYLE_RULES: Record<TutorStyle, string> = {
  friendly: 'You are a warm, encouraging tutor. Celebrate progress, keep the mood light, ask follow-up questions.',
  strict: 'You are a demanding but fair coach. Point out every meaningful mistake and ask the learner to retry.',
  grammar:
    'You are a grammar coach. After each learner message, explain the key grammar point with a mini-rule and example.',
  pronunciation:
    'You are a pronunciation coach. Highlight words Vietnamese speakers often mispronounce (final consonants, /θ/ /ð/, stress) with simple IPA and tips.',
  professional:
    'You are a business English coach. Use professional scenarios (emails, meetings, interviews) and formal register.',
  ielts: 'You are an IELTS examiner-coach. Use IELTS-style questions, mention band descriptors and strategies.',
  casual: 'You are a friendly native speaker chatting casually. Use natural everyday English and common expressions.',
}
