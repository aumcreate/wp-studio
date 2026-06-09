const { app } = require('electron')

// Thin wrapper around electron-updater that drives updates from GitHub Releases.
//
// Update source is configured via the electron-builder `publish` block in
// package.json (provider: github). At build time electron-builder writes an
// app-update.yml into the package, which electron-updater reads at runtime —
// no owner/repo needs to be hard-coded here.
//
// Flow (autoDownload is OFF so the user stays in control):
//   check → 'available' → user clicks Update → download → 'downloaded'
//        → user clicks Restart → quitAndInstall()

let autoUpdater = null
let _send = null
let _wired = false
let _busy = false

// Lazily loads electron-updater. Returns null when the dependency is not
// installed yet (e.g. before `npm install`), so the app never crashes on boot.
function loadUpdater() {
  if (autoUpdater) return autoUpdater
  try {
    autoUpdater = require('electron-updater').autoUpdater
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
  } catch (err) {
    console.warn('[Update] electron-updater not available:', err.message)
    autoUpdater = null
  }
  return autoUpdater
}

function emit(payload) {
  console.log('[Update]', JSON.stringify(payload))
  _send?.('update:status', payload)
}

// Registers electron-updater event handlers exactly once.
function wireEvents(updater) {
  if (_wired) return
  _wired = true

  updater.on('checking-for-update', () => emit({ state: 'checking' }))

  updater.on('update-available', (info) => {
    _busy = false
    emit({ state: 'available', version: info?.version, notes: normalizeNotes(info?.releaseNotes) })
  })

  updater.on('update-not-available', () => {
    _busy = false
    emit({ state: 'none', version: app.getVersion() })
  })

  updater.on('download-progress', (p) => {
    emit({ state: 'downloading', percent: Math.round(p?.percent ?? 0) })
  })

  updater.on('update-downloaded', (info) => {
    _busy = false
    emit({ state: 'downloaded', version: info?.version })
  })

  updater.on('error', (err) => {
    _busy = false
    emit({ state: 'error', message: (err?.message || String(err)).trim() })
  })
}

// Release notes from GitHub may be a string or an array of {version, note}.
function normalizeNotes(notes) {
  if (!notes) return ''
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) return notes.map(n => n?.note || '').join('\n\n')
  return ''
}

// Initializes the updater and performs a silent startup check (packaged only).
function initAutoUpdater(send) {
  _send = send
  if (!app.isPackaged) {
    console.log('[Update] Skipping auto-check in development (not packaged)')
    return
  }
  const updater = loadUpdater()
  if (!updater) return
  wireEvents(updater)
  // Fire-and-forget; errors surface via the 'error' event.
  updater.checkForUpdates().catch(err => emit({ state: 'error', message: err.message }))
}

// Manual "Check for updates" trigger from the UI.
async function checkForUpdates() {
  if (!app.isPackaged) {
    emit({ state: 'dev' })
    return { ok: false, error: 'Updates are only available in the installed app.' }
  }
  const updater = loadUpdater()
  if (!updater) return { ok: false, error: 'Updater is not available.' }
  wireEvents(updater)
  try {
    await updater.checkForUpdates()
    return { ok: true }
  } catch (err) {
    emit({ state: 'error', message: err.message })
    return { ok: false, error: err.message }
  }
}

// Starts downloading an available update.
async function downloadUpdate() {
  const updater = loadUpdater()
  if (!updater) return { ok: false, error: 'Updater is not available.' }
  if (_busy) return { ok: true }
  _busy = true
  try {
    await updater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    _busy = false
    emit({ state: 'error', message: err.message })
    return { ok: false, error: err.message }
  }
}

// Quits and installs a downloaded update.
function quitAndInstall() {
  const updater = loadUpdater()
  if (!updater) return { ok: false, error: 'Updater is not available.' }
  // isSilent=false (show installer), isForceRunAfter=true (relaunch after install)
  setImmediate(() => updater.quitAndInstall(false, true))
  return { ok: true }
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getVersion: () => app.getVersion(),
}
