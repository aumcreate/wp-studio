const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')
const fs = require('fs-extra')

let db

function getDb() {
  return db
}

async function initDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'wpstudio.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      slug         TEXT NOT NULL UNIQUE,
      domain       TEXT NOT NULL UNIQUE,
      port         INTEGER NOT NULL,
      php_version  TEXT NOT NULL DEFAULT '8.2',
      wp_version   TEXT NOT NULL DEFAULT 'latest',
      shared_theme_id TEXT REFERENCES themes(id) ON DELETE SET NULL,
      status       TEXT NOT NULL DEFAULT 'stopped',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      path         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS themes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      version     TEXT,
      author      TEXT,
      description TEXT,
      screenshot  TEXT,
      path        TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS site_child_themes (
      site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      theme_slug TEXT NOT NULL,
      PRIMARY KEY (site_id, theme_slug)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  console.log('[DB] Database initialized at', dbPath)
}

module.exports = { initDatabase, getDb }
