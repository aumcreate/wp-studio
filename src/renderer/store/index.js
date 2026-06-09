import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // --- Sites ---
  sites: [],
  sitesLoading: false,

  fetchSites: async () => {
    set({ sitesLoading: true })
    const res = await window.api.sites.list()
    if (res.ok) {
      // Preserve in-memory reachable state from health polling,
      // since the DB does not store reachability.
      const current = get().sites
      const reachableMap = {}
      current.forEach(s => { reachableMap[s.id] = s.reachable })
      const merged = res.data.map(s => ({
        ...s,
        reachable: reachableMap[s.id] ?? s.reachable,
      }))
      set({ sites: merged })
    }
    set({ sitesLoading: false })
  },

  addSite: (site) => set((s) => ({ sites: [site, ...s.sites] })),
  removeSite: (id) => set((s) => ({ sites: s.sites.filter((x) => x.id !== id) })),

  // Merges updated fields for a single site while preserving the in-memory
  // reachable value that is managed exclusively by health polling events.
  updateSite: (updatedSite) => set((s) => ({
    sites: s.sites.map((site) =>
      site.id === updatedSite.id
        ? { ...updatedSite, reachable: site.reachable }
        : site
    ),
  })),

  updateSiteHealth: (siteId, reachable) => set((s) => ({
    sites: s.sites.map((site) =>
      site.id === siteId ? { ...site, reachable } : site
    ),
  })),

  // --- Themes ---
  themes: [],
  themesLoading: false,

  fetchThemes: async () => {
    set({ themesLoading: true })
    const res = await window.api.themes.list()
    if (res.ok) set({ themes: res.data })
    set({ themesLoading: false })
  },

  addTheme: (theme) => set((s) => ({ themes: [...s.themes, theme] })),
  removeTheme: (id) => set((s) => ({ themes: s.themes.filter((t) => t.id !== id) })),

  // --- System ---
  herdStatus: null,
  fetchHerdStatus: async () => {
    const res = await window.api.system.getHerdStatus()
    if (res.ok) set({ herdStatus: res.data })
  },

  workspaceDir: '',
  fetchWorkspaceDir: async () => {
    const res = await window.api.system.getWorkspaceDir()
    if (res.ok) set({ workspaceDir: res.data })
  },

  // --- Service statuses ---
  mysqlStatus: { status: 'starting', message: 'Initializing...', port: 3306 },
  phpStatus: { running: [], ports: {} },
  caddyRunning: false,

  setMysqlStatus: (data) => set({ mysqlStatus: data }),
  setPhpStatus: (data) => set({ phpStatus: data }),
  setCaddyRunning: (v) => set({ caddyRunning: v }),

  fetchMysqlStatus: async () => {
    const res = await window.api.system.getMysqlStatus()
    if (res.ok) set({ mysqlStatus: res.data })
  },

  fetchServicesStatus: async () => {
    const res = await window.api.system.getServicesStatus()
    if (res.ok) {
      set({
        mysqlStatus: res.data.mysql,
        phpStatus: res.data.php,
        caddyRunning: res.data.caddy.running,
      })
    }
  },

  // --- Settings ---
  settings: null,
  fetchSettings: async () => {
    const res = await window.api.system.getSettings()
    if (res.ok) set({ settings: res.data })
  },
  saveSettings: async (values) => {
    const res = await window.api.system.saveSettings(values)
    if (res.ok) set({ settings: { ...get().settings, ...values } })
    return res
  },

  // --- App updates ---
  // updateStatus.state: idle|checking|available|none|downloading|downloaded|error|dev
  updateStatus: { state: 'idle' },
  appVersion: '',
  updateDismissed: false,

  setUpdateStatus: (data) => set({ updateStatus: data, updateDismissed: false }),
  dismissUpdate: () => set({ updateDismissed: true }),
  fetchAppVersion: async () => {
    const res = await window.api.updates.getVersion()
    if (res.ok) set({ appVersion: res.data })
  },

  // --- Integrations ---
  // integrations.mariadb: { installed, status, message, percent }
  // integrations.php: [{ version, status, message, percent, running }]
  integrations: null,
  integrationsLoading: false,

  fetchIntegrations: async () => {
    set({ integrationsLoading: true })
    const res = await window.api.integrations.getAll()
    if (res.ok) set({ integrations: res.data })
    set({ integrationsLoading: false })
  },

  // Applies a real-time progress event from main process to the integrations state.
  applyIntegrationProgress: (event) => {
    const { type, version, status, message, percent } = event
    set((s) => {
      if (!s.integrations) return s

      if (type === 'mariadb') {
        return {
          integrations: {
            ...s.integrations,
            mariadb: { ...s.integrations.mariadb, status, message, percent: percent ?? 0 },
          },
        }
      }

      if (type === 'php' && version) {
        const php = (s.integrations.php || []).map((v) =>
          v.version === version
            ? { ...v, status, message, percent: percent ?? 0 }
            : v
        )
        return { integrations: { ...s.integrations, php } }
      }

      return s
    })
  },
}))
