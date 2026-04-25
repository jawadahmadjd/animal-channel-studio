import { useEffect, useState } from 'react'
import { RefreshCw, Trash2, FolderOutput, Copy, Check } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, subscribeToStream, classifyLogLine } from '../../api/client'
import StepCard from './StepCard'

export default function PickStoryStep() {
  const {
    ideas, selectedIdeaIndex, setIdeas, setSelectedIdeaIndex,
    appendLog, runState, setRunState, setActiveStep, advanced,
  } = useStore()

  useEffect(() => {
    api.getIdeas().then(setIdeas).catch(() => {})
  }, [setIdeas])

  const selectedIdea = ideas[selectedIdeaIndex]

  async function startAndStream(label: string, startFn: () => Promise<unknown>) {
    try {
      setRunState('running')
      appendLog({ text: `\n===== ${label} =====\n`, level: 'header', timestamp: ts() })
      await startFn()
      const unsub = subscribeToStream(
        (line) => appendLog({ text: line, level: classifyLogLine(line), timestamp: ts() }),
        () => { setRunState('idle'); unsub() }
      )
    } catch {
      setRunState('error')
    }
  }

  async function handleResume() {
    if (!selectedIdea) return
    setActiveStep(6)
    await startAndStream('Resume Pipeline', () =>
      api.runResume({
        story_id: selectedIdea.story_id,
        wait_between_sec: advanced.waitBetweenSec,
        wait_max_sec: advanced.waitMaxSec,
        scene_max_retries: advanced.sceneMaxRetries,
        timeout_sec: advanced.timeoutSec,
        dry_run: advanced.dryRun,
        headless: advanced.headless,
      })
    )
  }

  async function handleFreshStart() {
    if (!selectedIdea) return
    if (!confirm(`Delete ALL progress for "${selectedIdea.title}"? This cannot be undone.`)) return
    await api.runFreshStart(selectedIdea.story_id)
    appendLog({ text: `\n[Fresh Start] Progress cleared for "${selectedIdea.title}"\n`, level: 'ok', timestamp: ts() })
  }

  async function handleFinalize() {
    if (!selectedIdea) return
    setActiveStep(6)
    await startAndStream('Finalize Story', () => api.runFinalize(selectedIdea.story_id))
  }

  const busy = runState === 'running'

  return (
    <StepCard title="6. Pick a Story from Ideas" subtitle="Select from trending animal narrative concepts.">
      {/* Dropdown */}
      <div className="relative mb-4">
        <select
          className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-slate-50 border border-slate-100 text-slate-900 outline-none appearance-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 transition-all"
          value={selectedIdeaIndex}
          onChange={(e) => setSelectedIdeaIndex(Number(e.target.value))}
        >
          {ideas.length === 0 && <option value={0}>(Loading ideas…)</option>}
          {ideas.map((idea, i) => (
            <option key={idea.story_id} value={i}>
              {idea.index}. {idea.title}
            </option>
          ))}
        </select>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
        </div>
      </div>

      {/* Story ID — subtle copyable chip, not a raw text dump */}
      {selectedIdea && <StoryIdChip id={selectedIdea.story_id} />}

      {/* Action buttons — unified outline style, semantically coloured on hover */}
      <div className="flex gap-3 mt-6">
        <ActionBtn
          icon={<RefreshCw size={14} />}
          label="Resume"
          onClick={handleResume}
          disabled={busy || !selectedIdea}
          title="Continue an existing generation for this story."
          variant="primary"
        />
        <ActionBtn
          icon={<FolderOutput size={14} />}
          label="Finalize"
          onClick={handleFinalize}
          disabled={busy || !selectedIdea}
          title="Move downloaded clips to the final output folder."
          variant="secondary"
        />
        <ActionBtn
          icon={<Trash2 size={14} />}
          label="Fresh Start"
          onClick={handleFreshStart}
          disabled={busy || !selectedIdea}
          title="Delete all saved progress and start from scratch."
          variant="danger"
        />
      </div>
    </StepCard>
  )
}

function StoryIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black font-mono cursor-pointer select-none bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
      onClick={handleCopy}
      title="Click to copy story ID"
    >
      <span className="truncate max-w-[200px] uppercase tracking-wider">{id}</span>
      {copied
        ? <Check size={12} className="text-emerald-500" strokeWidth={3} />
        : <Copy size={12} strokeWidth={3} />}
    </div>
  )
}

function ActionBtn({
  icon, label, onClick, disabled, title, variant,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled: boolean
  title: string
  variant: 'primary' | 'secondary' | 'danger'
}) {
  const colors = {
    primary:   'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100',
    secondary: 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100',
    danger:    'bg-red-50 text-red-600 border-red-100 hover:bg-red-100',
  }
  const c = colors[variant]

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all disabled:opacity-20 ${c}`}
    >
      {icon}
      {label}
    </button>
  )
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}
