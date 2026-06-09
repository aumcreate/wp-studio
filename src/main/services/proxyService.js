const { session } = require('electron')
const http  = require('http')
const https = require('https')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { HttpProxyAgent }  = require('http-proxy-agent')

// Cached proxy URL resolved at first call, then reused for the session lifetime.
// null  = not yet resolved
// ''    = resolved and direct (no proxy)
// 'http://...' = proxy URL
let _cachedProxyUrl = null

/**
 * Resolves the system proxy for a given target URL using Electron's built-in
 * proxy resolution (reads OS proxy settings, PAC scripts, and WinINet config).
 * Falls back to HTTPS_PROXY / HTTP_PROXY environment variables as a secondary
 * source, which covers cases where the user set the proxy in their shell before
 * launching the app.
 *
 * @param {string} targetUrl - The URL the request will be sent to
 * @returns {Promise<string>} - Proxy URL string, or '' for direct connection
 */
async function resolveSystemProxy(targetUrl = 'https://downloads.php.net') {
  // Return cached result after first resolution
  if (_cachedProxyUrl !== null) return _cachedProxyUrl

  try {
    // Electron resolves the proxy the same way Chromium does (PAC, WPAD, manual)
    const proxyString = await session.defaultSession.resolveProxy(targetUrl)
    // resolveProxy returns e.g. "PROXY 127.0.0.1:7890" or "DIRECT"
    if (proxyString && !proxyString.includes('DIRECT')) {
      const match = proxyString.match(/PROXY\s+([\w.\-]+:\d+)/i)
      if (match) {
        _cachedProxyUrl = `http://${match[1]}`
        console.log(`[Proxy] System proxy detected: ${_cachedProxyUrl}`)
        return _cachedProxyUrl
      }

      // SOCKS proxy entries look like "SOCKS5 127.0.0.1:1080"
      const socksMatch = proxyString.match(/SOCKS5?\s+([\w.\-]+:\d+)/i)
      if (socksMatch) {
        _cachedProxyUrl = `socks5://${socksMatch[1]}`
        console.log(`[Proxy] SOCKS proxy detected: ${_cachedProxyUrl}`)
        return _cachedProxyUrl
      }
    }
  } catch (err) {
    console.warn('[Proxy] Electron resolveProxy failed:', err.message)
  }

  // Fallback: environment variables (common in shell-launched dev environments)
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
                   process.env.HTTP_PROXY  || process.env.http_proxy
  if (envProxy) {
    _cachedProxyUrl = envProxy
    console.log(`[Proxy] Using environment proxy: ${_cachedProxyUrl}`)
    return _cachedProxyUrl
  }

  _cachedProxyUrl = ''
  console.log('[Proxy] No system proxy detected, using direct connection')
  return _cachedProxyUrl
}

/**
 * Returns axios request config additions that route traffic through the system
 * proxy when one is detected. Pass the result as extra options to axios calls.
 *
 * Usage:
 *   const proxyConfig = await getAxiosProxyConfig(url)
 *   const response = await axios.get(url, { ...proxyConfig, ...otherOptions })
 *
 * @param {string} targetUrl - The URL being requested (used for proxy resolution)
 * @returns {Promise<object>} - Partial axios config: { httpsAgent?, httpAgent?, proxy: false }
 */
async function getAxiosProxyConfig(targetUrl) {
  const proxyUrl = await resolveSystemProxy(targetUrl)

  if (!proxyUrl) {
    // No proxy — return plain agents with keepAlive for better throughput
    return {
      proxy: false,
      httpsAgent: new https.Agent({ keepAlive: true }),
      httpAgent:  new http.Agent({ keepAlive: true }),
    }
  }

  // Build agents that tunnel through the proxy
  // axios's built-in proxy support does not handle CONNECT tunneling correctly
  // for HTTPS targets, so we disable it and use explicit agents instead.
  try {
    const httpsAgent = new HttpsProxyAgent(proxyUrl)
    const httpAgent  = new HttpProxyAgent(proxyUrl)
    return { proxy: false, httpsAgent, httpAgent }
  } catch (err) {
    console.warn('[Proxy] Failed to create proxy agent:', err.message)
    return { proxy: false }
  }
}

/**
 * Clears the cached proxy URL, forcing re-resolution on the next request.
 * Call this if the user changes proxy settings while the app is running.
 */
function clearProxyCache() {
  _cachedProxyUrl = null
}

module.exports = { resolveSystemProxy, getAxiosProxyConfig, clearProxyCache }
