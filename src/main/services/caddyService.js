const path = require('path')
const fs = require('fs-extra')
const axios = require('axios')
const AdmZip = require('adm-zip')
const { app } = require('electron')
const { spawn, execFile } = require('child_process')
const { getFcgiPort } = require('./phpService')
const { getAxiosProxyConfig } = require('./proxyService')

let _proc = null
let _onCrash = null
let _isStopping = false   // add this

function onCaddyCrash(cb) { _onCrash = cb }

// ─── Paths ────────────────────────────────────────────────────────────────────

function getCaddyDir() { return path.join(app.getPath('userData'), 'caddy') }
function getCaddyfilePath() { return path.join(app.getPath('userData'), 'Caddyfile') }
function getCacheDir() { return path.join(app.getPath('userData'), '.cache') }

// Resolves the Caddy binary path.
// Priority: bundled in app resources → downloaded to userData → (trigger download)
function getCaddyExe() {
  const exe = process.platform === 'win32' ? 'caddy.exe' : 'caddy'

  // Production: binary is in the extraResources directory
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'bin', exe)
  }

  // Development: check project resources/bin/ first (if developer pre-placed it)
  const devBundled = path.join(app.getAppPath(), 'resources', 'bin', exe)
  if (require('fs').existsSync(devBundled)) return devBundled

  // Fallback: downloaded copy in userData (populated by downloadCaddy)
  return path.join(getCaddyDir(), exe)
}

// ─── Download (fallback for dev / missing bundled binary) ─────────────────────

async function resolveCaddyDownloadUrl() {
  const platform = process.platform === 'win32' ? 'windows' : 'darwin'
  const arch = process.platform === 'darwin' && process.arch === 'arm64' ? 'arm64' : 'amd64'

  try {
    const proxyConfig = await getAxiosProxyConfig('https://api.github.com')
    const { data } = await axios.get(
      'https://api.github.com/repos/caddyserver/caddy/releases/latest',
      { timeout: 8000, headers: { 'User-Agent': 'wp-studio' }, ...proxyConfig }
    )
    const assetName = `caddy_${data.tag_name.replace('v', '')}_${platform}_${arch}.zip`
    const asset = data.assets.find(a => a.name === assetName)
    if (!asset) throw new Error(`Asset ${assetName} not found in latest release`)
    return { url: asset.browser_download_url, version: data.tag_name }
  } catch (err) {
    console.warn('[Caddy] GitHub API failed:', err.message)
    return {
      url: 'https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_windows_amd64.zip',
      version: 'v2.9.1',
    }
  }
}

// Downloads Caddy only when the bundled binary is absent (dev without pre-placed binary).
async function downloadCaddy(onProgress) {
  const exe = getCaddyExe()
  if (await fs.pathExists(exe)) return

  onProgress?.({ status: 'downloading', message: 'Downloading Caddy web server...', percent: 0 })

  const { url, version } = await resolveCaddyDownloadUrl()
  const zipName = path.basename(url)
  const zipPath = path.join(getCacheDir(), zipName)

  await fs.ensureDir(getCacheDir())
  await fs.ensureDir(getCaddyDir())

  if (!await fs.pathExists(zipPath)) {
    const proxyConfig = await getAxiosProxyConfig(url)
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 0,
      ...proxyConfig,
      onDownloadProgress: (e) => {
        const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0
        onProgress?.({ status: 'downloading', message: `Downloading Caddy ${version}... ${pct}%`, percent: pct })
      },
    })
    await fs.writeFile(zipPath, response.data)
  }

  onProgress?.({ status: 'installing', message: 'Installing Caddy...' })
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(getCaddyDir(), true)

  if (process.platform !== 'win32') {
    await fs.chmod(exe, 0o755)
  }

  onProgress?.({ status: 'installing', message: 'Caddy ready.', percent: 100 })
}

// ─── Caddyfile generation ─────────────────────────────────────────────────────

