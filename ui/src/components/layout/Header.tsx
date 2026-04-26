import { Square, Play } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, subscribeToStream, classifyLogLine, parseSceneProgress } from '../../api/client'

interface Props {
  title: string
}

export default function Header({ title }: Props) {
  const {
    runState, setRunState, setStatusText, setActiveStep,
    appendLog, setCurrentScene, setTotalScenes,
    resetPipelineStages, updateStageFromLine,
    selectedStoryId, advanced,
  } = useStore()

  const isRunning = runState === 'running'

  async function handleGenerate() {
    if (isRunning) return
    if (!selectedStoryId) {
      alert('Please select a story first.')
      return
    }
    try {
      setRunState('running')
      setStatusText('Running pipeline…')
      setActiveStep(4)
      resetPipelineStages()
      appendLog({ text: `\n===== Generate All Videos =====\n`, level: 'header', timestamp: ts() })

      await api.runPipeline({
        story_id: selectedStoryId,
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
          if (prog) {
            setCurrentScene(prog.current)
            setTotalScenes(prog.total)
          }
          updateStageFromLine(line)
        },
        () => {
          setRunState('complete')
          setStatusText('Completed successfully ✓')
          unsub()
        }
      )
    } catch (err) {
      setRunState('error')
      setStatusText('Failed to start pipeline')
    }
  }

  async function handleStop() {
    try {
      await api.runStop()
      setRunState('stopped')
      setStatusText('Stopped')
      appendLog({ text: '\n[Stopped by user]\n', level: 'warn', timestamp: ts() })
    } catch {
      // ignore
    }
  }

  return (
    <div
      className="flex items-center justify-between px-12 py-6 bg-slate-50 border-b border-slate-200 overflow-hidden"
      style={{ flexShrink: 0 }}
    >
      <div className="flex flex-col">
        <h1 className="text-3xl font-black tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
          Automation Workflow
        </p>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        <button
          onClick={handleStop}
          disabled={!isRunning}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-all shadow-lg shadow-red-100 disabled:opacity-20 disabled:shadow-none whitespace-nowrap"
        >
          <Square size={16} fill="currentColor" />
          Stop
        </button>
        <button
          onClick={handleGenerate}
          disabled={isRunning}
          className="flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-black text-white bg-emerald-500 hover:bg-emerald-600 transition-all shadow-xl shadow-emerald-100 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-20 disabled:shadow-none whitespace-nowrap"
        >
          <Play size={16} fill="currentColor" />
          Generate All Videos
        </button>
      </div>
    </div>
  )
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
