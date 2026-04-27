import { useState } from 'react'
import { Mic2, Loader2, ChevronDown, Save, CheckCircle, PenLine, Wand2, Plus, Trash2, ArrowRight, Video } from 'lucide-react'
import { useStore, type VoNarrationItem } from '../../store/useStore'
import { api, logUIEvent } from '../../api/client'
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

  // Multi mode: either multiple generated scripts, or multiple approved ideas (no scripts needed)
  const isMulti = multiScripts.length > 1 || approvedIdeas.length > 1

  // Build a unified list of entries for multi mode — fall back to approvedIdeas when no scripts generated
  const baseEntries = multiScripts.length > 0
    ? multiScripts.map((s, i) => ({ ideaTitle: s.ideaTitle, ideaDescription: s.ideaDescription, script: s.script, originalIndex: i }))
    : approvedIdeas.map((a, i) => ({ ideaTitle: a.title, ideaDescription: a.description, script: '', originalIndex: i }))
  const selectedEntries = baseEntries
    .filter((s) => multiScripts.length === 0 || selectedMultiScriptIndices.size === 0 || selectedMultiScriptIndices.has(s.originalIndex))

  // Mode: generate or manual
  const [mode, setMode] = useState<'generate' | 'manual'>('generate')
  // VEO-only toggle (manual mode): skip narration field
  const [veoOnly, setVeoOnly] = useState(false)

  // Manual items for single-script mode
  const [manualItems, setManualItems] = useState<VoNarrationItem[]>(() =>
    voNarrations.length > 0
      ? voNarrations
      : [{ sentence: 'Scene 1', narration: '', veoPrompt: '' }]
  )
  // Manual items for multi-script mode (per card) — use approvedIdeas count as fallback
  const multiCardCount = Math.max(multiScripts.length, approvedIdeas.length)
  const [manualMultiItems, setManualMultiItems] = useState<VoNarrationItem[][]>(() =>
    Array.from({ length: multiCardCount }, (_, i) =>
      (multiVoNarrations[i]?.length ?? 0) > 0
        ? multiVoNarrations[i]
        : [{ sentence: 'Scene 1', narration: '', veoPrompt: '' }]
    )
  )

  // Single-script generate state
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

  // ── Single generate ────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!generatedScript.trim()) return
    logUIEvent('click:vonarration:generate', { scriptLength: generatedScript.trim().length })
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      const res = await api.generateVoNarration(generatedScript.trim())
      setVoNarrations(res.items.map((item) => ({
        sentence: item.sentence,
        narration: item.narration,
        veoPrompt: item.veo_prompt,
      })))
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

  async function doSingleSave(items: VoNarrationItem[], nextStep: 5 | 6) {
    const idea = resolveCurrentIdea()
    if (!idea) {
      setSaveError('Could not determine idea title — go back to Step 2 and select an idea.')
      return
    }
    if (items.length === 0) return
    setSaving(true)
    setSaveError('')
    try {
      await api.saveIdeaMetadata(
        idea.title,
        idea.description,
        generatedScript,
        items.map((v) => ({ sentence: v.sentence, narration: v.narration, veo_prompt: v.veoPrompt }))
      )
      setSaved(true)
      setTimeout(() => setActiveStep(nextStep), 600)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save metadata')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndProceedToVoiceover() {
    const items = mode === 'manual' ? manualItems : voNarrations
    await doSingleSave(items, 5)
  }

  async function handleSaveAndProceedToPickStory() {
    const items = mode === 'manual' ? manualItems : voNarrations
    await doSingleSave(items, 6)
  }

  // ── Multi generate ─────────────────────────────────────────────────────────
  async function handleMultiGenerate(index: number) {
    const entry = multiScripts[index] ?? baseEntries[index]
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

  async function doMultiSave(index: number, narrations: VoNarrationItem[], nextStep: 5 | 6) {
    const entry = baseEntries[index]
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
      if (nextStep === 6) setTimeout(() => setActiveStep(6), 600)
    } catch (e: unknown) {
      setMultiSaveError((prev) => setAt(prev, index, e instanceof Error ? e.message : 'Failed to save'))
    } finally {
      setMultiSaving((prev) => setAt(prev, index, false))
    }
  }

  async function handleMultiSave(index: number, nextStep: 5 | 6 = 5) {
    const narrations = mode === 'manual'
      ? (manualMultiItems[index] ?? [])
      : (multiVoNarrations[index] ?? [])
    await doMultiSave(index, narrations, nextStep)
  }

  // ── Manual helpers ─────────────────────────────────────────────────────────
  function addManualRow() {
    setManualItems((prev) => [...prev, { sentence: `Scene ${prev.length + 1}`, narration: '', veoPrompt: '' }])
  }

  function removeManualRow(i: number) {
    setManualItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateManualItem(i: number, patch: Partial<VoNarrationItem>) {
    setManualItems((prev) => prev.map((item, idx) => idx === i ? { ...item, ...patch } : item))
  }

  function addManualMultiRow(cardIdx: number) {
    setManualMultiItems((prev) => {
      const next = [...prev]
      const card = [...(next[cardIdx] ?? [])]
      card.push({ sentence: `Scene ${card.length + 1}`, narration: '', veoPrompt: '' })
      next[cardIdx] = card
      return next
    })
  }

  function removeManualMultiRow(cardIdx: number, rowIdx: number) {
    setManualMultiItems((prev) => {
      const next = [...prev]
      next[cardIdx] = (next[cardIdx] ?? []).filter((_, i) => i !== rowIdx)
      return next
    })
  }

  function updateManualMultiItem(cardIdx: number, rowIdx: number, patch: Partial<VoNarrationItem>) {
    setManualMultiItems((prev) => {
      const next = [...prev]
      next[cardIdx] = (next[cardIdx] ?? []).map((item, i) => i === rowIdx ? { ...item, ...patch } : item)
      return next
    })
  }

  const hasScript = Boolean(generatedScript.trim())
  const allMultiSaved = selectedEntries.length > 0 && selectedEntries.every((e) => multiSaved[e.originalIndex])

  // ── Mode toggle bar ────────────────────────────────────────────────────────
  function renderModeToggle() {
    return (
      <div className="flex gap-2 mb-5 p-1 bg-slate-100 rounded-xl">
        <button
          onClick={() => setMode('generate')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
            mode === 'generate' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Wand2 size={13} /> AI Generate
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
            mode === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <PenLine size={13} /> Enter Manually
        </button>
      </div>
    )
  }

  // ── Narration row editor (shared between generate and manual display) ──────
  function renderNarrationRow(
    item: VoNarrationItem,
    ri: number,
    isOpen: boolean,
    onToggle: () => void,
    onNarrationChange: (v: string) => void,
    onVeoChange: (v: string) => void,
    onSentenceChange?: (v: string) => void,
    onRemove?: () => void,
    isManual?: boolean,
  ) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-100 transition-colors"
        >
          <span className="mt-0.5 w-5 h-5 shrink-0 rounded-md bg-slate-200 text-slate-600 text-[10px] font-black flex items-center justify-center">
            {ri + 1}
          </span>
          <p className="flex-1 text-sm text-slate-700 font-medium leading-snug line-clamp-2">
            {item.sentence || <span className="italic text-slate-400">No sentence</span>}
          </p>
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="p-1 rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all shrink-0"
              title="Remove this scene"
            >
              <Trash2 size={13} />
            </button>
          )}
          <ChevronDown size={14} className={`shrink-0 mt-0.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
            {isManual && onSentenceChange && (
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-slate-500">
                  Scene / Sentence
                </label>
                <input
                  type="text"
                  value={item.sentence}
                  onChange={(e) => onSentenceChange(e.target.value)}
                  placeholder="Scene label or script sentence…"
                  className="w-full px-3 py-2 rounded-xl text-sm bg-white border border-slate-200 text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all"
                />
              </div>
            )}
            {!veoOnly && (
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-emerald-600">
                  VO Narration
                </label>
                <textarea
                  value={item.narration}
                  onChange={(e) => onNarrationChange(e.target.value)}
                  rows={3}
                  placeholder="Voiceover narration text…"
                  className="w-full px-3 py-2.5 rounded-xl text-sm bg-white border border-slate-200 text-slate-800 outline-none resize-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all leading-relaxed"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-violet-600">
                VEO 3 Prompt
              </label>
              <textarea
                value={item.veoPrompt}
                onChange={(e) => onVeoChange(e.target.value)}
                rows={4}
                placeholder="Describe the video clip for VEO 3…"
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-white border border-slate-200 text-slate-800 outline-none resize-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50 transition-all leading-relaxed"
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Save buttons (single mode) ─────────────────────────────────────────────
  function renderSingleSaveButtons(items: VoNarrationItem[]) {
    const hasItems = items.length > 0
    return (
      <div className="space-y-2">
        {saveError && (
          <p className="text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
            {saveError}
          </p>
        )}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleSaveAndProceedToVoiceover}
            disabled={saving || saved || !hasItems}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${
              saved
                ? 'text-white bg-emerald-500 border-2 border-emerald-500'
                : 'text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 disabled:opacity-30'
            }`}
          >
            {saving ? (
              <><Loader2 size={15} className="animate-spin" /> Saving…</>
            ) : saved ? (
              <><CheckCircle size={15} strokeWidth={2.5} /> Saved — moving on</>
            ) : (
              <><Save size={15} /> Save & Proceed to Step 5 (Voiceover)</>
            )}
          </button>

          {!saved && (
            <button
              onClick={handleSaveAndProceedToPickStory}
              disabled={saving || !hasItems}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-violet-700 bg-violet-50 border-2 border-violet-100 hover:bg-violet-100 transition-all disabled:opacity-30"
            >
              <Video size={15} />
              Save & Skip to Step 6 (Pick Story)
              <ArrowRight size={14} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-400 font-medium">
          Step 6 (Pick Story) only needs the VEO 3 prompts — voiceover is optional.
        </p>
      </div>
    )
  }

  // ── Multi-script mode ──────────────────────────────────────────────────────
  if (isMulti) {
    return (
      <StepCard
        title="4. Voiceover Narration & VEO 3 Prompts"
        subtitle="Generate or enter voiceover narration and VEO 3 prompts for each script, then save to the database."
      >
        {renderModeToggle()}

        {mode === 'manual' && (
          <div className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setVeoOnly(v => !v)}
                className={`w-9 h-5 rounded-full transition-colors relative ${veoOnly ? 'bg-violet-500' : 'bg-slate-300'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${veoOnly ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs font-black text-slate-600 uppercase tracking-widest">VEO 3 Prompts Only</span>
            </label>
            <span className="text-[10px] text-slate-400 font-medium">(skip narration field)</span>
          </div>
        )}

        <div className="space-y-4">
          {selectedEntries.map((entry, displayIdx) => {
            const i = entry.originalIndex
            const generatedNarrations = multiVoNarrations[i] ?? []
            const manualNarrations = manualMultiItems[i] ?? []
            const narrations = mode === 'manual' ? manualNarrations : generatedNarrations
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
                  <ChevronDown size={15} className={`shrink-0 ml-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 pt-4 space-y-4">
                    {mode === 'generate' ? (
                      <>
                        <button
                          onClick={() => handleMultiGenerate(i)}
                          disabled={isLoading}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-md shadow-slate-200 disabled:opacity-30"
                        >
                          {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Mic2 size={15} />}
                          {isLoading ? 'Generating…' : generatedNarrations.length > 0 ? 'Regenerate' : 'Generate Narration & Prompts'}
                        </button>

                        {err && (
                          <p className="text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">{err}</p>
                        )}

                        {generatedNarrations.length > 0 && (
                          <div className="space-y-2">
                            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                              {generatedNarrations.length} scenes — click to edit
                            </label>
                            {generatedNarrations.map((item, ri) => {
                              const rowOpen = multiExpandedRow[i] === ri
                              return renderNarrationRow(
                                item, ri, rowOpen,
                                () => setMultiExpandedRow((prev) => ({ ...prev, [i]: rowOpen ? null : ri })),
                                (v) => updateMultiVoNarrationItem(i, ri, { narration: v }),
                                (v) => updateMultiVoNarrationItem(i, ri, { veoPrompt: v }),
                              )
                            })}
                          </div>
                        )}
                      </>
                    ) : (
                      /* Manual mode per card */
                      <div className="space-y-2">
                        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                          {manualNarrations.length} scenes — click to edit
                        </label>
                        {manualNarrations.map((item, ri) => {
                          const rowOpen = multiExpandedRow[i] === ri
                          return (
                            <div key={ri}>
                              {renderNarrationRow(
                                item, ri, rowOpen,
                                () => setMultiExpandedRow((prev) => ({ ...prev, [i]: rowOpen ? null : ri })),
                                (v) => updateManualMultiItem(i, ri, { narration: v }),
                                (v) => updateManualMultiItem(i, ri, { veoPrompt: v }),
                                (v) => updateManualMultiItem(i, ri, { sentence: v }),
                                () => removeManualMultiRow(i, ri),
                                true,
                              )}
                            </div>
                          )
                        })}
                        <button
                          onClick={() => addManualMultiRow(i)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all"
                        >
                          <Plus size={13} /> Add Scene
                        </button>
                      </div>
                    )}

                    {(mode === 'generate' ? generatedNarrations.length > 0 : manualNarrations.length > 0) && (
                      <>
                        {saveErr && (
                          <p className="text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">{saveErr}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleMultiSave(i, 5)}
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
                              <><CheckCircle size={15} strokeWidth={2.5} /> Saved</>
                            ) : (
                              <><Save size={15} /> Save to Database</>
                            )}
                          </button>
                          {!isSaved && (
                            <button
                              onClick={() => handleMultiSave(i, 6)}
                              disabled={isSaving}
                              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-violet-700 bg-violet-50 border-2 border-violet-100 hover:bg-violet-100 transition-all disabled:opacity-30"
                            >
                              <Video size={15} /> Save & Go to Step 6
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {allMultiSaved && (
          <button
            onClick={() => setActiveStep(5)}
            className="mt-4 w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-black text-emerald-700 bg-emerald-50 border-2 border-emerald-200 hover:bg-emerald-100 transition-all"
          >
            All Saved — Continue to Step 5 (Voiceover)
            <ArrowRight size={16} />
          </button>
        )}
      </StepCard>
    )
  }

  // ── Single-script mode ─────────────────────────────────────────────────────
  return (
    <StepCard
      title="4. Voiceover Narration & VEO 3 Prompts"
      subtitle="Auto-generate or manually enter voiceover narration lines and VEO 3 video prompts per scene."
    >
      {renderModeToggle()}

      {mode === 'generate' ? (
        <>
          {!hasScript && (
            <p className="text-sm text-slate-400 font-medium">
              Complete Step 3 (Script Generation) first, or switch to Manual mode.
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
                      <div key={i}>
                        {renderNarrationRow(
                          item, i, isOpen,
                          () => setExpandedRow(isOpen ? null : i),
                          (v) => updateVoNarrationItem(i, { narration: v }),
                          (v) => updateVoNarrationItem(i, { veoPrompt: v }),
                        )}
                      </div>
                    )
                  })}

                  <div className="mt-4">
                    {renderSingleSaveButtons(voNarrations)}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        /* Manual mode */
        <>
          <div className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setVeoOnly(v => !v)}
                className={`w-9 h-5 rounded-full transition-colors relative ${veoOnly ? 'bg-violet-500' : 'bg-slate-300'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${veoOnly ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs font-black text-slate-600 uppercase tracking-widest">VEO 3 Prompts Only</span>
            </label>
            <span className="text-[10px] text-slate-400 font-medium">(skip narration field)</span>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
              {manualItems.length} scenes — click to edit
            </label>
            {manualItems.map((item, i) => {
              const isOpen = expandedRow === i
              return (
                <div key={i}>
                  {renderNarrationRow(
                    item, i, isOpen,
                    () => setExpandedRow(isOpen ? null : i),
                    (v) => updateManualItem(i, { narration: v }),
                    (v) => updateManualItem(i, { veoPrompt: v }),
                    (v) => updateManualItem(i, { sentence: v }),
                    () => removeManualRow(i),
                    true,
                  )}
                </div>
              )
            })}

            <button
              onClick={addManualRow}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all"
            >
              <Plus size={13} /> Add Scene
            </button>
          </div>

          <div className="mt-5">
            {renderSingleSaveButtons(manualItems)}
          </div>
        </>
      )}
    </StepCard>
  )
}
