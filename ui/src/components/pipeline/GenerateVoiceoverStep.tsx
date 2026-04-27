import { useEffect, useRef, useState } from 'react'
import { Volume2, Loader2, Play, Pause, RefreshCw, ArrowRight, Check, ChevronDown, Square, X, RotateCcw, FolderOpen } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, logUIEvent } from '../../api/client'
import StepCard from './StepCard'

const ELEVENLABS_COST_PER_1K_CHARS = 0.30

export default function GenerateVoiceoverStep() {
  const {
    voNarrations,
    multiVoNarrations,
    multiScripts,
    elevenlabsVoices, setElevenLabsVoices,
    selectedVoiceId, setSelectedVoiceId,
    generatedAudioFilename, setGeneratedAudioFilename,
    sceneAudioFilenames, updateSceneAudioFilename, setSceneAudioFilenames,
    setActiveStep,
    appendLog,
  } = useStore()

  const [loadingVoices, setLoadingVoices] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [confirmCostly, setConfirmCostly] = useState(true)
  const stopRef = useRef(false)

  useEffect(() => {
    api.getAppSettings().then((data) => {
      if (typeof data.confirm_costly_operations === 'boolean') {
        setConfirmCostly(data.confirm_costly_operations as boolean)
      }
    }).catch(() => {})
  }, [])

  const [generatingScene, setGeneratingScene] = useState<Record<number, boolean>>({})
  const [error, setError] = useState('')
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [audioObjects, setAudioObjects] = useState<Record<number, HTMLAudioElement>>({})
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set([0]))
  const [voiceSelectorOpen, setVoiceSelectorOpen] = useState(false)
  // Per-scene manual filename inputs
  const [manualFilenameInput, setManualFilenameInput] = useState<Record<number, string>>({})

  const isMulti = multiVoNarrations.length > 1
  const effectiveNarrations = voNarrations.length > 0
    ? voNarrations
    : multiVoNarrations.flat()
  const hasNarrations = effectiveNarrations.length > 0
  const allGenerated = hasNarrations && sceneAudioFilenames.length === effectiveNarrations.length
    && sceneAudioFilenames.every(Boolean)
  const anyGenerated = sceneAudioFilenames.some(Boolean)

  function flatOffset(scriptIdx: number): number {
    let offset = 0
    for (let i = 0; i < scriptIdx; i++) {
      offset += (multiVoNarrations[i] ?? []).length
    }
    return offset
  }

  useEffect(() => {
    if (elevenlabsVoices.length > 0) return
    setLoadingVoices(true)
    api.getElevenLabsVoices()
      .then((res) => {
        setElevenLabsVoices(res.voices)
        if (res.voices.length > 0 && !selectedVoiceId) {
          setSelectedVoiceId(res.voices[0].voice_id)
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load voices'))
      .finally(() => setLoadingVoices(false))
  }, [])

  function playPreview(url: string) {
    if (!url) return
    previewAudio?.pause()
    const a = new Audio(url)
    setPreviewAudio(a)
    a.play().catch(() => {})
  }

  async function generateScene(index: number) {
    if (!selectedVoiceId) return
    const text = effectiveNarrations[index].narration
    if (!text.trim()) {
      setError(`Scene ${index + 1} has no narration text — enter narration in Step 4 or use a pre-generated file.`)
      return
    }
    setGeneratingScene((prev) => ({ ...prev, [index]: true }))
    try {
      const res = await api.generateVoiceover(text, selectedVoiceId)
      updateSceneAudioFilename(index, res.filename)
      setGeneratedAudioFilename(res.filename)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : `Failed to generate voiceover for scene ${index + 1}`
      setError(msg)
      appendLog({ text: `[Scene ${index + 1}] ERROR: ${msg}`, level: 'error', timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }) })
    } finally {
      setGeneratingScene((prev) => ({ ...prev, [index]: false }))
    }
  }

  async function handleGenerateAll() {
    if (!selectedVoiceId || !hasNarrations) return
    logUIEvent('click:voiceover:generateAll', { voiceId: selectedVoiceId, sceneCount: effectiveNarrations.length })

    if (confirmCostly) {
      const totalChars = effectiveNarrations.reduce((sum, item) => sum + item.narration.length, 0)
      const estimatedCost = (totalChars / 1000) * ELEVENLABS_COST_PER_1K_CHARS
      const ok = confirm(
        `ElevenLabs Cost Estimate\n\n` +
        `Scenes: ${effectiveNarrations.length}\n` +
        `Total characters: ${totalChars.toLocaleString()}\n` +
        `Estimated cost: ~$${estimatedCost.toFixed(2)} (at $${ELEVENLABS_COST_PER_1K_CHARS}/1k chars)\n\n` +
        `Continue generating all ${effectiveNarrations.length} scenes?\n\n` +
        `(Disable this prompt in Settings → Confirm Costly Operations)`
      )
      if (!ok) return
    }

    stopRef.current = false
    setGeneratingAll(true)
    setError('')
    Object.values(audioObjects).forEach((a) => a.pause())
    setAudioObjects({})
    setPlayingIndex(null)
    try {
      for (let i = 0; i < effectiveNarrations.length; i++) {
        if (stopRef.current) break
        await generateScene(i)
      }
    } finally {
      setGeneratingAll(false)
      stopRef.current = false
    }
  }

  function handleStop() {
    logUIEvent('click:voiceover:stop')
    stopRef.current = true
  }

  function resetScene(index: number) {
    if (playingIndex === index) {
      audioObjects[index]?.pause()
      setPlayingIndex(null)
    }
    setAudioObjects((prev) => { const next = { ...prev }; delete next[index]; return next })
    updateSceneAudioFilename(index, '')
  }

  function resetAllScenes() {
    Object.values(audioObjects).forEach((a) => a.pause())
    setAudioObjects({})
    setPlayingIndex(null)
    setSceneAudioFilenames([])
  }

  function togglePlay(index: number, filename: string) {
    if (playingIndex !== null && playingIndex !== index) {
      audioObjects[playingIndex]?.pause()
    }
    const existing = audioObjects[index]
    if (existing) {
      if (playingIndex === index) {
        existing.pause()
        setPlayingIndex(null)
      } else {
        existing.play().catch(() => {})
        setPlayingIndex(index)
      }
      return
    }
    const a = new Audio(api.audioUrl(filename))
    a.onended = () => setPlayingIndex(null)
    a.onerror = () => { setPlayingIndex(null); setError('Failed to play audio') }
    setAudioObjects((prev) => ({ ...prev, [index]: a }))
    a.play().catch(() => {})
    setPlayingIndex(index)
  }

  function applyManualFilename(index: number) {
    const name = (manualFilenameInput[index] ?? '').trim()
    if (!name) return
    updateSceneAudioFilename(index, name)
    setManualFilenameInput((prev) => { const next = { ...prev }; delete next[index]; return next })
  }

  function renderSceneRow(flatIndex: number, displayIndex?: number) {
    const item = effectiveNarrations[flatIndex]
    const filename = sceneAudioFilenames[flatIndex]
    const isGenerating = generatingScene[flatIndex]
    const isPlaying = playingIndex === flatIndex
    const isDone = Boolean(filename)
    const label = (displayIndex ?? flatIndex) + 1
    const hasNarrationText = Boolean(item?.narration?.trim())
    const manualInput = manualFilenameInput[flatIndex] ?? ''
    const showManualInput = !isDone && !isGenerating

    return (
      <div key={flatIndex} className="space-y-1">
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
            isDone ? 'border-emerald-100 bg-emerald-50' : 'border-slate-100 bg-slate-50'
          }`}
        >
          <span className="w-7 h-7 shrink-0 rounded-lg bg-slate-200 text-slate-600 text-[11px] font-black flex items-center justify-center">
            {label}
          </span>
          <p className="flex-1 text-xs text-slate-600 font-medium line-clamp-1">
            {item.narration || <span className="italic text-slate-400">No narration text</span>}
          </p>
          {isGenerating ? (
            <Loader2 size={16} className="shrink-0 text-slate-400 animate-spin" />
          ) : isDone ? (
            <>
              <button
                onClick={() => togglePlay(flatIndex, filename)}
                className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 transition-all shrink-0"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={() => generateScene(flatIndex)}
                disabled={generatingAll || !hasNarrationText}
                className="p-1.5 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 transition-all shrink-0 disabled:opacity-30"
                title="Regenerate this scene"
              >
                <RefreshCw size={13} />
              </button>
              <button
                onClick={() => resetScene(flatIndex)}
                disabled={generatingAll}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all shrink-0 disabled:opacity-30"
                title="Clear this audio"
              >
                <X size={13} />
              </button>
              <Check size={14} className="text-emerald-500 shrink-0" strokeWidth={3} />
            </>
          ) : (
            <button
              onClick={() => generateScene(flatIndex)}
              disabled={generatingAll || !selectedVoiceId || !hasNarrationText}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-200 text-slate-600 hover:bg-slate-300 transition-all disabled:opacity-30 shrink-0"
              title={!hasNarrationText ? 'No narration text — use manual filename below' : ''}
            >
              Generate
            </button>
          )}
        </div>

        {/* Pre-generated filename input */}
        {showManualInput && (
          <div className="flex items-center gap-2 px-2">
            <FolderOpen size={12} className="shrink-0 text-slate-300" />
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualFilenameInput((prev) => ({ ...prev, [flatIndex]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && applyManualFilename(flatIndex)}
              placeholder="Or enter pre-generated filename (e.g. scene_001.mp3)"
              className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-slate-50 border border-slate-100 text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-50 transition-all placeholder:text-slate-300"
            />
            {manualInput.trim() && (
              <button
                onClick={() => applyManualFilename(flatIndex)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-violet-100 text-violet-700 hover:bg-violet-200 transition-all shrink-0"
              >
                Use
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const selectedVoice = elevenlabsVoices.find((v) => v.voice_id === selectedVoiceId)
  const busy = generatingAll || Object.values(generatingScene).some(Boolean)

  return (
    <StepCard
      title="5. Generate Voiceover"
      subtitle="Pick an ElevenLabs voice and generate per-scene narration audio, or import pre-generated files."
    >
      {!hasNarrations && (
        <p className="text-sm text-slate-400 font-medium">
          Complete Step 4 (Narration &amp; Prompts) first, or go back and add scenes.
        </p>
      )}

      {hasNarrations && (
        <>
          {/* Voice selector card */}
          <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm mb-4">
            <button
              onClick={() => setVoiceSelectorOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-black text-slate-800">Select Voice</span>
                {selectedVoice && !voiceSelectorOpen && (
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                    {selectedVoice.name}
                  </span>
                )}
                {loadingVoices && (
                  <Loader2 size={13} className="animate-spin text-slate-400" />
                )}
              </div>
              <ChevronDown
                size={15}
                className={`shrink-0 ml-3 text-slate-400 transition-transform ${voiceSelectorOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {voiceSelectorOpen && (
              <div className="px-4 pb-4 pt-3">
                {!loadingVoices && elevenlabsVoices.length === 0 && !error && (
                  <p className="text-sm text-slate-400 font-medium">
                    No voices loaded. Check your ElevenLabs API key in Settings.
                  </p>
                )}
                {elevenlabsVoices.length > 0 && (
                  <div className="space-y-2">
                    {elevenlabsVoices.map((voice) => {
                      const isSelected = voice.voice_id === selectedVoiceId
                      return (
                        <div
                          key={voice.voice_id}
                          onClick={() => setSelectedVoiceId(voice.voice_id)}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer border-2 transition-all ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-50'
                              : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                              isSelected ? 'border-emerald-500' : 'border-slate-300'
                            }`}
                          >
                            {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-black ${isSelected ? 'text-emerald-700' : 'text-slate-700'}`}>
                              {voice.name}
                            </p>
                            {Object.keys(voice.labels).length > 0 && (
                              <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                                {Object.values(voice.labels).join(' · ')}
                              </p>
                            )}
                          </div>
                          {voice.preview_url && (
                            <button
                              onClick={(e) => { e.stopPropagation(); playPreview(voice.preview_url) }}
                              className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                              title="Preview voice"
                            >
                              <Play size={14} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Generate All + Stop buttons */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={handleGenerateAll}
              disabled={busy || !selectedVoiceId}
              className="flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl text-sm font-black uppercase tracking-[0.15em] text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-30"
            >
              {generatingAll ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Volume2 size={18} />
              )}
              {generatingAll ? 'Generating All Scenes…' : `Generate All ${effectiveNarrations.length} Scenes`}
            </button>

            {generatingAll && (
              <button
                onClick={handleStop}
                className="flex items-center justify-center gap-2 px-5 py-4 rounded-2xl text-sm font-black uppercase tracking-[0.15em] text-white bg-red-500 hover:bg-red-600 transition-all shadow-lg shadow-red-200"
              >
                <Square size={16} fill="currentColor" />
                Stop
              </button>
            )}
            {!generatingAll && anyGenerated && (
              <button
                onClick={resetAllScenes}
                disabled={busy}
                className="flex items-center justify-center gap-2 px-5 py-4 rounded-2xl text-sm font-black uppercase tracking-[0.15em] text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all disabled:opacity-30"
                title="Clear all generated audio"
              >
                <RotateCcw size={16} />
                Reset All
              </button>
            )}
          </div>

          {error && (
            <p className="mt-3 mb-4 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
              {error}
            </p>
          )}

          {/* Scenes — multi-script cards or flat list */}
          {isMulti ? (
            <div className="space-y-3">
              {multiVoNarrations.map((scenes, scriptIdx) => {
                if (!scenes || scenes.length === 0) return null
                const offset = flatOffset(scriptIdx)
                const title = multiScripts[scriptIdx]?.ideaTitle ?? `Script ${scriptIdx + 1}`
                const isOpen = expandedCards.has(scriptIdx)
                const doneCount = scenes.filter((_, si) => Boolean(sceneAudioFilenames[offset + si])).length

                return (
                  <div key={scriptIdx} className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
                    <button
                      onClick={() => setExpandedCards((prev) => {
                        const next = new Set(prev)
                        isOpen ? next.delete(scriptIdx) : next.add(scriptIdx)
                        return next
                      })}
                      className="w-full flex items-center justify-between px-5 py-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-200 text-slate-600 text-[11px] font-black flex items-center justify-center">
                          {scriptIdx + 1}
                        </span>
                        <span className="text-sm font-black text-slate-800 truncate">{title}</span>
                        {doneCount > 0 && (
                          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            doneCount === scenes.length
                              ? 'text-emerald-600 bg-emerald-50 border border-emerald-100'
                              : 'text-slate-500 bg-slate-100'
                          }`}>
                            {doneCount}/{scenes.length} done
                          </span>
                        )}
                      </div>
                      <ChevronDown
                        size={15}
                        className={`shrink-0 ml-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 pt-3 space-y-2">
                        <button
                          onClick={async () => {
                            for (let sceneIdx = 0; sceneIdx < scenes.length; sceneIdx++) {
                              if (stopRef.current) break
                              if (!sceneAudioFilenames[offset + sceneIdx]) {
                                await generateScene(offset + sceneIdx)
                              }
                            }
                          }}
                          disabled={busy || !selectedVoiceId}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-slate-800 hover:bg-slate-700 transition-all disabled:opacity-30 mb-1"
                        >
                          <Volume2 size={13} />
                          Generate All Scenes for this Story
                        </button>
                        {scenes.map((_, sceneIdx) => renderSceneRow(offset + sceneIdx, sceneIdx))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {effectiveNarrations.map((_, i) => renderSceneRow(i))}
            </div>
          )}

          {/* Continue buttons */}
          <div className="mt-6 space-y-2">
            {allGenerated && (
              <button
                onClick={() => setActiveStep(6)}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl text-sm font-black text-emerald-700 bg-emerald-50 border-2 border-emerald-200 hover:bg-emerald-100 transition-all"
              >
                All Done — Continue to Pick Story
                <ArrowRight size={16} />
              </button>
            )}
            <button
              onClick={() => setActiveStep(6)}
              className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-black transition-all ${
                allGenerated
                  ? 'text-slate-400 bg-slate-50 border-2 border-slate-100 hover:bg-slate-100'
                  : 'text-violet-700 bg-violet-50 border-2 border-violet-100 hover:bg-violet-100'
              }`}
            >
              {allGenerated ? 'Or skip to' : 'Skip to'} Step 6 (Pick Story) without voiceover
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
    </StepCard>
  )
}
