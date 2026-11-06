import { describe, expect, it } from 'vitest'
import { makeKernel } from '../helpers/kernel'

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('email code delivery errors from Supabase', () => {
  it('explains SMTP / template failures instead of a generic server error', async () => {
    const { kernel } = await makeKernel({
      fetchImpl: respond(500, { code: 500, error_code: 'unexpected_failure', msg: 'Error sending confirmation email' }),
    })
    kernel.cloud.configure('https://demo.supabase.co', 'sb_publishable_abcdefghijklmnopqrstuvwxyz')
    await expect(kernel.cloud.sendCode('learner@example.com')).rejects.toMatchObject({
      code: 'server',
      message: expect.stringContaining('SMTP'),
    })
  })

  it('explains addresses the default mailer refuses', async () => {
    const { kernel } = await makeKernel({ fetchImpl: respond(400, { msg: 'Email address not authorized' }) })
    kernel.cloud.configure('https://demo.supabase.co', 'sb_publishable_abcdefghijklmnopqrstuvwxyz')
    await expect(kernel.cloud.sendCode('learner@example.com')).rejects.toMatchObject({ code: 'forbidden' })
  })
})
