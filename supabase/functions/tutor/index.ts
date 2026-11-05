// Edge Function "tutor": AI tutor for the PWA. POST {message, history?} with the user's access token
// (Authorization: Bearer <jwt>, verified with /auth/v1/user) → {reply, corrections[], newWords[], usage}.
// Uses the server Gemini key with the per-user daily quota. All logic lives in ../_shared (unit-tested).
import { handleTutor, readEnv } from '../_shared/handlers.ts'

const env = readEnv((key) => Deno.env.get(key))

Deno.serve((req) => handleTutor(req, env, { log: (msg) => console.log(`[tutor] ${msg}`) }))
