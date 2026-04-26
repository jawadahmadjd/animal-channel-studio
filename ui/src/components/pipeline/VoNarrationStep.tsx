import { useState } from 'react'
import { Mic2, Loader2, ChevronDown, Save, CheckCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

export default function VoNarrationStep() {
  const {
    generatedScript,
    voNarrations, setVoNarrations,
    updateVoNarrationItem,
    setActiveStep,
    approvedIdeas,
    activeApprovedIdeaIndex,
    scriptInput,
    multiScripts,
    selectedMultiScriptIndices,
    multiVoNarrations,
    setMultiVoNarrationsForIndex,
    updateMultiVoNarrationItem,
  } = useStore()

  const isMulti = multiScripts.length > 1
  // Only show scripts the user selected in Step 3
  const selectedEntries = multiScripts
    .map((s, i) => ({ ...s, originalIndex: i }))
    .filter((s) => selectedMultiScriptIndices.size === 0 || selectedMultiScriptIndices.has(s.originalIndex))

  // Single-script state
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  // Multi-script state (per card)
  const [multiLoading, setMultiLoading] = useState<boolean[]>([])
  const [multiSaving, setMultiSaving] = useState<boolean[]>([])
  const [multiSaved, setMultiSaved] = useState<boolean[]>([])
  const [multiError, setMultiError] = useState<string[]>([])
  const [multiSaveError, setMultiSaveError] = useState<string[]>([])
  const [multiExpandedCards, setMultiExpandedCards] = useState<Set<number>>(new Set())
  const [multiExpandedRow, setMultiExpandedRow] = useState<Record<number, number | null>>({})

  function setAt<T>(arr: T[], index: number, value: T): T[] {
    const next = [...arr]
    next[index] = value
    return next
  }

  // Single-script helpers
  async function handleGenerate() {
    if (!generatedScript.trim()) return
    setLoading(true)
    setError('')
    setSaved(false)
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

  function resolveCurrentIdea(): { title: string; description: string } | null {
    if (approvedIdeas.length > 0) {
      const idea = approvedIdeas[activeApprovedIdeaIndex] ?? approvedIdeas[0]
      return { title: idea.title, description: idea.description }
    }
    const colonIdx = scriptInput.indexOf(':')
    if (colonIdx > 0) {
      return {
        title: scriptInput.slice(0, colonIdx).trim(),
        description: scriptInput.slice(colonIdx + 1).trim(),
      }
    }
    return null
  }

  async function handleSaveAndProceed() {
    const idea = resolveCurrentIdea()
    if (!idea) {
      setSaveError('Could not determine idea title — go back to Step 2 and select an idea.')
      return
    }
    if (voNarrations.length === 0) return
    setSaving(true)
    setSaveError('')
    try {
      await api.saveIdeaMetadata(
        idea.title,
        idea.description,
        generatedScript,
        voNarrations.map((v) => ({ sentence: v.sentence, narration: v.narration, veo_prompt: v.veoPrompt }))
      )
      setSaved(true)
      setTimeout(() => setActiveStep(5), 600)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save metadata')
    } finally {
      setSaving(false)
    }
  }

  // Multi-script helpers
  async function handleMultiGenerate(index: number) {
    const entry = multiScripts[index]
    if (!entry?.script.trim()) return
    setMultiLoading((prev) => setAt(prev, index, true))
    setMultiError((prev) => setAt(prev, index, ''))
    setMultiSaved((prev) => setAt(prev, index, false))
    try {
      const res = await api.generateVoNarration(entry.script.trim())
      setMultiVoNarrationsForIndex(index, res.items.map((item) => ({
        sentence: item.sentence,
        narration: item.narration,
        veoPrompt: item.veo_prompt,
      })))
      setMultiExpandedCards((prev) => { const next = new Set(prev); next.add(index); return next })
    } catch (e: unknown) {
      setMultiError((prev) => setAt(prev, index, e instanceof Error ? e.message : 'Failed to generate narration'))
    } finally {
      setMultiLoading((prev) => setAt(prev, index, false))
    }
  }

  async function handleMultiSave(index: number) {
    const entry = multiScripts[index]
    const narrations = multiVoNarrations[index] ?? []
    if (!entry || narrations.length === 0) return
    setMultiSaving((prev) => setAt(prev, index, true))
    setMultiSaveError((prev) => setAt(prev, index, ''))
    try {
      await api.saveIdeaMetadata(
        entry.ideaTitle,
        entry.ideaDescription,
        entry.script,
        narrations.map((v) => ({ sentence: v.sentence, narration: v.narration, veo_prompt: v.veoPrompt }))
      )
      setMultiSaved((prev) => setAt(prev, index, true))
    } catch (e: unknown) {
      setMultiSaveError((prev) => setAt(prev, index, e instanceof Error ? e.message : 'Failed to save'))
    } finally {
      setMultiSaving((prev) => setAt(prev, index, false))
    }
  }

  const hasScript = Boolean(generatedScript.trim())
  const allMultiSaved = selectedEntries.length > 0 && selectedEntries.every((e) => multiSaved[e.originalIndex])

  if (isMulti) {
    return (
      <StepCard
        title="4. Voiceover Narration & VEO 3 Prompts"
        subtitle="Generate voiceover narration and VEO 3 prompts for each script, then save them all to the database."
      >
        <div className="space-y-4">
          {selectedEntries.map((entry, displayIdx) => {
            const i = entry.originalIndex
            const narrations = multiVoNarrations[i] ?? []
            const isOpen = multiExpandedCards.has(i)
            const isSaved = multiSaved[i] ?? false
            const isLoading = multiLoading[i] ?? false
            const isSaving = multiSaving[i] ?? false
            const err = multiError[i] ?? ''
            const saveErr = multiSaveError[i] ?? ''

            return (
              <div key={i} className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
                {/* Card header */}
                <button
                  onClick={() => setMultiExpandedCards((prev) => { const next = new Set(prev); isOpen ? next.delete(i) : next.add(i); return next })}
                  className="w-full flex items-center justify-between px-5 py-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-200 text-slate-600 text-[11px] font-black flex items-center justify-center">
                      {displayIdx + 1}
                    </span>
                    <span className="text-sm font-black text-slate-800 truncate">{entry.ideaTitle}</span>
                    {isSaved && (
                      <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                        <CheckCircle size={10} strokeWidth={2.5} /> Saved
                      </span>
                    )}
                    {narrations.length > 0 && !isSaved && (
                      <span className="shrink-0 text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        {narrations.length} scenes
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    size={15}
                    className={`shrink-0 ml-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 pt-4 space-y-4">
                    {/* Generate button */}
                    <button
                      onClick={() => handleMultiGenerate(i)}
                      disabled={isLoading}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-md shadow-slate-200 disabled:opacity-30"
                    >
                      {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Mic2 size={15} />}
                      {isLoading ? 'Generating…' : narrations.length > 0 ? 'Regenerate Narration & Prompts' : 'Generate Narration & Prompts'}
                    </button>

                    {err && (
                      <p className="text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">{err}</p>
                    )}

                    {/* Narration rows */}
                    {narrations.length > 0 && (
                      <div className="space-y-2">
                        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                          {narrations.length} scenes — click to edit
                        </label>
                        {narrations.map((item, ri) => {
                          const rowOpen = multiExpandedRow[i] === ri
                          return (
                            <div key={ri} className="rounded-xl border border-slate-100 bg-slate-50 overflow-hidden">
                              <button
                                onClick={() =>
                                  setMultiExpandedRow((prev) => ({ ...prev, [i]: rowOpen ? null : ri }))
                                }
                                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-100 transition-colors"
                              >
                                <span className="mt-0.5 w-5 h-5 shrink-0 rounded-md bg-slate-200 text-slate-600 text-[10px] font-black flex items-center justify-center">
                                  {ri + 1}
                                </span>
                                <p className="flex-1 text-sm text-slate-700 font-medium leading-snug line-clamp-2">
                                  {item.sentence}
                                </p>
                                <ChevronDown
                                  size={14}
                                  className={`shrink-0 mt-0.5 text-slate-400 transition-transform ${rowOpen ? 'rotate-180' : ''}`}
                                />
                              </button>
                              {rowOpen && (
                                <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                                  <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-emerald-600">
                                      VO Narration
                                    </label>
                                    <textarea
                                      value={item.narration}
                                      onChange={(e) => updateMultiVoNarrationItem(i, ri, { narration: e.target.value })}
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
                                      onChange={(e) => updateMultiVoNarrationItem(i, ri, { veoPrompt: e.target.value })}
                                      rows={4}
                                      className="w-full px-3 py-2.5 rounded-xl text-sm bg-white border border-slate-200 text-slate-800 outline-none resize-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50 transition-all leading-relaxed"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {saveErr && (
                          <p className="text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">{saveErr}</p>
                        )}

                        <button
                          onClick={() => handleMultiSave(i)}
                          disabled={isSaving || isSaved}
                          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${
                            isSaved
                              ? 'text-white bg-emerald-500 border-2 border-emerald-500'
                              : 'text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 disabled:opacity-30'
                          }`}
                        >
                          {isSaving ? (
                            <><Loader2 size={15} className="animate-spin" /> Saving…</>
                          ) : isSaved ? (
                            <><CheckCircle size={15} strokeWidth={2.5} /> Saved to Database</>
                          ) : (
                            <><Save size={15} /> Save to Database</>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </StepCard>
    )
  }

  // ── Single-script mode ────────────────────────────────────────────────────
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

              {saveError && (
                <p className="text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
                  {saveError}
                </p>
              )}

              <button
                onClick={handleSaveAndProceed}
                disabled={saving || saved}
                className={`mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all ${
                  saved
                    ? 'text-white bg-emerald-500 border-2 border-emerald-500'
                    : 'text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 disabled:opacity-30'
                }`}
              >
                {saving ? (
                  <><Loader2 size={16} className="animate-spin" /> Saving…</>
                ) : saved ? (
                  <><CheckCircle size={16} strokeWidth={2.5} /> Saved — moving to Step 5</>
                ) : (
                  <><Save size={16} /> Save to Database & Proceed to Voiceover<ArrowRight size={16} /></>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </StepCard>
  )
}
