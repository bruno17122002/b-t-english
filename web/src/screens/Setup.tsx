import { useState } from 'react'
import { Button, Input, Notice } from '../components/ui'
import { errorKey, useT } from '../i18n'
import { CloudError } from '../lib/supabase'
import { client, useApp } from '../store'
import { AuthLayout } from './AuthLayout'

/** First run without VITE_CLOUD_URL / VITE_CLOUD_ANON_KEY: the server is entered once and kept in localStorage. */
export function Setup() {
  const t = useT()
  const afterAuth = useApp((s) => s.afterAuth)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    try {
      client.configure(url, key)
      setError(null)
      void afterAuth()
    } catch (e) {
      setError(e instanceof CloudError ? e.code : 'invalid_config')
    }
  }

  return (
    <AuthLayout title={t('setup.title')} desc={t('setup.desc')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Input
          label={t('setup.url')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://xxxx.supabase.co"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <Input
          label={t('setup.key')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="eyJhbGciOi…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        {error && <Notice tone="danger">{t(errorKey(error))}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={!url.trim() || !key.trim()}>
          {t('setup.save')}
        </Button>
      </form>
    </AuthLayout>
  )
}
