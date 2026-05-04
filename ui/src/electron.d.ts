interface ElectronAPI {
  getVersion: () => Promise<string>
  openFolder: () => Promise<string | null>
  openPath: (path: string) => Promise<void>
  saveTextFile: (defaultPath: string, content: string) => Promise<boolean>
  onSetupProgress: (cb: (payload: { stage: string; detail: string }) => void) => void
  onWindowFocusChanged: (cb: (focused: boolean) => void) => void
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
