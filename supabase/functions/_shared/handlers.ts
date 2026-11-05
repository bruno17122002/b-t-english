// HTTP handlers of the three Edge Functions. The Deno entrypoints (supabase/functions/<name>/index.ts) only read
// Deno.env and call these with the incoming Request, so everything is testable under Vitest with a fake fetch.
import { ServerBot } from './bot.ts'
import { safeEqual } from './format.ts'
import { DEFAULT_GEMINI_MODEL, Gemini, type AiModel } from './gemini.ts'
import { AiQuota, parseLimit } from './quota.ts'
import { SupabaseRest, type FetchLike } from './rest.ts'
import { runScheduler } from './scheduler.ts'
import { TelegramBot, type TgUpdate } from './telegram.ts'
import { parseTutorRequest, TutorHttpError, tutorReply } from './tutor.ts'

export interface ServerEnv {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  telegramToken: string
  webhookSecret: string
  schedulerSecret: string
  geminiKey: string
  geminiModel: string
  aiDailyLimit: number
  botUsername: string | null
}

/** Reads the secrets (Supabase provides SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY itself). */
export function readEnv(get: (key: string) => string | undefined): ServerEnv {
  return {
    supabaseUrl: get('SUPABASE_URL') ?? '',
    serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    anonKey: get('SUPABASE_ANON_KEY') ?? '',
    telegramToken: get('TELEGRAM_BOT_TOKEN') ?? '',
    webhookSecret: get('TELEGRAM_WEBHOOK_SECRET') ?? '',
    schedulerSecret: get('SCHEDULER_SECRET') ?? '',
    geminiKey: get('GEMINI_API_KEY') ?? '',
    geminiModel: get('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL,
    aiDailyLimit: parseLimit(get('AI_DAILY_LIMIT')),
    botUsername: get('TELEGRAM_BOT_USERNAME') || null,
  }
}

export interface Services {
  rest: SupabaseRest
  tg: TelegramBot
  ai: AiModel | null
  quota: AiQuota
}

export function makeServices(env: ServerEnv, fetchImpl?: FetchLike, overrides: Partial<Services> = {}): Services {
  const rest = overrides.rest ?? new SupabaseRest(env.supabaseUrl, env.serviceRoleKey, fetchImpl)
  return {
    rest,
    tg: overrides.tg ?? new TelegramBot(env.telegramToken, fetchImpl),
    ai:
      overrides.ai !== undefined
        ? overrides.ai
        : env.geminiKey
          ? new Gemini(env.geminiKey, env.geminiModel, fetchImpl)
          : null,
    quota: overrides.quota ?? new AiQuota(rest, env.aiDailyLimit),
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })

export interface HandlerOptions {
  fetchImpl?: FetchLike
  services?: Partial<Services>
  now?: () => Date
  log?: (msg: string) => void
}

const missing = (env: ServerEnv, keys: (keyof ServerEnv)[]) => keys.filter((k) => !env[k])

// ---------- telegram-bot ----------
export async function handleTelegramWebhook(
  req: Request,
  env: ServerEnv,
  opts: HandlerOptions = {},
): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const notSet = missing(env, ['supabaseUrl', 'serviceRoleKey', 'telegramToken', 'webhookSecret'])
  if (notSet.length) return json({ error: 'not_configured', missing: notSet }, 500)
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', env.webhookSecret))
    return json({ error: 'unauthorized' }, 401)
  let update: TgUpdate
  try {
    update = (await req.json()) as TgUpdate
  } catch {
    return json({ ok: true, ignored: 'invalid json' })
  }
  const s = makeServices(env, opts.fetchImpl, opts.services)
  const bot = new ServerBot({ ...s, botUsername: env.botUsername, now: opts.now, log: opts.log })
  try {
    await bot.handleUpdate(update)
  } catch (err) {
    // Always 200: Telegram would otherwise retry the same update again and again.
    opts.log?.(`update ${update.update_id} failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300))
  }
  return json({ ok: true })
}

// ---------- scheduler ----------
export async function handleScheduler(req: Request, env: ServerEnv, opts: HandlerOptions = {}): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const notSet = missing(env, ['supabaseUrl', 'serviceRoleKey', 'telegramToken', 'schedulerSecret'])
  if (notSet.length) return json({ error: 'not_configured', missing: notSet }, 500)
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const given = req.headers.get('x-scheduler-secret') ?? bearer
  if (!safeEqual(given, env.schedulerSecret)) return json({ error: 'unauthorized' }, 401)
  const s = makeServices(env, opts.fetchImpl, opts.services)
  const res = await runScheduler({ ...s, now: opts.now, log: opts.log })
  const counts: Record<string, number> = {}
  for (const r of res.runs) counts[r.result] = (counts[r.result] ?? 0) + 1
  return json({ ok: true, users: res.users, ...counts })
}

// ---------- tutor (PWA) ----------
export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

export async function handleTutor(req: Request, env: ServerEnv, opts: HandlerOptions = {}): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, CORS_HEADERS)
  const notSet = missing(env, ['supabaseUrl', 'serviceRoleKey'])
  if (notSet.length) return json({ error: 'not_configured', missing: notSet }, 500, CORS_HEADERS)
  const s = makeServices(env, opts.fetchImpl, opts.services)
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const user = await s.rest.authUser(jwt, env.anonKey)
  if (!user) return json({ error: 'unauthorized', message: 'Bạn cần đăng nhập lại.' }, 401, CORS_HEADERS)
  try {
    const body = parseTutorRequest(await req.json().catch(() => null))
    return json(await tutorReply({ ...s, now: opts.now }, user.id, body), 200, CORS_HEADERS)
  } catch (err) {
    if (err instanceof TutorHttpError) return json({ error: err.code, message: err.message }, err.status, CORS_HEADERS)
    opts.log?.(`tutor failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300))
    return json({ error: 'internal', message: 'Lỗi máy chủ, bạn thử lại sau nhé.' }, 500, CORS_HEADERS)
  }
}
