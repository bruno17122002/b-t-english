// Main-process side of the grammar module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'
import { GrammarService } from './service'

export const grammarMain: ModuleMain = {
  id: 'grammar',
  register(router, kernel) {
    const service = new GrammarService(kernel)
    router.handle('grammar:overview', () => service.overview())
    router.handle('grammar:topic', (input) => service.topic(input.id))
    router.handle('grammar:submit', (input) => service.submit(input))
    router.handle('grammar:generate', (input) => service.generate(input.topicId))
    router.handle('grammar:explain', (input) => service.explain(input))
  },
}
