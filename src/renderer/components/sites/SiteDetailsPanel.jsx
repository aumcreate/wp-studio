import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Camera, CheckSquare, Code2, Database, ExternalLink,
  FileText, FolderOpen, Globe, Image as ImageIcon, LayoutDashboard,
  Loader2, Play, Settings, Square, TerminalSquare, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

const WIDTH_OPTIONS = [1920, 1440, 1280, 1024]

function itemKey(item) {
  return `${item.type}:${item.id}`
}

export default function SiteDetailsPanel({
  site, onClose, onStart, onOpenEditor, onOpenPma, onEdit, onDelete,
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('overview')
  const [content, setContent] = useState(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentError, setContentError] = useState('')
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [contentType, setContentType] = useState('pages')
  const [widthValue, setWidthValue] = useState('1440')
  const [customWidth, setCustomWidth] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [captureProgress, setCaptureProgress] = useState(null)
  const [captureResult, setCaptureResult] = useState(null)
  const [captureError, setCaptureError] = useState('')

  const allItems = useMemo(() => content ? [...content.pages, ...content.posts] : [], [content])
  const selectedItems = useMemo(
    () => allItems.filter(item => selectedKeys.has(itemKey(item))),
    [allItems, selectedKeys],
  )
  const screenshotWidth = widthValue === 'custom' ? Number(customWidth) : Number(widthValue)
  const isRunning = site.status === 'running'

  useEffect(() => {
    function handleProgress(progress) {
      if (progress.siteId === site.id) setCaptureProgress(progress)
    }
    window.api.on('site:screenshotProgress', handleProgress)
    return () => window.api.off('site:screenshotProgress', handleProgress)
  }, [site.id])

  useEffect(() => {
    if (site.status === 'running') loadContent()
  }, [site.id])

  async function loadContent() {
    setLoadingContent(true)
    setContentError('')
    setCaptureResult(null)
    try {
      if (site.status !== 'running') {
        const started = await onStart()
        if (!started?.ok) throw new Error(started?.error || 'Could not start the site')
      }
      const response = await window.api.sites.getContent(site.id)
      if (!response.ok) throw new Error(response.error)
      setContent(response.data)
      setSelectedKeys(new Set())
    } catch (error) {
      setContentError(error.message)
    } finally {
      setLoadingContent(false)
    }
  }

  function toggleItem(item) {
    const key = itemKey(item)
    setSelectedKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleCollection(items) {
    const keys = items.map(itemKey)
    const everySelected = keys.length > 0 && keys.every(key => selectedKeys.has(key))
    setSelectedKeys(current => {
      const next = new Set(current)
      keys.forEach(key => everySelected ? next.delete(key) : next.add(key))
      return next
    })
  }

  async function captureSelected() {
    if (!selectedItems.length || !Number.isInteger(screenshotWidth)) return
    setCapturing(true)
    setCaptureError('')
    setCaptureResult(null)
    setCaptureProgress({ current: 0, total: selectedItems.length, stage: 'queued' })
    try {
      const response = await window.api.sites.captureContent({
        siteId: site.id,
        items: selectedItems,
        width: screenshotWidth,
      })
      if (!response.ok) throw new Error(response.error)
      setCaptureResult(response.data)
    } catch (error) {
      setCaptureError(error.message)
    } finally {
      setCapturing(false)
    }
  }

  const activeItems = content?.[contentType] || []
  const activeAllSelected = activeItems.length > 0 && activeItems.every(item => selectedKeys.has(itemKey(item)))

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={capturing ? undefined : onClose} />
      <aside className="relative h-full w-full max-w-2xl bg-surface-100 border-l border-ink-10 shadow-2xl flex flex-col">
        <header className="px-6 py-5 border-b border-ink-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-ink-ghost'}`} />
              <h2 className="text-base font-semibold text-ink truncate">{site.name}</h2>
              {site.shared_theme_name && <span className="text-xs bg-brand-500/15 text-brand-600 border border-brand-500/25 rounded-full px-2 py-0.5">{site.shared_theme_name}</span>}
            </div>
            <p className="font-mono text-xs text-ink-muted mt-1">{site.domain}</p>
          </div>
          <button onClick={onClose} disabled={capturing} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink-8 disabled:opacity-40" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <nav className="px-6 pt-3 flex gap-1 border-b border-ink-6">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={LayoutDashboard}>{t('sites.overview')}</TabButton>
          <TabButton active={tab === 'content'} onClick={() => setTab('content')} icon={Camera}>{t('sites.contentScreenshots')}</TabButton>
        </nav>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {tab === 'overview' ? (
            <Overview
              site={site}
              onOpenEditor={onOpenEditor}
              onOpenPma={onOpenPma}
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenContent={() => setTab('content')}
            />
          ) : (
            <ContentCapture
              t={t}
              isRunning={isRunning}
              content={content}
              loadingContent={loadingContent}
              contentError={contentError}
              loadContent={loadContent}
              contentType={contentType}
              setContentType={setContentType}
              activeItems={activeItems}
              activeAllSelected={activeAllSelected}
              selectedKeys={selectedKeys}
              toggleItem={toggleItem}
              toggleCollection={() => toggleCollection(activeItems)}
              selectedCount={selectedItems.length}
              widthValue={widthValue}
              setWidthValue={setWidthValue}
              customWidth={customWidth}
              setCustomWidth={setCustomWidth}
              screenshotWidth={screenshotWidth}
              capturing={capturing}
              captureProgress={captureProgress}
              captureResult={captureResult}
              captureError={captureError}
              captureSelected={captureSelected}
              site={site}
            />
          )}
        </div>
      </aside>
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick} className={`px-3 py-2.5 text-sm flex items-center gap-2 border-b-2 transition-colors ${active ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-muted hover:text-ink'}`}>
      <Icon size={15} />
      {children}
    </button>
  )
}

