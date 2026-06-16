import React, { useState, useMemo } from 'react'
import {
  Plus, Globe, FolderOpen, Settings, Trash2,
  ExternalLink, Circle, Play, Square, Loader2,
  Pencil, X, Check, AlertCircle, Palette,
  TerminalSquare, Search, Code2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import CreateSiteModal from '../components/sites/CreateSiteModal'
import { Database } from 'lucide-react'

export default function SitesPage() {
  const { t } = useTranslation()
  const { sites, sitesLoading, fetchSites, removeSite, updateSite } = useStore()
  const [showCreate, setShowCreate] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [togglingId, setTogglingId] = useState(null)
  const [editingSite, setEditingSite] = useState(null)
  const [search, setSearch] = useState('')

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sites
    return sites.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.domain.toLowerCase().includes(q)
    )
  }, [sites, search])

  async function handleDelete(site) {
    if (!confirm(t('sites.deleteConfirm', { name: site.name }))) return
    setDeletingId(site.id)
    await window.api.sites.delete(site.id)
    removeSite(site.id)
    setDeletingId(null)
  }

  async function handleToggle(site) {
    setTogglingId(site.id)
    try {
      if (site.status === 'stopped') {
        // After start, update only the status fields returned by the IPC call.
        // reachable is intentionally preserved from store — it will be set to
        // true by the health polling retry loop in siteService once the site
        // becomes reachable, without an intermediate fetchSites() wiping it.
        const res = await window.api.sites.start(site.id)
        if (res.ok && res.data) updateSite(res.data)
        else await fetchSites()
      } else {
        await window.api.sites.stop(site.id)
        await fetchSites()
      }
    } catch (err) {
      console.error('[Sites] Toggle failed:', err)
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="p-8 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t('sites.title')}</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {t('sites.count', { count: sites.length })}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          {t('sites.newSite')}
        </button>
      </div>

      {/* Search */}
      {sites.length > 0 && (
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-ghost pointer-events-none" />
          <input
            type="text"
            placeholder={t('sites.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-surface-100 border border-ink-8 rounded-lg text-ink placeholder:text-ink-ghost focus:outline-none focus:border-brand-500/50 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-ghost hover:text-ink-muted transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {!sitesLoading && sites.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-200 flex items-center justify-center mb-4">
            <Globe size={28} className="text-ink-ghost" />
          </div>
          <h2 className="text-ink-secondary font-medium mb-1">{t('sites.emptyTitle')}</h2>
          <p className="text-ink-faint text-sm">{t('sites.emptyDesc')}</p>
        </div>
      )}

      {/* Sites list */}
      <div className="grid grid-cols-1 gap-3">
        {filteredSites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            deleting={deletingId === site.id}
            toggling={togglingId === site.id}
            onDelete={() => handleDelete(site)}
            onToggle={() => handleToggle(site)}
            onEdit={() => setEditingSite(site)}
            onOpenTerminal={() => window.api.sites.openTerminal(site.id)}
            onOpenEditor={async () => {
              const res = await window.api.sites.openInEditor(site.id)
              if (!res.ok) alert(t('sites.openEditorFailed', { error: res.error }))
            }}
            onOpenPma={async () => {
              const res = await window.api.sites.openPma(site.id)
              if (res && !res.ok) alert(t('sites.openDatabaseFailed', { error: res.error }))
            }}
          />
        ))}
        {filteredSites.length === 0 && search && (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <p className="text-ink-muted text-sm">
              {t('sites.noResults', { query: search })}
            </p>
            <button onClick={() => setSearch('')} className="text-xs text-brand-500 hover:text-brand-400 mt-1.5 transition-colors">
              {t('common.clearSearch')}
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateSiteModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            fetchSites()
            setShowCreate(false)
          }}
        />
      )}

      {editingSite && (
        <EditSiteModal
          site={editingSite}
          onClose={() => setEditingSite(null)}
          onSaved={() => {
            fetchSites()
            setEditingSite(null)
          }}
        />
      )}
    </div>
  )
}

