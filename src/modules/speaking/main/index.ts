// Main-process side of the speaking module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'
import { SpeakingService } from './service'

export const speakingMain: ModuleMain = {
  id: 'speaking',
  register(router, kernel) {
    const service = new SpeakingService(kernel)
    router.handle('speaking:prompts', (input) => service.prompts(input ?? {}))
    router.handle('speaking:prompt', ({ id }) => service.prompt(id))
    router.handle('speaking:submit', (input) => service.submit(input))
    router.handle('speaking:feedback', ({ sessionId }) => service.feedback(sessionId))
    router.handle('speaking:history', (input) => service.history(input ?? {}))
    router.handle('speaking:roleplayTurn', (input) => service.roleplayTurn(input))
    router.handle('speaking:pronOverview', () => service.pronOverview())
    router.handle('speaking:pronLesson', ({ id }) => service.pronLesson(id))
    router.handle('speaking:pronEstimate', (input) => service.pronEstimate(input))
    router.handle('speaking:pronComplete', (input) => service.pronComplete(input))
  },
}
