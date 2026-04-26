import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { spawn, ChildProcess } from 'child_process'
import { join, resolve } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

autoUpdater.logger = log
;(autoUpdater.logger as typeof log).transports.file.level = 'info'

const BRIDGE_PORT = 7477
let bridgeProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

// ── Path helpers ──────────────────────────────────────────────────────────────

function getResourcesDir(): string {
  // In packaged app, extraResources land in process.resourcesPath
  if (app.isPackaged) return process.resourcesPath
  // Dev: two levels up from dist-electron/ (which mirrors electron/)
  return resolve(__dirname, '..', '..')
}

function getDataDir(): string {
  // User-writable data dir: state/, output/, logs/, downloads/ live here
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'AnimalChannelStudio')
  }
  // Dev: project root
  return resolve(__dirname, '..', '..')
}

function getBridgeScript(): string {
  return join(getResourcesDir(), 'bridge', 'server.py')
}

function getPythonExe(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python-runtime', 'python.exe')
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

// ── First-run setup ───────────────────────────────────────────────────────────

async function ensurePlaywrightBrowser(): Promise<void> {
  const dataDir = join(app.getPath('userData'), 'AnimalChannelStudio')
  mkdirSync(dataDir, { recursive: true })
  const markerPath = join(dataDir, 'playwright-ready')
  if (existsSync(markerPath)) return

  const setupWin = new BrowserWindow({
    width: 480,
    height: 220,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#0f172a',
    webPreferences: { contextIsolation: true },
  })

  setupWin.loadURL(
    `data:text/html,<!DOCTYPE html><html><body style="margin:0;background:%230f172a;color:%23e2e8f0;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:14px;text-align:center"><img src="" style="display:none"><h2 style="margin:0;font-size:20px;font-weight:600">Animal Channel Studio</h2><p style="margin:0;font-size:14px;color:%2394a3b8">First-time setup — downloading browser engine…</p><p style="margin:0;font-size:12px;color:%2364748b">This only happens once. Please wait.</p></body></html>`
  )

  await new Promise<void>((resolve) => {
    const proc = spawn(getPythonExe(), ['-m', 'playwright', 'install', 'chromium'], {
      stdio: 'pipe',
    })
    proc.stdout?.on('data', (d: Buffer) => console.log('[setup]', d.toString().trim()))
    proc.stderr?.on('data', (d: Buffer) => console.log('[setup]', d.toString().trim()))
    proc.on('exit', () => resolve())
  })

  writeFileSync(markerPath, '')
  setupWin.close()
}

// ── Bridge lifecycle ──────────────────────────────────────────────────────────

function startBridge(): void {
  const bridgeScript = getBridgeScript()

  if (!existsSync(bridgeScript)) {
    console.error('Bridge server not found:', bridgeScript)
    return
  }

  const dataDir = getDataDir()
  // Ensure data dir exists before bridge tries to write to it
  try { mkdirSync(dataDir, { recursive: true }) } catch { /* ignore */ }

  const pythonExe = getPythonExe()

  bridgeProcess = spawn(
    pythonExe,
    [bridgeScript],
    {
      cwd: getResourcesDir(),
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        ANIMAL_STUDIO_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  bridgeProcess.stdout?.on('data', (d: Buffer) =>
    console.log('[bridge]', d.toString().trim())
  )
  bridgeProcess.stderr?.on('data', (d: Buffer) =>
    console.error('[bridge]', d.toString().trim())
  )
  bridgeProcess.on('exit', (code) =>
    console.log('[bridge] exited with code', code)
  )
}

function stopBridge(): void {
  if (bridgeProcess) {
    bridgeProcess.kill()
    bridgeProcess = null
  }
}

async function waitForBridge(retries = 20, delayMs = 500): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  console.warn('Bridge did not become ready in time')
}

// ── Window ────────────────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (app.isPackaged) {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173')
  }
}

function setupAutoUpdater(): void {
  // Only runs in packaged builds — update checks don't work in dev
  if (!app.isPackaged) return

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info.version)
    log.info('Update available:', info.version)
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-ready', info.version)
    log.info('Update downloaded:', info.version)
  })

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err)
  })

  autoUpdater.checkForUpdatesAndNotify()
}

app.whenReady().then(async () => {
  await ensurePlaywrightBrowser()
  startBridge()
  await waitForBridge()
  await createWindow()
  setupAutoUpdater()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopBridge()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopBridge)

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Version
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:getVersion', () => app.getVersion())

// Folder picker for Settings screen
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Output Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall()
})

// Window controls
ipcMain.handle('app:open-path', (_event, folderPath: string) => {
  shell.openPath(folderPath)
})
ipcMain.on('app:relaunch', () => { app.relaunch(); app.quit() })
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
