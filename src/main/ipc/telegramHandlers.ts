// IPC handlers for the in-app Telegram bot (Settings → Telegram). The bot token goes in once and is never
// returned: status only carries a masked hint.
import type { Kernel } from '../kernel'
import { TelegramService } from '../kernel/telegram/service'
import { UserError, type IpcRouter } from './router'

export function registerTelegramHandlers(r: IpcRouter, k: Kernel): void {
  const service = (): TelegramService => {
    if (k.telegram instanceof TelegramService) return k.telegram
    throw new UserError('telegram_unavailable', 'Dịch vụ Telegram không khả dụng trong phiên này.')
  }

  r.handle('telegram:status', () => service().status())
  r.handle('telegram:setToken', async ({ token }) => {
    const s = service()
    try {
      return await s.setToken(token)
    } catch (err) {
      const e = s.errorMessage(err)
      throw new UserError(`telegram_${e.code}`, e.message)
    }
  })
  r.handle('telegram:removeToken', () => service().removeToken())
  r.handle('telegram:unlink', () => service().unlink())
  r.handle('telegram:test', () => service().sendTest())
  r.handle('telegram:updateSettings', (patch) => service().updateSettings(patch))

  // ---------- server mode (central bot on Supabase) ----------
  r.handle('telegram:serverStatus', () => service().server.status())
  r.handle('telegram:setMode', async ({ mode, serverBot }) => {
    const s = service()
    await s.setMode(mode, serverBot)
    return s.server.status()
  })
  r.handle('telegram:createLinkCode', () => service().server.createLinkCode())
  r.handle('telegram:unlinkServer', async () => {
    const s = service()
    await s.server.unlink()
    return s.server.status()
  })
  r.handle('telegram:pushSchedules', () => service().server.pushSchedules(true))
}
