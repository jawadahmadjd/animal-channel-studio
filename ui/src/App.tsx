import { useRef } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import PipelineView from './views/PipelineView'
import LogsView from './views/LogsView'
import { useStore } from './store/useStore'

export default function App() {
  const { activeView } = useStore()
  const pipelineScrollRef = useRef<HTMLDivElement>(null!)

  function scrollToTop() {
    pipelineScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="flex flex-col h-full">
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
        </main>
      </div>
    </div>
  )
}
