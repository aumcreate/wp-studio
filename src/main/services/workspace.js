const path = require('path')
const fs = require('fs-extra')
const os = require('os')

const WORKSPACE_DIR = path.join(os.homedir(), 'WP-Studio')

const DIRS = {
  root:         WORKSPACE_DIR,
  sites:        path.join(WORKSPACE_DIR, 'sites'),
  sharedThemes: path.join(WORKSPACE_DIR, 'shared-themes'),
  backups:      path.join(WORKSPACE_DIR, 'backups'),
}

async function initWorkspace() {
  for (const dir of Object.values(DIRS)) {
    await fs.ensureDir(dir)
  }
  console.log('[Workspace] Initialized at', WORKSPACE_DIR)
}

function getWorkspaceDirs() {
  return DIRS
}

function getSitePath(siteSlug) {
  return path.join(DIRS.sites, siteSlug)
}

function getSharedThemePath(themeSlug) {
  return path.join(DIRS.sharedThemes, themeSlug)
}

function getWpThemesPath(siteSlug) {
  return path.join(DIRS.sites, siteSlug, 'wordpress', 'wp-content', 'themes')
}

module.exports = {
  initWorkspace,
  getWorkspaceDirs,
  getSitePath,
  getSharedThemePath,
  getWpThemesPath,
  WORKSPACE_DIR,
}
