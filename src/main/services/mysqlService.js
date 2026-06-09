const path = require('path')
const fs = require('fs-extra')
const axios = require('axios')
const AdmZip = require('adm-zip')
const { app } = require('electron')
const { spawn } = require('child_process')
const mysql = require('mysql2/promise')
const portfinder = require('portfinder')
const { pickWorkingMirror } = require('./mirrorService')
const { getAxiosProxyConfig } = require('./proxyService')

const MARIADB_SERIES = '10.11'
const MARIADB_API = `https://downloads.mariadb.org/rest-api/mariadb/${MARIADB_SERIES}/`

const MARIADB_MIRRORS = [
  'https://mirrors.tuna.tsinghua.edu.cn/mariadb',
  'https://mirrors.aliyun.com/mariadb',
  'https://mirrors.ustc.edu.cn/mariadb',
  'https://archive.mariadb.org',
]

let _proc = null
let _port = 3306
let _status = 'stopped'
let _message = ''
let _percent = 0

// ─── Paths ────────────────────────────────────────────────────────────────────

function getBinDir() { return path.join(app.getPath('userData'), 'mariadb') }
function getDataDir() { return path.join(app.getPath('userData'), 'mariadb-data') }
function getCacheDir() { return path.join(app.getPath('userData'), '.cache') }

