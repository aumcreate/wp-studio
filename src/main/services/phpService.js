const path = require('path')
const fs = require('fs-extra')
const axios = require('axios')
const { app } = require('electron')
const { spawn } = require('child_process')
const { pickWorkingMirror } = require('./mirrorService')
const { getAxiosProxyConfig } = require('./proxyService')

// Static FastCGI port map — one php-cgi process per PHP version
const FCGI_PORTS = {
  '7.4': 9074,
  '8.0': 9080,
  '8.2': 9082,
  '8.3': 9083,
  '8.4': 9084,
  '8.5': 9085,
}

// The version auto-installed on first launch when no PHP is present
const DEFAULT_PHP_VERSION = '8.2'

// Mirror base URLs for PHP Windows binaries.
// Probed in parallel — fastest responder wins.
// Last entry is the official fallback used when all mirrors are unreachable.
const PHP_MIRRORS = [
  'https://cn2.php.net/~windows/releases/archives',
  'https://downloads.php.net/~windows/releases/archives',
]

// Static version catalog — each entry pins the exact binary that ships with the app.
// Ordered newest-first for UI display.
// eol: true        = version has reached end-of-life upstream; UI shows a warning label.
// recommended: true = pre-selected in the create-site form and installed by default.
const VERSION_CATALOG = [
  {
    version: '8.5',
    label: 'PHP 8.5',
    eol: false,
    recommended: false,
    file: 'php-8.5.1-nts-Win32-vs17-x64.zip',
  },
  {
    version: '8.4',
    label: 'PHP 8.4',
    eol: false,
    recommended: false,
    file: 'php-8.4.16-nts-Win32-vs17-x64.zip',
  },
  {
    version: '8.3',
    label: 'PHP 8.3',
    eol: false,
    recommended: false,
    file: 'php-8.3.29-nts-Win32-vs16-x64.zip',
  },
  {
    version: '8.2',
    label: 'PHP 8.2 (Recommended)',
    eol: false,
    recommended: true,
    file: 'php-8.2.30-nts-Win32-vs16-x64.zip',
  },
  {
    version: '8.0',
    label: 'PHP 8.0',
    eol: true,
    recommended: false,
    file: 'php-8.0.30-nts-Win32-vs16-x64.zip',
  },
  {
    version: '7.4',
    label: 'PHP 7.4',
    eol: true,
    recommended: false,
    file: 'php-7.4.30-nts-Win32-vc15-x86.zip',
  },
]

// Derived list of version strings for iteration
const AVAILABLE_VERSIONS = VERSION_CATALOG.map(e => e.version)

// Running php-cgi processes indexed by PHP version string
const _procs = {}

let _onCrash = null
function onFcgiCrash(cb) { _onCrash = cb }

// Per-version installation status
// status: 'not_installed' | 'downloading' | 'installing' | 'installed' | 'error'
const _versionStatus = {}
AVAILABLE_VERSIONS.forEach(v => {
  _versionStatus[v] = { status: 'not_installed', message: '', percent: 0 }
})

// ─── Paths ────────────────────────────────────────────────────────────────────

