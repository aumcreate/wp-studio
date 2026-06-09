const net = require('net')
const { exec } = require('child_process')
const { dialog } = require('electron')

/**
 * Checks whether a TCP port on 127.0.0.1 is currently in use.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (err) => {
      console.log(`[Port] Port ${port} check error:`, err.code)
      resolve(true)
    })
    server.once('listening', () => {
      server.close()
      console.log(`[Port] Port ${port} is free`)
      resolve(false)
    })
    server.listen(port, '0.0.0.0')
  })
}

/**
 * Returns the PID of the process listening on the given port (Windows only).
 * Uses netstat to find the owning PID.
 * @param {number} port
 * @returns {Promise<number|null>}
 */
function getPortPid(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano -p TCP`, (err, stdout) => {
      if (err) { resolve(null); return }
      const lines = stdout.split('\n')
      for (const line of lines) {
        // Match lines like: TCP  0.0.0.0:80  0.0.0.0:0  LISTENING  1234
        const match = line.match(/TCP\s+[\d.:]+:(\d+)\s+[\d.:]+\s+LISTENING\s+(\d+)/i)
        if (match && parseInt(match[1]) === port) {
          resolve(parseInt(match[2]))
          return
        }
      }
      resolve(null)
    })
  })
}

/**
 * Returns the image name of a process by PID (e.g. "nginx.exe"), or null.
 * Helps tell the user which application to close when port 80 cannot be freed.
 * @param {number} pid
 * @returns {Promise<string|null>}
 */
function getProcessName(pid) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      exec(`ps -p ${pid} -o comm=`, (err, stdout) => {
        resolve(err ? null : (stdout.trim() || null))
      })
      return
    }
    exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
      if (err) { resolve(null); return }
      // CSV row: "image","pid","session","#","mem"
      const match = stdout.match(/^"([^"]+)"/)
      resolve(match ? match[1] : null)
    })
  })
}

/**
 * Kills a process by PID (Windows: taskkill, macOS/Linux: kill).
 * @param {number} pid
 * @returns {Promise<void>}
 */
function killPid(pid) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32'
      ? `taskkill /PID ${pid} /F`
      : `kill -9 ${pid}`
    exec(cmd, (err) => {
      if (err) reject(new Error(`Failed to kill PID ${pid}: ${err.message}`))
      else resolve()
    })
  })
}

/**
 * Kills any existing caddy.exe process to prevent 2019 port conflicts
 * when the app restarts without a clean shutdown.
 */
async function killStaleCADdy() {
  if (process.platform !== 'win32') return
  return new Promise((resolve) => {
    exec('taskkill /IM caddy.exe /F', (err) => {
      if (!err) console.log('[Port] Killed stale caddy.exe process')
      resolve() // ignore errors — process may not exist
    })
  })
}

/**
 * Checks port 80 before Caddy starts. If occupied, shows a dialog asking the
 * user whether to release it. Returns true if the port is clear and Caddy can
 * proceed, false if the user declined or the port could not be freed.
 *
 * @param {BrowserWindow} win - The main window (used as dialog parent)
 * @returns {Promise<boolean>}
 */
async function ensurePort80Free(win) {
  const inUse = await isPortInUse(80)
  if (!inUse) return true

  const pid = await getPortPid(80)
  const procName = pid ? await getProcessName(pid) : null
  const holder = procName ? `${procName}${pid ? ` (PID ${pid})` : ''}` : (pid ? `PID ${pid}` : 'another application')

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Port 80 In Use',
    message: `Port 80 is already in use by ${holder}.`,
    detail: 'WP Studio needs port 80 to serve your local WordPress sites.\n\nWould you like WP Studio to release it automatically?',
    buttons: ['Release Port 80', 'Quit WP Studio'],
    defaultId: 0,
    cancelId: 1,
  })

  // User chose to quit instead of releasing — exit quietly, no error needed.
  if (response !== 0) {
    console.warn('[Port] User declined to release port 80')
    return false
  }

  // Attempt automatic release, then verify. Any failure path surfaces a clear,
  // actionable dialog telling the user to free the port manually, so the app
  // never just disappears without explanation.
  let released = false
  if (pid) {
    try {
      await killPid(pid)
      console.log(`[Port] Released port 80 by killing PID ${pid}`)
      // Brief wait for the OS to reclaim the port, then verify.
      await new Promise(r => setTimeout(r, 800))
      released = !(await isPortInUse(80))
    } catch (err) {
      console.error('[Port] Failed to release port 80:', err.message)
    }
  } else {
    console.warn('[Port] Could not identify the PID holding port 80')
  }

  if (released) return true

  // Automatic release failed — explain why and how to fix it before exiting.
  await dialog.showMessageBox(win, {
    type: 'error',
    title: 'Could Not Release Port 80',
    message: `WP Studio could not free port 80${procName ? ` from ${holder}` : ''}.`,
    detail:
      'The process may be a protected system service that requires manual action — ' +
      'common culprits are IIS / "World Wide Web Publishing Service", the Windows ' +
      '"http.sys" driver (often shown as PID 4 / System), Apache, Nginx, or Skype.\n\n' +
      'Please stop that program manually, then start WP Studio again.\n\n' +
      'WP Studio will now exit.',
    buttons: ['OK'],
    defaultId: 0,
  })

  return false
}

module.exports = { isPortInUse, ensurePort80Free, killStaleCADdy, getProcessName }
