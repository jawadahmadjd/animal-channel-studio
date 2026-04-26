import { useRef, useState, useEffect } from 'react'
import { Play } from 'lucide-react'
import { useStore } from '../../store/useStore'

const BASE = 'http://127.0.0.1:7477'

interface Clip {
  path: string
  scene: number
}

export default function VideoPreview() {
  const { currentScene, totalScenes, selectedStoryTitle, runState } = useStore()
  const isRunning = runState === 'running'
  const videoRef = useRef<HTMLVideoElement>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [activeClipPath, setActiveClipPath] = useState<string>('')

  const progress = totalScenes > 0 ? (currentScene / totalScenes) * 100 : 0

  // Subscribe to /output/watch SSE while pipeline is running
  useEffect(() => {
    if (!isRunning) return
    const es = new EventSource(`${BASE}/output/watch`)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'clip_ready') {
          const clip: Clip = { path: data.path, scene: data.scene }
          setClips((prev) => {
            // Avoid duplicates
            if (prev.some((c) => c.path === clip.path)) return prev
            return [...prev, clip].sort((a, b) => a.scene - b.scene)
          })
          // Auto-load the latest clip
          setActiveClipPath(data.path)
        }
      } catch {
        // not a JSON event
      }
    }
    return () => es.close()
  }, [isRunning])

  // Update video element src when activeClipPath changes
  useEffect(() => {
    if (!activeClipPath || !videoRef.current) return
    const src = `${BASE}/output/file?path=${encodeURIComponent(activeClipPath)}`
    videoRef.current.src = src
    videoRef.current.load()
    videoRef.current.play().catch(() => {})
  }, [activeClipPath])

  // Clear clips when starting a new run
  useEffect(() => {
    if (runState === 'running' && currentScene === 0) {
      setClips([])
      setActiveClipPath('')
    }
  }, [runState, currentScene])

  const hasVideo = Boolean(activeClipPath)

  return (
    <div className="rounded-3xl overflow-hidden bg-white border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500">
      {/* Video element */}
      <div className="relative bg-slate-900 group" style={{ aspectRatio: '9/16', maxHeight: 280 }}>
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          controls
          playsInline
          muted
        />

        {/* Placeholder overlay when no src */}
        {!hasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-2xl">
              <Play size={32} className="text-white fill-white" />
            </div>
            <p className="text-[10px] mt-4 font-black uppercase tracking-[0.2em] text-white/40">Monitor Standby</p>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="px-8 py-7">
        <div className="flex items-center justify-between mb-4">
          {isRunning ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                Live Buffer
              </span>
            </div>
          ) : (
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Monitor
            </span>
          )}
          {totalScenes > 0 && (
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Scene {currentScene} / {totalScenes}
            </span>
          )}
        </div>

        {selectedStoryTitle && (
          <p className="text-lg font-black text-slate-900 mb-4 truncate">
            {selectedStoryTitle}
          </p>
        )}

        {/* Progress bar */}
        <div className="h-2 rounded-full overflow-hidden bg-slate-50 border border-slate-100">
          <div
            className="h-full rounded-full transition-all duration-1000 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Thumbnail strip */}
      {clips.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 px-2">
            Downloaded Clips ({clips.length})
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {clips.map((clip) => (
              <button
                key={clip.path}
                onClick={() => setActiveClipPath(clip.path)}
                className={`shrink-0 relative rounded-xl overflow-hidden border-2 transition-all ${
                  activeClipPath === clip.path
                    ? 'border-emerald-400 shadow-md shadow-emerald-100'
                    : 'border-slate-100 hover:border-slate-300'
                }`}
                style={{ width: 60, height: 80 }}
                title={`Scene ${clip.scene}`}
              >
                <video
                  src={`${BASE}/output/file?path=${encodeURIComponent(clip.path)}`}
                  className="w-full h-full object-cover"
                  muted
                  preload="metadata"
                />
                <span className="absolute bottom-1 left-1 text-[9px] font-black text-white bg-black/60 px-1 rounded">
                  {clip.scene}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
