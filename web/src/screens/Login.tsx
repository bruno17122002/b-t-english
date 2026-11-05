import { useState } from 'react'
import { Button, Input, Notice } from '../components/ui'
import { errorKey, useT } from '../i18n'
import { CloudError } from '../lib/supabase'
import { client, kv, useApp } from '../store'
import { AuthLayout } from './AuthLayout'

const LAST_EMAIL = 'lq.lastEmail'

/** Email → 6-digit one-time code (same account as the desktop app). */
export function Login() {
  const t = useT()
  const afterAuth = useApp((s) => s.afterAuth)
  const sessionError = useApp((s) => s.error)
  const [email, setEmail] = useState(() => kv.get(LAST_EMAIL) ?? '')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof CloudError ? e.code : 'network')
    } finally {
      setBusy(false)
    }
  }

  const send = () =>
    run(async () => {
      await client.sendCode(email)
      kv.set(LAST_EMAIL, email.trim().toLowerCase())
      setCode('')
      setStep('code')
    })

  const verify = () =>
    run(async () => {
      await client.verifyCode(email, code)
      await afterAuth()
    })

  return (
    <AuthLayout title={t('login.title')} desc={t('login.desc')}>
      {sessionError === 'not_signed_in' && !error && (
        <div className="mb-4">
          <Notice tone="warning">{t('err.not_signed_in')}</Notice>
        </div>
      )}
      {step === 'email' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <Input
            label={t('login.email')}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@example.com"
            required
          />
          {error && <Notice tone="danger">{t(errorKey(error))}</Notice>}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!email.trim()}>
            {t('login.send')}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          <Notice>{t('login.sent', { email: email.trim().toLowerCase() })}</Notice>
          <Input
            label={t('login.code')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="text-center font-mono text-2xl tracking-[0.5em]"
            autoFocus
            required
          />
          {error && <Notice tone="danger">{t(errorKey(error))}</Notice>}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.length !== 6}>
            {t('login.verify')}
          </Button>
          <div className="flex justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep('email')}>
              {t('login.change')}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void send()}>
              {t('login.resend')}
            </Button>
          </div>
        </form>
      )}
      <div className="mt-5 border-t border-line pt-3 text-xs break-all text-faint">
        {t('login.server', { url: client.config()?.url ?? '' })}
        {!client.hasBuiltInConfig() && (
          <button
            className="ml-2 text-accent"
            onClick={() => {
              client.clearConfig()
              void afterAuth()
            }}
          >
            {t('login.changeServer')}
          </button>
        )}
      </div>
    </AuthLayout>
  )
}
