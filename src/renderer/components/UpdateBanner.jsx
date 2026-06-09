import React from 'react'
import { Download, RefreshCw, X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

// Floating banner shown when an app update is available, downloading, or ready
// to install. Driven by the 'update:status' events from the main process.
export default function UpdateBanner() {
  const { t } = useTranslation()
  const { updateStatus, updateDismissed, dismissUpdate } = useStore()
  const { state, version, percent } = updateStatus

  const visible = ['available', 'downloading', 'downloaded'].includes(state) && !updateDismissed
  if (!visible) return null

  return (
    <div className="absolute bottom-4 right-4 z-40 w-80 bg-surface-100 border border-ink-10 rounded-xl shadow-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-600/15 flex items-center justify-center shrink-0">
          {state === 'downloading'
            ? <Loader2 size={15} className="text-brand-400 animate-spin" />
            : <Download size={15} className="text-brand-400" />}
        </div>

        <div className="flex-1 min-w-0">
          {state === 'available' && (
            <>
              <p className="text-sm font-medium text-ink">{t('update.availableTitle', { version })}</p>
              <p className="text-xs text-ink-muted mt-0.5">{t('update.availableDesc')}</p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => window.api.updates.download()}
                  className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Download size={13} /> {t('update.downloadBtn')}
                </button>
                <button onClick={dismissUpdate} className="text-xs text-ink-muted hover:text-ink px-2 py-1.5">
                  {t('update.later')}
                </button>
              </div>
            </>
          )}

          {state === 'downloading' && (
            <>
              <p className="text-sm font-medium text-ink">{t('update.downloadingTitle')}</p>
              <div className="w-full bg-ink-10 rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${percent ?? 0}%` }}
                />
              </div>
              <p className="text-xs text-ink-faint mt-1">{percent ?? 0}%</p>
            </>
          )}

          {state === 'downloaded' && (
            <>
              <p className="text-sm font-medium text-ink">{t('update.readyTitle', { version })}</p>
              <p className="text-xs text-ink-muted mt-0.5">{t('update.readyDesc')}</p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => window.api.updates.install()}
                  className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw size={13} /> {t('update.restartBtn')}
                </button>
                <button onClick={dismissUpdate} className="text-xs text-ink-muted hover:text-ink px-2 py-1.5">
                  {t('update.later')}
                </button>
              </div>
            </>
          )}
        </div>

        <button onClick={dismissUpdate} className="text-ink-ghost hover:text-ink-muted transition-colors shrink-0">
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
