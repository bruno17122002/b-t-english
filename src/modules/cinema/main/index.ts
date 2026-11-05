// Main-process side of the cinema module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'
import { CinemaService } from './service'

export const cinemaMain: ModuleMain = {
  id: 'cinema',
  register(router, kernel) {
    const service = new CinemaService(kernel)
    router.handle('cinema:list', () => service.list())
    router.handle('cinema:story', (input) => service.story(input.id))
    router.handle('cinema:start', (input) => service.start(input.id, input.restart))
    router.handle('cinema:advance', (input) => service.advance(input))
    router.handle('cinema:generate', (input) => service.generate(input))
    router.handle('cinema:deleteStory', (input) => service.deleteStory(input.id))
  },
}
