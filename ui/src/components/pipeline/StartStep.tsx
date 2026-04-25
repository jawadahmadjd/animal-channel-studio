import { Rocket } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, subscribeToStream, classifyLogLine, parseSceneProgress } from '../../api/client'
import StepCard from './StepCard'
import StatusBadge from '../shared/StatusBadge'

export default function StartStep() {
  const {
    ideas, selectedIdeaIndex, advanced, runState,
    setRunState, setStatusText, setActiveStep,
    appendLog, setCurrentScene, setTotalScenes,
    resetPipelineStages, updateStageFromLine,
  } = useStore()

  const isRunning = runState === 'running'

  async function handleStart() {
    const idea = ideas[selectedIdeaIndex]
    if (!idea) { alert('Please select a story first.'); return }

    try {
      setRunState('running')
      setStatusText('Running pipeline…')
      setActiveStep(8)
      resetPipelineStages()
      appendLog({ text: '\n===== Start Pipeline =====\n', level: 'header', timestamp: ts() })

      await api.runPipeline({
        idea_index: idea.index,
        wait_between_sec: advanced.waitBetweenSec,
        wait_max_sec: advanced.waitMaxSec,
        scene_max_retries: advanced.sceneMaxRetries,
        timeout_sec: advanced.timeoutSec,
        dry_run: advanced.dryRun,
        headless: advanced.headless,
      })

      const unsub = subscribeToStream(
        (line) => {
          const level = classifyLogLine(line)
          appendLog({ text: line, level, timestamp: ts() })
          const prog = parseSceneProgress(line)
          if (prog) { setCurrentScene(prog.current); setTotalScenes(prog.total) }
          updateStageFromLine(line)
        },
        () => {
          setRunState('complete')
          setStatusText('Completed successfully ✓')
          unsub()
        }
      )
    } catch {
      setRunState('error')
      setStatusText('Failed to start')
    }
  }

  return (
    <StepCard title="8. Start Pipeline" subtitle="Finalize and launch the automated generation.">
      <button
        onClick={handleStart}
        disabled={isRunning}
        className="w-full flex items-center justify-center gap-4 py-6 rounded-2xl text-lg font-black uppercase tracking-[0.2em] text-white mb-6 transition-all bg-slate-900 hover:bg-slate-800 hover:shadow-2xl hover:shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-20 disabled:shadow-none"
      >
        <Rocket size={20} fill="currentColor" />
        Start Pipeline
      </button>
      <div className="flex justify-center">
        <StatusBadge status={runState} />
      </div>
    </StepCard>
  )
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}
