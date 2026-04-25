import { useEffect, useState } from 'react'
import { Volume2, Loader2, Play, Pause, RefreshCw } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

export default function GenerateVoiceoverStep() {
  const {
    voNarrations,
    elevenlabsVoices, setElevenLabsVoices,
    selectedVoiceId, setSelectedVoiceId,
    generatedAudioFilename, setGeneratedAudioFilename,
  } = useStore()

  const [loadingVoices, setLoadingVoices] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)

  const hasNarrations = voNarrations.length > 0

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
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load voices')
      })
      .finally(() => setLoadingVoices(false))
  }, [])

  function playPreview(url: string) {
    if (!url) return
    previewAudio?.pause()
    const a = new Audio(url)
    setPreviewAudio(a)
    a.play().catch(() => {})
  }

  async function handleGenerate() {
    if (!selectedVoiceId || !hasNarrations) return
    const fullNarration = voNarrations.map((item) => item.narration).join(' ')
    setGenerating(true)
    setError('')
    audio?.pause()
    setAudio(null)
    setPlaying(false)
    try {
      const res = await api.generateVoiceover(fullNarration, selectedVoiceId)
      setGeneratedAudioFilename(res.filename)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate voiceover')
    } finally {
      setGenerating(false)
    }
  }

  function togglePlay() {
    if (!generatedAudioFilename) return
    if (audio) {
      if (playing) {
        audio.pause()
        setPlaying(false)
      } else {
        audio.play().catch(() => {})
        setPlaying(true)
      }
      return
    }
    const a = new Audio(api.audioUrl(generatedAudioFilename))
    a.onended = () => setPlaying(false)
    a.onerror = () => { setPlaying(false); setError('Failed to play audio') }
    setAudio(a)
    a.play().catch(() => {})
    setPlaying(true)
  }

  const selectedVoice = elevenlabsVoices.find((v) => v.voice_id === selectedVoiceId)

  return (
    <StepCard
      title="5. Generate Voiceover"
      subtitle="Pick an ElevenLabs voice and generate a full narration audio from your script."
    >
      {!hasNarrations && (
        <p className="text-sm text-slate-400 font-medium">
          Complete Step 4 (Narration & Prompts) first.
        </p>
      )}

      {hasNarrations && (
        <>
          {/* Voice selector */}
          <label className="block text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
            Select Voice
          </label>

          {loadingVoices && (
            <div className="flex items-center gap-2 text-sm text-slate-400 font-medium py-2">
              <Loader2 size={14} className="animate-spin" />
              Loading voices…
            </div>
          )}

          {!loadingVoices && elevenlabsVoices.length === 0 && !error && (
            <p className="text-sm text-slate-400 font-medium">
              No voices loaded. Check your ELEVENLABS_API_KEY in .env.
            </p>
          )}

          {elevenlabsVoices.length > 0 && (
            <div className="space-y-2 mb-6">
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
                    {/* Radio dot */}
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                        isSelected ? 'border-emerald-500' : 'border-slate-300'
                      }`}
                    >
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      )}
                    </div>

                    {/* Name + labels */}
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

                    {/* Preview button */}
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

          {/* Narration summary */}
          <div className="mb-5 px-4 py-3 rounded-xl bg-slate-50 border border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Narration preview ({voNarrations.length} scenes)
            </p>
            <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
              {voNarrations.map((n) => n.narration).join(' ')}
            </p>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedVoiceId}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl text-sm font-black uppercase tracking-[0.15em] text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-30"
          >
            {generating ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Volume2 size={18} />
            )}
            {generating ? 'Generating Voiceover…' : 'Generate Voiceover'}
          </button>

          {error && (
            <p className="mt-3 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
              {error}
            </p>
          )}

          {/* Audio player */}
          {generatedAudioFilename && !generating && (
            <div className="mt-5 flex items-center gap-4 px-5 py-4 rounded-2xl bg-emerald-50 border-2 border-emerald-100">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 transition-all shadow-sm shadow-emerald-200"
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-emerald-700 uppercase tracking-widest">
                  Voiceover Ready
                </p>
                <p className="text-[11px] text-emerald-600 mt-0.5 font-medium truncate">
                  {selectedVoice?.name} · {generatedAudioFilename}
                </p>
              </div>
              <button
                onClick={handleGenerate}
                className="p-2 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 transition-all"
                title="Regenerate"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </StepCard>
  )
}
