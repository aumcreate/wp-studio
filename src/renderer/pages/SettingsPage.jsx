import React from 'react'
import { Circle, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
]

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { workspaceDir, mysqlStatus, phpStatus, caddyRunning, appVersion } = useStore()

  return (
    <div className="p-8 overflow-y-auto h-full">
      <h1 className="text-xl font-semibold text-ink mb-6">{t('settings.title')}</h1>

      {/* Language */}
      <Section title={t('settings.language')}>
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm text-ink-secondary">{t('settings.languageLabel')}</p>
            <p className="text-xs text-ink-faint mt-0.5">{t('settings.languageNote')}</p>
          </div>
          <div className="flex items-center gap-2">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => i18n.changeLanguage(lang.code)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border
                  ${i18n.language === lang.code
                    ? 'bg-brand-600/15 border-brand-500/40 text-brand-500'
                    : 'bg-surface-200 border-ink-8 text-ink-muted hover:text-ink hover:border-ink-15'
                  }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Workspace */}
      <Section title={t('settings.workspace')}>
        <InfoRow label={t('settings.rootDirectory')}>
          <span className="font-mono text-sm text-ink-secondary">{workspaceDir || '—'}</span>
        </InfoRow>
        <InfoRow label={t('settings.sharedThemes')}>
          <span className="font-mono text-sm text-ink-secondary">{workspaceDir}/shared-themes</span>
        </InfoRow>
        <InfoRow label={t('settings.sites')}>
          <span className="font-mono text-sm text-ink-secondary">{workspaceDir}/sites</span>
        </InfoRow>
      </Section>

      {/* Bundled Services */}
      <Section title={t('settings.bundledServices')}>
        <ServiceRow
          label={t('settings.mysql')}
          status={mysqlStatus.status}
          detail={mysqlStatus.status === 'running' ? `127.0.0.1:${mysqlStatus.port}` : mysqlStatus.message}
        />
        <ServiceRow
          label={t('settings.phpFastcgi')}
          status={(phpStatus.running ?? []).length > 0 ? 'running' : 'stopped'}
          detail={
            (phpStatus.running ?? []).length > 0
              ? t('settings.phpRunning', { versions: (phpStatus.running ?? []).join(', ') })
              : t('settings.phpNoActive')
          }
        />
        <ServiceRow
          label={t('settings.caddyServer')}
          status={caddyRunning ? 'running' : 'stopped'}
          detail={caddyRunning ? t('settings.caddyServing') : t('settings.caddyNotRunning')}
        />
        <div className="px-4 pb-3 pt-1">
          <p className="text-xs text-ink-faint leading-relaxed">{t('settings.servicesNote')}</p>
        </div>
      </Section>

      {/* How Shared Themes Work */}
      <Section title={t('settings.sharedThemesSection')}>
        <div className="px-4 py-3 text-sm text-ink-muted space-y-2 leading-relaxed">
          <p>
            {t('settings.sharedThemesDesc1')
              .split('<mono>')
              .flatMap((part, i) => {
                if (i === 0) return [part]
                const [code, rest] = part.split('</mono>')
                return [<span key={i} className="font-mono text-ink-secondary">{code}</span>, rest]
              })}
          </p>
          <p>{t('settings.sharedThemesDesc2')}</p>
        </div>
      </Section>

      {/* About */}
      <Section title={t('settings.about')}>
        <InfoRow label={t('settings.version')}>
          <span className="text-sm text-ink-muted">{appVersion || '—'}</span>
        </InfoRow>
        <UpdateRow />
        <InfoRow label={t('settings.stack')}>
          <span className="text-sm text-ink-muted">Electron · React · MariaDB · PHP · Caddy</span>
        </InfoRow>
      </Section>
    </div>
  )
}

// Manual update check row in the About section.
function UpdateRow() {
  const { t } = useTranslation()
  const { updateStatus } = useStore()
  const state = updateStatus.state
  const checking = state === 'checking'

  // Map the update lifecycle to a short status line.
  let statusText = ''
  if (state === 'checking') statusText = t('update.statusChecking')
  else if (state === 'none') statusText = t('update.statusNone')
  else if (state === 'available') statusText = t('update.statusAvailable', { version: updateStatus.version })
  else if (state === 'downloading') statusText = t('update.statusDownloading', { percent: updateStatus.percent ?? 0 })
  else if (state === 'downloaded') statusText = t('update.statusDownloaded')
  else if (state === 'error') statusText = t('update.statusError')
  else if (state === 'dev') statusText = t('update.statusDev')

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm text-ink-secondary">{t('update.checkLabel')}</p>
        {statusText && <p className="text-xs text-ink-faint mt-0.5">{statusText}</p>}
      </div>
      <button
        onClick={() => window.api.updates.check()}
        disabled={checking}
        className="flex items-center gap-1.5 bg-ink-5 hover:bg-ink-10 disabled:opacity-50 text-ink-secondary text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
      >
        <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
        {t('update.checkBtn')}
      </button>
    </div>
  )
}

function ServiceRow({ label, status, detail }) {
  const isRunning = status === 'running'
  const isLoading = !['running', 'error', 'stopped'].includes(status)
  const isError = status === 'error'

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2.5">
        <Circle
          size={8}
          className={
            isLoading ? 'text-amber-400 fill-amber-400 animate-pulse' :
              isRunning ? 'text-emerald-400 fill-emerald-400' :
                isError ? 'text-red-400 fill-red-400' :
                  'text-ink-ghost fill-ink-ghost'
          }
        />
        <span className="text-sm text-ink-secondary">{label}</span>
      </div>
      <span className={`text-xs ${isRunning ? 'text-emerald-400/70' : isError ? 'text-red-400/70' : 'text-ink-faint'}`}>
        {isLoading ? <Loader2 size={12} className="animate-spin" /> : detail}
      </span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-widest mb-3">{title}</h2>
      <div className="bg-surface-100 border border-ink-5 rounded-xl overflow-hidden divide-y divide-ink-5">
        {children}
      </div>
    </div>
  )
}

function InfoRow({ label, children }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <div>{children}</div>
    </div>
  )
}