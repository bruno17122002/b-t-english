import { LogOut, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Notice, Segmented, SectionTitle } from '../components/ui'
import { errorKey, useT } from '../i18n'
import { APP_VERSION, client, useApp, type Theme } from '../store'

export function Settings() {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const theme = useApp((s) => s.theme)
  const setLang = useApp((s) => s.setLang)
  const setTheme = useApp((s) => s.setTheme)
  const email = useApp((s) => s.email)
  const queue = useApp((s) => s.queue.length)
  const lastPullAt = useApp((s) => s.cache?.lastPullAt ?? null)
  const syncing = useApp((s) => s.syncing)
  const error = useApp((s) => s.error)
  const sync = useApp((s) => s.sync)
  const signOut = useApp((s) => s.signOut)
  const [leaving, setLeaving] = useState(false)

  const last = lastPullAt
    ? new Date(lastPullAt).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
    : t('settings.never')

  return (
    <div>
      <SectionTitle>{t('settings.language')}</SectionTitle>
      <Segmented
        value={lang}
        onChange={setLang}
        options={[
          { value: 'vi', label: 'Tiếng Việt' },
          { value: 'en', label: 'English' },
        ]}
      />

      <SectionTitle>{t('settings.theme')}</SectionTitle>
      <Segmented<Theme>
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'dark', label: t('settings.theme.dark') },
          { value: 'light', label: t('settings.theme.light') },
          { value: 'system', label: t('settings.theme.system') },
        ]}
      />

      <SectionTitle>{t('settings.account')}</SectionTitle>
      <Card className="space-y-3">
        <div>
          <div className="font-semibold break-all">{email}</div>
          <div className="text-xs break-all text-faint">
            {t('settings.server')}: {client.config()?.url}
          </div>
        </div>
        <div className="text-sm text-muted">
          <div>{t('settings.lastSync', { t: last })}</div>
          {queue > 0 && <div>{t('settings.pending', { n: queue })}</div>}
        </div>
        {error && <Notice tone="warning">{t(errorKey(error))}</Notice>}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            icon={<RefreshCw className="size-4" />}
            loading={syncing}
            onClick={() => void sync()}
          >
            {t('settings.syncNow')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            icon={<LogOut className="size-4" />}
            loading={leaving}
            onClick={() => {
              setLeaving(true)
              void signOut().finally(() => setLeaving(false))
            }}
          >
            {t('settings.signOut')}
          </Button>
        </div>
        <p className="text-xs text-faint">{t('settings.privacy')}</p>
      </Card>

      <p className="mt-4 px-1 text-xs text-faint">{t('settings.install')}</p>
      <p className="mt-1 px-1 text-xs text-faint">{t('settings.version', { v: APP_VERSION })}</p>
    </div>
  )
}
