// Preload: exposes a minimal, allowlisted bridge. The renderer never gets ipcRenderer itself.
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@modules/contract'
import { PUSH_EVENTS, type LqBridge, type PushEvent } from '@shared/ipc'

const allowed = new Set<string>(CHANNELS)
const events = new Set<string>(PUSH_EVENTS)

const bridge: LqBridge = {
  invoke(channel, payload) {
    if (!allowed.has(channel)) {
      return Promise.resolve({ ok: false, error: { code: 'unknown_channel', message: `Channel ${channel} is not allowed` } })
    }
    return ipcRenderer.invoke('lq:invoke', channel, payload)
  },
  on(event: PushEvent, listener) {
    if (!events.has(event)) return () => undefined
    const handler = (_e: Electron.IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) listener(payload)
    }
    ipcRenderer.on('lq:push', handler)
    return () => ipcRenderer.removeListener('lq:push', handler)
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('lq', bridge)
