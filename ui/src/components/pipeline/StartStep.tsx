import { useState } from 'react'
import { Clapperboard, AlertTriangle, Loader2, RefreshCw, FolderOutput, Pause } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, subscribeToStream, classifyLogLine, parseSceneProgress, logUIEvent } from '../../api/client'
import StepCard from './StepCard'
import StatusBadge from '../shared/StatusBadge'

export default function StartStep() {
  const {
    runState, pipelineRunning,
    setRunState, setStatusText, setActiveStep,
    appendLog, setCurrentScene, setTotalScenes,
    resetPipelineStages, updateStageFromLine,
    selectedStoryId,
  } = useStore()

  const [authWarning, setAuthWarning] = useState('')
  const [alreadyRunningToast, setAlreadyRunningToast] = useState(false)
  const isRunning = runState === 'running'
  const busy = isRunning

  async function startAndStream(label: string, startFn: () => Promise<unknown>) {
    if (pipelineRunning) { showAlreadyRunningToast(); return }
    try {
      setRunState('running')
      appendLog({ text: `\n===== ${label} =====\n`, level: 'header', timestamp: ts() })
      const res = await startFn() as { status?: string; message?: string } | undefined
      if (res?.status === 'already_completed') {
        setRunState('complete')
        setStatusText('Already completed')
        appendLog({ text: res.message || '[Already completed]\n', level: 'ok', timestamp: ts() })
        return
      }
      const unsub = subscribeToStream(
        (line) => appendLog({ text: line, level: classifyLogLine(line), timestamp: ts() }),
        (success) => {
          setRunState(success ? 'idle' : 'error')
          unsub()
        }
      )
    } catch {
      setRunState('error')
    }
  }

  async function handleResume() {
    if (!selectedStoryId) return
    logUIEvent('click:start:resume', { story_id: selectedStoryId })
    try {
      const state = await api.getRunState(selectedStoryId)
      if (!state.schema_ok && state.schema_message) {
        const proceed = confirm(
          `⚠️ Schema Version Mismatch\n\n${state.schema_message}\n\nResume may be unreliable.\n\nContinue anyway?`
        )
        if (!proceed) return
      }
    } catch {
      // No saved state — proceed normally
    }
    await startAndStream('Resume Pipeline', () =>
      api.runResume({ story_id: selectedStoryId })
    )
  }

  async function handleFinalize() {
    if (!selectedStoryId) return
    logUIEvent('click:start:finalize', { story_id: selectedStoryId })
    await startAndStream('Finalize Story', () => api.runFinalize(selectedStoryId))
  }

  async function handlePause() {
    if (!isRunning) return
    logUIEvent('click:start:pause', { story_id: selectedStoryId })
    try {
      await api.runStop()
      setRunState('stopped')
      setStatusText('Paused. Use Resume to continue.')
      appendLog({
        text: '\n[Paused by user - use Resume to continue saved scenes]\n',
        level: 'warn',
        timestamp: ts(),
      })
    } catch {
      setRunState('error')
      setStatusText('Pause failed')
    }
  }

  function showAlreadyRunningToast() {
    setAlreadyRunningToast(true)
    setTimeout(() => setAlreadyRunningToast(false), 3000)
  }

  async function handleStart() {
    if (pipelineRunning) {
      showAlreadyRunningToast()
      logUIEvent('click:start:blocked-already-running')
      return
    }

    if (!selectedStoryId) { alert('Please select a story first.'); return }
    logUIEvent('click:start:generate', { story_id: selectedStoryId })

    // H6: check auth before starting
    setAuthWarning('')
    try {
      const status = await api.getAuthStatus()
      if (!status.authorized) {
        setAuthWarning('You are not logged in to Google Flow. Please complete the Login step first.')
        return
      }
      if (status.expires_soon) {
        setAuthWarning('Your Google session expires soon. Consider re-logging in before starting to avoid a failed run.')
        // Don't block — just warn
      }
    } catch {
      // bridge unreachable — proceed anyway
    }

    try {
      setRunState('running')
      setStatusText('Generating with Flow…')
      setActiveStep(8)
      resetPipelineStages()
      appendLog({ text: '\n===== Generate with Flow =====\n', level: 'header', timestamp: ts() })

      const runRes = await api.runFlowOnly({
        story_id: selectedStoryId,
      })
      if ((runRes as { status?: string; message?: string })?.status === 'already_completed') {
        setRunState('complete')
        setStatusText('Already completed')
        appendLog({
          text: (runRes as { message?: string }).message || '[Already completed]\n',
          level: 'ok',
          timestamp: ts(),
        })
        return
      }

      const unsub = subscribeToStream(
        (line) => {
          const level = classifyLogLine(line)
          appendLog({ text: line, level, timestamp: ts() })
          const prog = parseSceneProgress(line)
          if (prog) { setCurrentScene(prog.current); setTotalScenes(prog.total) }
          updateStageFromLine(line)
        },
        (success) => {
          if (success) {
            setRunState('complete')
            setStatusText('Completed successfully ✓')
          } else {
            setRunState('error')
            setStatusText('Flow failed to start')
          }
          unsub()
        }
      )
    } catch {
      setRunState('error')
      setStatusText('Failed to start')
    }
  }

  return (
    <StepCard title="8. Generate with Flow" subtitle="Open the browser and generate videos in Google Flow.">
      {authWarning && (
        <div className="mb-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100 text-xs font-bold text-amber-700">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {authWarning}
        </div>
      )}
      {alreadyRunningToast && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100 text-xs font-bold text-amber-700 text-center">
          A pipeline is already running. Pause it first.
        </div>
      )}
      <button
        onClick={handleStart}
        disabled={isRunning}
        className="w-full flex items-center justify-center gap-4 py-6 rounded-2xl text-lg font-black uppercase tracking-[0.2em] text-white mb-6 transition-all bg-slate-900 hover:bg-slate-800 hover:shadow-2xl hover:shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-20 disabled:shadow-none"
      >
        {isRunning ? (
          <Loader2 size={20} className="animate-spin" />
        ) : (
          <Clapperboard size={20} />
        )}
        {isRunning ? 'Generating…' : 'Generate with Flow'}
      </button>
      <div className="flex justify-center mb-6">
        <StatusBadge status={runState} />
      </div>

      {/* Resume / Finalize — story must be selected in Step 6 */}
      <button
        onClick={handlePause}
        disabled={!isRunning}
        title="Pause the current run. Resume will continue from saved scene progress."
        className="mb-6 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-amber-700 bg-amber-50 border-2 border-amber-100 hover:bg-amber-100 transition-all disabled:opacity-25"
      >
        <Pause size={14} fill="currentColor" />
        Pause Run
      </button>

      {selectedStoryId && (
        <div className="flex gap-3">
          <button
            onClick={handleResume}
            disabled={busy}
            title="Continue an existing generation for the selected story."
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 transition-all disabled:opacity-30"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Resume
          </button>
          <button
            onClick={handleFinalize}
            disabled={busy}
            title="Move downloaded clips to the final output folder."
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-slate-600 bg-slate-50 border-2 border-slate-100 hover:bg-slate-100 transition-all disabled:opacity-30"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FolderOutput size={13} />}
            Finalize
          </button>
        </div>
      )}
    </StepCard>
  )
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}
