import React, { useState } from 'react'
import { Upload, FolderOpen, Trash2, Palette, RefreshCw, Package, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

export default function ThemesPage() {
  const { t } = useTranslation()
  const { themes, themesLoading, fetchThemes, removeTheme } = useStore()
  const [importing, setImporting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [exportingId, setExportingId] = useState(null)
  const [exportingFolder, setExportingFolder] = useState(false)

  async function handleImport() {
    setImporting(true)
    const res = await window.api.themes.selectFolder()
    setImporting(false)
    if (res.ok) {
      await fetchThemes()
    } else if (!res.canceled) {
      alert(t('themes.importFailed', { error: res.error }))
    }
  }

  async function handleDelete(theme) {
    const confirmMsg = theme.sites_count > 0
      ? t('themes.deleteConfirmUsed', { name: theme.name, count: theme.sites_count })
      : t('themes.deleteConfirm', { name: theme.name })
    if (!confirm(confirmMsg)) return

    setDeletingId(theme.id)
    const res = await window.api.themes.delete(theme.id)
    if (res.ok) {
      removeTheme(theme.id)
    } else {
      alert(t('themes.deleteFailed', { error: res.error }))
    }
    setDeletingId(null)
  }

  // Presents the POT generation result and offers to reveal the file.
  function handleExportResult(res) {
    if (!res.ok) {
      if (res.canceled) return
      alert(t('themes.exportFailed', { error: res.error }))
      return
    }
    const { potPath, domain, stringCount, warnings } = res.data
    const key = warnings.length > 0 ? 'themes.exportSuccessWarnings' : 'themes.exportSuccess'
    const reveal = confirm(
      t(key, { count: stringCount, domain, path: potPath, warnings: warnings.length })
    )
    if (reveal) window.api.themes.revealPot(potPath)
  }

  async function handleExportPot(theme) {
    setExportingId(theme.id)
    const res = await window.api.themes.exportPot(theme.id)
    setExportingId(null)
    handleExportResult(res)
  }

  async function handleExportFromFolder() {
    setExportingFolder(true)
    const res = await window.api.themes.exportPotFromFolder()
    setExportingFolder(false)
    handleExportResult(res)
  }

  return (
    <div className="p-8 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t('themes.title')}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{t('themes.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchThemes}
            disabled={themesLoading}
            className="w-9 h-9 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink-5 rounded-lg transition-colors"
            title={t('common.refresh')}
          >
            <RefreshCw size={15} className={themesLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleExportFromFolder}
            disabled={exportingFolder}
            className="flex items-center gap-2 bg-ink-5 hover:bg-ink-10 disabled:opacity-50 text-ink-secondary text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            title={t('themes.exportPotTitle')}
          >
            <Languages size={15} />
            {exportingFolder ? t('themes.exporting') : t('themes.exportPotFromFolder')}
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Upload size={15} />
            {importing ? t('themes.importing') : t('themes.importTheme')}
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-brand-600/10 border border-brand-600/20 rounded-xl px-4 py-3 mb-6 mt-4">
        <Package size={16} className="text-brand-400 shrink-0 mt-0.5" />
        <div className="text-sm text-ink-secondary leading-relaxed">
          {t('themes.infoBanner')
            .split('<mono>')
            .flatMap((part, i) => {
              if (i === 0) return [part]
              const [code, rest] = part.split('</mono>')
              return [<span key={i} className="font-mono text-ink-secondary">{code}</span>, rest]
            })}
        </div>
      </div>

      {/* Empty state */}
      {!themesLoading && themes.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-200 flex items-center justify-center mb-4">
            <Palette size={28} className="text-ink-ghost" />
          </div>
          <h2 className="text-ink-secondary font-medium mb-1">{t('themes.emptyTitle')}</h2>
          <p className="text-ink-faint text-sm mb-4">{t('themes.emptyDesc')}</p>
          <button
            onClick={handleImport}
            className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors"
          >
            <Upload size={14} />
            {t('themes.importFirst')}
          </button>
        </div>
      )}

      {/* Themes grid */}
      <div className="grid grid-cols-1 gap-3">
        {themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            deleting={deletingId === theme.id}
            exporting={exportingId === theme.id}
            onDelete={() => handleDelete(theme)}
            onOpenFolder={() => window.api.themes.openFolder(theme.id)}
            onExportPot={() => handleExportPot(theme)}
          />
        ))}
      </div>
    </div>
  )
}

function ThemeCard({ theme, deleting, exporting, onDelete, onOpenFolder, onExportPot }) {
  const { t } = useTranslation()
  return (
    <div className="bg-surface-100 border border-ink-5 rounded-xl p-5 flex items-center gap-5 hover:border-ink-10 transition-colors group">
      <div className="w-12 h-12 rounded-lg bg-surface-200 shrink-0 flex items-center justify-center overflow-hidden">
        {theme.screenshot ? (
          <img src={`file://${theme.screenshot}`} alt={theme.name} className="w-full h-full object-cover" />
        ) : (
          <Palette size={20} className="text-ink-muted" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium text-ink text-sm">{theme.name}</h3>
          {theme.version && <span className="text-xs text-ink-faint font-mono">v{theme.version}</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-ink-muted font-mono">{theme.slug}</span>
          {theme.author && <span className="text-xs text-ink-faint">{t('common.by')} {theme.author}</span>}
        </div>
        {theme.description && <p className="text-xs text-ink-faint mt-1 line-clamp-1">{theme.description}</p>}
      </div>

      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 bg-emerald-400/10 border border-emerald-400/20 rounded-full">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className="text-xs text-emerald-400 font-medium">{t('themes.symlink')}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onExportPot}
          disabled={exporting}
          title={t('themes.exportPotTitle')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink-10 transition-colors disabled:opacity-40"
        >
          <Languages size={14} className={exporting ? 'animate-pulse' : ''} />
        </button>
        <button
          onClick={onOpenFolder}
          title={t('themes.openFolder')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink-10 transition-colors"
        >
          <FolderOpen size={14} />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          title={t('themes.removeFromPool')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}