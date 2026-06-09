const http = require('http')

// Active polling timers keyed by siteId
const _timers = {}

// Last known reachability keyed by siteId
const _reachable = {}

const POLL_INTERVAL_MS = 8000
const REQUEST_TIMEOUT_MS = 4000

/**
 * Performs a single HTTP GET to http://<domain> and resolves to true if the
 * server responds with any HTTP status code (even 4xx/5xx counts as reachable
 * — it means WordPress is up). Resolves to false on connection errors or timeout.
 *
 * @param {string} domain - e.g. "test1.test"
 * @returns {Promise<boolean>}
 */
function checkReachable(domain) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port: 80,
        path: '/',
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Host: domain },
      },
      (res) => {
        res.resume()
        resolve(true)
      }
    )
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

/**
 * Starts periodic health polling for a site.
 * Calls onStatusChange(siteId, reachable) whenever reachability changes.
 *
 * @param {string} siteId
 * @param {string} domain
 * @param {function} onStatusChange
 */
function startPolling(siteId, domain, onStatusChange) {
  if (_timers[siteId]) return // already polling

  async function poll() {
    const reachable = await checkReachable(domain)
    if (_reachable[siteId] !== reachable) {
      _reachable[siteId] = reachable
      onStatusChange(siteId, reachable)
    }
  }

  // Run immediately, then on interval
  poll()
  _timers[siteId] = setInterval(poll, POLL_INTERVAL_MS)
  console.log(`[Health] Started polling ${domain} (site ${siteId})`)
}

/**
 * Stops health polling for a site.
 * @param {string} siteId
 */
function stopPolling(siteId) {
  if (_timers[siteId]) {
    clearInterval(_timers[siteId])
    delete _timers[siteId]
    delete _reachable[siteId]
    console.log(`[Health] Stopped polling site ${siteId}`)
  }
}

/**
 * Stops all active polling timers.
 */
function stopAll() {
  for (const siteId of Object.keys(_timers)) {
    stopPolling(siteId)
  }
}

/**
 * Returns the last known reachability for a site, or null if not yet checked.
 * @param {string} siteId
 * @returns {boolean|null}
 */
function getReachable(siteId) {
  return _reachable[siteId] ?? null
}

module.exports = { startPolling, stopPolling, stopAll, getReachable, checkReachable }