import { useRef } from 'react'
import { Play } from 'lucide-react'
import { useStore } from '../../store/useStore'


export default function VideoPreview() {
  const { currentScene, totalScenes, ideas, selectedIdeaIndex, runState } = useStore()
  const isRunning = runState === 'running'
  const videoRef = useRef<HTMLVideoElement>(null)

  const idea = ideas[selectedIdeaIndex]
  const progress = totalScenes > 0 ? (currentScene / totalScenes) * 100 : 0

  return (
    <div
      className="rounded-3xl overflow-hidden bg-white border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500"
    >
      {/* Video element */}
      <div className="relative bg-slate-900 group" style={{ aspectRatio: '9/16', maxHeight: 280 }}>
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          controls
          playsInline
        >
          Your browser does not support the video element.
        </video>

        {/* Placeholder overlay when no src */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none transition-opacity duration-500"
          style={{ opacity: videoRef.current?.src ? 0 : 1 }}
        >
          <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-2xl">
            <Play size={32} className="text-white fill-white" />
          </div>
          <p className="text-[10px] mt-4 font-black uppercase tracking-[0.2em] text-white/40">Monitor Standby</p>
        </div>
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

        {idea && (
          <p className="text-lg font-black text-slate-900 mb-4 truncate">
            {idea.title}
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
    </div>
  )
}
