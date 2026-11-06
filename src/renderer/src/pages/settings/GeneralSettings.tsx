import { Bell, Lock, Moon, Palette, Volume2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ACCENT_UNLOCKS } from '@core/game'
import type { AppSettings } from '@shared/types'
import { Button, Card, cx, Field, Input, Select, Toggle } from '../../components/ui'
import { useL } from '../../i18n'
import { api, toApiError } from '../../lib/api'
import { speak, systemVoices } from '../../lib/audio'
import { useApp } from '../../lib/store'

const ACCENT_SWATCH: Record<string, string> = {
  aurora: '#0078d4',
  ember: '#ca5010',
  jade: '#107c10',
  royal: '#8764b8',
  sunset: '#c239b3',
}

function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function GeneralSettings() {
  const L = useL()
  const settings = useApp((s) => s.settings)
  const game = useApp((s) => s.game)
  const update = useApp((s) => s.updateSettings)
  const toast = useApp((s) => s.toast)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => systemVoices())

  useEffect(() => {
    const refresh = () => setVoices(systemVoices())
    speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => speechSynthesis.removeEventListener('voiceschanged', refresh)
  }, [])

  if (!settings) return null
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    void update({ [key]: value } as Partial<AppSettings>)
  const level = game?.level ?? 1

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Palette className="size-4 text-accent" />
          {L('Appearance & language', 'Giao diện & ngôn ngữ')}
        </h3>
        <Row title={L('Interface language', 'Ngôn ngữ giao diện')}>
          <Select
            value={settings.uiLanguage}
            onChange={(e) => set('uiLanguage', e.target.value as AppSettings['uiLanguage'])}
            className="w-44"
            aria-label={L('Interface language', 'Ngôn ngữ giao diện')}
          >
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </Select>
        </Row>
        <Row
          title={L('Theme', 'Chủ đề')}
          desc={
            <span className="flex items-center gap-1">
              <Moon className="size-3" />
              {L(
                'Dark is designed first; light is fully supported.',
                'Giao diện tối là mặc định; giao diện sáng được hỗ trợ đầy đủ.',
              )}
            </span>
          }
        >
          <Select
            value={settings.theme}
            onChange={(e) => set('theme', e.target.value as AppSettings['theme'])}
            className="w-44"
            aria-label={L('Theme', 'Chủ đề')}
          >
            <option value="dark">{L('Dark', 'Tối')}</option>
            <option value="light">{L('Light', 'Sáng')}</option>
            <option value="system">{L('Follow Windows', 'Theo Windows')}</option>
          </Select>
        </Row>
        <Row
          title={L('Accent colour', 'Màu nhấn')}
          desc={L('New colours unlock as you level up.', 'Màu mới được mở khóa khi bạn lên cấp.')}
        >
          <div className="flex gap-2">
            {ACCENT_UNLOCKS.map((a) => {
              const locked = level < a.level
              return (
                <button
                  key={a.key}
                  disabled={locked}
                  onClick={() => set('accent', a.key)}
                  title={locked ? L(`Unlocks at level ${a.level}`, `Mở khóa ở cấp ${a.level}`) : a.key}
                  aria-label={a.key}
                  className={cx(
                    'relative size-8 rounded-full ring-offset-2 ring-offset-surface transition',
                    settings.accent === a.key && 'ring-2 ring-text',
                    locked && 'opacity-30',
                  )}
                  style={{ background: ACCENT_SWATCH[a.key] }}
                >
                  {locked && <Lock className="absolute inset-0 m-auto size-3.5 text-white" />}
                </button>
              )
            })}
          </div>
        </Row>
        <Row
          title={L('Vietnamese hints', 'Gợi ý tiếng Việt')}
          desc={L(
            'Show translations and Vietnamese explanations where available.',
            'Hiện bản dịch và giải thích tiếng Việt khi có.',
          )}
        >
          <Toggle
            checked={settings.showVietnameseHints}
            onChange={(v) => set('showVietnameseHints', v)}
            label={L('Vietnamese hints', 'Gợi ý tiếng Việt')}
          />
        </Row>
        <Row title={L('Reduce motion', 'Giảm chuyển động')}>
          <Toggle
            checked={settings.reduceMotion}
            onChange={(v) => set('reduceMotion', v)}
            label={L('Reduce motion', 'Giảm chuyển động')}
          />
        </Row>
      </Card>

      <Card>
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Volume2 className="size-4 text-accent" />
          {L('Voice & audio', 'Giọng đọc & âm thanh')}
        </h3>
        <Row
          title={L('Voice engine', 'Bộ đọc')}
          desc={L(
            'Windows voices work offline. OpenAI / Gemini voices sound more natural and need an API key.',
            'Giọng Windows chạy offline. Giọng OpenAI / Gemini tự nhiên hơn và cần API key.',
          )}
        >
          <Select
            value={settings.ttsEngine}
            onChange={(e) => set('ttsEngine', e.target.value as AppSettings['ttsEngine'])}
            className="w-48"
            aria-label={L('Voice engine', 'Bộ đọc')}
          >
            <option value="system">{L('Windows voices (offline)', 'Giọng Windows (offline)')}</option>
            <option value="openai">OpenAI TTS</option>
            <option value="gemini">Gemini TTS</option>
          </Select>
        </Row>
        {settings.ttsEngine === 'system' && (
          <Row
            title={L('Preferred Windows voice', 'Giọng Windows ưu tiên')}
            desc={
              voices.length
                ? undefined
                : L(
                    'No English voices found. Install one in Windows Settings → Time & language → Speech.',
                    'Không thấy giọng tiếng Anh. Cài thêm trong Windows Settings → Time & language → Speech.',
                  )
            }
          >
            <Select
              value={settings.systemVoiceUri}
              onChange={(e) => set('systemVoiceUri', e.target.value)}
              className="w-64"
              aria-label={L('Preferred Windows voice', 'Giọng Windows ưu tiên')}
            >
              <option value="">{L('Automatic (fast offline voice)', 'Tự động (giọng offline, phát ngay)')}</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                  {v.localService ? '' : L(' – online, slower to start', ' – trực tuyến, phát chậm hơn')}
                </option>
              ))}
            </Select>
          </Row>
        )}
        <Row title={L('Speech speed', 'Tốc độ đọc')} desc={`${settings.speechRate.toFixed(2)}×`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={settings.speechRate}
              onChange={(e) => set('speechRate', Number(e.target.value))}
              aria-label={L('Speech speed', 'Tốc độ đọc')}
              className="w-40 accent-[var(--accent)]"
            />
            <Button size="sm" onClick={() => speak('Welcome to B&T English. Every day is a new adventure.')}>
              {L('Test', 'Thử')}
            </Button>
          </div>
        </Row>
      </Card>

      <Card>
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Bell className="size-4 text-accent" />
          {L('Reminders & goals', 'Nhắc nhở & mục tiêu')}
        </h3>
        <Row
          title={L('Daily reminder', 'Nhắc học hằng ngày')}
          desc={L(
            'A Windows notification if you have not studied yet that day.',
            'Thông báo Windows nếu hôm đó bạn chưa học.',
          )}
        >
          <Toggle
            checked={settings.notificationsEnabled}
            onChange={(v) => set('notificationsEnabled', v)}
            label={L('Daily reminder', 'Nhắc học hằng ngày')}
          />
        </Row>
        <Row title={L('Reminder time', 'Giờ nhắc')}>
          <div className="flex gap-2">
            <Input
              type="time"
              value={settings.reminderTime}
              onChange={(e) => e.target.value && set('reminderTime', e.target.value)}
              className="w-32"
              aria-label={L('Reminder time', 'Giờ nhắc')}
            />
            <Button
              size="sm"
              onClick={() =>
                api('app:testNotification').catch((err) => toast({ kind: 'error', title: toApiError(err).message }))
              }
            >
              {L('Test', 'Thử')}
            </Button>
          </div>
        </Row>
        <Row title={L('Daily XP goal', 'Mục tiêu XP mỗi ngày')}>
          <Field label="">
            <Select
              value={settings.dailyGoalXp}
              onChange={(e) => set('dailyGoalXp', Number(e.target.value))}
              className="w-32"
              aria-label={L('Daily XP goal', 'Mục tiêu XP mỗi ngày')}
            >
              {[30, 50, 80, 120, 200].map((n) => (
                <option key={n} value={n}>
                  {n} XP
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <Row
          title={L('Keep running when the window is closed', 'Chạy ngầm khi đóng cửa sổ')}
          desc={L(
            'B&T English stays in the system tray so reminders, reports and the Telegram bot keep working.',
            'B&T English nằm ở khay hệ thống để nhắc học, báo cáo và bot Telegram vẫn hoạt động.',
          )}
        >
          <Toggle
            checked={settings.runInBackground}
            onChange={(v) => set('runInBackground', v)}
            label={L('Keep running when the window is closed', 'Chạy ngầm khi đóng cửa sổ')}
          />
        </Row>
        <Row
          title={L('Start with Windows', 'Khởi động cùng Windows')}
          desc={L('Starts hidden in the tray when you sign in.', 'Tự chạy ẩn trong khay khi bạn đăng nhập Windows.')}
        >
          <Toggle
            checked={settings.launchAtLogin}
            onChange={(v) => set('launchAtLogin', v)}
            label={L('Start with Windows', 'Khởi động cùng Windows')}
          />
        </Row>
      </Card>
    </div>
  )
}
