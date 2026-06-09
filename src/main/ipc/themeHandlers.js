const { dialog, shell } = require('electron')
const { importThemeFromPath, listThemes, deleteTheme } = require('../services/themeService')
const { exportPot } = require('../services/i18nService')
const { getDb } = require('../services/database')

function registerThemeHandlers(ipcMain) {
  // Opens native file picker and imports selected theme (zip or folder)
  ipcMain.handle('themes:selectFolder', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Theme to Import',
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'WordPress Theme', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (canceled || filePaths.length === 0) return { ok: false, canceled: true }

    try {
      const theme = await importThemeFromPath(filePaths[0])
      return { ok: true, data: theme }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('themes:import', async (_, sourcePath) => {
    try {
      const theme = await importThemeFromPath(sourcePath)
      return { ok: true, data: theme }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('themes:list', async () => {
    try {
      return { ok: true, data: listThemes() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('themes:delete', async (_, themeId) => {
    try {
      await deleteTheme(themeId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('themes:openFolder', async (_, themeId) => {
    try {
      const theme = getDb().prepare('SELECT * FROM themes WHERE id = ?').get(themeId)
      if (!theme) throw new Error('Theme not found')
      await shell.openPath(theme.path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Generates a .pot translation template for a shared theme in the pool.
  // Output: <theme>/languages/<text-domain>.pot
  ipcMain.handle('themes:exportPot', async (_, themeId) => {
    try {
      const theme = getDb().prepare('SELECT * FROM themes WHERE id = ?').get(themeId)
      if (!theme) throw new Error('Theme not found')
      const result = await exportPot(theme.path)
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Opens a folder picker and generates a .pot for an arbitrary theme or
  // plugin directory (e.g. a plugin inside a site's wp-content/plugins).
  ipcMain.handle('themes:exportPotFromFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Theme or Plugin Folder',
      properties: ['openDirectory'],
    })

    if (canceled || filePaths.length === 0) return { ok: false, canceled: true }

    try {
      const result = await exportPot(filePaths[0])
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Reveals a generated .pot file in the system file manager.
  ipcMain.handle('themes:revealPot', async (_, potPath) => {
    try {
      shell.showItemInFolder(potPath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { registerThemeHandlers }
