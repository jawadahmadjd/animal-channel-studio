import { useState } from 'react'
import { Sparkles, ArrowRight, Loader2, RotateCcw, CheckSquare, Square, PenLine, Wand2 } from 'lucide-react'
import { useStore, type GeneratedIdea } from '../../store/useStore'
import { api, logUIEvent } from '../../api/client'
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

  const [mode, setMode] = useState<'generate' | 'manual'>('generate')
  const [manualText, setManualText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!ideaNiche.trim() || !ideaContentType.trim()) return
    logUIEvent('click:idea:generate', { niche: ideaNiche.trim(), contentType: ideaContentType.trim() })
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
    logUIEvent('click:idea:proceed', { count: selected.length, titles: selected.map(i => i.title) })
    setApprovedIdeas(selected)
    setScriptInput(selected.map((idea) => `${idea.title}: ${idea.description}`).join('\n\n'))
    setActiveStep(3)
  }

  function parseManualIdeas(): GeneratedIdea[] {
    return manualText.trim().split('\n')
      .map(line => line.trim()).filter(Boolean)
      .map(line => {
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0) {
          return { title: line.slice(0, colonIdx).trim(), description: line.slice(colonIdx + 1).trim() }
        }
        return { title: line, description: '' }
      })
  }

  function handleManualProceed() {
    const ideas = parseManualIdeas()
    if (ideas.length === 0) return
    logUIEvent('click:idea:manual', { count: ideas.length })
    setApprovedIdeas(ideas)
    setScriptInput(ideas.map(idea => idea.description ? `${idea.title}: ${idea.description}` : idea.title).join('\n\n'))
    setActiveStep(3)
  }

  const canProceed = selectedIdeaIds.size > 0
  const manualIdeas = parseManualIdeas()

  return (
    <StepCard
      title="2. Idea Generation"
      subtitle="Enter your niche and content type to get 10 tailored video ideas, or type your own."
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
      {/* Mode toggle */}
      <div className="flex gap-2 mb-5 p-1 bg-slate-100 rounded-xl">
        <button
          onClick={() => setMode('generate')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
            mode === 'generate'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Wand2 size={13} /> AI Generate
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
            mode === 'manual'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <PenLine size={13} /> Enter Manually
        </button>
      </div>

      {mode === 'generate' && (
        <>
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
        </>
      )}

      {mode === 'manual' && (
        <>
          <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
            Your Ideas
          </label>
          <p className="text-[11px] text-slate-400 font-medium mb-3">
            One idea per line. Format: <span className="font-bold text-slate-500">Title: Description</span> — or just a title.
          </p>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder={`Lions vs Tigers: A dramatic look at apex predators\nThe Secret Life of Axolotls\nHow Elephants Mourn Their Dead: Ancient rituals and social bonds`}
            rows={6}
            className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-900 outline-none resize-y focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all placeholder:text-slate-300 leading-relaxed"
          />

          {manualIdeas.length > 0 && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                Preview — {manualIdeas.length} idea{manualIdeas.length !== 1 ? 's' : ''}
              </p>
              {manualIdeas.map((idea, i) => (
                <p key={i} className="text-xs text-slate-600 font-medium leading-relaxed">
                  · <span className="font-bold">{idea.title}</span>
                  {idea.description && <span className="text-slate-400"> — {idea.description}</span>}
                </p>
              ))}
            </div>
          )}

          <button
            onClick={handleManualProceed}
            disabled={manualIdeas.length === 0}
            className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 transition-all disabled:opacity-30"
          >
            Use {manualIdeas.length > 0 ? manualIdeas.length : ''} Idea{manualIdeas.length !== 1 ? 's' : ''} →
            <ArrowRight size={16} />
          </button>
        </>
      )}
    </StepCard>
  )
}
