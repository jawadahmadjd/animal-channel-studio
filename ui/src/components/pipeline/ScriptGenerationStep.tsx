import { useState } from 'react'
import { FileText, ArrowRight, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

export default function ScriptGenerationStep() {
  const {
    scriptInput, setScriptInput,
    generatedScript, setGeneratedScript,
    setActiveStep,
  } = useStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!scriptInput.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await api.generateScript(scriptInput.trim())
      setGeneratedScript(res.script)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate script')
    } finally {
      setLoading(false)
    }
  }

  function handleUseScript() {
    if (!generatedScript.trim()) return
    setActiveStep(4)
  }

  return (
    <StepCard
      title="3. Script Generation"
      subtitle="Turn your idea into a cinematic scene-by-scene narration script."
    >
      {/* Idea input */}
      <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
        Idea or concept (from step 2 or write your own)
      </label>
      <textarea
        value={scriptInput}
        onChange={(e) => setScriptInput(e.target.value)}
        placeholder="Paste or type the idea you want to script…"
        rows={4}
        className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-900 outline-none resize-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all placeholder:text-slate-300"
      />

      <button
        onClick={handleGenerate}
        disabled={loading || !scriptInput.trim()}
        className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-30"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
        {loading ? 'Writing Script…' : 'Generate Script'}
      </button>

      {error && (
        <p className="mt-3 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
          {error}
        </p>
      )}

      {/* Editable script output */}
      {generatedScript && (
        <div className="mt-6">
          <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
            Generated Script — edit freely before proceeding
          </label>
          <textarea
            value={generatedScript}
            onChange={(e) => setGeneratedScript(e.target.value)}
            rows={12}
            className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-800 outline-none resize-y focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all leading-relaxed"
          />
          <p className="mt-2 text-[11px] text-slate-400 font-medium">
            Each line = one scene. The next step will generate voiceover narration and VEO 3 prompts per line.
          </p>
          <button
            onClick={handleUseScript}
            className="mt-3 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 transition-all"
          >
            Use This Script
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </StepCard>
  )
}
