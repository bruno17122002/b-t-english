// Main-process side of the cinema module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'

export const cinemaMain: ModuleMain = {
  id: 'cinema',
  register() {},
}
