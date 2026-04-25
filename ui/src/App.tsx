import { useRef, useEffect } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import PipelineView from './views/PipelineView'
import LogsView from './views/LogsView'
import SettingsView from './views/SettingsView'
import UpdateBanner from './components/shared/UpdateBanner'
import { useStore } from './store/useStore'
import { api } from './api/client'

export default function App() {
  const { activeView, setActiveView, setUpdateReady } = useStore()
  const pipelineScrollRef = useRef<HTMLDivElement>(null!)

  // First-launch gate: if both API keys are missing, redirect to Settings
  useEffect(() => {
    api.getAppSettings().then((data) => {
      const noDeepSeek = !data.deepseek_api_key || data.deepseek_api_key === ''
      const noElevenLabs = !data.elevenlabs_api_key || data.elevenlabs_api_key === ''
      if (noDeepSeek && noElevenLabs) {
        setActiveView('settings')
      }
    }).catch(() => {})
  }, [setActiveView])

  // Wire auto-update IPC listener from Electron main
  useEffect(() => {
    window.electron?.onUpdateReady?.((version) => setUpdateReady(version))
  }, [setUpdateReady])

  function scrollToTop() {
    pipelineScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
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
