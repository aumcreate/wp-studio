const { shell }            = require('electron')
const { getHerdStatus }    = require('../services/herd')
const { WORKSPACE_DIR }    = require('../services/workspace')
const { getAllSettings, setSetting } = require('../services/settingsService')
const mysqlService        = require('../services/mysqlService')
const phpService          = require('../services/phpService')
const caddyService        = require('../services/caddyService')
const integrationService  = require('../services/integrationService')
const updateService       = require('../services/updateService')

function registerSystemHandlers(ipcMain, getMainWindow) {
  const mainWindow = () => getMainWindow()

  ipcMain.handle('system:herdStatus', async () => {
    try { return { ok: true, data: await getHerdStatus() } }
    catch (err) { return { ok: false, error: err.message } }
  })

  ipcMain.handle('system:workspaceDir', () => {
    return { ok: true, data: WORKSPACE_DIR }
  })

  ipcMain.handle('system:getMysqlStatus', () => {
    return { ok: true, data: mysqlService.getStatus() }
  })

  ipcMain.handle('system:getServicesStatus', () => {
    return {
      ok: true,
      data: {
        mysql: mysqlService.getStatus(),
        php:   phpService.getStatus(),
        caddy: { running: caddyService.isRunning() },
      },
    }
  })

  ipcMain.handle('system:getSettings', () => {
    try { return { ok: true, data: getAllSettings() } }
    catch (err) { return { ok: false, error: err.message } }
  })

  ipcMain.handle('system:saveSettings', async (_, settings) => {
    try {
      for (const [key, value] of Object.entries(settings)) setSetting(key, value)
      return { ok: true }
    } catch (err) { return { ok: false, error: err.message } }
  })

  // ─── Integration management ─────────────────────────────────────────────────

  // Returns installation + runtime status for all integrations (PHP versions + MariaDB).
  ipcMain.handle('integrations:getAll', async () => {
    try { return { ok: true, data: await integrationService.getAllIntegrationStatus() } }
    catch (err) { return { ok: false, error: err.message } }
  })

  // Installs a specific PHP version, pushing progress events to the renderer.
  ipcMain.handle('integrations:installPhp', async (event, version) => {
    try {
      await integrationService.installPhpVersion(version, (progress) => {
        event.sender.send('integration:progress', { type: 'php', version, ...progress })
      })
      return { ok: true }
    } catch (err) {
      event.sender.send('integration:progress', {
        type: 'php', version, status: 'error', message: err.message,
      })
      return { ok: false, error: err.message }
    }
  })

  // Removes a PHP version from disk.
  ipcMain.handle('integrations:removePhp', async (_, version) => {
    try {
      await integrationService.removePhpVersion(version)
      return { ok: true }
    } catch (err) { return { ok: false, error: err.message } }
  })

  // Installs MariaDB binaries, pushing progress events to the renderer.
  ipcMain.handle('integrations:installMariaDb', async (event) => {
    try {
      await integrationService.installMariaDb((progress) => {
        event.sender.send('integration:progress', { type: 'mariadb', ...progress })
      })
      return { ok: true }
    } catch (err) {
      event.sender.send('integration:progress', {
        type: 'mariadb', status: 'error', message: err.message,
      })
      return { ok: false, error: err.message }
    }
  })

  // ─── Window controls ────────────────────────────────────────────────────────

  ipcMain.handle('system:minimize', () => mainWindow()?.minimize())
  ipcMain.handle('system:maximize', () => {
    const win = mainWindow()
    win?.isMaximized() ? win.unmaximize() : win?.maximize()
  })
  ipcMain.handle('system:close', () => mainWindow()?.close())

  // Opens an external URL in the user's default browser. Only http(s) URLs are
  // permitted, to avoid launching arbitrary protocols.
  ipcMain.handle('system:openExternal', async (_, url) => {
    try {
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed')
      await shell.openExternal(url)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('system:toggleDevTools', () => {
    const win = mainWindow()
    if (!win) return
    win.webContents.isDevToolsOpened()
      ? win.webContents.closeDevTools()
      : win.webContents.openDevTools()
  })

  // ─── App updates (electron-updater + GitHub Releases) ────────────────────────

  ipcMain.handle('update:getVersion', () => ({ ok: true, data: updateService.getVersion() }))
  ipcMain.handle('update:check', () => updateService.checkForUpdates())
  ipcMain.handle('update:download', () => updateService.downloadUpdate())
  ipcMain.handle('update:install', () => updateService.quitAndInstall())
}

module.exports = { registerSystemHandlers }