const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const isDev = process.env.NODE_ENV === 'development'

const { registerSiteHandlers } = require('./ipc/siteHandlers')
const { registerThemeHandlers } = require('./ipc/themeHandlers')
const { registerSystemHandlers } = require('./ipc/systemHandlers')
const { initDatabase } = require('./services/database')
const { initWorkspace } = require('./services/workspace')
const mysqlService = require('./services/mysqlService')
const phpService = require('./services/phpService')
const caddyService = require('./services/caddyService')
const { ensurePort80Free, killStaleCADdy } = require('./services/portService')

let mainWindow
let appIsQuitting = false

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: false,
    backgroundColor: '#0e0f14',
    icon: path.join(__dirname, '../../resources/icons/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Intercept window close — confirm if sites are running
  mainWindow.on('close', async (event) => {
    const { listSites } = require('./services/siteService')
    const runningSites = listSites().filter(s => s.status === 'running')

    if (runningSites.length === 0) {
      appIsQuitting = true
      return
    }

    event.preventDefault() // block the close

    const { dialog } = require('electron')
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Sites Are Running',
      message: `${runningSites.length} site${runningSites.length > 1 ? 's are' : ' is'} currently running.`,
      detail: 'Closing WP Studio will stop all running sites and services. Are you sure?',
      buttons: ['Close WP Studio', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })

    if (response === 0) {
      // Manually clean up before force exit
      await caddyService.stopCaddy()
      await phpService.stopAll()
      await mysqlService.stopMySQL()
      const db = require('./services/database').getDb()
      db.prepare("UPDATE sites SET status = 'stopped' WHERE status = 'running'").run()
      app.exit(0)
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
    // mainWindow.webContents.openDevTools()
  }
}

// Pushes a service event to the renderer (safe to call before window is ready)
function send(channel, payload) {
  if (appIsQuitting) return
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

// Runs the full service startup sequence once the renderer is ready.
// Progress events are pushed to the renderer so a loading overlay can be shown.
async function startServices() {
  // Reset any stale 'running' status left by a previous unclean shutdown
  const db = require('./services/database').getDb()
  db.prepare("UPDATE sites SET status = 'stopped' WHERE status = 'running'").run()
  console.log('[Startup] Reset stale site statuses to stopped')
  // ── MySQL ──────────────────────────────────────────────────────────────────
  try {
    await mysqlService.ensureReady((p) => {
      send('mysql:progress', p)
      // Mirror progress to integration:progress so IntegrationsPage stays in sync
      send('integration:progress', { type: 'mariadb', ...p })
    })
    send('mysql:ready', mysqlService.getStatus())
    send('integration:progress', { type: 'mariadb', status: 'installed', message: 'MariaDB ready', percent: 100 })
  } catch (err) {
    send('mysql:error', { message: err.message })
    send('integration:progress', { type: 'mariadb', status: 'error', message: err.message })
    console.error('[Startup] MySQL failed:', err.message)
    return // Cannot continue without MySQL
  }

  // ── PHP default version (installed only when no PHP version exists on disk) ──
  try {
    send('services:progress', { service: 'php', message: 'Checking PHP installation...' })
    send('integration:progress', { type: 'php', version: '8.2', status: 'downloading', message: 'Checking PHP installation...', percent: 0 })
    await phpService.ensureDefaultVersion((p) => {
      send('services:progress', { service: 'php', ...p })
      send('integration:progress', { type: 'php', version: '8.2', ...p })
    })
    send('integration:progress', { type: 'php', version: '8.2', status: 'installed', message: 'PHP ready', percent: 100 })
  } catch (err) {
    console.error('[Startup] PHP default version failed:', err.message)
    send('services:progress', { service: 'php', status: 'error', message: err.message })
    send('integration:progress', { type: 'php', version: '8.2', status: 'error', message: err.message })
    // Non-fatal — sites simply cannot run without PHP
  }

  // ── Caddy + restore running sites ─────────────────────────────────────────
  try {
    send('services:progress', { service: 'caddy', message: 'Starting web server...' })

    // Kill any stale caddy.exe left from a previous unclean shutdown
    await killStaleCADdy()

    // Ensure port 80 is free before starting Caddy
    const port80Free = await ensurePort80Free(mainWindow)
    if (!port80Free) {
      app.quit()
      return
    }

    await caddyService.startCaddy([], (p) => send('services:progress', { service: 'caddy', ...p }))
    send('services:progress', { service: 'caddy', status: 'running', message: 'Web server ready' })
  } catch (err) {
    console.error('[Startup] Caddy failed:', err.message)
    send('services:progress', { service: 'caddy', status: 'error', message: err.message })
  }

  console.log('[Startup] PHP status after startup:', JSON.stringify(phpService.getStatus()))

  send('services:ready', {
    mysql: mysqlService.getStatus(),
    php: phpService.getStatus(),
    caddy: { running: caddyService.isRunning() },
  })

  // Register crash callbacks to notify renderer when services die unexpectedly
  phpService.onFcgiCrash((version, code, signal) => {
    console.error(`[PHP] FastCGI ${version} crashed (code=${code}, signal=${signal})`)
    send('service:crashed', { service: 'php', version, code, signal })
  })

  caddyService.onCaddyCrash((code) => {
    console.error(`[Caddy] Process crashed (code=${code})`)
    send('service:crashed', { service: 'caddy', code })
  })

  // Silently check GitHub Releases for a newer version (packaged builds only).
  // Results are pushed to the renderer via the 'update:status' channel.
  require('./services/updateService').initAutoUpdater(send)
}

app.whenReady().then(async () => {
  await initDatabase()
  await initWorkspace()

  registerSiteHandlers(ipcMain)
  registerThemeHandlers(ipcMain)
  registerSystemHandlers(ipcMain, () => mainWindow)   // pass getter so handlers always see the current window

  await createWindow()

  // Start services after renderer loads so progress events are received
  mainWindow.webContents.once('did-finish-load', startServices)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async () => {
  appIsQuitting = true
  const db = require('./services/database').getDb()
  db.prepare("UPDATE sites SET status = 'stopped' WHERE status = 'running'").run()

  await caddyService.stopCaddy()
  await phpService.stopAll()
  await mysqlService.stopMySQL()

  const pmaService = require('./services/phpMyAdminService')
  const healthService = require('./services/healthService')
  await pmaService.stopAll()
  healthService.stopAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})