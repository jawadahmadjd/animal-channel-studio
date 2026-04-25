import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
} from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join, resolve } from 'path'
import { existsSync } from 'fs'

const BRIDGE_PORT = 7477
let bridgeProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

function getRootDir(): string {
  // In packaged app, resources are in process.resourcesPath
  if (app.isPackaged) {
    return resolve(process.resourcesPath, '..')
  }
  // In dev, go up two levels from electron/ folder
  return resolve(__dirname, '..', '..')
}

function startBridge(): void {
  const rootDir = getRootDir()
  const bridgeScript = join(rootDir, 'bridge', 'server.py')

  if (!existsSync(bridgeScript)) {
    console.error('Bridge server not found:', bridgeScript)
    return
  }

  const pythonExe = process.platform === 'win32' ? 'python' : 'python3'

  bridgeProcess = spawn(
    pythonExe,
    [bridgeScript],
    {
      cwd: rootDir,
      env: { ...process.env, PYTHONUTF8: '1' },
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

async function waitForBridge(retries = 20, delayMs = 300): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/auth/status`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  console.warn('Bridge did not become ready in time')
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 950,
    minWidth: 1100,
    minHeight: 800,
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
    // Wait for Vite dev server
    mainWindow.loadURL('http://localhost:5173')
  }
}

app.whenReady().then(async () => {
  startBridge()
  await waitForBridge()
  await createWindow()

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

ipcMain.handle('app:version', () => app.getVersion())

ipcMain.handle('app:open-path', (_event, folderPath: string) => {
  shell.openPath(folderPath)
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
