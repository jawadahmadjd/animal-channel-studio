import { useRef, useState, useEffect } from 'react'
import { Copy, ExternalLink, Play } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, type FlowLiveBuffer } from '../../api/client'

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
  const [flowBuffer, setFlowBuffer] = useState<FlowLiveBuffer>({ status: 'idle' })
  const [copied, setCopied] = useState(false)

  const progress = totalScenes > 0 ? (currentScene / totalScenes) * 100 : 0
  const flowMediaUrl = flowBuffer.media_url || ''
  const flowThumbnailUrl = flowBuffer.thumbnail_url || ''
  const flowUrl = flowBuffer.flow_url || ''
  const flowProgress = typeof flowBuffer.progress_pct === 'number' ? flowBuffer.progress_pct : null
  const previewVideoSrc = flowMediaUrl || (activeClipPath ? api.videoFileUrl(activeClipPath) : '')
  const hasPreview = Boolean(previewVideoSrc || flowThumbnailUrl)

  // Load the current browser-detected Flow preview snapshot.
  useEffect(() => {
    let cancelled = false
    const loadFlowBuffer = async () => {
      try {
        const latest = await api.getFlowLiveBuffer()
        if (!cancelled) setFlowBuffer(latest)
      } catch {
        // Bridge may still be starting.
      }
    }
    loadFlowBuffer()
    return () => {
      cancelled = true
    }
  }, [runState])

  useEffect(() => {
    if (!isRunning) return
    const es = new EventSource(`${BASE}/flow/live-buffer/watch`)
    es.onmessage = (e) => {
      try {
        setFlowBuffer(JSON.parse(e.data))
      } catch {
        // Ignore malformed transient events.
      }
    }
    return () => es.close()
  }, [isRunning])

  // Keep downloaded output updates for the thumbnail strip after downloads begin.
  useEffect(() => {
    if (!isRunning) return
    const es = new EventSource(`${BASE}/output/watch`)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'clip_ready') {
          const clip: Clip = { path: data.path, scene: data.scene }
          setClips((prev) => {
            if (prev.some((c) => c.path === clip.path)) return prev
            return [...prev, clip].sort((a, b) => a.scene - b.scene)
          })
        }
      } catch {
        // Ignore non-JSON events.
      }
    }
    return () => es.close()
  }, [isRunning])

  useEffect(() => {
    if (!previewVideoSrc || !videoRef.current) return
    videoRef.current.src = previewVideoSrc
    videoRef.current.load()
    videoRef.current.play().catch(() => {})
  }, [previewVideoSrc])

  useEffect(() => {
    if (runState === 'running' && currentScene === 0) {
      setClips([])
      setActiveClipPath('')
      setFlowBuffer({ status: 'idle' })
    }
  }, [runState, currentScene])

  const copyFlowLink = async () => {
    if (!flowUrl) return
    await navigator.clipboard.writeText(flowUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="rounded-3xl overflow-hidden bg-white border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500">
      <div className="relative bg-slate-900 group" style={{ aspectRatio: '9/16', maxHeight: 280 }}>
        {previewVideoSrc ? (
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            playsInline
            muted
          />
        ) : flowThumbnailUrl ? (
          <img
            src={flowThumbnailUrl}
            className="w-full h-full object-contain"
            alt="Flow generated clip preview"
          />
        ) : (
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            playsInline
            muted
          />
        )}

        {!hasPreview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-2xl">
              <Play size={32} className="text-white fill-white" />
            </div>
            <p className="text-[10px] mt-4 font-black uppercase tracking-[0.2em] text-white/40">Monitor Standby</p>
          </div>
        )}
      </div>

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

        {(flowBuffer.status === 'running' || flowBuffer.status === 'ready' || flowBuffer.status === 'failed') && (
          <div className={`mb-4 rounded-2xl border px-4 py-3 ${
            flowBuffer.status === 'failed'
              ? 'border-rose-100 bg-rose-50/70'
              : 'border-emerald-100 bg-emerald-50/70'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-[10px] font-black uppercase tracking-widest ${
                  flowBuffer.status === 'failed' ? 'text-rose-700' : 'text-emerald-700'
                }`}>
                  Flow {flowBuffer.status === 'ready' ? 'Ready' : flowBuffer.status === 'failed' ? 'Failed' : 'Generating'}
                  {flowProgress !== null ? ` ${flowProgress}%` : ''}
                </p>
                {flowBuffer.scene_no && (
                  <p className={`mt-1 truncate text-xs font-bold ${
                    flowBuffer.status === 'failed' ? 'text-rose-900' : 'text-emerald-900'
                  }`}>
                    Scene {flowBuffer.scene_no}{flowBuffer.clip_count ? ` - ${flowBuffer.clip_count} clip(s)` : ''}
                  </p>
                )}
              </div>
              {flowUrl && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={copyFlowLink}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-200 bg-white text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                    title={copied ? 'Copied' : 'Copy Flow link'}
                  >
                    <Copy size={15} />
                  </button>
                  <a
                    href={flowUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-200 bg-white text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                    title="Open Flow clip"
                  >
                    <ExternalLink size={15} />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="h-2 rounded-full overflow-hidden bg-slate-50 border border-slate-100">
          <div
            className="h-full rounded-full transition-all duration-1000 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

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
                  src={api.videoFileUrl(clip.path)}
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
