import { useRef, useState, useEffect, useCallback } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { Eraser, ArrowDownToLine, AlertTriangle, ChevronDown, Copy, Check } from 'lucide-react'
import { useStore, LogLine } from '../../store/useStore'

const LEVEL_COLORS: Record<LogLine['level'], string> = {
  error:  '#f87171',
  ok:     '#4ade80',
  warn:   '#fbbf24',
  header: '#cbd5e1',
  info:   '#e2e8f0',
}

interface StructuredError {
  type: 'error'
  message: string
  detail: string
}

function tryParseError(text: string): StructuredError | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed)
    if (obj.type === 'error' && obj.message) return obj as StructuredError
  } catch {
    // not JSON
  }
  return null
}

function ErrorRow({ line }: { line: LogLine }) {
  const err = tryParseError(line.text)
  if (!err) return null
  const errorDetail = err.detail

  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(errorDetail).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mx-3 my-1 rounded-xl overflow-hidden border border-red-900/40 bg-red-950/30">
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
        <p className="flex-1 text-xs font-bold text-red-300 leading-snug">{err.message}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            title="Copy error detail"
            className="p-1.5 rounded-lg text-red-500 hover:text-red-300 hover:bg-red-900/40 transition-all"
          >
            {copied ? <Check size={11} strokeWidth={3} /> : <Copy size={11} />}
          </button>
          <button
            onClick={() => setExpanded((e) => !e)}
            title="Show/hide details"
            className="p-1.5 rounded-lg text-red-500 hover:text-red-300 hover:bg-red-900/40 transition-all"
          >
            <ChevronDown size={11} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="px-4 pb-4 text-[10px] font-mono text-red-400/70 whitespace-pre-wrap break-all leading-relaxed border-t border-red-900/40 pt-3">
          {errorDetail}
        </pre>
      )}
    </div>
  )
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

      // Structured error → special rendering
      if (line.level === 'error' && tryParseError(line.text)) {
        return <ErrorRow key={line.id} line={line} />
      }

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
