const path = require('path')
const fs = require('fs-extra')
const slugify = require('slugify')
const { randomUUID } = require('crypto')

const { getDb } = require('./database')
const { getSitePath } = require('./workspace')
const { installWordPress, generateWpConfig, createDatabase, dropDatabase, runWpCoreInstall } = require('./wordpress')
const { linkSharedThemeToSite, unlinkSharedThemeFromSite } = require('./themeService')
const phpService = require('./phpService')
const caddyService = require('./caddyService')
const hostsService = require('./hostsService')
const pmaService = require('./phpMyAdminService')
const healthService = require('./healthService')
const { BrowserWindow } = require('electron')


function sendToRenderer(channel, payload) {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length) wins[0].webContents.send(channel, payload)
}

// Returns all sites with shared theme info, used to regenerate Caddy config
function getActiveSites() {
  return getDb().prepare(`
    SELECT s.*, t.name AS shared_theme_name, t.slug AS shared_theme_slug
    FROM sites s LEFT JOIN themes t ON s.shared_theme_id = t.id
    WHERE s.status = 'running'
    ORDER BY s.created_at DESC
  `).all()
}

// Full site creation flow:
// extract WP → create DB → write wp-config → wp core install → symlink theme
// → register .test domain → start PHP FastCGI → reload Caddy
async function createSite(
  { name, phpVersion = '8.2', wpVersion = 'latest', sharedThemeId, siteTitle, adminUser, adminPass, adminEmail },
  onProgress
) {
  const db = getDb()

  const slug = slugify(name, { lower: true, strict: true })
  const domain = `${slug}.test`
  const siteUrl = `http://${domain}`

  if (db.prepare('SELECT id FROM sites WHERE slug = ?').get(slug)) {
    throw new Error(`A site named "${slug}" already exists`)
  }

  const sitePath = getSitePath(slug)
  const wpDir = path.join(sitePath, 'wordpress')
  const dbName = `wpstudio_${slug}`.replace(/-/g, '_')

  // Step 1: WordPress files
  onProgress?.('Creating directories...')
  await fs.ensureDir(sitePath)
  await installWordPress(wpDir, onProgress, wpVersion)

  // Step 2: Database
  onProgress?.('Creating database...')
  await createDatabase(dbName)

  // Step 3: wp-config.php
  onProgress?.('Writing configuration...')
  const { getMysqlConfig } = require('./settingsService')
  const mysqlCfg = getMysqlConfig()
  const dbHost = mysqlCfg.port !== 3306
    ? `${mysqlCfg.host}:${mysqlCfg.port}`
    : mysqlCfg.host

  await generateWpConfig(wpDir, {
    dbName,
    dbUser: mysqlCfg.user,
    dbPass: mysqlCfg.password,
    dbHost,
    tablePrefix: 'wp_',
    siteUrl,
  })

  // Step 4: Ensure bundled PHP is ready, then run WP-CLI
  onProgress?.(`Ensuring PHP ${phpVersion} is ready...`)
  await phpService.ensureVersion(phpVersion, (p) => onProgress?.(p.message))

  await runWpCoreInstall(wpDir, {
    phpVersion,
    siteUrl,
    siteTitle: siteTitle || name,
    adminUser: adminUser || 'admin',
    adminPass,
    adminEmail,
  }, onProgress)

  // Step 5: Persist site record (status = running immediately)
  const id = randomUUID()
  db.prepare(`
    INSERT INTO sites (id, name, slug, domain, port, php_version, wp_version, shared_theme_id, status, path)
    VALUES (@id, @name, @slug, @domain, @port, @phpVersion, @wpVersion, @sharedThemeId, @status, @path)
  `).run({
    id,
    name,
    slug,
    domain,
    port: 80,
    phpVersion,
    wpVersion,
    sharedThemeId: sharedThemeId || null,
    status: 'running',
    path: sitePath,
  })

  // Step 6: Shared theme symlink
  if (sharedThemeId) {
    const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(sharedThemeId)
    if (theme) {
      onProgress?.(`Linking shared theme "${theme.name}"...`)
      await linkSharedThemeToSite(theme.slug, slug)
    }
  }

  // Step 7: .test domain in hosts file
  onProgress?.(`Registering ${domain}...`)
  await hostsService.addEntry(domain)

  // Step 8: Reload Caddy with the new vhost
  onProgress?.('Starting web server...')
  const running = getActiveSites()
  if (caddyService.isRunning()) {
    await caddyService.reloadCaddy(running)
  }

  onProgress?.('Site ready! 🎉')

  // Begin health polling immediately after creation so the site indicator
  // turns green as soon as WordPress becomes reachable, matching the
  // behavior of startSite().
  healthService.startPolling(id, domain, (pollId, reachable) => {
    sendToRenderer('site:healthChanged', { siteId: pollId, reachable })
  })

    // Retry reachability for up to 15 s to cover Caddy/PHP-CGI warm-up time.
    ; (async () => {
      const MAX_ATTEMPTS = 10
      const RETRY_DELAY_MS = 1500
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        const reachable = await healthService.checkReachable(domain)
        sendToRenderer('site:healthChanged', { siteId: id, reachable })
        if (reachable) break
      }
    })()

  return db.prepare(`
    SELECT s.*, t.name AS shared_theme_name, t.slug AS shared_theme_slug
    FROM sites s LEFT JOIN themes t ON s.shared_theme_id = t.id
    WHERE s.id = ?
  `).get(id)
}

