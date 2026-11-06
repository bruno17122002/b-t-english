// Settings hub: general preferences, AI providers, Telegram bot, online account (sync + cloud backup), data (backup/restore/import/export) and diagnostics.
import { Bot, Cloud, Database, Info, Send, SlidersHorizontal } from 'lucide-react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { PageHeader, cx } from '../../components/ui'
import { useL } from '../../i18n'
import { AboutSettings } from './AboutSettings'
import { AccountSettings } from './AccountSettings'
import { AiSettings } from './AiSettings'
import { DataSettings } from './DataSettings'
import { GeneralSettings } from './GeneralSettings'
import { TelegramSettings } from './TelegramSettings'

export function SettingsPage() {
  const L = useL()
  const tabs = [
    { to: '/settings/general', label: L('General', 'Chung'), icon: SlidersHorizontal },
    { to: '/settings/ai', label: L('AI providers', 'Nhà cung cấp AI'), icon: Bot },
    { to: '/settings/telegram', label: L('Telegram', 'Telegram'), icon: Send },
    { to: '/settings/account', label: L('Account & sync', 'Tài khoản'), icon: Cloud },
    { to: '/settings/data', label: L('Data & backup', 'Dữ liệu & sao lưu'), icon: Database },
    { to: '/settings/about', label: L('Diagnostics & about', 'Chẩn đoán & giới thiệu'), icon: Info },
  ]
  return (
    <div data-testid="page-settings">
      <PageHeader
        title={L('Settings', 'Cài đặt')}
        subtitle={L('Make B&T English yours.', 'Tùy chỉnh B&T English theo cách của bạn.')}
      />
      <div className="flex gap-8">
        <nav className="w-56 shrink-0 space-y-1" aria-label={L('Settings sections', 'Mục cài đặt')}>
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                )
              }
            >
              <t.icon className="size-4" />
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="ai" element={<AiSettings />} />
            <Route path="telegram" element={<TelegramSettings />} />
            <Route path="account" element={<AccountSettings />} />
            <Route path="data" element={<DataSettings />} />
            <Route path="about" element={<AboutSettings />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
