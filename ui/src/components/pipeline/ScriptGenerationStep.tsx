import { useState, useRef } from 'react'
import { FileText, ArrowRight, Loader2, AlertTriangle, CheckCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

const MIN_WORDS = 30
const MAX_WORDS = 1200

interface ScriptResult {
  idea: string
  script: string
  wordCount: number
  targetWordCount: number
  lengthOk: boolean
}

export default function ScriptGenerationStep() {
  const {
    scriptInput, setScriptInput,
    approvedIdeas,
    generatedScript, setGeneratedScript,
    ideaNiche,
    setActiveStep,
    setMultiScripts,
    multiScripts,
    multiVoNarrations,
    selectedMultiScriptIndices,
    toggleMultiScriptSelected,
  } = useStore()

  const [wordCountRaw, setWordCountRaw] = useState('300')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [scriptMeta, setScriptMeta] = useState<{ actual: number; target: number; ok: boolean } | null>(null)
  const [multiResults, setMultiResults] = useState<ScriptResult[]>(() =>
    multiScripts.map(s => ({
      idea: s.ideaTitle,
      script: s.script,
      wordCount: s.wordCount ?? 0,
      targetWordCount: s.targetWordCount ?? 0,
      lengthOk: s.lengthOk ?? true,
    }))
  )
  // Track which script index is being confirmed (shows tick before navigating)
  const [promotingIndex, setPromotingIndex] = useState<number | 'single' | null>(null)
  const promoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isMulti = approvedIdeas.length > 1

  const wordCount = parseInt(wordCountRaw, 10)
  const wordCountOutOfRange = isNaN(wordCount) || wordCount < MIN_WORDS || wordCount > MAX_WORDS

  function handleWordCountChange(raw: string) {
    setWordCountRaw(raw)
  }

  async function handleGenerate() {
    setLoading(true)
    setError('')
    setScriptMeta(null)
    setMultiResults([])

    if (isMulti) {
      // Generate one script per approved idea
      const results: ScriptResult[] = []
      setProgress({ current: 0, total: approvedIdeas.length })
      try {
        for (let i = 0; i < approvedIdeas.length; i++) {
          const idea = approvedIdeas[i]
          setProgress({ current: i + 1, total: approvedIdeas.length })
          const ideaStr = `${idea.title}: ${idea.description}`
          const res = await api.generateScript(ideaNiche || 'general', ideaStr, wordCount)
          results.push({
            idea: idea.title,
            script: res.script,
            wordCount: res.word_count,
            targetWordCount: res.target_word_count,
            lengthOk: res.length_ok,
          })
        }
        setMultiResults(results)
        setMultiScripts(results.map((r, i) => ({
          ideaTitle: approvedIdeas[i]?.title ?? r.idea,
          ideaDescription: approvedIdeas[i]?.description ?? '',
          script: r.script,
          wordCount: r.wordCount,
          targetWordCount: r.targetWordCount,
          lengthOk: r.lengthOk,
        })))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to generate scripts')
      } finally {
        setLoading(false)
        setProgress(null)
      }
    } else {
      // Single idea — existing behaviour
      const input = scriptInput.trim()
      if (!input) { setLoading(false); return }
      try {
        const res = await api.generateScript(ideaNiche || 'general', input, wordCount)
        setGeneratedScript(res.script)
        setScriptMeta({ actual: res.word_count, target: res.target_word_count, ok: res.length_ok })
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to generate script')
      } finally {
        setLoading(false)
      }
    }
  }

  function handleUseScript() {
    if (!generatedScript.trim()) return
    if (promoteTimerRef.current) clearTimeout(promoteTimerRef.current)
    setPromotingIndex('single')
    promoteTimerRef.current = setTimeout(() => {
      setPromotingIndex(null)
      setActiveStep(4)
    }, 700)
  }

  function updateMultiScript(index: number, value: string) {
    setMultiResults((prev) => {
      const next = prev.map((r, i) => i === index ? { ...r, script: value } : r)
      setMultiScripts(next.map((r, i) => ({
        ideaTitle: approvedIdeas[i]?.title ?? r.idea,
        ideaDescription: approvedIdeas[i]?.description ?? '',
        script: r.script,
        wordCount: r.wordCount,
        targetWordCount: r.targetWordCount,
        lengthOk: r.lengthOk,
      })))
      return next
    })
  }

  const low = wordCountOutOfRange ? 0 : Math.round(wordCount * 0.75)
  const high = wordCountOutOfRange ? 0 : Math.round(wordCount * 1.25)
  const canGenerate = !wordCountOutOfRange && (isMulti ? approvedIdeas.length > 0 : !!scriptInput.trim())

  return (
    <StepCard
      title="3. Script Generation"
      subtitle="Turn your selected idea(s) into narration-ready scripts."
    >
      {/* Multi-idea notice */}
      {isMulti && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-violet-50 border border-violet-100">
          <p className="text-xs font-bold text-violet-700">
            {approvedIdeas.length} ideas selected — a separate script will be generated for each one.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {approvedIdeas.map((idea, i) => (
              <li key={i} className="text-[11px] text-violet-600 font-medium">· {idea.title}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Manual idea input — shown only in single-idea mode */}
      {!isMulti && (
        <>
          <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
            Idea to Script (from step 2 or write your own)
          </label>
          <textarea
            value={scriptInput}
            onChange={(e) => setScriptInput(e.target.value)}
            placeholder="Paste or type the idea you want to script…"
            rows={4}
            className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-900 outline-none resize-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all placeholder:text-slate-300"
          />
        </>
      )}

      {/* Word count */}
      <div className="mt-4 flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs font-bold uppercase tracking-widest mb-2 text-slate-400">
            Script Length (words)
          </label>
          <input
            type="number"
            value={wordCountRaw}
            onChange={(e) => handleWordCountChange(e.target.value)}
            className={`w-full px-4 py-3 rounded-xl text-sm font-bold outline-none transition-all ${
              wordCountOutOfRange
                ? 'bg-red-50 border border-red-300 text-red-600 focus:border-red-400 focus:ring-4 focus:ring-red-50'
                : 'bg-slate-50 border border-slate-100 text-slate-900 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50'
            }`}
          />
        </div>
        <div className="pb-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Accepted range
          </p>
          <p className="text-xs font-black text-slate-600">
            {low} – {high} words
          </p>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-slate-400 font-medium">
        Min {MIN_WORDS} · Max {MAX_WORDS} · Up to 25% deviation is acceptable
      </p>
      {wordCountOutOfRange && (
        <p className="mt-1 text-xs font-bold text-red-500">
          Script length is out of range — must be between {MIN_WORDS} and {MAX_WORDS}.
        </p>
      )}

      <button
        onClick={handleGenerate}
        disabled={loading || !canGenerate}
        className="mt-4 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-30"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
        {loading
          ? progress
            ? `Writing Script ${progress.current} of ${progress.total}…`
            : 'Writing Script…'
          : isMulti
            ? `Generate ${approvedIdeas.length} Scripts`
            : 'Generate Script'}
      </button>

      {error && (
        <p className="mt-3 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
          {error}
        </p>
      )}

      {/* Multi-idea results */}
      {isMulti && multiResults.length > 0 && (
        <div className="mt-6 space-y-6">
          {multiResults.map((result, i) => {
            const isSelected = selectedMultiScriptIndices.has(i)
            return (
              <div key={i} className={`rounded-2xl border bg-white overflow-hidden shadow-sm transition-all ${isSelected ? 'border-emerald-300 ring-2 ring-emerald-50' : 'border-slate-100'}`}>
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <p className="text-xs font-black text-slate-700 uppercase tracking-widest truncate">
                    {result.idea}
                  </p>
                  <span className={`ml-3 shrink-0 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    result.lengthOk
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {result.lengthOk
                      ? <CheckCircle size={11} strokeWidth={2.5} />
                      : <AlertTriangle size={11} strokeWidth={2.5} />}
                    {result.wordCount}w
                  </span>
                </div>
                <div className="p-4">
                  <textarea
                    value={result.script}
                    onChange={(e) => updateMultiScript(i, e.target.value)}
                    rows={8}
                    className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-slate-50 border border-slate-100 text-slate-800 outline-none resize-y focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 transition-all leading-relaxed"
                  />
                  {(multiVoNarrations[i]?.length ?? 0) > 0 && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                      <CheckCircle size={13} strokeWidth={2.5} />
                      {multiVoNarrations[i].length} narrations in Step 4
                    </div>
                  )}
                  <button
                    onClick={() => toggleMultiScriptSelected(i)}
                    className={`mt-3 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all border-2 ${
                      isSelected
                        ? 'text-white bg-emerald-500 border-emerald-500'
                        : 'text-emerald-700 bg-emerald-50 border-emerald-100 hover:bg-emerald-100'
                    }`}
                  >
                    {isSelected ? (
                      <><CheckCircle size={15} strokeWidth={2.5} /> Selected for Step 4</>
                    ) : (
                      <>Use This Script<ArrowRight size={15} /></>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Single-idea result */}
      {!isMulti && generatedScript && (
        <div className="mt-6">
          {scriptMeta && (
            <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-xs font-bold border ${
              scriptMeta.ok
                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}>
              {scriptMeta.ok
                ? <CheckCircle size={13} strokeWidth={2.5} />
                : <AlertTriangle size={13} strokeWidth={2.5} />}
              {scriptMeta.ok
                ? `${scriptMeta.actual} words — within target range (${low}–${high})`
                : `${scriptMeta.actual} words — outside target range (${low}–${high}). Try a different length.`}
            </div>
          )}

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
            disabled={promotingIndex !== null}
            className={`mt-3 flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all disabled:opacity-70 ${
              promotingIndex === 'single'
                ? 'text-white bg-emerald-500 border-2 border-emerald-500'
                : 'text-emerald-700 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100'
            }`}
          >
            {promotingIndex === 'single' ? (
              <>
                <CheckCircle size={16} strokeWidth={2.5} />
                Sent to Step 4
              </>
            ) : (
              <>
                Use This Script
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      )}
    </StepCard>
  )
}
