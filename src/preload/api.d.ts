import type { LqBridge } from '@shared/ipc'

declare global {
  interface Window {
    lq: LqBridge
  }
}

export {}