function getPhpDir(version) {
  return path.join(app.getPath('userData'), 'php', version)
}
function getPhpExe(version) {
  return path.join(getPhpDir(version), process.platform === 'win32' ? 'php.exe' : 'php')
}
function getPhpCgiExe(version) {
  return path.join(getPhpDir(version), process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi')
}
function getCacheDir() {
  return path.join(app.getPath('userData'), '.cache')
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function setVersionState(version, status, message = '', percent = 0) {
  _versionStatus[version] = { status, message, percent }
}

function getVersionStatus(version) {
  return _versionStatus[version] || { status: 'not_installed', message: '', percent: 0 }
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1500) {
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        console.warn(`[PHP] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

// ─── ZIP integrity check ──────────────────────────────────────────────────────

async function verifyZip(zipPath) {
  const stat = await fs.stat(zipPath)
  if (stat.size < 1024 * 100) {
    throw new Error(`Downloaded file is too small (${stat.size} bytes) — likely corrupt`)
  }
  try {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    if (entries.length === 0) throw new Error('ZIP archive contains no entries')
  } catch (err) {
    throw new Error(`ZIP integrity check failed: ${err.message}`)
  }
}

// ─── Streaming download ───────────────────────────────────────────────────────

async function streamDownload(url, destPath, proxyConfig, onProgress) {
  console.log(`[PHP] GET ${url}`)

  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    maxRedirects: 10,
    timeout: 300000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/octet-stream,application/zip,*/*',
      'Accept-Encoding': 'identity',
    },
    ...proxyConfig,
  })

  const contentLength = parseInt(response.headers['content-length'], 10) || 0
  console.log(`[PHP] Response ${response.status}, content-length=${contentLength || 'unknown'}`)

  let downloaded = 0

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath)

    response.data.on('data', (chunk) => {
      downloaded += chunk.length
      if (contentLength > 0) {
        // File size known — report percentage
        const pct = Math.min(100, Math.round((downloaded / contentLength) * 100))
        onProgress?.({ type: 'percent', percent: pct })
      } else {
        // File size unknown — report raw bytes, UI handles display
        onProgress?.({ type: 'bytes', bytes: downloaded })
      }
    })

    response.data.on('error', (err) => {
      writer.destroy()
      fs.remove(destPath).catch(() => { })
      reject(err)
    })

    writer.on('error', (err) => {
      fs.remove(destPath).catch(() => { })
      reject(err)
    })

    writer.on('finish', () => resolve())

    response.data.pipe(writer)
  })

  const stat = await fs.stat(destPath)
  if (stat.size === 0) {
    await fs.remove(destPath)
    throw new Error('Downloaded file is 0 bytes — stream completed without data')
  }
}

// ─── Download & install ───────────────────────────────────────────────────────

async function downloadVersion(version, onProgress) {
  console.log(`[PHP] downloadVersion called for ${version}`)

  if (await fs.pathExists(getPhpExe(version))) {
    console.log(`[PHP] ${version} already installed, skipping download`)
    setVersionState(version, 'installed')
    return
  }

  if (process.platform !== 'win32') {
    throw new Error('Bundled PHP download is only supported on Windows. On macOS, install PHP via Homebrew.')
  }

  const entry = VERSION_CATALOG.find(e => e.version === version)
  if (!entry) throw new Error(`PHP ${version} is not in the supported version catalog`)

  await fs.ensureDir(getCacheDir())

  // Resolve system proxy once — reused for mirror probe and the actual download
  const proxyConfig = await getAxiosProxyConfig('https://downloads.php.net')

  setVersionState(version, 'downloading', `Selecting download mirror for PHP ${version}...`, 0)
  onProgress?.({ status: 'downloading', message: `Selecting download mirror for PHP ${version}...`, percent: 0 })

  // Probe mirrors in parallel with proxy — fastest responder wins
  const mirrorBase = await pickWorkingMirror(
    PHP_MIRRORS,
    `/${entry.file}`,
    4000,
    proxyConfig,
  )

  const url = `${mirrorBase}/${entry.file}`
  const zipPath = path.join(getCacheDir(), entry.file)
  const mirrorLabel = new URL(mirrorBase).hostname

  console.log(`[PHP] Selected mirror: ${mirrorBase}`)

  // Validate any existing cached zip before trusting it
  let needsDownload = !await fs.pathExists(zipPath)
  if (!needsDownload) {
    try {
      await verifyZip(zipPath)
      console.log(`[PHP] Cache hit: ${zipPath} passed integrity check`)
    } catch (err) {
      console.warn(`[PHP] Cached zip failed integrity check (${err.message}), re-downloading...`)
      await fs.remove(zipPath)
      needsDownload = true
    }
  }

  if (needsDownload) {
    await withRetry(async (attempt) => {
      const msg = attempt > 1
        ? `Downloading PHP ${version} from ${mirrorLabel}... (attempt ${attempt})`
        : `Downloading PHP ${version} from ${mirrorLabel}...`

      setVersionState(version, 'downloading', msg, 0)
      onProgress?.({ status: 'downloading', message: msg, percent: 0 })

      await fs.remove(zipPath)

      await streamDownload(url, zipPath, proxyConfig, (progress) => {
        if (progress.type === 'bytes') {
          // Content-length unknown — show downloaded MB without percentage
          const mb = (progress.bytes / 1024 / 1024).toFixed(1)
          const txt = `${msg} · ${mb} MB`
          setVersionState(version, 'downloading', txt, null)
          onProgress?.({ status: 'downloading', message: txt, percent: null, downloadedBytes: progress.bytes })
        } else {
          // Content-length known — show percentage
          setVersionState(version, 'downloading', `${msg} ${progress.percent}%`, progress.percent)
          onProgress?.({ status: 'downloading', message: `${msg} ${progress.percent}%`, percent: progress.percent })
        }
      })

      try {
        await verifyZip(zipPath)
      } catch (err) {
        await fs.remove(zipPath)
        throw err
      }
    }, 3, 2000)
  }

  setVersionState(version, 'installing', `Installing PHP ${version}...`, 99)
  onProgress?.({ status: 'installing', message: `Installing PHP ${version}...`, percent: 99 })

  const phpDir = getPhpDir(version)
  await fs.ensureDir(phpDir)

  await new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${phpDir}"`,
    ], { windowsHide: true })

    proc.stdout?.on('data', (d) => console.log(`[PHP] Extract stdout: ${d.toString().trim()}`))
    proc.stderr?.on('data', (d) => console.warn(`[PHP] Extract stderr: ${d.toString().trim()}`))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`PowerShell Expand-Archive exited with code ${code}`))
    })
    proc.on('error', reject)
  })

  // Minimal php.ini enabling the extensions WordPress requires
  const phpIni = [
    'extension_dir = "ext"',
    'extension=curl',
    'extension=fileinfo',
    'extension=gd',
    'extension=mbstring',
    'extension=mysqli',
    'extension=openssl',
    'extension=pdo_mysql',
    'extension=zip',
    'upload_max_filesize = 64M',
    'post_max_size = 64M',
    'memory_limit = 256M',
    'max_execution_time = 300',
    'date.timezone = UTC',
  ].join('\n')
  await fs.writeFile(path.join(phpDir, 'php.ini'), phpIni)

  setVersionState(version, 'installed', `PHP ${version} ready.`, 100)
  onProgress?.({ status: 'installed', message: `PHP ${version} ready.`, percent: 100 })
  console.log(`[PHP] PHP ${version} installation complete`)
}

