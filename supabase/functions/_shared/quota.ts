// Per-user daily AI quota on the server's Gemini key (table ai_usage, one row per user and day). The day is the
// learner's local calendar day. The default limit is 100 requests/day (secret AI_DAILY_LIMIT overrides it).
import type { AiModel, GenerateInput } from './gemini.ts'
import { eq, type SupabaseRest } from './rest.ts'

export const DEFAULT_AI_DAILY_LIMIT = 100

export function parseLimit(raw: string | undefined | null): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_AI_DAILY_LIMIT
}

export class DailyLimitError extends Error {
  constructor(readonly limit: number) {
    super(`daily AI limit of ${limit} reached`)
    this.name = 'DailyLimitError'
  }
  get userMessage(): string {
    return `⏳ Hôm nay bạn đã dùng hết ${this.limit} lượt AI miễn phí. Hạn mức sẽ được làm mới lúc 0:00. Trong lúc chờ, bạn vẫn dùng được /today, /review, /habits.`
  }
}

export class AiQuota {
  constructor(
    private readonly rest: SupabaseRest,
    readonly limit: number = DEFAULT_AI_DAILY_LIMIT,
  ) {}

  async used(userId: string, day: string): Promise<number> {
    const rows = await this.rest
      .forUser(userId)
      .select<{ requests: number }>('ai_usage', [['day', eq(day)]], { select: 'requests' })
    return Number(rows[0]?.requests ?? 0)
  }

  /** Counts one request; throws DailyLimitError when the limit is already reached. */
  async consume(userId: string, day: string): Promise<number> {
    const used = await this.used(userId, day)
    if (used >= this.limit) throw new DailyLimitError(this.limit)
    await this.rest
      .forUser(userId)
      .insert('ai_usage', [{ day, requests: used + 1 }], { onConflict: 'user_id,day', resolution: 'merge' })
    return used + 1
  }

  /** Wraps a model so every call is counted against the user's quota first. */
  metered(ai: AiModel, userId: string, day: string): AiModel {
    return {
      generate: async (input: GenerateInput) => {
        await this.consume(userId, day)
        return ai.generate(input)
      },
    }
  }
}
