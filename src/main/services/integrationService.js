const phpService   = require('./phpService')
const mysqlService = require('./mysqlService')

// Tracks active download tasks to prevent duplicate concurrent downloads.
const _activeDownloads = new Set()

// ─── PHP version management ───────────────────────────────────────────────────

// Returns installation and runtime status for all known PHP versions.
async function getPhpVersionsStatus() {
  return phpService.getAllVersionsStatus()
}

// Installs a specific PHP version, streaming progress via onProgress callback.
// Prevents duplicate concurrent installs for the same version.
async function installPhpVersion(version, onProgress) {
  const key = `php-${version}`
  if (_activeDownloads.has(key)) {
    throw new Error(`PHP ${version} is already being downloaded`)
  }

  _activeDownloads.add(key)
  try {
    await phpService.downloadVersion(version, onProgress)
  } finally {
    _activeDownloads.delete(key)
  }
}

// Removes an installed PHP version from disk (stops its FastCGI process first).
async function removePhpVersion(version) {
  const fs = require('fs-extra')
  const path = require('path')
  const { app } = require('electron')

  await phpService.stopFcgi(version)

  const phpDir = path.join(app.getPath('userData'), 'php', version)
  await fs.remove(phpDir)
}

// ─── MariaDB management ───────────────────────────────────────────────────────

// Returns the current MariaDB installation and runtime status.
function getMariaDbStatus() {
  return mysqlService.getStatus()
}

// Returns true if the MariaDB binary is already on disk.
function isMariaDbInstalled() {
  return mysqlService.isInstalled()
}

// Downloads and extracts MariaDB binaries (does not start the server).
async function installMariaDb(onProgress) {
  const key = 'mariadb'
  if (_activeDownloads.has(key)) {
    throw new Error('MariaDB is already being downloaded')
  }

  _activeDownloads.add(key)
  try {
    await mysqlService.downloadBinaries(onProgress)
  } finally {
    _activeDownloads.delete(key)
  }
}

// ─── Combined overview ────────────────────────────────────────────────────────

// Returns a full snapshot of all integration statuses for the UI overview panel.
async function getAllIntegrationStatus() {
  const phpVersions = await getPhpVersionsStatus()
  const mariaDb     = getMariaDbStatus()

  return {
    mariadb: {
      installed: isMariaDbInstalled(),
      ...mariaDb,
    },
    php: phpVersions,
  }
}

module.exports = {
  getPhpVersionsStatus,
  installPhpVersion,
  removePhpVersion,
  getMariaDbStatus,
  isMariaDbInstalled,
  installMariaDb,
  getAllIntegrationStatus,
}
