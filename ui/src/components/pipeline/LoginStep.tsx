import { LogIn, RotateCcw } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, subscribeToStream, classifyLogLine } from '../../api/client'
import StepCard from './StepCard'

export default function LoginStep() {
  const { isAuthorized, setIsAuthorized, advanced, appendLog, runState, setRunState, setActiveStep } = useStore()

  async function handleConnect() {
    try {
      setRunState('running')
      setActiveStep(1)
      appendLog({ text: '\n===== Open Google Flow Login =====\n', level: 'header', timestamp: ts() })
      await api.runLogin(advanced.headless)
      const unsub = subscribeToStream(
        (line) => appendLog({ text: line, level: classifyLogLine(line), timestamp: ts() }),
        () => {
          setRunState('idle')
          unsub()
        }
      )
    } catch {
      setRunState('error')
    }
  }

  async function handleReset() {
    if (!confirm('Delete your saved session and log in again?')) return
    await api.deleteAuth()
    setIsAuthorized(false)
    appendLog({ text: '\n[Login session cleared]\n', level: 'info', timestamp: ts() })
  }

  const busy = runState === 'running'

  return (
    <StepCard title="1. Log in to Google Flow" subtitle="Authorize access to your story scripts and assets.">
      <div className="flex items-center gap-4">
        <button
          onClick={handleConnect}
          disabled={busy}
          className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-20"
        >
          <LogIn size={18} />
          Connect Account
        </button>

        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            isAuthorized 
              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
              : 'bg-red-50 text-red-600 border border-red-100'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${isAuthorized ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}
          />
          {isAuthorized ? 'Authorized' : 'Unauthorized'}
        </div>

        <button
          onClick={handleReset}
          className="ml-auto flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
        >
          <RotateCcw size={14} strokeWidth={3} />
          Reset
        </button>
      </div>
    </StepCard>
  )
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}
