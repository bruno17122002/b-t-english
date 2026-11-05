// Main-process side of the writing module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'
import { WritingService } from './service'

export const writingMain: ModuleMain = {
  id: 'writing',
  register(router, kernel) {
    const service = new WritingService(kernel)
    router.handle('writing:catalog', () => service.catalog())
    router.handle('writing:submit', (input) => service.submit(input))
    router.handle('writing:analyze', (input) => service.analyze(input.id))
    router.handle('writing:selfCorrect', (input) => service.selfCorrect(input))
    router.handle('writing:get', (input) => service.view(input.id))
    router.handle('writing:history', (input) => service.history(input ?? {}))
    router.handle('writing:delete', (input) => service.delete(input.id))
  },
}