// ─── FastCGI process management ───────────────────────────────────────────────

function getFcgiPort(version) {
  return FCGI_PORTS[version] || 9082
}

async function startFcgi(version, onProgress) {
  if (_procs[version]) return

  if (!await fs.pathExists(getPhpCgiExe(version))) {
    await downloadVersion(version, onProgress)
  }

  const port = getFcgiPort(version)
  onProgress?.({ status: 'starting', message: `Starting PHP ${version} FastCGI on port ${port}...` })

  return new Promise((resolve, reject) => {
    const proc = spawn(getPhpCgiExe(version), ['-b', `127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PHPRC: getPhpDir(version),
        PHP_FCGI_MAX_REQUESTS: '0',
        PHP_FCGI_CHILDREN: '4',
      },
    })

    _procs[version] = proc

    proc.on('error', (err) => {
      delete _procs[version]
      const msg = err.code === 'EADDRINUSE'
        ? `PHP ${version} FastCGI could not start: port ${port} is already in use. Another process may be occupying it.`
        : err.message
      reject(new Error(msg))
    })

    proc.on('exit', (code, signal) => {
      const wasRunning = !!_procs[version]
      delete _procs[version]
      if (wasRunning && _onCrash) _onCrash(version, code, signal)
    })

    setTimeout(() => {
      if (_procs[version]) {
        console.log(`[PHP] FastCGI ${version} started on port ${port}`)
        resolve()
      } else {
        reject(new Error(
          `PHP ${version} FastCGI failed to start (exited immediately). ` +
          `Port ${port} may be in use, or the PHP binary may be corrupted. ` +
          `Try removing PHP ${version} in the Integrations page and reinstalling.`
        ))
      }
    }, 1000)
  })
}

async function stopFcgi(version) {
  const proc = _procs[version]
  if (!proc) return
  try { proc.kill() } catch { }
  delete _procs[version]
}

async function stopAll() {
  for (const version of Object.keys(_procs)) {
    await stopFcgi(version)
  }
}

// ─── Installation status detection ───────────────────────────────────────────

async function refreshInstalledVersions() {
  for (const v of AVAILABLE_VERSIONS) {
    const installed = await fs.pathExists(getPhpExe(v))
    if (installed && _versionStatus[v].status === 'not_installed') {
      setVersionState(v, 'installed')
    }
  }
}

// Returns true if at least one PHP version binary exists on disk
async function hasAnyInstalledVersion() {
  for (const v of AVAILABLE_VERSIONS) {
    if (await fs.pathExists(getPhpExe(v))) return true
  }
  return false
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function ensureVersion(version, onProgress) {
  await downloadVersion(version, onProgress)
  await startFcgi(version, onProgress)
}

// Installs DEFAULT_PHP_VERSION only when no PHP version is present on disk.
// Called during app startup to guarantee at least one usable PHP binary.
async function ensureDefaultVersion(onProgress) {
  if (await hasAnyInstalledVersion()) {
    console.log('[PHP] At least one PHP version already installed, skipping default download')
    return
  }
  console.log(`[PHP] No PHP found, installing default version ${DEFAULT_PHP_VERSION}`)
  await ensureVersion(DEFAULT_PHP_VERSION, onProgress)
}

function getStatus() {
  const running = Object.keys(_procs)
  const installed = AVAILABLE_VERSIONS.filter(v =>
    require('fs').existsSync(getPhpExe(v))
  )
  return {
    running,
    installed,
    ports: Object.fromEntries(running.map(v => [v, getFcgiPort(v)])),
  }
}

async function getAllVersionsStatus() {
  await refreshInstalledVersions()
  return AVAILABLE_VERSIONS.map(v => {
    const catalog = VERSION_CATALOG.find(e => e.version === v)
    return {
      version: v,
      label: catalog?.label || v,
      eol: catalog?.eol || false,
      recommended: catalog?.recommended || false,
      ...getVersionStatus(v),
      running: Object.keys(_procs).includes(v),
    }
  })
}

module.exports = {
  VERSION_CATALOG,
  AVAILABLE_VERSIONS,
  DEFAULT_PHP_VERSION,
  ensureVersion,
  ensureDefaultVersion,
  downloadVersion,
  startFcgi,
  stopFcgi,
  stopAll,
  getFcgiPort,
  getPhpExe,
  getStatus,
  getAllVersionsStatus,
  getVersionStatus,
  hasAnyInstalledVersion,
  onFcgiCrash,
}