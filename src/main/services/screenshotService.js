const path = require('path')
const fs = require('fs-extra')
const { BrowserWindow } = require('electron')
const { getSite } = require('./siteService')

const VIEWPORT_HEIGHT = 1000
const WARM_SCROLL_STEP = 700
const TOP_SETTLE_DELAY = 1800

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createOutputDirectory(sitePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return path.join(sitePath, 'screenshots', stamp)
}

function filenameForItem(item, index) {
  const title = String(item.title || item.slug || item.type || 'page')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'page'
  return `${String(index + 1).padStart(2, '0')}__${title}.png`
}

function assertSiteUrl(site, rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' || url.hostname !== site.domain) {
    throw new Error('Only pages belonging to this local site can be captured')
  }
  return url.toString()
}

async function fetchJsonWithRetry(url, retries = 10) {
  let lastError
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`WordPress returned HTTP ${response.status}`)
      return { data: await response.json(), headers: response.headers }
    } catch (error) {
      lastError = error
      if (attempt < retries - 1) await sleep(700)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`Could not load WordPress content: ${lastError?.message || 'unknown error'}`)
}

function decodeTitle(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

async function fetchCollection(baseUrl, type) {
  const items = []
  let page = 1
  let totalPages = 1
  do {
    // Query routing keeps REST discovery working with local Caddy WordPress
    // rewrites, including sites where /wp-json/ is served by the front page.
    const endpoint = new URL('/', baseUrl)
    endpoint.searchParams.set('rest_route', `/wp/v2/${type}`)
    endpoint.searchParams.set('status', 'publish')
    endpoint.searchParams.set('per_page', '100')
    endpoint.searchParams.set('page', String(page))
    endpoint.searchParams.set('_fields', 'id,link,title,date,slug')
    const { data, headers } = await fetchJsonWithRetry(endpoint.toString())
    totalPages = Number(headers.get('x-wp-totalpages') || 1)
    items.push(...data.map(entry => ({
      id: entry.id,
      type: type === 'pages' ? 'page' : 'post',
      title: decodeTitle(entry.title?.rendered) || entry.slug || `#${entry.id}`,
      url: entry.link,
      date: entry.date,
    })))
    page += 1
  } while (page <= totalPages)
  return items
}

async function getSiteContent(siteId) {
  const site = getSite(siteId)
  if (!site) throw new Error('Site not found')
  if (site.status !== 'running') {
    const error = new Error('Start the site before loading its content')
    error.code = 'SITE_NOT_RUNNING'
    throw error
  }

  const baseUrl = `http://${site.domain}`
  const [pages, posts] = await Promise.all([
    fetchCollection(baseUrl, 'pages'),
    fetchCollection(baseUrl, 'posts'),
  ])
  return { pages, posts }
}

async function evaluate(webContents, expression) {
  return webContents.executeJavaScript(`(${expression})()`, true)
}

async function warmPage(webContents) {
  return evaluate(webContents, `async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important')
    document.body?.style.setProperty('scroll-behavior', 'auto', 'important')
    await document.fonts?.ready
    await sleep(800)

    const scrollTo = async top => {
      window.scrollTo(0, top)
      for (let attempt = 0; attempt < 30 && Math.abs(window.scrollY - top) > 2; attempt += 1) {
        await sleep(25)
      }
    }

    let previousHeight = 0
    let stablePasses = 0
    for (let pass = 0; pass < 5 && stablePasses < 2; pass += 1) {
      let y = 0
      let pageHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
      while (y < pageHeight) {
        await scrollTo(y)
        await sleep(260)
        y += Math.max(${WARM_SCROLL_STEP}, window.innerHeight * 0.75)
        pageHeight = Math.max(pageHeight, document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
      }
      await scrollTo(pageHeight)
      await sleep(1200)
      const currentHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
      stablePasses = Math.abs(currentHeight - previousHeight) < 2 ? stablePasses + 1 : 0
      previousHeight = currentHeight
    }

    await scrollTo(0)
    // Sticky headers and scroll-linked effects can take a few frames to reset
    // after the final bottom-to-top pass. Capture only once their normal top
    // of page layout has settled.
    await sleep(${TOP_SETTLE_DELAY})

    return {
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }
  }`)
}

async function captureFullPage({ url, width, destination, onProgress }) {
  const captureWindow = new BrowserWindow({
    // A fully hidden BrowserWindow does not reliably advance its scroll
    // position on Windows. Keeping the window rendered off-screen lets each
    // site run its own IntersectionObserver/animation code as it would in a
    // normal browser, without showing a capture window to the user.
    show: true,
    width,
    height: VIEWPORT_HEIGHT,
    x: -10000,
    y: -10000,
    skipTaskbar: true,
    useContentSize: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  try {
    onProgress?.('loading')
    await captureWindow.loadURL(url)
    onProgress?.('warming')
    await warmPage(captureWindow.webContents)
    const debuggerClient = captureWindow.webContents.debugger
    debuggerClient.attach('1.3')
    try {
      onProgress?.('capturing', 1, 1)
      const { data } = await debuggerClient.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
      })
      await fs.writeFile(destination, Buffer.from(data, 'base64'))
    } finally {
      if (debuggerClient.isAttached()) debuggerClient.detach()
    }
  } finally {
    if (!captureWindow.isDestroyed()) captureWindow.destroy()
  }
}

async function captureSiteContent(siteId, items, width, onProgress) {
  const site = getSite(siteId)
  if (!site) throw new Error('Site not found')
  if (site.status !== 'running') throw new Error('Start the site before taking screenshots')
  if (!Array.isArray(items) || items.length === 0) throw new Error('Select at least one page or post')
  if (!Number.isInteger(width) || width < 320 || width > 3840) {
    throw new Error('Screenshot width must be between 320 and 3840 pixels')
  }

  const outputDir = createOutputDirectory(site.path)
  await fs.ensureDir(outputDir)
  const results = []

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const filename = filenameForItem(item, index)
    const destination = path.join(outputDir, filename)
    try {
      const url = assertSiteUrl(site, item.url)
      await captureFullPage({
        url,
        width,
        destination,
        onProgress: (stage, segment, segments) => onProgress?.({
          siteId,
          stage,
          current: index + 1,
          total: items.length,
          segment,
          segments,
          title: item.title,
        }),
      })
      results.push({ title: item.title, url, file: destination, ok: true })
    } catch (error) {
      results.push({ title: item.title, url: item.url, error: error.message, ok: false })
    }
  }

  await fs.writeJson(path.join(outputDir, 'report.json'), results, { spaces: 2 })
  return { outputDir, results }
}

module.exports = { getSiteContent, captureSiteContent }