// Starts an existing stopped site
async function startSite(siteId, onProgress) {
  const db = getDb()
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId)
  if (!site) throw new Error('Site not found')

  onProgress?.(`Starting PHP ${site.php_version}...`)
  await phpService.ensureVersion(site.php_version, (p) => onProgress?.(p.message))

  onProgress?.(`Registering ${site.domain}...`)
  await hostsService.addEntry(site.domain)

  db.prepare('UPDATE sites SET status = ? WHERE id = ?').run('running', siteId)

  if (caddyService.isRunning()) {
    await caddyService.reloadCaddy(getActiveSites())
  }

  // Start phpMyAdmin (non-fatal — health polling must run regardless)
  try {
    const pmaPort = await pmaService.startPma(siteId, site.php_version || '8.2')
    console.log(`[Site] phpMyAdmin started on port ${pmaPort}`)
  } catch (pmaErr) {
    console.error(`[Site] phpMyAdmin failed to start (non-fatal): ${pmaErr.message}`)
  }

  healthService.startPolling(siteId, site.domain, (id, reachable) => {
    sendToRenderer('site:healthChanged', { siteId: id, reachable })
  })

    // Poll reachability after start — Caddy and PHP-CGI need a moment to become
    // ready. Retry every 1.5 s for up to 15 s, pushing each result to the renderer
    // so the site indicator updates as soon as the stack is actually serving.
    ; (async () => {
      const MAX_ATTEMPTS = 10
      const RETRY_DELAY_MS = 1500
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        const reachable = await healthService.checkReachable(site.domain)
        sendToRenderer('site:healthChanged', { siteId, reachable })
        if (reachable) break
      }
    })()

  return getSite(siteId)
}

// Stops a running site (removes from Caddy, removes hosts entry)
async function stopSite(siteId) {
  const db = getDb()
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId)
  if (!site) throw new Error('Site not found')

  db.prepare('UPDATE sites SET status = ? WHERE id = ?').run('stopped', siteId)

  await hostsService.removeEntry(site.domain)

  if (caddyService.isRunning()) {
    await caddyService.reloadCaddy(getActiveSites())
  }

  await pmaService.stopPma(siteId)
  healthService.stopPolling(siteId)

  // Stop the PHP FastCGI process for this site's version if no other
  // running site still requires it.
  const phpVersion = site.php_version || '8.2'
  const remainingSites = getActiveSites()
  const versionStillNeeded = remainingSites.some(s => (s.php_version || '8.2') === phpVersion)
  if (!versionStillNeeded) {
    console.log(`[Site] No remaining sites using PHP ${phpVersion}, stopping FastCGI`)
    await phpService.stopFcgi(phpVersion)
  }

  console.log('[StopSite] PHP status after stop:', JSON.stringify(phpService.getStatus()))
  return getSite(siteId)
}

