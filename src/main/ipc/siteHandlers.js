const { shell, app } = require('electron')
const { exec } = require('child_process')
const path = require('path')
const { createSite, startSite, stopSite, deleteSite, listSites, getSite, updateSite, updateSiteSharedTheme } = require('../services/siteService')
const { getWordPressVersions } = require('../services/wordpress')
const pmaService = require('../services/phpMyAdminService')

function registerSiteHandlers(ipcMain) {
  ipcMain.handle('sites:list', async () => {
    try {
      return { ok: true, data: listSites() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:create', async (event, data) => {
    try {
      const site = await createSite(data, (msg) => {
        event.sender.send('site:log', { siteId: 'creating', message: msg })
      })

      // Notify renderer of updated PHP runtime status so the sidebar
      // PHP indicator reflects the newly started FastCGI process.
      const phpService = require('../services/phpService')
      event.sender.send('services:phpStatus', phpService.getStatus())

      return { ok: true, data: site }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:delete', async (_, siteId) => {
    try {
      await deleteSite(siteId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:open', async (_, siteId) => {
    try {
      const site = getSite(siteId)
      if (!site) throw new Error('Site not found')
      await shell.openExternal(`http://${site.domain}`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:openAdmin', async (_, siteId) => {
    try {
      const site = getSite(siteId)
      if (!site) throw new Error('Site not found')
      await shell.openExternal(`http://${site.domain}/wp-admin`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:openFolder', async (_, siteId) => {
    try {
      const site = getSite(siteId)
      if (!site) throw new Error('Site not found')
      await shell.openPath(site.path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:start', async (event, siteId) => {
    try {
      console.log('[IPC] sites:start called for', siteId)
      const site = await startSite(siteId, (msg) => {
        console.log('[IPC] startSite progress:', msg)
        event.sender.send('site:log', { siteId, message: msg })
      })
      console.log('[IPC] startSite done, caddy isRunning:', require('../services/caddyService').isRunning())

      // Notify the renderer of the updated PHP runtime status so the sidebar
      // PHP indicator turns green without requiring a manual page refresh.
      const phpService = require('../services/phpService')
      const phpStatus = phpService.getStatus()
      console.log('[IPC] sites:start sending services:phpStatus:', JSON.stringify(phpStatus))
      event.sender.send('services:phpStatus', phpStatus)

      return { ok: true, data: site }
    } catch (err) {
      console.error('[IPC] sites:start error:', err.message)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:stop', async (event, siteId) => {
    try {
      const site = await stopSite(siteId)
      const phpService = require('../services/phpService')
      event.sender.send('services:phpStatus', phpService.getStatus())
      return { ok: true, data: site }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:getStatus', async (_, siteId) => {
    try {
      const site = getSite(siteId)
      return { ok: true, data: site }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('wordpress:getVersions', async () => {
    try {
      return { ok: true, data: await getWordPressVersions() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('sites:openPma', async (_, siteId) => {
    try {
      const site = getSite(siteId)
      if (!site) throw new Error('Site not found')
      let port = pmaService.getPort(siteId)
      if (!port) {
        port = await pmaService.startPma(siteId, site.php_version || '8.2')
      }
      await shell.openExternal(`http://127.0.0.1:${port}`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('sites:update', async (_, { siteId, name, phpVersion, sharedThemeId }) => {
    try {
      const site = await updateSite(siteId, { name, phpVersion, sharedThemeId })
      return { ok: true, data: site }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Opens a system terminal cd'd into the site's WordPress directory.
  // On Windows: PowerShell. On macOS: Terminal.app.
  // The site's PHP binary directory is prepended to PATH so that running
  // `php wp-cli.phar` or `wp` works without specifying the full path.
  ipcMain.handle('sites:openTerminal', async (_, siteId) => {
    try {
      const site = getSite(siteId)
      if (!site) throw new Error('Site not found')

      const wpDir = path.join(site.path, 'wordpress')
      const phpDir = path.join(app.getPath('userData'), 'php', site.php_version)

      // Resolve the bundled WP-CLI phar so the shell can expose a `wp` command.
      const wpCliPath = app.isPackaged
        ? path.join(process.resourcesPath, 'resources', 'bin', 'wp-cli.phar')
        : path.join(app.getAppPath(), 'resources', 'bin', 'wp-cli.phar')

      if (process.platform === 'win32') {
        // Build a PowerShell command that sets PATH, defines a `wp` wrapper
        // around php + wp-cli.phar, and cd's into the WP directory — so the
        // user can run `wp …` (e.g. wp i18n make-pot) just like in Local.
        const psCmd = [
          `$env:PATH = "${phpDir};$env:PATH"`,
          `function wp { & php "${wpCliPath}" @args }`,
          `Set-Location "${wpDir}"`,
          `Write-Host "WP Studio — ${site.name}" -ForegroundColor Cyan`,
          `Write-Host "PHP ${site.php_version} and 'wp' (WP-CLI) are ready. Try: wp --info" -ForegroundColor DarkGray`,
        ].join('; ')

        exec(`start powershell -NoExit -Command "${psCmd.replace(/"/g, '\\"')}"`)
      } else {
        // macOS: open a new Terminal window with the correct directory, PATH,
        // and a `wp` alias pointing at php + the bundled wp-cli.phar.
        const script = `tell application "Terminal"
  activate
  do script "export PATH='${phpDir}:$PATH' && alias wp='php \\"${wpCliPath}\\"' && cd '${wpDir}' && echo 'WP Studio — ${site.name} (php + wp ready)'"
end tell`
        exec(`osascript -e '${script.replace(/'/g, "\\'")}'`)
      }

      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Opens the site's WordPress folder in Visual Studio Code.
  // Tries the `code` CLI first (works when VS Code is on PATH), then falls
  // back to probing common install locations for Code.exe.
  ipcMain.handle('sites:openInEditor', async (_, siteId) => {
    try {
      const site = getSite(siteId)
      if (!site) throw new Error('Site not found')
      const target = path.join(site.path, 'wordpress')

      const launched = await openInVscode(target)
      if (!launched) {
        throw new Error(
          'Visual Studio Code was not found. Install VS Code, or run ' +
          '"Shell Command: Install \'code\' command in PATH" from inside VS Code, then try again.'
        )
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

// Attempts to open a folder in VS Code. Resolves true on success, false when
// no VS Code installation could be located.
function openInVscode(target) {
  return new Promise((resolve) => {
    // 1) Try the `code` CLI shim via the shell (covers PATH installs).
    const cli = process.platform === 'win32' ? 'code.cmd' : 'code'
    exec(`${cli} "${target}"`, (err) => {
      if (!err) { resolve(true); return }

      // 2) Fall back to a bare `code` (some setups expose code, not code.cmd).
      exec(`code "${target}"`, (err2) => {
        if (!err2) { resolve(true); return }

        // 3) Probe common Windows install locations for Code.exe.
        if (process.platform !== 'win32') { resolve(false); return }
        const candidates = [
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
          path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'),
          path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft VS Code', 'Code.exe'),
        ]
        const exe = candidates.find(p => p && require('fs').existsSync(p))
        if (!exe) { resolve(false); return }
        exec(`"${exe}" "${target}"`, (err3) => resolve(!err3))
      })
    })
  })
}

module.exports = { registerSiteHandlers }