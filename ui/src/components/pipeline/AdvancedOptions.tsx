import { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, subscribeToStream, classifyLogLine } from '../../api/client'

export default function AdvancedOptions() {
  const [open, setOpen] = useState(false)
  const { advanced, setAdvanced, runState, setRunState, appendLog,
          selectedStoryId, setActiveStep } = useStore()

  // Debounced persist to app_settings whenever advanced changes
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.saveAppSettings({
        wait_between_scenes:   advanced.waitBetweenSec,
        max_retries_per_scene: advanced.sceneMaxRetries,
        pipeline_timeout_sec:  advanced.timeoutSec,
        flow_headless:         advanced.headless,
      }).catch(() => {})
    }, 500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [advanced.waitBetweenSec, advanced.sceneMaxRetries, advanced.timeoutSec, advanced.headless])

  const busy = runState === 'running'

  async function handleSingleScene() {
    if (!selectedStoryId) { alert('Please select a story first.'); return }

    try {
      setRunState('running')
      setActiveStep(4)
      appendLog({ text: '\n===== Run Single Scene =====\n', level: 'header', timestamp: ts() })

      await api.runSingleScene({
        story_id: selectedStoryId,
        scene_number: advanced.singleScene,
        wait_between_sec: advanced.waitBetweenSec,
        wait_max_sec: advanced.waitMaxSec,
        scene_max_retries: advanced.sceneMaxRetries,
        timeout_sec: advanced.timeoutSec,
        dry_run: advanced.dryRun,
        headless: advanced.headless,
      })

      const unsub = subscribeToStream(
        (line) => appendLog({ text: line, level: classifyLogLine(line), timestamp: ts() }),
        () => { setRunState('idle'); unsub() }
      )
    } catch {
      setRunState('error')
    }
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-6 py-3 text-xs font-black uppercase tracking-widest w-full text-left transition-all text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl"
      >
        {open ? <ChevronDown size={14} strokeWidth={3} /> : <ChevronRight size={14} strokeWidth={3} />}
        Advanced Configuration
      </button>

      {open && (
        <div
          className="mt-4 rounded-2xl p-8 bg-white border border-slate-100 shadow-sm"
        >
          <div className="grid grid-cols-2 gap-x-10 gap-y-6 mb-8">
            <NumField
              label="Min wait between scenes (s)"
              value={advanced.waitBetweenSec}
              onChange={(v) => setAdvanced({ waitBetweenSec: v })}
            />
            <NumField
              label="Retries per scene"
              value={advanced.sceneMaxRetries}
              onChange={(v) => setAdvanced({ sceneMaxRetries: v })}
            />
            <NumField
              label="Scene timeout (sec)"
              value={advanced.timeoutSec}
              onChange={(v) => setAdvanced({ timeoutSec: v })}
            />
            <NumField
              label="Run only scene number"
              value={advanced.singleScene}
              onChange={(v) => setAdvanced({ singleScene: v })}
            />
          </div>

          <div className="flex gap-8 mb-8">
            <CheckField
              label="Dry run (no video generated)"
              checked={advanced.dryRun}
              onChange={(v) => setAdvanced({ dryRun: v })}
            />
            <CheckField
              label="Headless browser"
              checked={advanced.headless}
              onChange={(v) => setAdvanced({ headless: v })}
            />
          </div>

          <button
            onClick={handleSingleScene}
            disabled={busy}
            className="w-full px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-sky-600 bg-sky-50 border-2 border-sky-100 hover:bg-sky-100 transition-all disabled:opacity-20"
          >
            Run Single Scene Only
          </button>
        </div>
      )}
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-slate-50 border border-slate-100 text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 transition-all"
      />
    </div>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 text-xs font-bold text-slate-600 cursor-pointer group">
      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${checked ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-200 group-hover:border-slate-300'}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="hidden"
        />
        {checked && <div className="w-2 h-2 bg-white rounded-full" />}
      </div>
      {label}
    </label>
  )
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}
