// Main-process side of the tutor module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'

export const tutorMain: ModuleMain = {
  id: 'tutor',
  register() {},
}
