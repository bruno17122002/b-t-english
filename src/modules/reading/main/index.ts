// Main-process side of the reading module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'
import { ReadingService } from './service'

export const readingMain: ModuleMain = {
  id: 'reading',
  register(router, kernel) {
    const service = new ReadingService(kernel)
    router.handle('reading:library', () => service.library())
    router.handle('reading:get', (input) => service.get(input.id))
    router.handle('reading:complete', (input) => service.complete(input))
    router.handle('reading:history', (input) => service.history(input ?? {}))
    router.handle('reading:savedWords', () => service.savedWords())
    router.handle('reading:highlights', (input) => service.highlights(input.passageId))
    router.handle('reading:addHighlight', (input) => service.addHighlight(input))
    router.handle('reading:updateHighlight', (input) => service.updateHighlight(input))
    router.handle('reading:deleteHighlight', (input) => service.deleteHighlight(input.id))
    router.handle('reading:generate', (input) => service.generate(input))
    router.handle('reading:deleteGenerated', (input) => service.deleteGenerated(input.id))
    router.handle('reading:explainSentence', (input) => service.explainSentence(input))
    router.handle('reading:retell', (input) => service.retell(input))
  },
}
