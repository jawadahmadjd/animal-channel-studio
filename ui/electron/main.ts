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
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, createWriteStream,
} from 'fs'
import https from 'https'
import http from 'http'

autoUpdater.logger = log
;(autoUpdater.logger as typeof log).transports.file.level = 'info'

const BRIDGE_PORT = 7477
const PYTHON_VERSION = '3.12.9'
const PYTHON_ZIP_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

let bridgeProcess: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

// ── Path helpers ──────────────────────────────────────────────────────────────

function getResourcesDir(): string {
  if (app.isPackaged) return process.resourcesPath
  return resolve(__dirname, '..', '..')
}

function getDataDir(): string {
  if (app.isPackaged) return join(app.getPath('userData'), 'AnimalChannelStudio')
  return resolve(__dirname, '..', '..')
}

function getPythonRuntimeDir(): string {
  return join(app.getPath('userData'), 'AnimalChannelStudio', 'python-runtime')
}

function getPythonExe(): string {
  // Always prefer the self-managed runtime we downloaded
  const managed = join(getPythonRuntimeDir(), 'python.exe')
  if (existsSync(managed)) return managed
  // Dev fallback: system Python
  return process.platform === 'win32' ? 'python' : 'python3'
}

function getBridgeScript(): string {
  return join(getResourcesDir(), 'bridge', 'server.py')
}

// ── Setup progress IPC ────────────────────────────────────────────────────────

type SetupStage = 'python' | 'pip' | 'bridge' | 'browser' | 'done' | 'error'

function sendSetupProgress(stage: SetupStage, detail: string) {
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('setup:progress', { stage, detail })
    }
  }
  setTimeout(send, 80)
}

function needsFirstTimeSetup(): boolean {
  return !existsSync(join(getDataDir(), 'setup-complete-v4'))
}

function markSetupDone(): void {
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'setup-complete-v4'), new Date().toISOString())
}