function generateCaddyfile(sites) {
  const global = [
    '{',
    '    admin 127.0.0.1:2019',
    '    auto_https off',
    '    log {',
    '        output discard',
    '    }',
    '}',
    '',
  ].join('\n')

  if (!sites.length) {
    return global + ':80 {\n    respond "WP Studio is running"\n}\n'
  }

  const blocks = sites.map(site => {
    const fcgiPort = getFcgiPort(site.php_version || '8.2')
    const wpRoot = path.join(site.path, 'wordpress').replace(/\\/g, '/')
    return [
      `http://${site.domain} {`,
      `    root * "${wpRoot}"`,
      `    encode gzip`,
      `    php_fastcgi 127.0.0.1:${fcgiPort} {`,
      `        index index.php`,
      `    }`,
      `    file_server`,
      `    @notFound {`,
      `        not file`,
      `        not path /wp-admin/*`,
      `    }`,
      `    rewrite @notFound /index.php?{query}`,
      `}`,
    ].join('\n')
  })

  return global + blocks.join('\n\n') + '\n'
}

async function writeCaddyfile(sites) {
  await fs.writeFile(getCaddyfilePath(), generateCaddyfile(sites))
}

// ─── Process management ───────────────────────────────────────────────────────

async function startCaddy(sites, onProgress) {
  await downloadCaddy(onProgress) // no-op when bundled binary exists
  await writeCaddyfile(sites)

  onProgress?.({ status: 'starting', message: 'Starting Caddy web server...' })

  return new Promise((resolve, reject) => {
    _proc = spawn(getCaddyExe(), ['run', '--config', getCaddyfilePath(), '--adapter', 'caddyfile'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let started = false
    const timeout = setTimeout(() => {
      if (!started) { started = true; resolve() }
    }, 2000)

    _proc.stdout?.on('data', (d) => {
      const line = d.toString()
      if (!started && (line.includes('serving') || line.includes('started'))) {
        started = true
        clearTimeout(timeout)
        resolve()
      }
    })

    _proc.stderr?.on('data', (d) => {
      const line = d.toString()
      console.log('[Caddy]', line.trim())
      if (!started && line.includes('error')) {
        started = true
        clearTimeout(timeout)
        // Caddy uses stderr for normal logs too; don't reject on every error line
      }
    })

    _proc.on('error', (err) => {
      clearTimeout(timeout)
      if (!started) { started = true; reject(err) }
    })

    _proc.on('exit', (code) => {
      const wasStarted = started
      _proc = null
      if (!started) { started = true; reject(new Error(`Caddy exited with code ${code}`)) }
      else if (_onCrash && !_isStopping) _onCrash(code)
    })
  })
}

async function reloadCaddy(sites) {
  await writeCaddyfile(sites)
  console.log('[Caddy] Caddyfile written for sites:', sites.map(s => s.domain))
  console.log('[Caddy] Caddyfile path:', getCaddyfilePath())
  console.log('[Caddy] Caddy exe:', getCaddyExe())
  if (!_proc) {
    console.warn('[Caddy] _proc is null, skipping reload')
    return
  }

  return new Promise((resolve) => {
    execFile(getCaddyExe(), ['reload', '--config', getCaddyfilePath(), '--adapter', 'caddyfile'], (err, stdout, stderr) => {
      if (err) console.warn('[Caddy] reload error:', err.message)
      if (stderr) console.log('[Caddy] reload stderr:', stderr)
      if (stdout) console.log('[Caddy] reload stdout:', stdout)
      console.log('[Caddy] reload done')
      resolve()
    })
  })
}

async function stopCaddy() {
  if (!_proc) return
  _isStopping = true
  try { _proc.kill() } catch { }
  _proc = null
  _isStopping = false
}

function isRunning() {
  return !!_proc
}

module.exports = { downloadCaddy, startCaddy, reloadCaddy, stopCaddy, isRunning, writeCaddyfile, onCaddyCrash }