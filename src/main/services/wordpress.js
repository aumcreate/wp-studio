const path = require('path')
const fs = require('fs-extra')
const axios = require('axios')
const AdmZip = require('adm-zip')
const os = require('os')
const { exec } = require('child_process')
const mysql = require('mysql2/promise')
const { getMysqlConfig } = require('./settingsService')
const phpService = require('./phpService')

const WP_CACHE_DIR = path.join(os.homedir(), 'WP-Studio', '.cache')
const WPCLI_CACHE_PATH = path.join(WP_CACHE_DIR, 'wp-cli.phar')
const WPCLI_MIRRORS = [
  'https://mirror.ghproxy.com/https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
  'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
]

// Seven-day TTL for the "latest" zip cache so it stays fresh without forcing
// a re-download on every site creation
const LATEST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Shown when the WordPress.org API is unreachable
const FALLBACK_WP_VERSIONS = [
  { value: 'latest', label: 'Latest (Recommended)' },
  { value: '6.7.2', label: '6.7.2' },
  { value: '6.6.2', label: '6.6.2' },
  { value: '6.5.5', label: '6.5.5' },
  { value: '6.4.3', label: '6.4.3' },
  { value: '6.3.2', label: '6.3.2' },
]

// ─── Paths ────────────────────────────────────────────────────────────────────

// Resolves the bundled WP-CLI phar (packed into app resources/bin/).
// Falls back to a cached download in the user's WP-Studio directory.
function getWpCliPath() {
  try {
    const { app } = require('electron')
    const bundled = app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'bin', 'wp-cli.phar')
      : path.join(app.getAppPath(), 'resources', 'bin', 'wp-cli.phar')
    if (require('fs').existsSync(bundled)) return bundled
  } catch { }
  return WPCLI_CACHE_PATH
}

// Resolves the bundled PHP CLI binary for the given version.
function getPhpBin(phpVersion) {
  const bundled = phpService.getPhpExe(phpVersion)
  return require('fs').existsSync(bundled) ? `"${bundled}"` : 'php'
}

// ─── Shell helper ─────────────────────────────────────────────────────────────

// Wraps exec in a promise. On Windows, prefixes with chcp 65001 so that
// system error messages from non-English locales are not garbled.
function run(cmd, options = {}) {
  const wrappedCmd = process.platform === 'win32'
    ? `chcp 65001 > nul 2>&1 && ${cmd}`
    : cmd
  return new Promise((resolve, reject) => {
    exec(wrappedCmd, { ...options, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').replace(/^Active code page.*\n?/i, '').trim()
        return reject(new Error(msg || err.message))
      }
      resolve(stdout.trim())
    })
  })
}

// ─── WP-CLI download fallback ─────────────────────────────────────────────────

async function ensureWpCli(onProgress) {
  const cliPath = getWpCliPath()
  if (await fs.pathExists(cliPath)) return cliPath

  onProgress?.('Downloading WP-CLI...')
  await fs.ensureDir(WP_CACHE_DIR)

  const { getAxiosProxyConfig } = require('./proxyService')
  const { pickWorkingMirror } = require('./mirrorService')

  const proxyConfig = await getAxiosProxyConfig('https://raw.githubusercontent.com')
  const mirrorUrl = await pickWorkingMirror(WPCLI_MIRRORS, '', 5000, proxyConfig)

  const response = await axios.get(mirrorUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
    ...proxyConfig,
  })
  await fs.writeFile(WPCLI_CACHE_PATH, response.data)
  return WPCLI_CACHE_PATH
}

// ─── WordPress version list ───────────────────────────────────────────────────

