import { useState } from 'react'
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

export default function IdeaGenerationStep() {
  const {
    ideaInput, setIdeaInput,
    generatedIdeas, setGeneratedIdeas,
    setScriptInput, setActiveStep,
  } = useStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!ideaInput.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await api.generateIdea(ideaInput.trim())
      setGeneratedIdeas(res.ideas)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate ideas')
    } finally {
      setLoading(false)
    }
  }

  function handleUseIdea() {
    if (!generatedIdeas.trim()) return
    setScriptInput(generatedIdeas)
    setActiveStep(3)
  }

  return (
    <StepCard
      title="2. Idea Generation"
      subtitle="Describe your animal video concept and let AI expand it into compelling ideas."
    >
      {/* Input */}
      <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
        Your concept or theme
      </label>
      <textarea
        value={ideaInput}
        onChange={(e) => setIdeaInput(e.target.value)}
        placeholder="e.g. A mother elephant protecting her calf from lions during drought season..."
        rows={3}
        className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-900 outline-none resize-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all placeholder:text-slate-300"
      />

      <button
        onClick={handleGenerate}
        disabled={loading || !ideaInput.trim()}
        className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-30"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {loading ? 'Generating…' : 'Generate Ideas'}
      </button>

      {error && (
        <p className="mt-3 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
          {error}
        </p>
      )}

      {/* Output */}
      {generatedIdeas && (
        <div className="mt-6">
          <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
            Generated Ideas — edit or refine before proceeding
          </label>
          <textarea
            value={generatedIdeas}
            onChange={(e) => setGeneratedIdeas(e.target.value)}
            rows={10}
            className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-800 outline-none resize-y focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all leading-relaxed"
          />
          <button
            onClick={handleUseIdea}
            className="mt-3 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 transition-all"
          >
            Use This Idea
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </StepCard>
  )
}
