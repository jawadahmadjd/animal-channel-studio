import { useState } from 'react'
import { Sparkles, ArrowRight, Loader2, RotateCcw, CheckSquare, Square } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

export default function IdeaGenerationStep() {
  const {
    ideaNiche, setIdeaNiche,
    ideaContentType, setIdeaContentType,
    generatedIdeas, setGeneratedIdeas,
    selectedIdeaIds, toggleIdeaSelected,
    setApprovedIdeas, setScriptInput, setActiveStep,
    resetContentCreation,
  } = useStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!ideaNiche.trim() || !ideaContentType.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await api.generateIdea(ideaNiche.trim(), ideaContentType.trim())
      setGeneratedIdeas(res.ideas)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate ideas')
    } finally {
      setLoading(false)
    }
  }

  function handleProceed() {
    if (selectedIdeaIds.size === 0) return
    const selected = generatedIdeas.filter((_, i) => selectedIdeaIds.has(i))
    setApprovedIdeas(selected)
    // Keep scriptInput for the manual textarea (single-idea fallback)
    setScriptInput(selected.map((idea) => `${idea.title}: ${idea.description}`).join('\n\n'))
    setActiveStep(3)
  }

  const canProceed = selectedIdeaIds.size > 0

  return (
    <StepCard
      title="2. Idea Generation"
      subtitle="Enter your niche and content type to get 10 tailored video ideas."
      headerAction={
        <button
          onClick={resetContentCreation}
          title="Reset all content creation steps"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
        >
          <RotateCcw size={11} strokeWidth={3} />
          Reset All
        </button>
      }
    >
      {/* Niche input */}
      <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
        Your Niche
      </label>
      <input
        type="text"
        value={ideaNiche}
        onChange={(e) => setIdeaNiche(e.target.value)}
        placeholder="e.g. Wildlife, Cooking, Personal Finance, Tech Reviews…"
        className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all placeholder:text-slate-300"
      />

      {/* Content type input */}
      <label className="block text-xs font-bold uppercase tracking-widest mt-4 mb-2 text-slate-400">
        Content Type
      </label>
      <input
        type="text"
        value={ideaContentType}
        onChange={(e) => setIdeaContentType(e.target.value)}
        placeholder="e.g. Short-form Reels, Long-form Documentary, Educational, Entertainment…"
        className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all placeholder:text-slate-300"
      />

      <button
        onClick={handleGenerate}
        disabled={loading || !ideaNiche.trim() || !ideaContentType.trim()}
        className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-30"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {loading ? 'Generating…' : 'Generate 10 Ideas'}
      </button>

      {error && (
        <p className="mt-3 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
          {error}
        </p>
      )}

      {/* Idea cards */}
      {generatedIdeas.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
              Select Ideas to Proceed
            </label>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {selectedIdeaIds.size} selected
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {generatedIdeas.map((idea, i) => {
              const selected = selectedIdeaIds.has(i)
              return (
                <button
                  key={i}
                  onClick={() => toggleIdeaSelected(i)}
                  className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                    selected
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-slate-50 border-slate-100 text-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-slate-400">
                      {selected
                        ? <CheckSquare size={15} className="text-emerald-500" strokeWidth={2.5} />
                        : <Square size={15} strokeWidth={2} />}
                    </span>
                    <div>
                      <p className="text-sm font-bold leading-snug">{idea.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 font-medium leading-relaxed">
                        {idea.description}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <button
            onClick={handleProceed}
            disabled={!canProceed}
            className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 transition-all disabled:opacity-30"
          >
            Proceed with {selectedIdeaIds.size} idea{selectedIdeaIds.size !== 1 ? 's' : ''}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </StepCard>
  )
}
