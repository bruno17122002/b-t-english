// Main-process side of the listening module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'
import { ListeningService } from './service'

export const listeningMain: ModuleMain = {
  id: 'listening',
  register(router, kernel) {
    const service = new ListeningService(kernel)
    router.handle('listening:list', (input) => service.list(input ?? {}))
    router.handle('listening:get', ({ id }) => service.get(id))
    router.handle('listening:history', (input) => service.history(input ?? {}))
    router.handle('listening:submit', (input) => service.submit(input))
    router.handle('listening:generate', (input) => service.generate(input))
    router.handle('listening:deleteGenerated', ({ id }) => service.deleteGenerated(id))
    router.handle('listening:checkLine', (input) => service.checkLine(input))
    router.handle('listening:checkGaps', (input) => service.checkGaps(input))
  },
}
