interface ElectronAPI {
  getVersion: () => Promise<string>
  openPath: (path: string) => Promise<void>
  minimize: () => void
  maximize: () => void
  close: () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
