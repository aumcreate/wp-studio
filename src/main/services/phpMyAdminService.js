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

// ─── Port helper ──────────────────────────────────────────────────────────────

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

// ─── Config generation ────────────────────────────────────────────────────────

// Generates a minimal config.inc.php for phpMyAdmin that:
// - connects to the bundled MariaDB on the correct port
// - uses cookie-based auth with auto-login for root (no password)
async function writeConfig(siteId, mysqlPort) {
    // Write config.inc.php directly into the phpMyAdmin directory
    // phpMyAdmin looks for config.inc.php in its own root directory
    const pmaDir = getPmaDir()
    await fs.ensureDir(pmaDir)

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
    // PHPRC points to our per-site config dir so phpMyAdmin picks up config.inc.php
    const proc = spawn(phpExe, ['-S', `127.0.0.1:${port}`, '-t', pmaDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
            ...process.env,
        },
    })

    _procs[siteId] = proc
    _ports[siteId] = port

    proc.on('exit', () => {
        delete _procs[siteId]
        delete _ports[siteId]
    })

    proc.on('error', (err) => {
        console.error(`[PMA] PHP server error for site ${siteId}:`, err.message)
        delete _procs[siteId]
        delete _ports[siteId]
    })

    // Give PHP a moment to bind the port
    await new Promise(r => setTimeout(r, 600))

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