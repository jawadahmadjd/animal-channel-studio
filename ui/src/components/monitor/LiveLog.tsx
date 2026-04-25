import { useRef, useState, useEffect, useCallback } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { Eraser, ArrowDownToLine } from 'lucide-react'
import { useStore, LogLine } from '../../store/useStore'

const LEVEL_COLORS: Record<LogLine['level'], string> = {
  error:  '#f87171',
  ok:     '#4ade80',
  warn:   '#fbbf24',
  header: '#cbd5e1',
  info:   '#e2e8f0',
}

export default function LiveLog() {
  const { logLines, clearLogs } = useStore()
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [locked, setLocked] = useState(true)

  useEffect(() => {
    if (locked && logLines.length > 0) {
      virtuosoRef.current?.scrollToIndex({ index: logLines.length - 1, behavior: 'smooth' })
    }
  }, [logLines, locked])

  const renderLine = useCallback(
    (index: number) => {
      const line = logLines[index]
      if (!line) return null
      return (
        <div
          className="px-3 py-0.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
          style={{ color: LEVEL_COLORS[line.level] }}
        >
          {line.text}
        </div>
      )
    },
    [logLines]
  )

  return (
    <div
      className="flex flex-col rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl"
      style={{ flex: 1, minHeight: 0 }}
    >
      {/* Bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-800/50 border-b border-slate-800 backdrop-blur-md sticky top-0 z-10" style={{ flexShrink: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black tracking-[0.2em] text-slate-400 uppercase">
            Live Output Console
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocked((l) => !l)}
            title={locked ? 'Auto-scroll on' : 'Auto-scroll off'}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              locked ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/20' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowDownToLine size={12} strokeWidth={3} />
            {locked ? 'Locked' : 'Unlocked'}
          </button>
          <button
            onClick={clearLogs}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all"
          >
            <Eraser size={12} strokeWidth={3} />
            Clear
          </button>
        </div>
      </div>

      {/* Virtualized log list */}
      <div style={{ flex: 1, minHeight: 0 }} className="p-4">
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: '100%' }}
          totalCount={logLines.length}
          itemContent={renderLine}
          followOutput={locked ? 'smooth' : false}
          initialTopMostItemIndex={logLines.length > 0 ? logLines.length - 1 : 0}
        />
      </div>
    </div>
  )
}
