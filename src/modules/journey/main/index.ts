// Main-process side of the journey module: registers IPC handlers on the kernel router.
import type { Kernel } from '../../../main/kernel'
import type { IpcRouter } from '../../../main/ipc/router'
import type { ModuleMain } from '../../types.main'
import { AssessmentService } from './assessment'
import { CourseService } from './course'
import { PlanService } from './plan'
import { RoadmapService } from './roadmap'

export function createJourneyServices(kernel: Kernel) {
  const assessment = new AssessmentService(kernel)
  const roadmap = new RoadmapService(kernel)
  const plan = new PlanService(kernel, roadmap)
  const course = new CourseService(kernel)
  return { assessment, roadmap, plan, course }
}

export const journeyMain: ModuleMain = {
  id: 'journey',
  register(router: IpcRouter, kernel: Kernel) {
    const { assessment, roadmap, plan, course } = createJourneyServices(kernel)
    const changed = (what: string) => kernel.push('data-changed', { module: 'journey', what })

    // dashboard & plan
    router.handle('journey:dashboard', () => {
      const last = assessment.latest()
      return plan.dashboard(last ? { id: last.id, completedAt: last.completedAt, overall: last.overall } : null)
    })
    router.handle('journey:today', () => plan.todayPlan())
    router.handle('journey:planStatus', ({ id, status }) => plan.setStatus(id, status))

    // assessment
    router.handle('journey:assessmentStart', (input) => assessment.start(input?.resume ?? true))
    router.handle('journey:assessmentState', ({ id }) => assessment.session(id))
    router.handle('journey:assessmentAnswer', ({ id, itemId, choice }) => assessment.answer(id, itemId, choice))
    router.handle('journey:assessmentWriting', ({ id, text }) => assessment.writing(id, text))
    router.handle('journey:assessmentSpeaking', ({ id, transcript, durationSec }) =>
      assessment.speaking(id, transcript, durationSec),
    )
    router.handle('journey:assessmentFinish', ({ id }) => {
      const res = assessment.finish(id)
      changed('skills')
      return res
    })
    router.handle('journey:assessmentLatest', () => assessment.latest())
    router.handle('journey:assessmentHistory', () => assessment.history())
    router.handle('journey:placementSkip', () => {
      const res = assessment.skip()
      changed('skills')
      return res
    })

    // roadmap
    router.handle('journey:roadmap', () => roadmap.get())
    router.handle('journey:roadmapGenerate', (input) => roadmap.generate(input?.useAi ?? true))
    router.handle('journey:roadmapWeek', ({ weekId, status }) => roadmap.setWeekStatus(weekId, status))
    router.handle('journey:roadmapNotes', ({ notes }) => roadmap.setNotes(notes))

    // course
    router.handle('journey:course', () => course.overview())
    router.handle('journey:courseLesson', ({ id }) => course.lesson(id))
    router.handle('journey:courseComplete', ({ id, completed }) => course.complete(id, completed))
    router.handle('journey:courseSaveWords', ({ id }) => course.saveWords(id))
  },
}
