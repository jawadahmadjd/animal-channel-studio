import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // App info
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  // Folder picker (used by Settings screen)
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),

  // Open path in Explorer
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('app:open-path', path),

  // First-time setup progress from background installer
  onSetupProgress: (cb: (payload: { stage: string; detail: string }) => void) => {
    ipcRenderer.on('setup:progress', (_event, payload) => cb(payload))
  },

  // Auto-update (wired up once electron-updater is added in U2)
  onUpdateReady: (cb: (version: string) => void) => {
    ipcRenderer.on('update-ready', (_event, version: string) => cb(version))
  },
  installUpdate: () => ipcRenderer.send('install-update'),

  // Relaunch (used by bridge-error screen)
  relaunch: () => ipcRenderer.send('app:relaunch'),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
}

// Expose as both names for compatibility
contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