function SiteCard({ site, deleting, toggling, onDelete, onToggle, onEdit, onOpenTerminal, onOpenEditor, onOpenPma }) {
  const [openingPma, setOpeningPma] = useState(false)
  const { t } = useTranslation()
  const isRunning   = site.status === 'running'
  const isReachable = isRunning && site.reachable === true

  return (
    <div className="bg-surface-100 border border-ink-5 rounded-xl p-5 flex items-center gap-5 hover:border-ink-10 transition-colors group">
      <div className="shrink-0">
        <Circle
          size={10}
          className={isReachable ? 'text-emerald-400 fill-emerald-400' : isRunning ? 'text-amber-400 fill-amber-400' : 'text-ink-ghost fill-ink-ghost'}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-ink text-sm">{site.name}</h3>
          {site.shared_theme_name && (
            <span className="text-xs bg-brand-500/15 text-brand-600 border border-brand-500/25 rounded-full px-2 py-0.5">
              {site.shared_theme_name}
            </span>
          )}
          {isRunning && <span className="text-xs text-emerald-600">{t('common.running')}</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-ink-muted font-mono">{site.domain}</span>
          <span className="text-xs text-ink-ghost">PHP {site.php_version}</span>
          {site.wp_version && site.wp_version !== 'latest' && (
            <span className="text-xs text-ink-ghost">WP {site.wp_version}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onToggle}
          disabled={toggling || deleting}
          aria-label={isRunning ? t('sites.stop') : t('sites.start')}
          title={isRunning ? t('sites.stop') : t('sites.start')}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40
            ${isRunning ? 'text-emerald-400 hover:text-red-400 hover:bg-red-400/10' : 'text-ink-muted hover:text-emerald-400 hover:bg-emerald-400/10'}`}
        >
          {toggling ? <Loader2 size={14} className="animate-spin" /> : isRunning ? <Square size={14} /> : <Play size={14} />}
        </button>

        <div className="flex items-center gap-1">
          <ActionBtn onClick={() => window.api.sites.open(site.id)}      title={t('sites.openSite')}    disabled={!isRunning}><ExternalLink size={14} /></ActionBtn>
          <ActionBtn onClick={() => window.api.sites.openAdmin(site.id)} title={t('sites.openAdmin')}   disabled={!isRunning}><Settings size={14} /></ActionBtn>
          <ActionBtn onClick={() => window.api.sites.openFolder(site.id)} title={t('sites.openFolder')}               ><FolderOpen size={14} /></ActionBtn>
          <ActionBtn onClick={onOpenEditor}                               title={t('sites.openInEditor')}              ><Code2 size={14} /></ActionBtn>
          <ActionBtn
            onClick={async () => { setOpeningPma(true); try { await onOpenPma() } finally { setOpeningPma(false) } }}
            title={t('sites.openDatabase')}
            disabled={!isRunning || openingPma}
          >
            {openingPma ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
          </ActionBtn>
          <ActionBtn onClick={onOpenTerminal}                              title={t('sites.openTerminal')}              ><TerminalSquare size={14} /></ActionBtn>
          <ActionBtn onClick={onEdit}                                      title={t('sites.editSite')}   disabled={deleting || toggling}><Pencil size={14} /></ActionBtn>
          <ActionBtn onClick={onDelete}                                    title={t('sites.deleteSite')} disabled={deleting || toggling} danger><Trash2 size={14} /></ActionBtn>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ children, onClick, title, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40
        ${danger ? 'text-ink-muted hover:text-red-400 hover:bg-red-400/10' : 'text-ink-muted hover:text-ink hover:bg-ink-10'}`}
    >
      {children}
    </button>
  )
}

// ─── Edit Site Modal ──────────────────────────────────────────────────────────

function EditSiteModal({ site, onClose, onSaved }) {
  const { t } = useTranslation()
  const { themes, integrations } = useStore()

  const installedPhpVersions = (integrations?.php ?? [])
    .filter(v => v.status === 'installed')
    .map(v => v.version)

  const [name, setName]                   = useState(site.name)
  const [phpVersion, setPhpVersion]       = useState(site.php_version)
  const [sharedThemeId, setSharedThemeId] = useState(site.shared_theme_id ?? '')
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')

  const isDirty =
    name.trim() !== site.name ||
    phpVersion !== site.php_version ||
    (sharedThemeId || null) !== (site.shared_theme_id || null)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError('')
    const res = await window.api.sites.update({
      siteId: site.id,
      name: name.trim(),
      phpVersion,
      sharedThemeId: sharedThemeId || null,
    })
    setSaving(false)
    if (res.ok) onSaved()
    else setError(res.error)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-100 border border-ink-10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ink-5">
          <div>
            <h2 className="font-semibold text-ink text-sm">{t('editSite.title')}</h2>
            <p className="text-xs text-ink-faint mt-0.5 font-mono">{site.domain}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider">{t('editSite.displayName')}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" autoFocus />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider">{t('editSite.phpVersion')}</label>
            {installedPhpVersions.length === 0 ? (
              <p className="text-sm text-ink-faint px-3 py-2 bg-surface-200 rounded-lg">{t('editSite.phpNotInstalled')}</p>
            ) : (
              <select value={phpVersion} onChange={e => setPhpVersion(e.target.value)} className="input">
                {installedPhpVersions.map(v => <option key={v} value={v}>PHP {v}</option>)}
              </select>
            )}
            {phpVersion !== site.php_version && site.status === 'running' && (
              <p className="text-xs text-amber-400">{t('editSite.phpSwitchWarning')}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider">
              {t('editSite.sharedTheme')}
              <span className="ml-1.5 text-ink-ghost normal-case font-normal">{t('editSite.sharedThemeOptional')}</span>
            </label>
            {themes.length === 0 ? (
              <div className="flex items-center gap-2.5 px-3 py-3 bg-surface-200 border border-ink-8 rounded-lg">
                <Palette size={14} className="text-ink-ghost shrink-0" />
                <span className="text-sm text-ink-faint">{t('editSite.noThemes')}</span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                <ThemeOption selected={!sharedThemeId} onClick={() => setSharedThemeId('')}>
                  <span className="text-ink-faint text-sm italic">{t('common.none')}</span>
                </ThemeOption>
                {themes.map(theme => (
                  <ThemeOption key={theme.id} selected={sharedThemeId === theme.id} onClick={() => setSharedThemeId(theme.id)}>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded bg-surface-400 shrink-0 overflow-hidden flex items-center justify-center">
                        {theme.screenshot ? <img src={`file://${theme.screenshot}`} className="w-full h-full object-cover" alt="" /> : <Palette size={12} className="text-ink-ghost" />}
                      </div>
                      <div>
                        <p className="text-sm text-ink font-medium leading-tight">{theme.name}</p>
                        <p className="text-xs text-ink-faint font-mono">{theme.slug}</p>
                      </div>
                    </div>
                  </ThemeOption>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300/80">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="btn-ghost">{t('common.cancel')}</button>
          <button onClick={handleSave} disabled={!isDirty || !name.trim() || saving} className="btn-primary flex items-center gap-2 disabled:opacity-40">
            {saving ? <><Loader2 size={14} className="animate-spin" /> {t('common.saving')}</> : <><Check size={14} /> {t('common.save')}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ThemeOption({ children, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all
        ${selected ? 'bg-brand-600/12 border-brand-500/35' : 'bg-surface-200 border-ink-6 hover:border-ink-15'}`}
    >
      {children}
      {selected && <Check size={14} className="text-brand-400 shrink-0 ml-2" />}
    </button>
  )
}