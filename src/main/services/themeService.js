const path = require('path')
const fs = require('fs-extra')
const AdmZip = require('adm-zip')
const { getDb } = require('./database')
const { getSharedThemePath, getWpThemesPath, WORKSPACE_DIR } = require('./workspace')
const { randomUUID } = require('crypto')

// Parses style.css to extract theme metadata
async function parseThemeStyleCss(themeDir) {
  const stylePath = path.join(themeDir, 'style.css')
  if (!(await fs.pathExists(stylePath))) return {}

  const content = await fs.readFile(stylePath, 'utf8')
  const header = content.split('*/')[0]

  const extract = (field) => {
    const match = header.match(new RegExp(`^\\s*${field}:\\s*(.+)$`, 'm'))
    return match ? match[1].trim() : ''
  }

  return {
    name:        extract('Theme Name') || extract('Name'),
    version:     extract('Version'),
    author:      extract('Author'),
    description: extract('Description'),
  }
}

// Imports a theme from a .zip file or an existing directory into shared-themes/
async function importThemeFromPath(sourcePath) {
  const db = getDb()
  const sharedThemesDir = path.join(WORKSPACE_DIR, 'shared-themes')
  await fs.ensureDir(sharedThemesDir)

  let themeDir
  const isZip = sourcePath.toLowerCase().endsWith('.zip')

  if (isZip) {
    // Extract zip to a temp location first to detect the theme folder name
    const tempDir = path.join(require('os').tmpdir(), `wp-theme-import-${Date.now()}`)
    const zip = new AdmZip(sourcePath)
    zip.extractAllTo(tempDir, true)

    // Find extracted theme folder (usually one folder inside)
    const entries = await fs.readdir(tempDir)
    const folderName = entries.find((e) => fs.statSync(path.join(tempDir, e)).isDirectory())

    if (!folderName) {
      await fs.remove(tempDir)
      throw new Error('No theme folder found inside the zip file')
    }

    const extractedThemeDir = path.join(tempDir, folderName)
    const destDir = path.join(sharedThemesDir, folderName)

    if (await fs.pathExists(destDir)) {
      await fs.remove(destDir)
    }

    await fs.copy(extractedThemeDir, destDir)
    await fs.remove(tempDir)
    themeDir = destDir
  } else {
    // Source is a directory — copy it into shared-themes
    const folderName = path.basename(sourcePath)
    const destDir = path.join(sharedThemesDir, folderName)

    if (await fs.pathExists(destDir)) {
      await fs.remove(destDir)
    }

    await fs.copy(sourcePath, destDir)
    themeDir = destDir
  }

  const themeSlug   = path.basename(themeDir)
  const metadata    = await parseThemeStyleCss(themeDir)
  const screenshotPath = path.join(themeDir, 'screenshot.png')
  const screenshot  = (await fs.pathExists(screenshotPath)) ? screenshotPath : null

  // Upsert into database
  const existing = db.prepare('SELECT id FROM themes WHERE slug = ?').get(themeSlug)
  const id = existing ? existing.id : randomUUID()

  db.prepare(`
    INSERT INTO themes (id, name, slug, version, author, description, screenshot, path)
    VALUES (@id, @name, @slug, @version, @author, @description, @screenshot, @path)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      author = excluded.author,
      description = excluded.description,
      screenshot = excluded.screenshot,
      path = excluded.path
  `).run({
    id,
    name:        metadata.name || themeSlug,
    slug:        themeSlug,
    version:     metadata.version || '',
    author:      metadata.author || '',
    description: metadata.description || '',
    screenshot,
    path:        themeDir,
  })

  return db.prepare('SELECT * FROM themes WHERE id = ?').get(id)
}

// Lists all themes in the shared pool
function listThemes() {
  return getDb().prepare('SELECT * FROM themes ORDER BY name ASC').all()
}

// Deletes a theme from pool (and removes symlinks from all sites using it)
async function deleteTheme(themeId) {
  const db = getDb()
  const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(themeId)
  if (!theme) throw new Error('Theme not found')

  // Find all sites using this theme and remove their symlinks
  const sites = db.prepare('SELECT * FROM sites WHERE shared_theme_id = ?').all(themeId)
  for (const site of sites) {
    const symlinkPath = path.join(getWpThemesPath(site.slug), theme.slug)
    if (await fs.pathExists(symlinkPath)) {
      await fs.remove(symlinkPath)
    }
    db.prepare('UPDATE sites SET shared_theme_id = NULL WHERE id = ?').run(site.id)
  }

  // Remove the actual theme directory from shared-themes
  if (await fs.pathExists(theme.path)) {
    await fs.remove(theme.path)
  }

  db.prepare('DELETE FROM themes WHERE id = ?').run(themeId)
}

// Creates a symlink (junction on Windows, dir on macOS/Linux) from
// site's wp-content/themes/<slug> -> shared-themes/<slug>.
// On Windows, junction creation requires either Developer Mode or admin privileges.
async function linkSharedThemeToSite(themeSlug, siteSlug) {
  const sharedThemePath = getSharedThemePath(themeSlug)
  const wpThemesDir     = getWpThemesPath(siteSlug)
  const symlinkTarget   = path.join(wpThemesDir, themeSlug)

  await fs.ensureDir(wpThemesDir)

  if (await fs.pathExists(symlinkTarget)) {
    await fs.remove(symlinkTarget)
  }

  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir'

  try {
    await fs.ensureSymlink(sharedThemePath, symlinkTarget, symlinkType)
  } catch (err) {
    // EPERM on Windows indicates missing symlink privileges.
    // Enable Developer Mode or run as Administrator to resolve.
    if (err.code === 'EPERM' && process.platform === 'win32') {
      throw new Error(
        `Failed to link shared theme "${themeSlug}": insufficient privileges.\n` +
        `On Windows, enable Developer Mode (Settings -> System -> For developers) ` +
        `or run WP Studio as Administrator.`
      )
    }
    throw err
  }
}

// Removes a shared theme symlink from a site
async function unlinkSharedThemeFromSite(themeSlug, siteSlug) {
  const wpThemesDir   = getWpThemesPath(siteSlug)
  const symlinkTarget = path.join(wpThemesDir, themeSlug)

  if (await fs.pathExists(symlinkTarget)) {
    await fs.remove(symlinkTarget)
  }
}

module.exports = {
  importThemeFromPath,
  listThemes,
  deleteTheme,
  linkSharedThemeToSite,
  unlinkSharedThemeFromSite,
}
