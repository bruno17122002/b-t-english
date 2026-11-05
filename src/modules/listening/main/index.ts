// Main-process side of the listening module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'

export const listeningMain: ModuleMain = {
  id: 'listening',
  register() {},
}
