import React, { useState, useEffect } from 'react'
import {
  X, Check, Loader, AlertCircle, Palette,
  ChevronRight, ChevronLeft, Globe, User, Lock, Mail, Type, Eye, EyeOff,
  Package,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

const FALLBACK_WP_VERSIONS = [
  { value: 'latest', label: 'Latest (Recommended)' },
  { value: '6.7.2', label: '6.7.2' },
  { value: '6.6.2', label: '6.6.2' },
  { value: '6.5.5', label: '6.5.5' },
  { value: '6.4.3', label: '6.4.3' },
]

export default function CreateSiteModal({ onClose, onCreated }) {
  const { t } = useTranslation()
  const { themes, integrations, fetchIntegrations } = useStore()
  const navigate = useNavigate()

  const installedPhpVersions = (integrations?.php ?? [])
    .filter(v => v.status === 'installed')
    .map(v => v.version)

  const STEPS = [
    t('createSite.steps.setup'),
    t('createSite.steps.admin'),
    t('createSite.steps.creating'),
  ]

  const [step, setStep] = useState(0)
  const [wpVersions, setWpVersions] = useState([])
  const [wpVersionsLoading, setWpVersionsLoading] = useState(true)

  const [form, setForm] = useState({
    name: '',
    phpVersion: installedPhpVersions[0] ?? '8.2',
    wpVersion: 'latest',
    sharedThemeId: '',
    siteTitle: '',
    adminUser: 'admin',
    adminPass: '',
    adminEmail: 'admin@example.com',
  })

  useEffect(() => { fetchIntegrations() }, [])

  useEffect(() => {
    setWpVersionsLoading(true)
    window.api.wordpress.getVersions()
      .then(res => {
        if (res.ok && res.data?.length) setWpVersions(res.data)
        else setWpVersions(FALLBACK_WP_VERSIONS)
      })
      .catch(() => setWpVersions(FALLBACK_WP_VERSIONS))
      .finally(() => setWpVersionsLoading(false))
  }, [])

  const [showPass, setShowPass] = useState(false)
  const [status, setStatus] = useState('idle')
  const [log, setLog] = useState([])
  const [error, setError] = useState('')

  function field(key) {
    return {
      value: form[key],
      onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
    }
  }

  const slug = form.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const step1Valid = form.name.trim().length > 0 && installedPhpVersions.length > 0
  const step2Valid = form.adminUser.trim() && form.adminPass.trim() && form.adminEmail.includes('@')

  async function handleCreate() {
    setStep(2)
    setStatus('creating')
    setLog([])
    setError('')

    const logListener = (msg) => setLog((l) => [...l, msg.message])
    window.api.on('site:log', logListener)

    const res = await window.api.sites.create({
      name: form.name.trim(),
      phpVersion: form.phpVersion,
      wpVersion: form.wpVersion,
      sharedThemeId: form.sharedThemeId || null,
      siteTitle: form.siteTitle || form.name.trim(),
      adminUser: form.adminUser.trim(),
      adminPass: form.adminPass,
      adminEmail: form.adminEmail.trim(),
    })

    window.api.off('site:log', logListener)

    if (res.ok) {
      setStatus('done')
      setTimeout(async () => {
        await window.api.sites.open(res.data.id)
        onCreated(res.data)
      }, 1200)
    } else {
      setStatus('error')
      setError(res.error)
    }
  }

  const isCreating = status === 'creating'
  const isDone     = status === 'done'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-surface-100 border border-ink-10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ink-5">
          <div>
            <h2 className="font-semibold text-ink text-sm">{t('createSite.title')}</h2>
            <p className="text-xs text-ink-faint mt-0.5">{STEPS[step]}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {STEPS.slice(0, 2).map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === step || (step === 2 && i <= 1) ? 'bg-brand-500' : i < step ? 'bg-brand-500/40' : 'bg-ink-15'
              }`} />
            ))}
          </div>
          {status !== 'creating' && (
            <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors ml-3">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Step 0 */}
        {step === 0 && (
          <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[70vh]">
            <Field label={t('createSite.siteName')} icon={<Globe size={14} />}>
              <input type="text" placeholder={t('createSite.siteNamePlaceholder')} autoFocus {...field('name')} className="input" />
              {slug && <p className="text-xs text-ink-faint font-mono mt-1">{slug}.test</p>}
            </Field>

            <Field label={t('createSite.phpVersion')}>
              {installedPhpVersions.length === 0 ? (
                <div className="flex items-center justify-between gap-3 px-3 py-3 bg-surface-200 border border-amber-500/20 rounded-lg">
                  <div className="flex items-center gap-2.5">
                    <Package size={14} className="text-amber-400 shrink-0" />
                    <span className="text-sm text-ink-muted">{t('createSite.phpNotInstalled')}</span>
                  </div>
                  <button type="button" onClick={() => { onClose(); navigate('/integrations') }} className="text-xs text-amber-400 hover:text-amber-300 underline shrink-0">
                    {t('createSite.installPhp')}
                  </button>
                </div>
              ) : (
                <select {...field('phpVersion')} className="input">
                  {installedPhpVersions.map(v => <option key={v} value={v}>PHP {v}</option>)}
                </select>
              )}
            </Field>

            <Field label={t('createSite.wpVersion')}>
              {wpVersionsLoading ? (
                <div className="input flex items-center gap-2 text-ink-faint">
                  <Loader2 size={13} className="animate-spin shrink-0" />
                  <span className="text-sm">{t('createSite.loadingVersions')}</span>
                </div>
              ) : (
                <select {...field('wpVersion')} className="input">
                  {wpVersions.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              )}
            </Field>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider">
                {t('createSite.sharedTheme')}
                <span className="ml-1.5 text-ink-ghost normal-case font-normal">{t('createSite.sharedThemeOptional')}</span>
              </label>
              {themes.length === 0 ? (
                <div className="flex items-center gap-2.5 px-3 py-3 bg-surface-200 border border-ink-8 rounded-lg">
                  <Palette size={14} className="text-ink-ghost shrink-0" />
                  <span className="text-sm text-ink-faint">{t('createSite.noThemesYet')}</span>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
                  <ThemeOption selected={!form.sharedThemeId} onClick={() => setForm(f => ({ ...f, sharedThemeId: '' }))}>
                    <span className="text-ink-faint text-sm italic">{t('common.none')}</span>
                  </ThemeOption>
                  {themes.map(t_ => (
                    <ThemeOption key={t_.id} selected={form.sharedThemeId === t_.id} onClick={() => setForm(f => ({ ...f, sharedThemeId: t_.id }))}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-surface-400 shrink-0 overflow-hidden flex items-center justify-center">
                          {t_.screenshot ? <img src={`file://${t_.screenshot}`} className="w-full h-full object-cover" alt="" /> : <Palette size={13} className="text-ink-ghost" />}
                        </div>
                        <div>
                          <p className="text-sm text-ink font-medium leading-tight">{t_.name}</p>
                          <p className="text-xs text-ink-faint font-mono">{t_.slug}{t_.version ? ` · v${t_.version}` : ''}</p>
                        </div>
                      </div>
                    </ThemeOption>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button onClick={() => step1Valid && setStep(1)} disabled={!step1Valid} className="btn-primary flex items-center gap-1.5">
                {t('common.next')} <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[70vh]">
            <p className="text-xs text-ink-muted leading-relaxed">{t('createSite.credentialsNote')}</p>

            <Field label={t('createSite.siteTitle')} icon={<Type size={14} />}>
              <input type="text" placeholder={form.name || 'My Site'} {...field('siteTitle')} className="input" />
            </Field>
            <Field label={t('createSite.adminUsername')} icon={<User size={14} />}>
              <input type="text" autoComplete="off" {...field('adminUser')} className="input" />
            </Field>
            <Field label={t('createSite.adminPassword')} icon={<Lock size={14} />}>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} placeholder={t('createSite.adminPasswordPlaceholder')} autoComplete="new-password" {...field('adminPass')} className="input pr-10" />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-secondary">
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <PasswordStrength password={form.adminPass} />
            </Field>
            <Field label={t('createSite.adminEmail')} icon={<Mail size={14} />}>
              <input type="email" placeholder={t('createSite.adminEmailPlaceholder')} {...field('adminEmail')} className="input" />
            </Field>

            <div className="flex items-center justify-between pt-1">
              <button onClick={() => setStep(0)} className="btn-ghost flex items-center gap-1">
                <ChevronLeft size={15} /> {t('common.back')}
              </button>
              <button onClick={handleCreate} disabled={!step2Valid} className="btn-primary">
                {t('createSite.createSite')}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="px-6 py-5 space-y-4">
            <div className="bg-surface-0 rounded-xl p-4 font-mono text-xs text-ink-muted space-y-1.5 min-h-[160px] max-h-[260px] overflow-y-auto">
              {log.length === 0 && isCreating && <span className="text-ink-ghost animate-pulse">{t('createSite.starting')}</span>}
              {log.map((line, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-brand-400 shrink-0 select-none">›</span>
                  <span>{line}</span>
                </div>
              ))}
              {isDone && (
                <div className="flex items-center gap-2 text-emerald-400 mt-1">
                  <Check size={13} />
                  <span className="font-semibold">{t('createSite.success')}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {isCreating && (
                <>
                  <Loader size={16} className="animate-spin text-brand-400 shrink-0" />
                  <span className="text-sm text-ink-muted">{log[log.length - 1] ?? t('createSite.working')}</span>
                </>
              )}
              {isDone && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm">
                  <div className="w-5 h-5 rounded-full bg-emerald-400/15 flex items-center justify-center">
                    <Check size={12} />
                  </div>
                  {t('createSite.openingShortly')}
                </div>
              )}
            </div>

            {status === 'error' && (
              <>
                <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                  <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-400 mb-0.5">{t('createSite.failed')}</p>
                    <p className="text-xs text-red-300/70">{error}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={onClose} className="btn-ghost">{t('common.close')}</button>
                  <button onClick={() => { setStep(0); setStatus('idle') }} className="btn-primary">{t('createSite.tryAgain')}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, icon, children }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted uppercase tracking-wider">
        {icon && <span className="text-ink-faint">{icon}</span>}
        {label}
      </label>
      {children}
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

function PasswordStrength({ password }) {
  const { t } = useTranslation()
  if (!password) return null

  let strength = 0
  if (password.length >= 8) strength++
  if (/[A-Z]/.test(password)) strength++
  if (/[0-9]/.test(password)) strength++
  if (/[^A-Za-z0-9]/.test(password)) strength++

  const labels = [
    t('createSite.passwordStrength.weak'),
    t('createSite.passwordStrength.fair'),
    t('createSite.passwordStrength.good'),
    t('createSite.passwordStrength.strong'),
  ]
  const colors     = ['bg-red-500', 'bg-amber-500', 'bg-yellow-400', 'bg-emerald-400']
  const textColors = ['text-red-400', 'text-amber-400', 'text-yellow-300', 'text-emerald-400']
  const idx = Math.max(0, strength - 1)

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex gap-1 flex-1">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i < strength ? colors[idx] : 'bg-ink-10'}`} />
        ))}
      </div>
      <span className={`text-xs ${textColors[idx]}`}>{labels[idx]}</span>
    </div>
  )
}