// Edge Function "scheduler": called by pg_cron every 5 minutes (supabase/migrations/0002_cron.sql) with the
// x-scheduler-secret header = SCHEDULER_SECRET. Sends morning briefs, evening reminders and reports via Telegram.
// Deploy with --no-verify-jwt. All logic lives in ../_shared (unit-tested).
import { handleScheduler, readEnv } from '../_shared/handlers.ts'

const env = readEnv((key) => Deno.env.get(key))

Deno.serve((req) => handleScheduler(req, env, { log: (msg) => console.log(`[scheduler] ${msg}`) }))