function Overview({ site, onOpenEditor, onOpenPma, onEdit, onDelete, onOpenContent }) {
  const { t } = useTranslation()
  const isRunning = site.status === 'running'
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <InfoItem label={t('sites.siteDomain')} value={site.domain} mono />
        <InfoItem label="PHP" value={site.php_version || '—'} />
        <InfoItem label="WordPress" value={site.wp_version && site.wp_version !== 'latest' ? site.wp_version : 'Latest'} />
        <InfoItem label={t('sites.siteTheme')} value={site.shared_theme_name || t('sites.notAssigned')} />
      </div>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-ghost mb-2">{t('sites.contentScreenshots')}</h3>
        <button onClick={onOpenContent} className="w-full flex items-center justify-between bg-brand-600/10 border border-brand-500/20 rounded-xl px-4 py-4 text-left hover:bg-brand-600/15 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/15 text-brand-500 flex items-center justify-center"><Camera size={17} /></div>
            <div><p className="text-sm font-medium text-ink">{t('sites.contentScreenshots')}</p><p className="text-xs text-ink-muted mt-0.5">{isRunning ? t('sites.loadContent') : t('sites.siteMustRun')}</p></div>
          </div>
          <span className="text-brand-500">›</span>
        </button>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-ghost mb-2">{t('sites.details')}</h3>
        <div className="grid grid-cols-2 gap-2">
          <QuickAction icon={ExternalLink} label={t('sites.openSite')} onClick={() => window.api.sites.open(site.id)} disabled={!isRunning} />
          <QuickAction icon={Settings} label={t('sites.openAdmin')} onClick={() => window.api.sites.openAdmin(site.id)} disabled={!isRunning} />
          <QuickAction icon={FolderOpen} label={t('sites.openSiteFolder')} onClick={() => window.api.sites.openFolder(site.id)} />
          <QuickAction icon={Code2} label={t('sites.openInEditor')} onClick={onOpenEditor} />
          <QuickAction icon={Database} label={t('sites.openDatabase')} onClick={onOpenPma} disabled={!isRunning} />
          <QuickAction icon={TerminalSquare} label={t('sites.openTerminal')} onClick={() => window.api.sites.openTerminal(site.id)} />
        </div>
      </section>

      <div className="pt-2 flex justify-between border-t border-ink-6">
        <button onClick={onDelete} className="text-sm text-red-400 hover:text-red-300 px-3 py-2">{t('sites.deleteSite')}</button>
        <button onClick={onEdit} className="btn-ghost text-sm flex items-center gap-2"><Settings size={14} />{t('sites.editSite')}</button>
      </div>
    </div>
  )
}

