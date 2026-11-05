// Contract every feature module implements on the main-process side.
import type { Migration } from '../main/db/migrations'
import type { IpcRouter } from '../main/ipc/router'
import type { Kernel } from '../main/kernel'

export interface ModuleMain {
  id: string
  /** Module-owned tables, applied after the kernel schema (namespaced by module id). */
  migrations?: Migration[]
  register(router: IpcRouter, kernel: Kernel): void
  /**
   * Background work (timers, schedulers) started only by the real app after bootstrap – never in tests.
   * Returns a stop function called on quit.
   */
  start?(kernel: Kernel): () => void
}
