// Main-process side of the coach module: IPC handlers, Telegram commands and the minute scheduler.
import type { Kernel } from '../../../main/kernel'
import type { IpcRouter } from '../../../main/ipc/router'
import type { ModuleMain } from '../../types.main'
import { COACH_MIGRATIONS } from './migrations'
import { CoachService } from './service'
import { registerCoachTelegram } from './telegram'

const services = new WeakMap<Kernel, CoachService>()

/** One CoachService per kernel, shared by the IPC handlers, Telegram commands and the scheduler. */
export function coachServicesFor(kernel: Kernel): CoachService {
  let svc = services.get(kernel)
  if (!svc) {
    svc = new CoachService(kernel)
    services.set(kernel, svc)
  }
  return svc
}

export const coachMain: ModuleMain = {
  id: 'coach',
  migrations: COACH_MIGRATIONS,
  register(router: IpcRouter, kernel: Kernel) {
    const svc = coachServicesFor(kernel)
    router.handle('coach:track', (input) => svc.habits.track(input))
    router.handle('coach:overview', ({ period, offset }) => svc.overview(period, offset))
    router.handle('coach:reports', (input) => svc.reports(input?.period, input?.limit))
    router.handle('coach:report', ({ id }) => svc.report(id))
    router.handle('coach:generateReport', ({ period, offset, useAi }) => svc.generateReport(period, offset, useAi))
    router.handle('coach:askHabits', ({ question, period }) => svc.ask(question, period))
    router.handle('coach:qaHistory', () => svc.qaHistory())
    router.handle('coach:schedules', () => svc.scheduleState())
    router.handle('coach:updateSchedules', (patch) => svc.updateSchedules(patch))
    router.handle('coach:sendTest', ({ channel }) => svc.sendTest(channel))
    router.handle('coach:applyPlan', ({ reportId }) => svc.applyPlan(reportId))
    registerCoachTelegram(kernel, svc)
  },
  start(kernel: Kernel) {
    const svc = coachServicesFor(kernel)
    const tick = () => {
      svc.tick().catch((err: unknown) => kernel.log.error(`coach scheduler tick failed: ${String(err)}`))
    }
    const first = setTimeout(tick, 20_000)
    const timer = setInterval(tick, 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  },
}
