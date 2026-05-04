import { useRef, useEffect, useCallback, useState } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import PipelineView from './views/PipelineView'
import LogsView from './views/LogsView'
import SettingsView from './views/SettingsView'
import PromptsView from './views/PromptsView'
import UpdateBanner from './components/shared/UpdateBanner'
import SetupBanner from './components/shared/SetupBanner'
import { useStore } from './store/useStore'
import { api, REQUIRED_BRIDGE_VERSION } from './api/client'

type ThemeChoice = 'light' | 'dark' | 'system'

function applyTheme(theme: ThemeChoice) {
  const effective = theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : theme === 'system'
    ? 'light'
    : theme
  document.documentElement.dataset.theme = effective
  document.documentElement.dataset.themePreference = theme
}

export default function App() {
  const {
    activeView, setActiveView, setUpdateReady,
    bridgeReady, setBridgeReady, setApiKeysConfigured,
    setupStage, setSetupProgress,
  } = useStore()
  const pipelineScrollRef = useRef<HTMLDivElement>(null!)
  const [bridgeError, setBridgeError] = useState(false)
  const [bridgeOutdated, setBridgeOutdated] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Listen to background setup progress from Electron main
  useEffect(() => {
    window.electron?.onSetupProgress?.((payload) => {
      setSetupProgress(payload.stage as Parameters<typeof setSetupProgress>[0], payload.detail)
    })
  }, [setSetupProgress])

  // Poll bridge health — waits indefinitely while first-time setup is running
  const setupStageRef = useRef(setupStage)
  useEffect(() => { setupStageRef.current = setupStage }, [setupStage])

  const pollBridge = useCallback(async (attempt = 0): Promise<void> => {
    try {
      const health = await api.getHealth()
      if ((health.bridge_version ?? 0) < REQUIRED_BRIDGE_VERSION) {
        setBridgeOutdated(true)
        return
      }
      setApiKeysConfigured(health.keys)
      setBridgeReady(true)
      const data = await api.getAppSettings()
      applyTheme((data.theme as ThemeChoice) || 'system')
      if (data.first_launch && !data.onboarding_complete) setShowOnboarding(true)
      const noDeepSeek = !data.deepseek_api_key || data.deepseek_api_key === ''
      const noElevenLabs = !data.elevenlabs_api_key || data.elevenlabs_api_key === ''
      if (noDeepSeek && noElevenLabs) setActiveView('settings')
    } catch {
      // During setup keep retrying forever — bridge isn't up yet
      // After setup (returning user), give up after 20 seconds
      const setupDone = setupStageRef.current === 'idle' || setupStageRef.current === 'done'
      const MAX_ATTEMPTS = 40 // 20 s
      if (!setupDone || attempt < MAX_ATTEMPTS) {
        setTimeout(() => pollBridge(attempt + 1), 500)
      } else {
        setBridgeError(true)
      }
    }
  }, [setBridgeReady, setActiveView, setApiKeysConfigured])

  useEffect(() => {
    pollBridge()
  }, [pollBridge])

  // Wire auto-update IPC listener
  useEffect(() => {
    window.electron?.onUpdateReady?.((version) => setUpdateReady(version))
  }, [setUpdateReady])

  function scrollToTop() {
    pipelineScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function dismissOnboarding() {
    setShowOnboarding(false)
    await api.saveAppSettings({ onboarding_complete: true }).catch(() => {})
  }

  async function finishOnboarding() {
    await dismissOnboarding()
    setActiveView('settings')
  }

  return (
    <div className="flex flex-col h-full">
      <UpdateBanner />
      <SetupBanner />
      {bridgeError && (
        <div className="flex items-center gap-3 px-4 py-2 text-xs bg-red-950/60 border-b border-red-800/40 text-red-300">
          <span className="w-3 h-3 rounded-full bg-red-400 shrink-0" />
          <span className="font-semibold">Background service failed to start.</span>
          <button
            onClick={() => window.electron?.relaunch?.()}
            className="ml-auto shrink-0 px-3 py-1 rounded bg-red-800/60 hover:bg-red-700/60 text-red-200 font-semibold transition-colors"
          >
            Restart App
          </button>
        </div>
      )}
      {bridgeOutdated && (
        <div className="flex items-center gap-3 px-4 py-2 text-xs bg-amber-950/60 border-b border-amber-800/40 text-amber-300">
          <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
          <span className="font-semibold">Background service is outdated — restart to update.</span>
          <button
            onClick={() => window.electron?.relaunch?.()}
            className="ml-auto shrink-0 px-3 py-1 rounded bg-amber-800/60 hover:bg-amber-700/60 text-amber-200 font-semibold transition-colors"
          >
            Restart App
          </button>
        </div>
      )}
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
          <div className={`absolute inset-0 transition-all duration-500 transform ${activeView === 'prompts' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'}`}>
            <PromptsView />
          </div>
          <div className={`absolute inset-0 transition-all duration-500 transform ${activeView === 'settings' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'}`}>
            <SettingsView />
          </div>
        </main>
      </div>

      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-6">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-7 py-6 border-b border-slate-100">
              <h2 className="text-xl font-black text-slate-900">Welcome to Animal Channel Studio</h2>
              <p className="text-sm text-slate-500 mt-1">Three quick setup steps before your first video.</p>
            </div>
            <div className="px-7 py-6 space-y-4">
              {[
                'Enter your API keys in Settings.',
                'Login to Google Flow once.',
                'Start generating videos.',
              ].map((text, idx) => (
                <div key={text} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 text-xs font-black flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-700">{text}</span>
                </div>
              ))}
            </div>
            <div className="px-7 py-5 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={dismissOnboarding}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={finishOnboarding}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors"
              >
                Go to Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
