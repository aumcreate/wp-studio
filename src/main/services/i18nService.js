const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const { spawn } = require('child_process')
const phpService = require('./phpService')

// Fallback WP-CLI location used when the app is run unpacked and the bundled
// phar cannot be resolved (mirrors wordpress.js download cache path).
const WPCLI_CACHE_PATH = path.join(os.homedir(), 'WP-Studio', '.cache', 'wp-cli.phar')

// Directories never worth scanning for translatable strings.
const DEFAULT_EXCLUDES = ['node_modules', 'vendor']

// ─── Binary resolution ──────────────────────────────────────────────────────

// Resolves the bundled WP-CLI phar (packed into resources/bin/), falling back
// to the cached download in the user's WP-Studio directory.
function getWpCliPath() {
  try {
    const { app } = require('electron')
    const bundled = app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'bin', 'wp-cli.phar')
      : path.join(app.getAppPath(), 'resources', 'bin', 'wp-cli.phar')
    if (fs.existsSync(bundled)) return bundled
  } catch { }
  return WPCLI_CACHE_PATH
}

// Returns the path to an installed php.exe, preferring the newest version.
// Throws a user-facing error when no PHP binary is present.
function resolvePhpExe() {
  // AVAILABLE_VERSIONS is ordered newest-first in the catalog.
  for (const version of phpService.AVAILABLE_VERSIONS) {
    const exe = phpService.getPhpExe(version)
    if (fs.existsSync(exe)) return exe
  }
  throw new Error(
    'No bundled PHP found. Install a PHP version in the Integrations page first, ' +
    'then try exporting again.'
  )
}

// ─── Text domain detection ──────────────────────────────────────────────────

// Reads a "Text Domain:" header value from a WordPress file header block.
// Returns null when the header is absent.
function readTextDomainHeader(filePath) {
  try {
    // Theme/plugin headers always live near the top of the file.
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 8192)
    const match = head.match(/^[\s*#/]*Text Domain:\s*(.+?)\s*$/im)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

// Determines the text domain for a target directory.
// Order: theme style.css header → main plugin file header → folder name.
function detectTextDomain(targetDir) {
  const styleCss = path.join(targetDir, 'style.css')
  if (fs.existsSync(styleCss)) {
    const domain = readTextDomainHeader(styleCss)
    if (domain) return domain
  }

  // Scan top-level PHP files for a plugin header carrying a Text Domain.
  try {
    const phpFiles = fs.readdirSync(targetDir).filter(f => f.toLowerCase().endsWith('.php'))
    for (const file of phpFiles) {
      const full = path.join(targetDir, file)
      const head = fs.readFileSync(full, 'utf8').slice(0, 8192)
      if (/^[\s*#/]*Plugin Name:\s*.+$/im.test(head)) {
        const domain = readTextDomainHeader(full)
        if (domain) return domain
      }
    }
  } catch { }

  // Fallback: directory name, normalized to a valid slug.
  return path.basename(targetDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'theme'
}

// ─── POT generation ─────────────────────────────────────────────────────────

// Counts non-header msgid entries in a generated POT file.
function countStrings(potContent) {
  const matches = potContent.match(/^msgid\s+"/gm)
  // The header block contributes one empty `msgid ""` entry; exclude it.
  return matches ? Math.max(0, matches.length - 1) : 0
}

// Generates a .pot translation template for a theme or plugin directory.
//
// Equivalent to: wp i18n make-pot <targetDir> <targetDir>/languages/<domain>.pot
//                  --exclude=node_modules,vendor
//
// Returns { potPath, domain, stringCount, warnings }.
async function exportPot(targetDir, options = {}) {
  if (!targetDir || !await fs.pathExists(targetDir)) {
    throw new Error(`Target directory does not exist: ${targetDir}`)
  }
  const stat = await fs.stat(targetDir)
  if (!stat.isDirectory()) {
    throw new Error(`Target is not a directory: ${targetDir}`)
  }

  const phpExe = resolvePhpExe()
  const wpCli = getWpCliPath()
  if (!await fs.pathExists(wpCli)) {
    throw new Error(
      'WP-CLI (wp-cli.phar) was not found in the app resources. ' +
      'Reinstall the app or place wp-cli.phar in resources/bin/.'
    )
  }

  const domain = (options.domain && options.domain.trim()) || detectTextDomain(targetDir)
  const excludes = options.exclude && options.exclude.length ? options.exclude : DEFAULT_EXCLUDES

  const languagesDir = path.join(targetDir, 'languages')
  await fs.ensureDir(languagesDir)
  const potPath = path.join(languagesDir, `${domain}.pot`)

  const args = [
    wpCli,
    'i18n', 'make-pot',
    targetDir,
    potPath,
    `--exclude=${excludes.join(',')}`,
  ]

  const { stderr } = await runPhp(phpExe, args)

  if (!await fs.pathExists(potPath)) {
    throw new Error(
      `POT generation reported success but no file was written.\n${stderr}`.trim()
    )
  }

  const content = await fs.readFile(potPath, 'utf8')

  // WP-CLI prints placeholder/translators-comment advisories to stderr.
  // These are informational, not failures — surface them to the user.
  const warnings = stderr
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^Warning:/i.test(l))
    .map(l => l.replace(/^Warning:\s*/i, ''))

  return {
    potPath,
    domain,
    stringCount: countStrings(content),
    warnings,
  }
}

// Spawns php.exe with the given args (no shell — avoids quoting issues with
// spaces in paths) and resolves with captured stdout/stderr. Rejects when
// WP-CLI exits non-zero.
function runPhp(phpExe, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(phpExe, args, { windowsHide: true })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', d => { stdout += d.toString() })
    proc.stderr?.on('data', d => { stderr += d.toString() })

    proc.on('error', err => reject(new Error(`Failed to launch PHP: ${err.message}`)))
    proc.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        const detail = (stderr || stdout || '').trim()
        reject(new Error(detail || `WP-CLI exited with code ${code}`))
      }
    })
  })
}

module.exports = { exportPot, detectTextDomain }
