import React from 'react'
import { Minus, Square, X, Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function TitleBar() {
  const { t } = useTranslation()
  const isMac = navigator.platform.toUpperCase().includes('MAC')

  return (
    <div
      className="app-drag-region flex items-center justify-between bg-surface-50 border-b border-ink-5 shrink-0"
      style={{ height: 38 }}
    >
      {isMac ? <div style={{ width: 80 }} /> : null}

      <span className="text-xs font-medium text-ink-faint tracking-widest uppercase select-none mx-auto">
        AUM WP Studio
      </span>

      {!isMac && (
        <div className="app-no-drag flex items-center">
          <TitleBarBtn onClick={() => window.api.system.toggleDevTools()} label={t('titlebar.devtools')}>
            <Bug size={12} />
          </TitleBarBtn>
          <TitleBarBtn onClick={() => window.api.system.minimize()} label={t('titlebar.minimize')}>
            <Minus size={12} />
          </TitleBarBtn>
          <TitleBarBtn onClick={() => window.api.system.maximize()} label={t('titlebar.maximize')}>
            <Square size={12} />
          </TitleBarBtn>
          <TitleBarBtn onClick={() => window.api.system.close()} label={t('titlebar.close')} danger>
            <X size={12} />
          </TitleBarBtn>
        </div>
      )}
    </div>
  )
}

function TitleBarBtn({ children, onClick, label, danger }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`
        w-10 h-[38px] flex items-center justify-center transition-colors
        ${danger ? 'hover:bg-red-600' : 'hover:bg-ink-10'}
        text-ink-muted hover:text-ink
      `}
    >
      {children}
    </button>
  )
}