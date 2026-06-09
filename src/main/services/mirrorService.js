const axios = require('axios')

/**
 * Probes mirror base URLs in parallel and returns the first one that responds
 * within timeoutMs. The last entry in mirrorBases is treated as the official
 * fallback and is always returned if no mirror is reachable.
 *
 * Proxy config (httpsAgent / httpAgent) is forwarded to each probe request so
 * that system VPN/proxy settings are honoured during mirror selection.
 *
 * @param {string[]} mirrorBases  - Base URLs to probe; last entry is official fallback
 * @param {string}   testSuffix   - Path suffix appended to each base for the HEAD probe
 * @param {number}   timeoutMs    - Per-probe timeout in milliseconds
 * @param {object}   proxyConfig  - Axios proxy config from proxyService.getAxiosProxyConfig()
 * @returns {Promise<string>}     - The chosen base URL (no trailing slash)
 */
async function pickWorkingMirror(mirrorBases, testSuffix = '/', timeoutMs = 3000, proxyConfig = {}) {
  if (mirrorBases.length <= 1) return mirrorBases[0] ?? ''

  const official = mirrorBases[mirrorBases.length - 1]
  const mirrors  = mirrorBases.slice(0, -1)

  return new Promise((resolve) => {
    let pending  = mirrors.length
    let resolved = false

    function done(url) {
      if (!resolved) {
        resolved = true
        resolve(url)
      }
    }

    for (const base of mirrors) {
      axios.head(`${base}${testSuffix}`, {
        timeout: timeoutMs,
        ...proxyConfig,
      })
        .then(() => {
          console.log(`[Mirror] Reachable: ${base}`)
          done(base)
        })
        .catch(() => {
          if (--pending === 0) {
            console.log('[Mirror] All mirrors unreachable, using official')
            done(official)
          }
        })
    }

    // Hard deadline — never stall longer than probe timeout + 500 ms
    setTimeout(() => {
      console.log('[Mirror] Probe timeout, falling back to official')
      done(official)
    }, timeoutMs + 500)
  })
}

module.exports = { pickWorkingMirror }