import React from 'react'
import { NavLink } from 'react-router-dom'
import { Globe, Palette, Settings, Circle, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import logoUrl from '../../assets/icon.png'

export default function Sidebar() {
  const { t, i18n } = useTranslation()
  const { sites, themes, mysqlStatus, phpStatus, caddyRunning } = useStore()

  // Route to the locale-appropriate marketing site.
  function openWebsite() {
    const url = (i18n.language || '').toLowerCase().startsWith('zh')
      ? 'https://app.aumcreate.cn'
      : 'https://app.aumcreate.com'
    window.api.system.openExternal(url)
  }

  const NAV_ITEMS = [
    { to: '/sites', icon: Globe, label: t('nav.sites') },
    { to: '/integrations', icon: Package, label: t('nav.integrations') },
    { to: '/themes', icon: Palette, label: t('nav.themes') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ]

  const services = [
    {
      label: `${t('sidebar.mysql')}${mysqlStatus.status === 'running' ? ` :${mysqlStatus.port}` : ''}`,
      ok: mysqlStatus.status === 'running',
      loading: !['running', 'error', 'stopped'].includes(mysqlStatus.status),
    },
    {
      label: (phpStatus.running ?? []).length
        ? `${t('sidebar.php')} ${phpStatus.running.join(', ')}`
        : t('sidebar.php'),
      ok: (phpStatus.running ?? []).length > 0,
      loading: false,
    },
    {
      label: t('sidebar.webServer'),
      ok: caddyRunning,
      loading: false,
    },
  ]

  return (
    <aside className="w-56 shrink-0 flex flex-col border-r" style={{ background: '#f7f7f7', borderColor: 'var(--border)' }}>

      {/* Logo — opens the official website (locale-aware) */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={openWebsite}
          title={t('sidebar.visitWebsite')}
          className="flex items-center gap-2.5 w-full text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-black/5 transition-colors"
        >
          <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center">
            <img
              src={logoUrl}
              alt="WP Studio"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-xs" style={{ color: 'var(--primary)' }}>AUM</span>
            <span className="font-semibold text-xs" style={{ color: 'var(--text-on-bg)' }}>WP Studio</span>
          </div>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors group ${isActive ? 'active-nav' : 'inactive-nav'}`
            }
            style={({ isActive }) => isActive
              ? { background: 'rgba(232,80,26,0.1)', color: 'var(--primary)' }
              : { color: 'var(--text-muted)' }
            }
          >
            {({ isActive }) => (
              <>
                <div className="flex items-center gap-2.5">
                  <Icon size={16} />
                  <span className="font-medium">{label}</span>
                </div>
                {to === '/sites' && sites.length > 0 && <Badge active={isActive}>{sites.length}</Badge>}
                {to === '/themes' && themes.length > 0 && <Badge active={isActive}>{themes.length}</Badge>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Service status footer */}
      <div className="px-4 py-3 border-t space-y-1.5" style={{ borderColor: 'var(--border)' }}>
        {services.map(({ label, ok, loading }) => (
          <div key={label} className="flex items-center gap-2">
            <Circle
              size={7}
              className={
                loading ? 'text-amber-400 fill-amber-400 animate-pulse' :
                  ok ? 'text-emerald-500 fill-emerald-500' :
                    'fill-current'
              }
              style={!loading && !ok ? { color: '#cccccc' } : {}}
            />
            <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}

function Badge({ children, active }) {
  return (
    <span
      className="text-xs rounded-full px-1.5 py-0.5 font-mono"
      style={{
        background: active ? 'rgba(232,80,26,0.15)' : 'rgba(0,0,0,0.08)',
        color: active ? 'var(--primary)' : 'var(--text-muted)',
      }}
    >
      {children}
    </span>
  )
}