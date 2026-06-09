import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2, Database, Globe, Cpu } from 'lucide-react'
import { useStore } from './store'
import Sidebar from './components/layout/Sidebar'
import TitleBar from './components/layout/TitleBar'
import SitesPage from './pages/SitesPage'
import ThemesPage from './pages/ThemesPage'
import SettingsPage from './pages/SettingsPage'
import IntegrationsPage from './pages/IntegrationsPage'
import UpdateBanner from './components/UpdateBanner'

export default function App() {
  const {
    fetchSites, fetchThemes, fetchHerdStatus, fetchWorkspaceDir, fetchIntegrations,
    mysqlStatus, setMysqlStatus, setPhpStatus, setCaddyRunning, applyIntegrationProgress,
  } = useStore()

  const [serviceMessages, setServiceMessages] = useState({
    mysql: 'Starting MySQL...',
    php: 'Waiting...',
    caddy: 'Waiting...',
  })
  const [allReady, setAllReady] = useState(false)

  useEffect(() => {
    fetchSites()
    fetchThemes()
    fetchHerdStatus()
    fetchWorkspaceDir()
    fetchIntegrations()
    useStore.getState().fetchAppVersion()

    // Push update lifecycle events into the store (drives UpdateBanner + Settings)
    window.api.on('update:status', (data) => {
      useStore.getState().setUpdateStatus(data)
    })

    window.api.on('mysql:progress', (data) => {
      setMysqlStatus(data)
      setServiceMessages(m => ({ ...m, mysql: data.message }))
    })
    window.api.on('mysql:ready', (data) => {
      setMysqlStatus(data)
      setServiceMessages(m => ({ ...m, mysql: `MySQL ready on :${data.port}` }))
    })
    window.api.on('mysql:error', (data) => {
      setMysqlStatus({ status: 'error', message: data.message, port: 0 })
      setServiceMessages(m => ({ ...m, mysql: `MySQL error: ${data.message}` }))
    })

    window.api.system.getServicesStatus().then(res => {
      if (res.ok) {
        setMysqlStatus(res.data.mysql)
        setPhpStatus(res.data.php)
        setCaddyRunning(res.data.caddy.running)
        if (res.data.mysql.status === 'running' || res.data.mysql.status === 'error') {
          setAllReady(true)
          fetchIntegrations()
          fetchSites()
        }
      }
    })

    window.api.on('services:progress', (data) => {
      const { service, message, status } = data
      setServiceMessages(m => ({ ...m, [service]: message }))
      if (service === 'php') setPhpStatus(prev => ({ ...prev, status }))
      if (service === 'caddy' && status === 'running') setCaddyRunning(true)
    })

    window.api.on('services:ready', (data) => {
      setMysqlStatus(data.mysql)
      setPhpStatus(data.php)
      setCaddyRunning(data.caddy.running)
      setAllReady(true)
      // Refresh integration statuses once services are ready
      fetchIntegrations()
    })

    // Forward integration progress events into the store so IntegrationsPage updates live
    window.api.on('integration:progress', (data) => {
      applyIntegrationProgress(data)
    })

    window.api.on('site:healthChanged', (data) => {
      useStore.getState().updateSiteHealth(data.siteId, data.reachable)
    })

    // Emitted by siteHandlers after sites:start completes — keeps the sidebar
    // PHP indicator in sync without requiring a full page reload.
    window.api.on('services:phpStatus', (data) => {
      useStore.getState().setPhpStatus(data)
    })

    window.api.on('service:crashed', (data) => {
      useStore.getState().fetchServicesStatus()
      if (data.service === 'php') {
        useStore.getState().fetchIntegrations()
      }
    })
  }, [])

  const mysqlReady = mysqlStatus.status === 'running' || mysqlStatus.status === 'error'
  // Always unblock once MySQL is up — PHP/Caddy errors are non-fatal for the UI
  const isBlocking = !mysqlReady

  return (
    <div className="flex flex-col h-screen bg-surface-0 text-ink">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto relative">
          <Routes>
            <Route path="/" element={<Navigate to="/sites" replace />} />
            <Route path="/sites" element={<SitesPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/themes" element={<ThemesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>

          {isBlocking && (
            <div className="absolute inset-0 backdrop-blur-sm flex items-center justify-center z-50" style={{ background: 'rgba(255,255,255,0.92)' }}>
              <StartupOverlay messages={serviceMessages} mysqlStatus={mysqlStatus} />
            </div>
          )}

          <UpdateBanner />
        </main>
      </div>
    </div>
  )
}

function StartupOverlay({ messages, mysqlStatus }) {
  const isDownloading = mysqlStatus.status === 'downloading'

  const steps = [
    { key: 'mysql', icon: Database, label: 'MySQL', message: messages.mysql },
    { key: 'php', icon: Cpu, label: 'PHP', message: messages.php },
    { key: 'caddy', icon: Globe, label: 'Web Server', message: messages.caddy },
  ]

  return (
    <div className="flex flex-col items-center gap-6 max-w-xs w-full text-center">
      <div>
        <div className="w-12 h-12 rounded-2xl bg-brand-600/20 flex items-center justify-center mx-auto mb-3">
          <Loader2 size={22} className="text-brand-400 animate-spin" />
        </div>
        <p className="text-sm font-medium text-ink">Starting WP Studio</p>
        <p className="text-xs text-ink-muted mt-1">Setting up bundled services…</p>
      </div>

      <div className="w-full space-y-2">
        {steps.map(({ key, icon: Icon, label, message }) => (
          <div key={key} className="flex items-center gap-3 bg-ink-4 rounded-lg px-3 py-2.5 text-left">
            <Icon size={14} className="text-ink-muted shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-secondary">{label}</p>
              <p className="text-xs text-ink-faint truncate">{message}</p>
            </div>
          </div>
        ))}
      </div>

      {isDownloading && typeof mysqlStatus.percent === 'number' && (
        <div className="w-full bg-ink-10 rounded-full h-1 overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-300"
            style={{ width: `${mysqlStatus.percent}%` }}
          />
        </div>
      )}

      <p className="text-xs text-ink-ghost leading-relaxed">
        First launch downloads MariaDB (~70 MB) and PHP (~30 MB).
        Subsequent starts take only a few seconds.
      </p>
    </div>
  )
}