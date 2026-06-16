const path = require('path')
const fs = require('fs-extra')
const net = require('net')
const { app } = require('electron')
const { spawn } = require('child_process')
const { getPhpExe } = require('./phpService')
const { getMysqlConfig } = require('./settingsService')

// Running phpMyAdmin PHP built-in server processes, keyed by siteId
const _procs = {}

// Allocated ports, keyed by siteId
const _ports = {}

// ─── Paths ────────────────────────────────────────────────────────────────────

// Resolves the bundled phpMyAdmin directory from app resources
function getPmaDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'resources', 'phpmyadmin')
    }
    return path.join(app.getAppPath(), 'resources', 'phpmyadmin')
}

// Per-site config directory stored in userData so we can write config.inc.php
function getPmaConfigDir(siteId) {
    return path.join(app.getPath('userData'), 'phpmyadmin', siteId)
}

// ─── Port helpers ─────────────────────────────────────────────────────────────

function findFreePort(start = 9200) {
    return new Promise((resolve, reject) => {
        let port = start
        function tryPort() {
            const server = net.createServer()
            server.once('error', () => { port++; if (port > 9300) reject(new Error('No free port found')); else tryPort() })
            server.once('listening', () => { server.close(); resolve(port) })
            server.listen(port, '127.0.0.1')
        }
        tryPort()
    })
}

// Resolves once a TCP connection to the port succeeds, or rejects after timeout.
// Used to confirm the PHP built-in server has actually bound the port before
// we open the browser — a fixed delay races on slower machines.
function waitForPort(port, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve, reject) => {
        function attempt() {
            const socket = net.connect(port, '127.0.0.1')
            socket.once('connect', () => { socket.destroy(); resolve() })
            socket.once('error', () => {
                socket.destroy()
                if (Date.now() > deadline) reject(new Error(`Timed out waiting for phpMyAdmin server on port ${port}`))
                else setTimeout(attempt, 150)
            })
        }
        attempt()
    })
}

// ─── Config generation ────────────────────────────────────────────────────────

// Generates a minimal config.inc.php for phpMyAdmin that:
// - connects to the bundled MariaDB on the correct port
// - uses cookie-based auth with auto-login for root (no password)
async function writeConfig(siteId, mysqlPort) {
    // phpMyAdmin loads config.inc.php from its own root directory (CONFIG_FILE),
    // so it must be written there. In packaged builds that directory lives under
    // the install path; the app runs elevated, so the write succeeds.
    const pmaDir = getPmaDir()
    await fs.ensureDir(pmaDir)

    // Point phpMyAdmin's template/cache writes at a guaranteed-writable location
    // in userData, so it never depends on the install directory being writable.
    const tempDir = path.join(app.getPath('userData'), 'phpmyadmin', 'tmp')
    await fs.ensureDir(tempDir)
    const tempDirPhp = tempDir.replace(/\\/g, '/')

    const blowfish = (siteId.replace(/-/g, '') + '0000000000000000').slice(0, 32)

    const config = `<?php
$cfg['blowfish_secret'] = '${blowfish}';
$i = 0;
$i++;
$cfg['Servers'][$i]['auth_type']       = 'config';
$cfg['Servers'][$i]['host']            = '127.0.0.1';
$cfg['Servers'][$i]['port']            = ${mysqlPort};
$cfg['Servers'][$i]['connect_type']    = 'tcp';
$cfg['Servers'][$i]['compress']        = false;
$cfg['Servers'][$i]['AllowNoPassword'] = true;
$cfg['Servers'][$i]['user']            = 'root';
$cfg['Servers'][$i]['password']        = '';
$cfg['UploadDir'] = '';
$cfg['SaveDir']   = '';
$cfg['TempDir']   = '${tempDirPhp}';
$cfg['SendErrorReports'] = 'never';
`
    await fs.writeFile(path.join(pmaDir, 'config.inc.php'), config)
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

// Starts a PHP built-in web server serving phpMyAdmin for the given site.
// Returns the port it is listening on.
async function startPma(siteId, phpVersion = '8.2') {
    if (_procs[siteId]) {
        return _ports[siteId]
    }

    const pmaDir = getPmaDir()
    if (!await fs.pathExists(pmaDir)) {
        throw new Error('phpMyAdmin files not found in app resources')
    }

    const phpExe = getPhpExe(phpVersion)
    if (!await fs.pathExists(phpExe)) {
        throw new Error(`PHP ${phpVersion} binary not found — install it from the Integrations page`)
    }

    // Read current MariaDB port from settings
    const mysqlCfg = getMysqlConfig()
    const mysqlPort = mysqlCfg.port || 3306

    await writeConfig(siteId, mysqlPort)
    const port = await findFreePort(9200)

    // PHP built-in server: php.exe -S 127.0.0.1:<port> -t <pmaDir>
    // PHPRC points PHP at its own install directory so it reliably loads the
    // generated php.ini (with mysqli/mbstring) regardless of the launch cwd.
    const proc = spawn(phpExe, ['-S', `127.0.0.1:${port}`, '-t', pmaDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
            ...process.env,
            PHPRC: path.dirname(phpExe),
        },
    })

    // Drain stdout/stderr so the PHP process never blocks on a full pipe buffer,
    // and keep the most recent stderr output for diagnostics on startup failure.
    let lastErr = ''
    proc.stdout?.on('data', (d) => { /* request log — discarded */ void d })
    proc.stderr?.on('data', (d) => { lastErr = d.toString().trim() })

    _procs[siteId] = proc
    _ports[siteId] = port

    let exited = false
    proc.on('exit', (code) => {
        exited = true
        delete _procs[siteId]
        delete _ports[siteId]
        if (code) console.error(`[PMA] PHP server for site ${siteId} exited with code ${code}: ${lastErr}`)
    })

    proc.on('error', (err) => {
        exited = true
        console.error(`[PMA] PHP server error for site ${siteId}:`, err.message)
        delete _procs[siteId]
        delete _ports[siteId]
    })

    // Wait until the server is actually accepting connections before returning,
    // so callers never open the browser at a port that is not yet (or never) up.
    try {
        await waitForPort(port)
    } catch (err) {
        try { proc.kill() } catch { }
        delete _procs[siteId]
        delete _ports[siteId]
        const detail = exited
            ? 'the PHP process exited on startup'
            : 'the server did not respond in time'
        throw new Error(`phpMyAdmin failed to start (${detail})${lastErr ? `: ${lastErr}` : ''}`)
    }

    console.log(`[PMA] Started for site ${siteId} on port ${port}`)
    return port
}

async function stopPma(siteId) {
    const proc = _procs[siteId]
    if (!proc) return
    try { proc.kill() } catch { }
    delete _procs[siteId]
    delete _ports[siteId]
    console.log(`[PMA] Stopped for site ${siteId}`)
}

async function stopAll() {
    for (const siteId of Object.keys(_procs)) {
        await stopPma(siteId)
    }
}

function getPort(siteId) {
    return _ports[siteId] || null
}

function isRunning(siteId) {
    return !!_procs[siteId]
}

module.exports = { startPma, stopPma, stopAll, getPort, isRunning }