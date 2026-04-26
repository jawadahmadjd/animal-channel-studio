import { useRef, useEffect, useState } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import PipelineView from './views/PipelineView'
import LogsView from './views/LogsView'
import SettingsView from './views/SettingsView'
import UpdateBanner from './components/shared/UpdateBanner'
import { useStore } from './store/useStore'
import { api, REQUIRED_BRIDGE_VERSION } from './api/client'

export default function App() {
  const { activeView, setActiveView, setUpdateReady, setAdvanced, bridgeReady, setBridgeReady, setApiKeysConfigured } = useStore()
  const pipelineScrollRef = useRef<HTMLDivElement>(null!)
  const [bridgeError, setBridgeError] = useState(false)
  const [bridgeOutdated, setBridgeOutdated] = useState(false)

  // M2: Poll bridge health until ready, then load settings
  useEffect(() => {
    let cancelled = false
    const POLL_INTERVAL = 500
    const MAX_ATTEMPTS = 20 // 10 seconds total

    async function pollBridge(attempt = 0): Promise<void> {
      if (cancelled) return
      try {
        const health = await api.getHealth()
        if (cancelled) return
        if ((health.bridge_version ?? 0) < REQUIRED_BRIDGE_VERSION) {
          setBridgeOutdated(true)
          return
        }
        setApiKeysConfigured(health.keys)
        setBridgeReady(true)
        // Load settings once bridge is ready
        const data = await api.getAppSettings()
        if (cancelled) return
        const noDeepSeek = !data.deepseek_api_key || data.deepseek_api_key === ''
        const noElevenLabs = !data.elevenlabs_api_key || data.elevenlabs_api_key === ''
        if (noDeepSeek && noElevenLabs) setActiveView('settings')
        setAdvanced({
          ...(typeof data.wait_between_scenes === 'number' ? { waitBetweenSec: data.wait_between_scenes } : {}),
          ...(typeof data.max_retries_per_scene === 'number' ? { sceneMaxRetries: data.max_retries_per_scene } : {}),
          ...(typeof data.pipeline_timeout_sec === 'number' ? { timeoutSec: data.pipeline_timeout_sec } : {}),
          ...(typeof data.flow_headless === 'boolean' ? { headless: data.flow_headless } : {}),
        })
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          setTimeout(() => pollBridge(attempt + 1), POLL_INTERVAL)
        } else {
          setBridgeError(true)
        }
      }
    }

    pollBridge()
    return () => { cancelled = true }
  }, [setBridgeReady, setActiveView, setAdvanced, setApiKeysConfigured])

  // Wire auto-update IPC listener from Electron main
  useEffect(() => {
    window.electron?.onUpdateReady?.((version) => setUpdateReady(version))
  }, [setUpdateReady])

  function scrollToTop() {
    pipelineScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // M2: Bridge error screen
  if (bridgeError) {
    return (
      <div className="flex flex-col h-full bg-slate-950 text-white items-center justify-center gap-6">
        <TitleBar />
        <div className="flex flex-col items-center gap-4 px-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-2xl">!</div>
          <h2 className="text-lg font-black text-white">Could not start the background service</h2>
          <p className="text-sm text-slate-400 max-w-sm">
            The Python bridge failed to start. Try restarting the app. If the problem persists, check that Python is installed correctly.
          </p>
          <button
            onClick={() => window.electron?.relaunch?.()}
            className="mt-2 px-6 py-3 rounded-xl bg-white text-slate-900 text-sm font-black uppercase tracking-widest hover:bg-slate-100 transition-all"
          >
            Restart App
          </button>
        </div>
      </div>
    )
  }

  // Stale bridge: server is running but too old for this UI version
  if (bridgeOutdated) {
    return (
      <div className="flex flex-col h-full bg-slate-950 text-white items-center justify-center gap-6">
        <TitleBar />
        <div className="flex flex-col items-center gap-4 px-8 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-2xl">↻</div>
          <h2 className="text-lg font-black text-white">Bridge server is outdated</h2>
          <p className="text-sm text-slate-400 max-w-sm">
            The background service is running an old version that is incompatible with this UI.
            Restart the app to pick up the latest server code.
          </p>
          <button
            onClick={() => window.electron?.relaunch?.()}
            className="mt-2 px-6 py-3 rounded-xl bg-amber-400 text-slate-900 text-sm font-black uppercase tracking-widest hover:bg-amber-300 transition-all"
          >
            Restart App
          </button>
        </div>
      </div>
    )
  }

  // M2: Connecting splash while bridge starts up
  if (!bridgeReady) {
    return (
      <div className="flex flex-col h-full bg-slate-950 text-white items-center justify-center gap-4">
        <TitleBar />
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-white animate-spin" />
          <p className="text-sm font-bold text-slate-400 tracking-widest uppercase">Connecting…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <UpdateBanner />
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar onNewVideo={scrollToTop} />

        <main className="flex-1 overflow-hidden relative">
          <div className={`absolute inset-0 transition-all duration-500 transform ${activeView === 'pipeline' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none'}`}>
            <PipelineView scrollRef={pipelineScrollRef} />
          </div>
          <div className={`absolute inset-0 transition-all duration-500 transform ${activeView === 'logs' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'}`}>
            <LogsView />
          </div>
          <div className={`absolute inset-0 transition-all duration-500 transform ${activeView === 'settings' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'}`}>
            <SettingsView />
          </div>
        </main>
      </div>
    </div>
  )
}
