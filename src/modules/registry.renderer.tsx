// Feature modules loaded by the renderer. Adding a module = adding one line here.
import { cinemaRenderer } from './cinema/renderer'
import { coachRenderer } from './coach/renderer'
import { gameRenderer } from './game/renderer'
import { grammarRenderer } from './grammar/renderer'
import { journeyRenderer } from './journey/renderer'
import { listeningRenderer } from './listening/renderer'
import { readingRenderer } from './reading/renderer'
import { speakingRenderer } from './speaking/renderer'
import { tutorRenderer } from './tutor/renderer'
import type { ModuleRenderer } from './types.renderer'
import { vocabularyRenderer } from './vocabulary/renderer'
import { writingRenderer } from './writing/renderer'

export const MODULES_RENDERER: ModuleRenderer[] = [
  journeyRenderer,
  listeningRenderer,
  speakingRenderer,
  readingRenderer,
  writingRenderer,
  grammarRenderer,
  vocabularyRenderer,
  cinemaRenderer,
  tutorRenderer,
  gameRenderer,
  coachRenderer,
]
