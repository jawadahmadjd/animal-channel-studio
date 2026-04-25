import { useState } from 'react'
import { Mic2, ArrowRight, Loader2, ChevronDown } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

export default function VoNarrationStep() {
  const {
    generatedScript,
    voNarrations, setVoNarrations,
    updateVoNarrationItem,
    setActiveStep,
  } = useStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  async function handleGenerate() {
    if (!generatedScript.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await api.generateVoNarration(generatedScript.trim())
      setVoNarrations(
        res.items.map((item) => ({
          sentence: item.sentence,
          narration: item.narration,
          veoPrompt: item.veo_prompt,
        }))
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate narration')
    } finally {
      setLoading(false)
    }
  }

  const hasScript = Boolean(generatedScript.trim())

  return (
    <StepCard
      title="4. Voiceover Narration & VEO 3 Prompts"
      subtitle="Auto-generate voiceover narration lines and VEO 3 video prompts for each script sentence."
    >
      {!hasScript && (
        <p className="text-sm text-slate-400 font-medium">
          Complete Step 3 (Script Generation) first.
        </p>
      )}

      {hasScript && (
        <>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-30"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Mic2 size={16} />}
            {loading ? 'Generating…' : 'Generate Narration & Prompts'}
          </button>

          {error && (
            <p className="mt-3 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
              {error}
            </p>
          )}

          {voNarrations.length > 0 && (
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                {voNarrations.length} scenes — click any row to edit
              </label>

              {voNarrations.map((item, i) => {
                const isOpen = expandedRow === i
                return (
                  <div
                    key={i}
                    className="rounded-2xl border border-slate-100 bg-slate-50 overflow-hidden"
                  >
                    {/* Row header — always visible */}
                    <button
                      onClick={() => setExpandedRow(isOpen ? null : i)}
                      className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-slate-100 transition-colors"
                    >
                      <span className="mt-0.5 w-6 h-6 shrink-0 rounded-lg bg-slate-200 text-slate-600 text-[11px] font-black flex items-center justify-center">
                        {i + 1}
                      </span>
                      <p className="flex-1 text-sm text-slate-700 font-medium leading-snug line-clamp-2">
                        {item.sentence}
                      </p>
                      <ChevronDown
                        size={16}
                        className={`shrink-0 mt-0.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* Expanded edit panel */}
                    {isOpen && (
                      <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-emerald-600">
                            VO Narration
                          </label>
                          <textarea
                            value={item.narration}
                            onChange={(e) =>
                              updateVoNarrationItem(i, { narration: e.target.value })
                            }
                            rows={3}
                            className="w-full px-3 py-2.5 rounded-xl text-sm bg-white border border-slate-200 text-slate-800 outline-none resize-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all leading-relaxed"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-violet-600">
                            VEO 3 Prompt
                          </label>
                          <textarea
                            value={item.veoPrompt}
                            onChange={(e) =>
                              updateVoNarrationItem(i, { veoPrompt: e.target.value })
                            }
                            rows={4}
                            className="w-full px-3 py-2.5 rounded-xl text-sm bg-white border border-slate-200 text-slate-800 outline-none resize-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50 transition-all leading-relaxed"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              <button
                onClick={() => setActiveStep(5)}
                className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 transition-all"
              >
                Proceed to Voiceover
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </StepCard>
  )
}
