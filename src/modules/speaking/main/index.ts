// Main-process side of the speaking module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'

export const speakingMain: ModuleMain = {
  id: 'speaking',
  register() {},
}