function ContentCapture(props) {
  const {
    t, isRunning, content, loadingContent, contentError, loadContent, contentType, setContentType,
    activeItems, activeAllSelected, selectedKeys, toggleItem, toggleCollection, selectedCount,
    widthValue, setWidthValue, customWidth, setCustomWidth, screenshotWidth, capturing,
    captureProgress, captureResult, captureError, captureSelected, site,
  } = props

  if (!content) {
    return (
      <div className="h-full min-h-72 flex flex-col items-center justify-center text-center max-w-sm mx-auto">
        {loadingContent ? <Loader2 size={25} className="animate-spin text-brand-500 mb-3" /> : <ImageIcon size={28} className="text-ink-ghost mb-3" />}
        <p className="text-sm text-ink-secondary">{loadingContent ? t('sites.loadingContent') : t('sites.contentNotLoaded')}</p>
        {!isRunning && !loadingContent && <p className="text-xs text-ink-muted mt-2 leading-relaxed">{t('sites.siteMustRun')}</p>}
        {contentError && <ErrorMessage>{t('sites.contentLoadFailed', { error: contentError })}</ErrorMessage>}
        <button onClick={loadContent} disabled={loadingContent} className="btn-primary mt-5 flex items-center gap-2">
          {loadingContent ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {isRunning ? t('sites.loadContent') : t('sites.startAndLoadContent')}
        </button>
      </div>
    )
  }

  const countLabel = contentType === 'pages' ? t('sites.pageCount', { count: content.pages.length }) : t('sites.postCount', { count: content.posts.length })
  const successful = captureResult?.results.filter(item => item.ok).length ?? 0
  const failed = captureResult?.results.filter(item => !item.ok).length ?? 0

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 border-b border-ink-6">
        <ContentTab active={contentType === 'pages'} onClick={() => setContentType('pages')} icon={FileText}>{t('sites.pages')} ({content.pages.length})</ContentTab>
        <ContentTab active={contentType === 'posts'} onClick={() => setContentType('posts')} icon={Globe}>{t('sites.posts')} ({content.posts.length})</ContentTab>
        <button onClick={loadContent} disabled={loadingContent || capturing} className="ml-auto text-xs text-ink-muted hover:text-brand-500 pb-2.5 disabled:opacity-40">{t('common.refresh')}</button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">{countLabel}</span>
        <button onClick={toggleCollection} className="text-brand-600 hover:text-brand-500 flex items-center gap-1.5">
          <CheckSquare size={14} /> {activeAllSelected ? t('sites.deselectAll') : t('sites.selectAll')}
        </button>
      </div>

      <div className="border border-ink-6 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
        {activeItems.length === 0 ? (
          <p className="text-sm text-ink-muted py-9 text-center">{contentType === 'pages' ? t('sites.noPages') : t('sites.noPosts')}</p>
        ) : activeItems.map(item => {
          const selected = selectedKeys.has(itemKey(item))
          return (
            <label key={itemKey(item)} className="flex items-center gap-3 px-3 py-3 border-b border-ink-5 last:border-b-0 cursor-pointer hover:bg-ink-3">
              <input type="checkbox" checked={selected} onChange={() => toggleItem(item)} className="accent-brand-600" />
              <span className="min-w-0 flex-1"><span className="block text-sm text-ink truncate">{item.title}</span><span className="block text-xs text-ink-ghost font-mono mt-0.5 truncate">{item.url}</span></span>
            </label>
          )
        })}
      </div>

      <section className="bg-surface-200 border border-ink-6 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between"><label className="text-sm font-medium text-ink">{t('sites.screenshotWidth')}</label><span className="text-xs text-ink-muted">{t('sites.selected', { count: selectedCount })}</span></div>
        <div className="flex gap-2 flex-wrap">
          {WIDTH_OPTIONS.map(width => <WidthButton key={width} active={widthValue === String(width)} onClick={() => setWidthValue(String(width))}>{width}px</WidthButton>)}
          <WidthButton active={widthValue === 'custom'} onClick={() => setWidthValue('custom')}>{t('sites.customWidth')}</WidthButton>
        </div>
        {widthValue === 'custom' && <input type="number" min="320" max="3840" value={customWidth} onChange={event => setCustomWidth(event.target.value)} placeholder="320–3840" className="input" />}
        <button onClick={captureSelected} disabled={!selectedCount || !Number.isInteger(screenshotWidth) || screenshotWidth < 320 || screenshotWidth > 3840 || capturing} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40">
          {capturing ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
          {capturing ? t('sites.capturing', { current: captureProgress?.current || 0, total: captureProgress?.total || selectedCount, title: captureProgress?.title || '' }) : t('sites.captureSelected')}
        </button>
      </section>

      {capturing && <div className="bg-brand-500/8 border border-brand-500/15 rounded-lg px-3.5 py-3 text-xs text-ink-muted"><p>{captureProgress?.stage === 'warming' ? t('sites.warmingPage') : t('sites.capturing', { current: captureProgress?.current || 0, total: captureProgress?.total || selectedCount, title: captureProgress?.title || '' })}</p>{captureProgress?.segments && <p className="mt-1 text-ink-ghost">{captureProgress.segment} / {captureProgress.segments}</p>}</div>}
      {captureError && <ErrorMessage>{t('sites.screenshotFailed', { error: captureError })}</ErrorMessage>}
      {captureResult && <div className="bg-emerald-500/8 border border-emerald-500/15 rounded-lg p-3.5"><p className="text-xs text-emerald-700">{t('sites.captureComplete', { success: successful, failed })}</p><button onClick={() => window.api.sites.openScreenshots({ siteId: site.id, outputDir: captureResult.outputDir })} className="text-xs text-brand-600 hover:text-brand-500 mt-2">{t('sites.openResults')}</button></div>}
    </div>
  )
}

function ContentTab({ active, onClick, icon: Icon, children }) {
  return <button onClick={onClick} className={`pb-2.5 text-sm flex items-center gap-1.5 border-b-2 ${active ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-muted hover:text-ink'}`}><Icon size={14} />{children}</button>
}

function WidthButton({ active, onClick, children }) {
  return <button onClick={onClick} className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${active ? 'bg-brand-600 text-white border-brand-600' : 'border-ink-10 text-ink-muted hover:border-brand-500/40'}`}>{children}</button>
}

function InfoItem({ label, value, mono }) {
  return <div className="bg-surface-200 border border-ink-6 rounded-lg px-3.5 py-3"><p className="text-xs text-ink-ghost mb-1">{label}</p><p className={`text-sm text-ink truncate ${mono ? 'font-mono' : ''}`}>{value}</p></div>
}

function QuickAction({ icon: Icon, label, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} className="flex items-center gap-2.5 text-left px-3 py-3 border border-ink-6 rounded-lg text-sm text-ink-muted hover:text-ink hover:bg-ink-3 disabled:opacity-40"><Icon size={15} />{label}</button>
}

function ErrorMessage({ children }) {
  return <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 mt-4 text-left"><AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" /><p className="text-xs text-red-400 leading-relaxed">{children}</p></div>
}