// Fetches available stable WordPress versions from the wordpress.org API.
// Returns [{value, label}, ...] with "latest" always first.
async function getWordPressVersions() {
  try {
    const { data } = await axios.get(
      'https://api.wordpress.org/core/stable-check/1.0/',
      { timeout: 8000 }
    )

    // Parse, filter insecure versions, sort descending by semver
    const versions = Object.entries(data)
      .filter(([, status]) => status !== 'insecure')
      .map(([ver]) => ver)
      .filter(ver => /^\d+\.\d+(\.\d+)?$/.test(ver))
      .sort((a, b) => {
        const av = a.split('.').map(Number)
        const bv = b.split('.').map(Number)
        for (let i = 0; i < 3; i++) {
          const diff = (bv[i] || 0) - (av[i] || 0)
          if (diff) return diff
        }
        return 0
      })

    // One entry per major.minor series (highest patch of each), max 5 series
    const seen = new Set()
    const result = []
    for (const ver of versions) {
      const parts = ver.split('.')
      const majorMinor = `${parts[0]}.${parts[1]}`
      if (!seen.has(majorMinor)) {
        seen.add(majorMinor)
        result.push({ value: ver, label: ver })
        if (result.length >= 5) break
      }
    }

    return [{ value: 'latest', label: 'Latest (Recommended)' }, ...result]
  } catch (err) {
    console.warn('[WP] Version API failed, using fallback list:', err.message)
    return FALLBACK_WP_VERSIONS
  }
}

// ─── WordPress download ───────────────────────────────────────────────────────

function getWpDownloadUrl(version) {
  return version === 'latest'
    ? 'https://wordpress.org/latest.zip'
    : `https://wordpress.org/wordpress-${version}.zip`
}

function getWpCacheFilename(version) {
  return version === 'latest' ? 'wordpress-latest.zip' : `wordpress-${version}.zip`
}

// Downloads a specific WordPress version and returns the local zip path.
// Specific versions are cached forever; "latest" is refreshed after 7 days.
async function downloadWordPress(version = 'latest', onProgress) {
  await fs.ensureDir(WP_CACHE_DIR)

  const cacheFile = path.join(WP_CACHE_DIR, getWpCacheFilename(version))

  if (await fs.pathExists(cacheFile)) {
    if (version !== 'latest') {
      console.log(`[WP] Using cached WordPress ${version}`)
      return cacheFile
    }
    // For "latest", honour the TTL
    const { mtime } = await fs.stat(cacheFile)
    if (Date.now() - mtime.getTime() < LATEST_CACHE_TTL_MS) {
      console.log('[WP] Using cached latest WordPress zip (< 7 days old)')
      return cacheFile
    }
    console.log('[WP] Cached latest zip is stale, re-downloading')
    await fs.remove(cacheFile)
  }

  const url = getWpDownloadUrl(version)
  const label = version === 'latest' ? 'latest' : `${version}`

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 0,
    onDownloadProgress: (e) => {
      if (onProgress && e.total) {
        const pct = Math.round((e.loaded / e.total) * 100)
        onProgress(`Downloading WordPress ${label}... ${pct}%`)
      }
    },
  })

  await fs.writeFile(cacheFile, response.data)
  return cacheFile
}

// ─── WordPress install ────────────────────────────────────────────────────────

// Extracts a WordPress zip into targetDir.
async function installWordPress(targetDir, onProgress, version = 'latest') {
  await fs.ensureDir(targetDir)
  const zipPath = await downloadWordPress(version, onProgress)

  onProgress?.('Extracting WordPress...')
  const zip = new AdmZip(zipPath)
  const tempExtract = path.join(os.tmpdir(), `wp-extract-${Date.now()}`)
  zip.extractAllTo(tempExtract, true)

  await fs.copy(path.join(tempExtract, 'wordpress'), targetDir)
  await fs.remove(tempExtract)
}

// ─── Database helpers ─────────────────────────────────────────────────────────

async function createDatabase(dbName) {
  const cfg = getMysqlConfig()
  let conn
  try {
    conn = await mysql.createConnection(cfg)
  } catch (err) {
    throw new Error(
      `Cannot connect to MySQL at ${cfg.host}:${cfg.port}. ` +
      `Check your MySQL settings in Settings → MySQL Connection. (${err.message})`
    )
  }
  try {
    await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``)
    console.log(`[WP] Database "${dbName}" created`)
  } finally {
    await conn.end()
  }
}

