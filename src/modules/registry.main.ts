// Feature modules loaded by the main process. Adding a module = adding one line here.
import { cinemaMain } from './cinema/main'
import { coachMain } from './coach/main'
import { grammarMain } from './grammar/main'
import { journeyMain } from './journey/main'
import { listeningMain } from './listening/main'
import { readingMain } from './reading/main'
import { speakingMain } from './speaking/main'
import { tutorMain } from './tutor/main'
import type { ModuleMain } from './types.main'
import { writingMain } from './writing/main'

export const MODULES_MAIN: ModuleMain[] = [
  journeyMain,
  listeningMain,
  speakingMain,
  readingMain,
  writingMain,
  grammarMain,
  cinemaMain,
  tutorMain,
  coachMain,
]