// Removes all traces of a site: Caddy vhost, hosts entry, files, database
async function deleteSite(siteId) {
  const db = getDb()
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId)
  if (!site) throw new Error('Site not found')

  // Stop the site first if it is running
  if (site.status === 'running') {
    await stopSite(siteId)
  }

  // Remove domain from hosts
  await hostsService.removeEntry(site.domain)

  // Remove files
  if (await fs.pathExists(site.path)) await fs.remove(site.path)

  // Drop database
  const dbName = `wpstudio_${site.slug}`.replace(/-/g, '_')
  await dropDatabase(dbName)

  // Remove from DB first so Caddy reload excludes it
  db.prepare('DELETE FROM sites WHERE id = ?').run(siteId)

  // Reload Caddy
  if (caddyService.isRunning()) {
    await caddyService.reloadCaddy(getActiveSites())
  }
}

function listSites() {
  return getDb().prepare(`
    SELECT s.*, t.name AS shared_theme_name, t.slug AS shared_theme_slug
    FROM sites s LEFT JOIN themes t ON s.shared_theme_id = t.id
    ORDER BY s.created_at DESC
  `).all()
}

function getSite(siteId) {
  return getDb().prepare(`
    SELECT s.*, t.name AS shared_theme_name, t.slug AS shared_theme_slug
    FROM sites s LEFT JOIN themes t ON s.shared_theme_id = t.id
    WHERE s.id = ?
  `).get(siteId)
}

// Updates editable site properties: display name, PHP version, shared theme.
// If the site is currently running and the PHP version changes, the old
// FastCGI process stays alive (serving other sites on that version) — Caddy
// is simply reloaded so new requests go to the correct CGI port.
async function updateSite(siteId, { name, phpVersion, sharedThemeId }) {
  const db = getDb()
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId)
  if (!site) throw new Error('Site not found')

  const newName = (name ?? site.name).trim()
  const newPhpVersion = phpVersion ?? site.php_version
  const newThemeId = sharedThemeId !== undefined ? (sharedThemeId || null) : site.shared_theme_id

  // --- PHP version change ---
  if (newPhpVersion !== site.php_version && site.status === 'running') {
    // Ensure the target PHP version is installed and its FastCGI is running
    await phpService.ensureVersion(newPhpVersion, () => { })
    db.prepare('UPDATE sites SET php_version = ? WHERE id = ?').run(newPhpVersion, siteId)
    // Reload Caddy so the vhost points to the new FastCGI port
    await caddyService.reloadCaddy(getActiveSites())
  } else {
    db.prepare('UPDATE sites SET php_version = ? WHERE id = ?').run(newPhpVersion, siteId)
  }

  // --- Display name change ---
  db.prepare('UPDATE sites SET name = ? WHERE id = ?').run(newName, siteId)

  // --- Shared theme change ---
  if (newThemeId !== site.shared_theme_id) {
    if (site.shared_theme_id) {
      const oldTheme = db.prepare('SELECT * FROM themes WHERE id = ?').get(site.shared_theme_id)
      if (oldTheme) await unlinkSharedThemeFromSite(oldTheme.slug, site.slug)
    }
    if (newThemeId) {
      const newTheme = db.prepare('SELECT * FROM themes WHERE id = ?').get(newThemeId)
      if (newTheme) await linkSharedThemeToSite(newTheme.slug, site.slug)
    }
    db.prepare('UPDATE sites SET shared_theme_id = ? WHERE id = ?').run(newThemeId, siteId)
  }

  return getSite(siteId)
}

async function updateSiteSharedTheme(siteId, newThemeId) {
  const db = getDb()
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId)
  if (!site) throw new Error('Site not found')

  if (site.shared_theme_id) {
    const old = db.prepare('SELECT * FROM themes WHERE id = ?').get(site.shared_theme_id)
    if (old) await unlinkSharedThemeFromSite(old.slug, site.slug)
  }

  if (newThemeId) {
    const next = db.prepare('SELECT * FROM themes WHERE id = ?').get(newThemeId)
    if (next) await linkSharedThemeToSite(next.slug, site.slug)
  }

  db.prepare('UPDATE sites SET shared_theme_id = ? WHERE id = ?').run(newThemeId || null, siteId)
  return getSite(siteId)
}

module.exports = { createSite, startSite, stopSite, deleteSite, listSites, getSite, updateSite, updateSiteSharedTheme }