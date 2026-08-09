const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // --- Sites ---
  sites: {
    list: () => ipcRenderer.invoke('sites:list'),
    create: (data) => ipcRenderer.invoke('sites:create', data),
    delete: (id) => ipcRenderer.invoke('sites:delete', id),
    start: (id) => ipcRenderer.invoke('sites:start', id),
    stop: (id) => ipcRenderer.invoke('sites:stop', id),
    open: (id) => ipcRenderer.invoke('sites:open', id),
    openAdmin: (id) => ipcRenderer.invoke('sites:openAdmin', id),
    openFolder: (id) => ipcRenderer.invoke('sites:openFolder', id),
    getStatus: (id) => ipcRenderer.invoke('sites:getStatus', id),
    getContent: (id) => ipcRenderer.invoke('sites:getContent', id),
    captureContent: (data) => ipcRenderer.invoke('sites:captureContent', data),
    openScreenshots: (data) => ipcRenderer.invoke('sites:openScreenshots', data),
    openPma: (id) => ipcRenderer.invoke('sites:openPma', id),
    update: (data) => ipcRenderer.invoke('sites:update', data),
    openTerminal: (id) => ipcRenderer.invoke('sites:openTerminal', id),
    openInEditor: (id) => ipcRenderer.invoke('sites:openInEditor', id),
  },

  // --- Themes ---
  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
    import: (sourcePath) => ipcRenderer.invoke('themes:import', sourcePath),
    delete: (id) => ipcRenderer.invoke('themes:delete', id),
    openFolder: (id) => ipcRenderer.invoke('themes:openFolder', id),
    selectFolder: () => ipcRenderer.invoke('themes:selectFolder'),
    exportPot: (id) => ipcRenderer.invoke('themes:exportPot', id),
    exportPotFromFolder: () => ipcRenderer.invoke('themes:exportPotFromFolder'),
    revealPot: (potPath) => ipcRenderer.invoke('themes:revealPot', potPath),
  },

  // --- System ---
  system: {
    getHerdStatus: () => ipcRenderer.invoke('system:herdStatus'),
    getWorkspaceDir: () => ipcRenderer.invoke('system:workspaceDir'),
    getMysqlStatus: () => ipcRenderer.invoke('system:getMysqlStatus'),
    getServicesStatus: () => ipcRenderer.invoke('system:getServicesStatus'),
    getSettings: () => ipcRenderer.invoke('system:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('system:saveSettings', settings),
    minimize: () => ipcRenderer.invoke('system:minimize'),
    maximize: () => ipcRenderer.invoke('system:maximize'),
    close: () => ipcRenderer.invoke('system:close'),
    toggleDevTools: () => ipcRenderer.invoke('system:toggleDevTools'),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  },

  // --- Integrations ---
  integrations: {
    getAll: () => ipcRenderer.invoke('integrations:getAll'),
    installPhp: (version) => ipcRenderer.invoke('integrations:installPhp', version),
    removePhp: (version) => ipcRenderer.invoke('integrations:removePhp', version),
    installMariaDb: () => ipcRenderer.invoke('integrations:installMariaDb'),
  },

  // --- WordPress ---
  wordpress: {
    getVersions: () => ipcRenderer.invoke('wordpress:getVersions'),
  },

  // --- App updates ---
  updates: {
    getVersion: () => ipcRenderer.invoke('update:getVersion'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
  },

  // --- Events from main → renderer ---
  on: (channel, callback) => {
    const allowed = [
      'site:statusChanged', 'site:log',
      'site:healthChanged', 'site:screenshotProgress',
      'mysql:progress', 'mysql:ready', 'mysql:error',
      'services:progress', 'services:ready', 'services:phpStatus',
      'integration:progress',
      'service:crashed',
      'update:status',
    ]
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args))
    }
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback)
  },
})
