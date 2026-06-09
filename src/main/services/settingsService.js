const { getDb } = require('./database')

const DEFAULTS = {
  mysql_host:     '127.0.0.1',
  mysql_port:     '3306',
  mysql_user:     'root',
  mysql_password: '',
}

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : DEFAULTS[key] ?? null
}

function setSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value ?? '')
}

function getMysqlConfig() {
  return {
    host:     getSetting('mysql_host')     || DEFAULTS.mysql_host,
    port:     parseInt(getSetting('mysql_port') || DEFAULTS.mysql_port, 10),
    user:     getSetting('mysql_user')     || DEFAULTS.mysql_user,
    password: getSetting('mysql_password') ?? DEFAULTS.mysql_password,
  }
}

function getAllSettings() {
  return {
    mysql_host:     getSetting('mysql_host')     || DEFAULTS.mysql_host,
    mysql_port:     getSetting('mysql_port')     || DEFAULTS.mysql_port,
    mysql_user:     getSetting('mysql_user')     || DEFAULTS.mysql_user,
    mysql_password: getSetting('mysql_password') ?? DEFAULTS.mysql_password,
  }
}

module.exports = { getSetting, setSetting, getMysqlConfig, getAllSettings }
