const { exec, execSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

// Laravel Herd stores sites in ~/Herd by default
// We communicate with Herd via its CLI and by placing sites in its served directory

const HERD_SITE_DIR = path.join(os.homedir(), 'Herd')
const HERD_CLI = process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'herd', 'resources', 'cli', 'bin', 'herd.bat')
  : '/usr/local/bin/herd'

async function isHerdInstalled() {
  try {
    if (process.platform === 'darwin') {
      const appPath = '/Applications/Herd.app'
      return await fs.pathExists(appPath)
    } else {
      const exePath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'herd', 'Herd.exe')
      return await fs.pathExists(exePath)
    }
  } catch {
    return false
  }
}

async function isHerdRunning() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32'
      ? 'tasklist /FI "IMAGENAME eq Herd.exe" 2>nul'
      : 'pgrep -x Herd'
    exec(cmd, (err, stdout) => {
      resolve(!err && stdout.trim().length > 0)
    })
  })
}

function runHerdCommand(command) {
  return new Promise((resolve, reject) => {
    exec(`"${HERD_CLI}" ${command}`, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message)
      resolve(stdout.trim())
    })
  })
}

async function getHerdStatus() {
  const installed = await isHerdInstalled()
  const running   = installed ? await isHerdRunning() : false
  return { installed, running, siteDir: HERD_SITE_DIR }
}

// Links a site directory into Herd's served directory
// Herd automatically serves any directory inside ~/Herd as a .test domain
async function linkSiteToHerd(siteName, siteDocRoot) {
  const herdSitePath = path.join(HERD_SITE_DIR, siteName)
  if (await fs.pathExists(herdSitePath)) {
    await fs.remove(herdSitePath)
  }
  // On Windows symlinks require elevated privileges; use junction for dirs
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir'
  await fs.ensureSymlink(siteDocRoot, herdSitePath, symlinkType)
}

async function unlinkSiteFromHerd(siteName) {
  const herdSitePath = path.join(HERD_SITE_DIR, siteName)
  if (await fs.pathExists(herdSitePath)) {
    await fs.remove(herdSitePath)
  }
}

async function getAvailablePhpVersions() {
  try {
    const output = await runHerdCommand('php:list --json')
    return JSON.parse(output)
  } catch {
    // Fallback list if Herd CLI is not responsive
    return ['8.3', '8.2', '8.1', '8.0', '7.4']
  }
}

module.exports = {
  isHerdInstalled,
  isHerdRunning,
  getHerdStatus,
  linkSiteToHerd,
  unlinkSiteFromHerd,
  getAvailablePhpVersions,
  HERD_SITE_DIR,
}