// ── File download helper ──────────────────────────────────────────────────────

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const get = url.startsWith('https') ? https : http

    const request = (get as typeof https).get(url, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        downloadFile(res.headers.location!, dest).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`))
        return
      }
      const total = parseInt(res.headers['content-length'] ?? '0', 10)
      let received = 0
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total > 0) {
          const pct = Math.round((received / total) * 100)
          const mb = (received / 1048576).toFixed(1)
          const totalMb = (total / 1048576).toFixed(1)
          sendSetupProgress('python', `Downloading Python… ${mb} / ${totalMb} MB (${pct}%)`)
        }
      })
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    })
    request.on('error', (err) => { file.close(); reject(err) })
  })
}

// ── Python runtime bootstrap ──────────────────────────────────────────────────

async function ensurePythonRuntime(): Promise<void> {
  const runtimeDir = getPythonRuntimeDir()
  const pythonExe = join(runtimeDir, 'python.exe')

  if (existsSync(pythonExe)) {
    log.info('[setup] Python runtime already present at', pythonExe)
    return
  }

  mkdirSync(runtimeDir, { recursive: true })
  const tempDir = app.getPath('temp')
  const zipPath = join(tempDir, `python-${PYTHON_VERSION}-embed-amd64.zip`)

  // ── Download ───────────────────────────────────────────────────────────────
  sendSetupProgress('python', `Downloading Python ${PYTHON_VERSION}…`)
  log.info('[setup] downloading Python from', PYTHON_ZIP_URL)
  await downloadFile(PYTHON_ZIP_URL, zipPath)

  // ── Extract with PowerShell (built into every Windows machine) ─────────────
  sendSetupProgress('python', 'Extracting Python runtime…')
  log.info('[setup] extracting Python zip')
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${runtimeDir}' -Force`,
    ], { stdio: 'pipe' })
    proc.stderr?.on('data', (d: Buffer) => log.warn('[extract]', d.toString().trim()))
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Expand-Archive exit ${code}`)))
  })

  // ── Enable pip: uncomment 'import site' in the ._pth file ─────────────────
  // The embeddable zip ships with '#import site' commented out, which breaks pip.
  const pthFiles = require('fs').readdirSync(runtimeDir).filter((f: string) => f.endsWith('._pth'))
  for (const pthFile of pthFiles) {
    const pthPath = join(runtimeDir, pthFile)
    const content = readFileSync(pthPath, 'utf8')
    const fixed = content.replace('#import site', 'import site')
    writeFileSync(pthPath, fixed, 'utf8')
    log.info('[setup] patched', pthFile)
  }

  // ── Bootstrap pip ──────────────────────────────────────────────────────────
  sendSetupProgress('python', 'Bootstrapping pip…')
  const getPipPath = join(runtimeDir, 'get-pip.py')
  await downloadFile(GET_PIP_URL, getPipPath)

  await new Promise<void>((resolve) => {
    const proc = spawn(pythonExe, [getPipPath], { stdio: 'pipe' })
    proc.stdout?.on('data', (d: Buffer) => log.info('[get-pip]', d.toString().trim()))
    proc.stderr?.on('data', (d: Buffer) => log.info('[get-pip]', d.toString().trim()))
    proc.on('exit', (code) => {
      if (code !== 0) log.warn('[get-pip] exit code', code)
      resolve()
    })
  })

  log.info('[setup] Python runtime ready at', pythonExe)
}

// ── Background setup orchestrator ─────────────────────────────────────────────

async function runBackgroundSetup(): Promise<void> {
  const requirementsFile = join(getResourcesDir(), 'bridge', 'requirements.txt')

  // ── Step 1: Python runtime ────────────────────────────────────────────────
  await ensurePythonRuntime()
  const python = getPythonExe()

  // ── Step 2: pip install ───────────────────────────────────────────────────
  sendSetupProgress('pip', 'Installing Python packages…')
  log.info('[setup] running pip install')
  await new Promise<void>((resolve) => {
    const args = ['-m', 'pip', 'install', '--upgrade', '-r', requirementsFile]
    const proc = spawn(python, args, { stdio: 'pipe' })
    const onData = (d: Buffer) => {
      for (const line of d.toString().trim().split('\n')) {
        if (!line.trim()) continue
        log.info('[pip]', line)
        const lower = line.toLowerCase()
        if (lower.startsWith('downloading') || lower.startsWith('installing') || lower.startsWith('successfully')) {
          sendSetupProgress('pip', line.trim())
        }
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('exit', (code) => {
      if (code !== 0) log.warn('[pip] exit code', code)
      resolve()
    })
  })

  // ── Step 3: start bridge ──────────────────────────────────────────────────
  sendSetupProgress('bridge', 'Starting background service…')
  startBridge()
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`)
      if (res.ok) break
    } catch { /* keep waiting */ }
    await new Promise((r) => setTimeout(r, 500))
  }

  // ── Step 4: Playwright browser (user can already use the app now) ─────────
  sendSetupProgress('browser', 'Downloading browser engine (Chromium)…')
  log.info('[setup] installing playwright browser')
  await new Promise<void>((resolve) => {
    const proc = spawn(python, ['-m', 'playwright', 'install', 'chromium'], { stdio: 'pipe' })
    proc.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) { log.info('[pw]', line); sendSetupProgress('browser', line) }
    })
    proc.stderr?.on('data', (d: Buffer) => log.info('[pw]', d.toString().trim()))
    proc.on('exit', () => resolve())
  })

  markSetupDone()
  sendSetupProgress('done', 'Setup complete')
  log.info('[setup] first-time setup complete')
}

// ── Bridge lifecycle ──────────────────────────────────────────────────────────

function startBridge(): void {
  const bridgeScript = getBridgeScript()
  if (!existsSync(bridgeScript)) {
    log.error('Bridge server not found:', bridgeScript)
    return
  }

  const dataDir = getDataDir()
  try { mkdirSync(dataDir, { recursive: true }) } catch { /* ignore */ }

  bridgeProcess = spawn(
    getPythonExe(),
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

  bridgeProcess.stdout?.on('data', (d: Buffer) => log.info('[bridge]', d.toString().trim()))
  bridgeProcess.stderr?.on('data', (d: Buffer) => log.warn('[bridge]', d.toString().trim()))
  bridgeProcess.on('exit', (code) => log.info('[bridge] exited with code', code))
}

function stopBridge(): void {
  if (bridgeProcess) {
    bridgeProcess.kill()
    bridgeProcess = null
  }
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
  if (!app.isPackaged) return

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info.version)
    log.info('Update available:', info.version)
  })
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-ready', info.version)
    log.info('Update downloaded:', info.version)
  })
  autoUpdater.on('error', (err) => log.error('Auto-updater error:', err))
  autoUpdater.checkForUpdatesAndNotify()
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await createWindow()
  setupAutoUpdater()

  if (needsFirstTimeSetup()) {
    runBackgroundSetup().catch((err) => {
      log.error('[setup] failed:', err)
      sendSetupProgress('error', String(err))
    })
  } else {
    startBridge()
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  stopBridge()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopBridge)

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:getVersion', () => app.getVersion())

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Output Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.on('install-update', () => autoUpdater.quitAndInstall())

ipcMain.handle('app:open-path', (_event, folderPath: string) => shell.openPath(folderPath))
ipcMain.on('app:relaunch', () => { app.relaunch(); app.quit() })
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