function getMysqldBin() {
  return path.join(getBinDir(), 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld')
}
function getMysqladminBin() {
  return path.join(getBinDir(), 'bin', process.platform === 'win32' ? 'mysqladmin.exe' : 'mysqladmin')
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function setState(status, message = '', percent = 0) {
  _status = status
  _message = message
  _percent = percent
  console.log(`[MySQL] ${status}${message ? ': ' + message : ''}`)
}

function getStatus() {
  return { status: _status, message: _message, port: _port, percent: _percent }
}

// Reports whether MariaDB binaries are already installed on disk.
function isInstalled() {
  return require('fs').existsSync(getMysqldBin())
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry(fn, maxAttempts = 3, baseDelayMs = 2000) {
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        console.warn(`[MySQL] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

// ─── ZIP integrity check ──────────────────────────────────────────────────────

async function verifyZip(zipPath) {
  const stat = await fs.stat(zipPath)
  if (stat.size < 1024 * 1024 * 10) {
    throw new Error(`Downloaded file is too small (${(stat.size / 1024 / 1024).toFixed(1)} MB) — likely corrupt`)
  }
  try {
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    if (entries.length === 0) throw new Error('ZIP archive contains no entries')
  } catch (err) {
    throw new Error(`ZIP integrity check failed: ${err.message}`)
  }
}

// ─── Version resolution ───────────────────────────────────────────────────────

const MARIADB_FALLBACK_VERSIONS = ['10.11.10', '10.11.9', '10.11.8', '10.11.7']

async function resolveMariaDbVersion() {
  try {
    const { data } = await axios.get(MARIADB_API, { timeout: 8000 })
    const source = typeof data.releases === 'object' && data.releases ? data.releases : data
    const versions = Object.keys(source).filter(k => /^\d+\.\d+\.\d+$/.test(k))

    if (versions.length > 0) {
      versions.sort((a, b) => {
        const av = a.split('.').map(Number)
        const bv = b.split('.').map(Number)
        for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return bv[i] - av[i]
        return 0
      })
      console.log(`[MySQL] Resolved version from API: ${versions[0]}`)
      return versions[0]
    }
    throw new Error('No version keys found in API response')
  } catch (err) {
    console.warn('[MySQL] Version API failed, using fallback version:', err.message)
    return MARIADB_FALLBACK_VERSIONS[0]
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function downloadBinaries(onProgress) {
  if (await fs.pathExists(getMysqldBin())) return

  setState('downloading', 'Fetching MariaDB release info...', 0)
  onProgress?.({ status: 'downloading', message: 'Fetching MariaDB release info...', percent: 0 })

  const version = await resolveMariaDbVersion()
  const filePath = `/mariadb-${version}/winx64-packages/mariadb-${version}-winx64.zip`
  const zipName = `mariadb-${version}-winx64.zip`
  const zipPath = path.join(getCacheDir(), zipName)

  await fs.ensureDir(getCacheDir())

  await withRetry(async (attempt) => {
    const needsDownload = !await fs.pathExists(zipPath)

    if (needsDownload) {
      onProgress?.({ status: 'downloading', message: 'Selecting download mirror...', percent: 0 })
      const proxyConfig = await getAxiosProxyConfig('https://archive.mariadb.org')
      const mirrorBase = await pickWorkingMirror(MARIADB_MIRRORS, filePath, 5000, proxyConfig)
      const downloadUrl = `${mirrorBase}${filePath}`

      const label = mirrorBase.includes('archive.mariadb.org') ? 'official' : new URL(mirrorBase).hostname
      const msg = attempt > 1
        ? `Downloading MariaDB ${version} from ${label}... (attempt ${attempt})`
        : `Downloading MariaDB ${version} from ${label}...`

      setState('downloading', msg, 0)
      onProgress?.({ status: 'downloading', message: msg, percent: 0 })
      console.log(`[MySQL] Downloading from: ${downloadUrl}`)

      // Remove partial file from any previous failed attempt
      await fs.remove(zipPath)

      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 0,
        ...proxyConfig,
        onDownloadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0
          setState('downloading', `${msg} ${pct}%`, pct)
          onProgress?.({ status: 'downloading', message: `${msg} ${pct}%`, percent: pct })
        },
      })

      await fs.writeFile(zipPath, response.data)

      // Integrity check — remove and retry on failure
      try {
        await verifyZip(zipPath)
      } catch (err) {
        await fs.remove(zipPath)
        throw err
      }
    }
  }, 3, 2000)

  setState('installing', 'Extracting MariaDB...', 0)
  onProgress?.({ status: 'installing', message: 'Extracting MariaDB...', percent: 0 })

  const tempDir = path.join(app.getPath('userData'), '.tmp-mariadb')
  await fs.remove(tempDir)
  await fs.ensureDir(tempDir)
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(tempDir, true)

  const entries = await fs.readdir(tempDir)
  const mariaDbEntry = entries.find(e => e.toLowerCase().startsWith('mariadb-'))
  if (!mariaDbEntry) throw new Error('Unexpected zip structure: no mariadb- folder found')

  await fs.remove(getBinDir())
  await fs.move(path.join(tempDir, mariaDbEntry), getBinDir())
  await fs.remove(tempDir)

  onProgress?.({ status: 'installing', message: 'MariaDB extracted.', percent: 100 })
}

// ─── Data directory init ──────────────────────────────────────────────────────

function getMysqlInstallDbBin() {
  return path.join(getBinDir(), 'bin', 'mysql_install_db.exe')
}

async function initializeDataDir(onProgress) {
  if (await fs.pathExists(path.join(getDataDir(), 'mysql'))) return

  setState('installing', 'Initializing database files...')
  onProgress?.({ status: 'installing', message: 'Initializing database files...' })

  await fs.ensureDir(getDataDir())

  const useInstallDb = process.platform === 'win32' && await fs.pathExists(getMysqlInstallDbBin())

  const bin = useInstallDb ? getMysqlInstallDbBin() : getMysqldBin()
  const args = useInstallDb
    ? [`--datadir=${getDataDir()}`, '--password=']
    : ['--no-defaults', `--datadir=${getDataDir()}`, '--initialize-insecure']

  console.log(`[MySQL] Initializing with: ${path.basename(bin)} ${args.join(' ')}`)

  await new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

    let out = ''
    proc.stdout?.on('data', d => { out += d.toString() })
    proc.stderr?.on('data', d => { out += d.toString() })

    proc.on('error', reject)
    proc.on('close', async (code) => {
      console.log(`[MySQL] Init exited ${code}${out ? ': ' + out.trim() : ''}`)
      if (code === 0 || await fs.pathExists(path.join(getDataDir(), 'mysql'))) {
        resolve()
      } else {
        const label = useInstallDb ? 'mysql_install_db.exe' : 'mysqld --initialize-insecure'
        reject(new Error(`${label} failed (exit ${code})${out.trim() ? ': ' + out.trim() : ''}`))
      }
    })
  })
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

async function waitForConnection(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const conn = await mysql.createConnection({
        host: '127.0.0.1', port, user: 'root', password: '',
        connectTimeout: 1000,
      })
      await conn.end()
      return
    } catch {
      await new Promise(r => setTimeout(r, 400))
    }
  }
  throw new Error(`MySQL did not become ready within ${timeoutMs / 1000}s`)
}

async function startMySQL(onProgress) {
  if (_status === 'running') return
  if (_proc) return

  portfinder.basePort = 3306
  _port = await portfinder.getPortPromise()

  setState('starting', `Starting MySQL on port ${_port}...`)
  onProgress?.({ status: 'starting', message: `Starting MySQL on port ${_port}...` })

  _proc = spawn(getMysqldBin(), [
    '--no-defaults',
    `--datadir=${getDataDir()}`,
    `--port=${_port}`,
    '--bind-address=127.0.0.1',
    '--skip-networking=0',
    '--skip-ssl',
    '--max-allowed-packet=64M',
    '--innodb-buffer-pool-size=64M',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  })

  _proc.stderr?.on('data', d => process.stdout.write(`[mysqld] ${d}`))
  _proc.stdout?.on('data', d => process.stdout.write(`[mysqld] ${d}`))

  _proc.on('error', (err) => {
    setState('error', err.message)
    _proc = null
  })
  _proc.on('exit', (code, signal) => {
    if (_status === 'running') {
      setState('stopped', `Process exited (code=${code}, signal=${signal})`)
    }
    _proc = null
  })

  await waitForConnection(_port)

  try {
    const { setSetting } = require('./settingsService')
    setSetting('mysql_host', '127.0.0.1')
    setSetting('mysql_port', String(_port))
    setSetting('mysql_user', 'root')
    setSetting('mysql_password', '')
  } catch { }

  setState('running')
  onProgress?.({ status: 'running', message: `MySQL running on port ${_port}` })
}

async function stopMySQL() {
  if (!_proc) return

  try {
    await new Promise((resolve) => {
      const p = spawn(getMysqladminBin(), [
        '-u', 'root', `--port=${_port}`, '--protocol=TCP', 'shutdown',
      ], { stdio: 'ignore', windowsHide: true })
      p.on('close', resolve)
      p.on('error', resolve)
      setTimeout(resolve, 4000)
    })
  } catch { }

  if (_proc) {
    try { _proc.kill() } catch { }
    _proc = null
  }
  setState('stopped')
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function ensureReady(onProgress) {
  try {
    await downloadBinaries(onProgress)
    await initializeDataDir(onProgress)
    await startMySQL(onProgress)
  } catch (err) {
    setState('error', err.message)
    throw err
  }
}

module.exports = { ensureReady, stopMySQL, getStatus, isInstalled, downloadBinaries }
