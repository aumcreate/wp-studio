import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Database, Cpu, Download, Trash2, CheckCircle2,
  AlertCircle, Loader2, RefreshCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

function statusColor(status) {
  switch (status) {
    case 'installed':
    case 'running':    return 'text-emerald-400'
    case 'starting':
    case 'downloading':
    case 'installing': return 'text-amber-400'
    case 'error':      return 'text-red-400'
    default:           return 'text-ink-faint'
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function StatusDot({ status }) {
  const base = 'w-2 h-2 rounded-full shrink-0'
  if (status === 'installed' || status === 'running')
    return <span className={`${base} bg-emerald-400`} />
  if (status === 'downloading' || status === 'installing')
    return <span className={`${base} bg-amber-400 animate-pulse`} />
  if (status === 'error')
    return <span className={`${base} bg-red-400`} />
  return <span className={`${base} bg-ink-15`} />
}

function ProgressBar({ percent }) {
  return (
    <div className="w-full bg-ink-8 rounded-full h-1 overflow-hidden mt-2">
      <div
        className="h-full bg-brand-500 rounded-full transition-all duration-300"
        style={{ width: `${Math.max(2, percent ?? 0)}%` }}
      />
    </div>
  )
}

function IndeterminateBar() {
  return (
    <div className="w-full bg-ink-8 rounded-full h-1 overflow-hidden mt-2">
      <div className="h-full bg-brand-500 rounded-full animate-[indeterminate_1.4s_ease-in-out_infinite]" />
    </div>
  )
}

function DownloadProgress({ status, message, percent, downloadedBytes, speedBps }) {
  const isKnownSize   = typeof percent === 'number' && percent >= 0 && percent <= 100
  const isDownloading = status === 'downloading'
  const isInstalling  = status === 'installing'
  if (!isDownloading && !isInstalling) return null

  return (
    <div className="mt-1.5">
      {isKnownSize ? (
        <>
          <div className="flex justify-between items-center">
            <p className="text-xs text-amber-400/70 truncate">{message}</p>
            <span className="text-xs text-ink-faint ml-2 shrink-0">{percent}%</span>
          </div>
          <ProgressBar percent={percent} />
        </>
      ) : (
        <>
          <div className="flex justify-between items-center">
            <p className="text-xs text-amber-400/70 truncate">{message}</p>
            <div className="flex items-center gap-2 ml-2 shrink-0">
              {downloadedBytes != null && <span className="text-xs text-ink-muted">{formatBytes(downloadedBytes)}</span>}
              {speedBps != null && speedBps > 0 && <span className="text-xs text-ink-faint">{formatBytes(speedBps)}/s</span>}
            </div>
          </div>
          <IndeterminateBar />
        </>
      )}
    </div>
  )
}

function MariaDbCard({ mariadb, onInstall }) {
  const { t } = useTranslation()
  const isBusy      = mariadb?.status === 'downloading' || mariadb?.status === 'installing'
  const isInstalled = mariadb?.installed || ['installed', 'running', 'starting'].includes(mariadb?.status)
  const isError     = mariadb?.status === 'error'
  const showProgress = isBusy && typeof mariadb?.percent === 'number'

  return (
    <div className="bg-surface-100 border border-ink-8 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/12 flex items-center justify-center shrink-0 mt-0.5">
            <Database size={17} className="text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-ink">MariaDB 10.11 LTS</p>
              <StatusDot status={mariadb?.status} />
            </div>
            <p className="text-xs text-ink-faint mt-0.5">{t('integrations.mariadbDesc')}</p>
          </div>
        </div>

        {!isInstalled && !isBusy && (
          <button onClick={onInstall} className="flex items-center gap-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-ink px-3 py-1.5 rounded-lg transition-colors shrink-0">
            <Download size={13} />
            {t('common.install')}
          </button>
        )}
        {isInstalled && !isBusy && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
            <CheckCircle2 size={14} />
            {t('common.ready')}
          </span>
        )}
        {isBusy && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400 shrink-0">
            <Loader2 size={13} className="animate-spin" />
            {mariadb?.status === 'downloading' ? t('integrations.downloading') : t('integrations.installing')}
          </span>
        )}
      </div>

      {showProgress && <ProgressBar percent={mariadb.percent} />}

      {mariadb?.message && (
        <p className={`text-xs mt-2 ${isError ? 'text-red-400' : 'text-ink-faint'}`}>
          {isError && <AlertCircle size={12} className="inline mr-1 mb-0.5" />}
          {mariadb.message}
          {isError && (
            <button onClick={onInstall} className="ml-2 underline text-ink-muted hover:text-ink">
              {t('common.retry')}
            </button>
          )}
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-ink-5">
        <p className="text-xs text-ink-ghost">{t('integrations.mariadbFixed')}</p>
      </div>
    </div>
  )
}

function PhpVersionRow({ info, onInstall, onRemove }) {
  const { t } = useTranslation()
  const { version, label, eol, recommended, status, message, percent, running } = info

  const isBusy      = status === 'downloading' || status === 'installing'
  const isInstalled = status === 'installed' || running
  const isError     = status === 'error'

  const prevBytesRef = useRef(null)
  const prevTimeRef  = useRef(null)
  const [downloadedBytes, setDownloadedBytes] = useState(null)
  const [speedBps, setSpeedBps]               = useState(null)

  useEffect(() => {
    if (!isBusy) {
      setDownloadedBytes(null); setSpeedBps(null)
      prevBytesRef.current = null; prevTimeRef.current = null
      return
    }
    const mbMatch = message?.match(/([\d.]+)\s*MB/)
    if (mbMatch) {
      const bytes = parseFloat(mbMatch[1]) * 1024 * 1024
      const now   = Date.now()
      if (prevBytesRef.current != null && prevTimeRef.current != null) {
        const dt = (now - prevTimeRef.current) / 1000
        if (dt > 0) setSpeedBps(Math.round((bytes - prevBytesRef.current) / dt))
      }
      prevBytesRef.current = bytes
      prevTimeRef.current  = now
      setDownloadedBytes(bytes)
    }
  }, [message, isBusy])

  const badgeClass = recommended
    ? 'bg-brand-600/20 text-brand-400'
    : eol ? 'bg-red-500/10 text-red-400' : 'bg-ink-6 text-ink-faint'

  const badgeLabel = recommended
    ? t('integrations.status.recommended')
    : eol ? t('integrations.status.endOfLife') : null

  const statusLabel = (s) => {
    const map = {
      installed:   t('integrations.status.installed'),
      running:     t('integrations.status.running'),
      starting:    t('integrations.status.starting'),
      downloading: t('integrations.status.downloading'),
      installing:  t('integrations.status.installing'),
      error:       t('integrations.status.error'),
    }
    return map[s] || t('integrations.status.notInstalled')
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <StatusDot status={status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink font-mono">{label || `PHP ${version}`}</span>
            {badgeLabel && <span className={`text-xs px-1.5 py-0.5 rounded-full ${badgeClass}`}>{badgeLabel}</span>}
            {running && <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400">{t('integrations.status.running')}</span>}
          </div>
        </div>

        <span className={`text-xs shrink-0 ${statusColor(status)}`}>
          {isBusy ? <Loader2 size={13} className="animate-spin" /> : statusLabel(status)}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isInstalled && !isBusy && (
            <button onClick={() => onInstall(version)} className="flex items-center gap-1 text-xs bg-ink-6 hover:bg-ink-12 text-ink-secondary hover:text-ink px-2.5 py-1.5 rounded-lg transition-colors">
              <Download size={12} />
              {t('common.install')}
            </button>
          )}
          {isError && (
            <button onClick={() => onInstall(version)} className="flex items-center gap-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-2.5 py-1.5 rounded-lg transition-colors">
              <RefreshCw size={12} />
              {t('common.retry')}
            </button>
          )}
          {isInstalled && !running && (
            <button onClick={() => onRemove(version)} className="flex items-center gap-1 text-xs bg-ink-4 hover:bg-red-500/10 text-ink-ghost hover:text-red-400 px-2.5 py-1.5 rounded-lg transition-colors" title={t('common.remove')}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {isError && message && (
        <p className="text-xs text-red-400/80 ml-5 truncate">
          <AlertCircle size={11} className="inline mr-1 mb-0.5" />
          {message}
        </p>
      )}
      {isBusy && (
        <div className="ml-5">
          <DownloadProgress
            status={status}
            message={message}
            percent={typeof percent === 'number' && percent > 0 ? percent : null}
            downloadedBytes={downloadedBytes}
            speedBps={speedBps}
          />
        </div>
      )}
    </div>
  )
}

export default function IntegrationsPage() {
  const { t } = useTranslation()
  const { integrations, integrationsLoading, fetchIntegrations, applyIntegrationProgress } = useStore()
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await fetchIntegrations()
    setRefreshing(false)
  }, [fetchIntegrations])

  async function handleInstallPhp(version) {
    applyIntegrationProgress({ type: 'php', version, status: 'downloading', message: 'Starting download...', percent: 0 })
    const res = await window.api.integrations.installPhp(version)
    if (res.ok) await fetchIntegrations()
  }

  async function handleRemovePhp(version) {
    if (!confirm(t('integrations.removePhpConfirm', { version }))) return
    await window.api.integrations.removePhp(version)
    await fetchIntegrations()
  }

  async function handleInstallMariaDb() {
    applyIntegrationProgress({ type: 'mariadb', status: 'downloading', message: 'Starting download...', percent: 0 })
    const res = await window.api.integrations.installMariaDb()
    if (res.ok) await fetchIntegrations()
  }

  const phpVersions  = integrations?.php ?? []
  const mariadb      = integrations?.mariadb
  const installedPhp = phpVersions.filter(v => v.status === 'installed' || v.running)

  if (integrationsLoading && !integrations) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-ink-faint" />
      </div>
    )
  }

  return (
    <div className="p-8 h-full overflow-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t('integrations.title')}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{t('integrations.subtitle')}</p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink-secondary transition-colors">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {t('common.refresh')}
        </button>
      </div>

      <div className="space-y-6 max-w-2xl">
        <section>
          <SectionHeader
            icon={<Database size={14} className="text-ink-muted" />}
            title={t('integrations.database')}
            subtitle={t('integrations.databaseRequired')}
          />
          <MariaDbCard mariadb={mariadb} onInstall={handleInstallMariaDb} />
        </section>

        <section>
          <SectionHeader
            icon={<Cpu size={14} className="text-ink-muted" />}
            title={t('integrations.php')}
            subtitle={
              installedPhp.length > 0
                ? t('integrations.phpSubtitle', { count: installedPhp.length })
                : t('integrations.phpSubtitleEmpty')
            }
          />
          <div className="bg-surface-100 border border-ink-8 rounded-xl divide-y divide-ink-5">
            {phpVersions.map((info) => (
              <div key={info.version} className="px-5 py-4">
                <PhpVersionRow info={info} onInstall={handleInstallPhp} onRemove={handleRemovePhp} />
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-2.5 px-1">{t('integrations.phpFootnote')}</p>
        </section>
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <span className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">{title}</span>
      {subtitle && <span className="text-xs text-ink-ghost ml-1">· {subtitle}</span>}
    </div>
  )
}