async function dropDatabase(dbName) {
  const cfg = getMysqlConfig()
  let conn
  try {
    conn = await mysql.createConnection(cfg)
    await conn.execute(`DROP DATABASE IF EXISTS \`${dbName}\``)
    console.log(`[WP] Database "${dbName}" dropped`)
  } catch (err) {
    console.warn('[WP] Could not drop database:', err.message)
  } finally {
    if (conn) await conn.end().catch(() => { })
  }
}

// ─── wp-config.php ────────────────────────────────────────────────────────────

async function generateWpConfig(wpDir, { dbName, dbUser, dbPass, dbHost, tablePrefix, siteUrl }) {
  const sampleConfig = path.join(wpDir, 'wp-config-sample.php')
  let config = await fs.readFile(sampleConfig, 'utf8')

  const pairs = {
    database_name_here: dbName,
    username_here: dbUser,
    password_here: dbPass,
    localhost: dbHost,
    wp_: tablePrefix,
  }

  for (const [find, replace] of Object.entries(pairs)) {
    config = config.replace(new RegExp(find, 'g'), replace)
  }

  // Remove any existing WP_DEBUG definitions from the sample to avoid duplicates
  config = config.replace(/define\(\s*'WP_DEBUG'[^;]+;\n?/g, '')
  config = config.replace(/define\(\s*'WP_DEBUG_LOG'[^;]+;\n?/g, '')
  config = config.replace(/define\(\s*'WP_DEBUG_DISPLAY'[^;]+;\n?/g, '')

  const extras = `
define( 'WP_DEBUG', false );
define( 'WP_DEBUG_LOG', false );
define( 'WP_HOME', '${siteUrl}' );
define( 'WP_SITEURL', '${siteUrl}' );
`
  config = config.replace("/* That's all", `${extras}\n/* That's all`)
  await fs.writeFile(path.join(wpDir, 'wp-config.php'), config)
}

// ─── WP-CLI: core install ─────────────────────────────────────────────────────

async function runWpCoreInstall(wpDir, { phpVersion, siteUrl, siteTitle, adminUser, adminPass, adminEmail }, onProgress) {
  const cliPath = await ensureWpCli(onProgress)
  const php = getPhpBin(phpVersion)

  try {
    await run(`${php} --version`)
  } catch {
    throw new Error(
      `PHP ${phpVersion} binary not found. ` +
      `Ensure the bundled PHP was downloaded successfully.`
    )
  }

  onProgress?.('Installing WordPress...')

  const cmd = [
    php,
    `"${cliPath}"`,
    'core install',
    `--path="${wpDir}"`,
    `--url="${siteUrl}"`,
    `--title="${siteTitle.replace(/"/g, '\\"')}"`,
    `--admin_user="${adminUser}"`,
    `--admin_password="${adminPass}"`,
    `--admin_email="${adminEmail}"`,
    '--skip-email',
    '--allow-root',
  ].join(' ')

  await run(cmd)
  console.log('[WP] Core install complete')
}

// ─── WP-CLI: update site URL ──────────────────────────────────────────────────

async function updateSiteUrl(wpDir, newUrl, phpVersion) {
  const cliPath = await ensureWpCli()
  const php = getPhpBin(phpVersion)

  await run([php, `"${cliPath}"`, 'option update siteurl', `"${newUrl}"`, `--path="${wpDir}"`, '--allow-root'].join(' '))
  await run([php, `"${cliPath}"`, 'option update home', `"${newUrl}"`, `--path="${wpDir}"`, '--allow-root'].join(' '))
}

module.exports = {
  getWordPressVersions,
  installWordPress,
  generateWpConfig,
  createDatabase,
  dropDatabase,
  runWpCoreInstall,
  updateSiteUrl,
}
