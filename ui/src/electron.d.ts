interface ElectronAPI {
  getVersion: () => Promise<string>
  openFolder: () => Promise<string | null>
  openPath: (path: string) => Promise<void>
  onSetupProgress: (cb: (payload: { stage: string; detail: string }) => void) => void
  onUpdateReady: (cb: (version: string) => void) => void
  installUpdate: () => void
  relaunch: () => void
  minimize: () => void
  maximize: () => void
  close: () => void
}

declare global {
  interface Window {
    electron?: ElectronAPI
    electronAPI?: ElectronAPI
  }
}

export {}
