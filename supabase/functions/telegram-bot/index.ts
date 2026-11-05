// Edge Function "telegram-bot": Telegram webhook of the central Lingua Quest bot.
// Deploy with --no-verify-jwt (Telegram sends no Supabase JWT; requests are authenticated by the
// X-Telegram-Bot-Api-Secret-Token header = TELEGRAM_WEBHOOK_SECRET). All logic lives in ../_shared (unit-tested).
import { handleTelegramWebhook, readEnv } from '../_shared/handlers.ts'

const env = readEnv((key) => Deno.env.get(key))

Deno.serve((req) => handleTelegramWebhook(req, env, { log: (msg) => console.log(`[telegram-bot] ${msg}`) }))
