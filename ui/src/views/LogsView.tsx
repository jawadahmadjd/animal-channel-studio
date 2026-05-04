import { useState, useEffect, useMemo, useRef } from 'react'
import { FolderOpen, Trash2, Search, Copy, Check, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, Download } from 'lucide-react'
import { api } from '../api/client'
import { useStore } from '../store/useStore'

const BASE = 'http://127.0.0.1:7477'

interface SessionFile {
  filename: string
  size_bytes: number
  modified_at: string
  is_current: boolean
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

type Level = 'ALL' | 'INFO' | 'OK' | 'WARN' | 'ERROR'

interface ParsedLine {
  id: number
  raw: string
  timestamp: string
  level: 'INFO' | 'OK' | 'WARN' | 'ERROR'
  message: string
}

interface Session {
  id: number
  lines: ParsedLine[]
  ended: boolean
  success: boolean | null
  startTimestamp: string
  endTimestamp: string
}

let _id = 0

function parseLine(raw: string): ParsedLine {
  const tsMatch = raw.match(/^(\d{2}:\d{2}:\d{2}[.,]\d{0,3})\s+/)
  const timestamp = tsMatch ? tsMatch[1] : ''
  const rest = tsMatch ? raw.slice(tsMatch[0].length) : raw

  const low = raw.toLowerCase()
  let level: ParsedLine['level'] = 'INFO'
  if (low.includes('error') || low.includes('failed') || low.includes('exception')) level = 'ERROR'
  else if (low.includes('✓') || low.includes(' ok ') || low.includes('success') || low.includes('complete') || low.includes('downloaded')) level = 'OK'
  else if (low.includes('warn') || low.includes('retry') || low.includes('skip')) level = 'WARN'

  return { id: ++_id, raw, timestamp, level, message: rest || raw }
}

function groupBySessions(lines: ParsedLine[]): Session[] {
  const sessions: Session[] = []
  let current: ParsedLine[] = []
  let sessionIdx = 1
  let prevWasFileLine = true

  for (const line of lines) {
    // Positive IDs = from fileLines, negative = live logLines.
    // When we cross from file → live and the current session is still open,
    // close it as incomplete so the live run starts a fresh card.
    const isFileLine = line.id > 0
    if (prevWasFileLine && !isFileLine && current.length > 0) {
      const alreadyClosed = current.some(
        (l) => /\[done.*exit code/i.test(l.raw) || l.raw.includes('[Stopped by user]')
      )
      if (!alreadyClosed) {
        const startTs = current.find((l) => l.timestamp)?.timestamp ?? ''
        const endTs = [...current].reverse().find((l) => l.timestamp)?.timestamp ?? ''
        sessions.push({ id: sessionIdx++, lines: current, ended: true, success: null, startTimestamp: startTs, endTimestamp: endTs })
        current = []
      }
    }
    prevWasFileLine = isFileLine

    current.push(line)
    const isDone = /\[done.*exit code/i.test(line.raw) || line.raw.includes('[Stopped by user]')
    if (isDone) {
      const success = /\[done.*exit code 0/i.test(line.raw)
      const startTs = current.find((l) => l.timestamp)?.timestamp ?? ''
      const endTs = [...current].reverse().find((l) => l.timestamp)?.timestamp ?? ''
      sessions.push({ id: sessionIdx++, lines: current, ended: true, success, startTimestamp: startTs, endTimestamp: endTs })
      current = []
    }
  }

  if (current.length > 0) {
    const startTs = current.find((l) => l.timestamp)?.timestamp ?? ''
    const endTs = [...current].reverse().find((l) => l.timestamp)?.timestamp ?? ''
    sessions.push({ id: sessionIdx, lines: current, ended: false, success: null, startTimestamp: startTs, endTimestamp: endTs })
  }

  return sessions
}

const LEVEL_COLORS: Record<ParsedLine['level'], string> = {
  INFO:  'text-slate-600',
  OK:    'text-emerald-600',
  WARN:  'text-amber-600',
  ERROR: 'text-red-600',
}

const LEVEL_LABEL_COLORS: Record<ParsedLine['level'], { bg: string; text: string; border: string }> = {
  INFO:  { bg: 'bg-slate-50',   text: 'text-slate-500',   border: 'border-slate-100'  },
  OK:    { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
  WARN:  { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-100'  },
  ERROR: { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-100'    },
}

export default function LogsView() {
  const { logLines, runState } = useStore()
  const [fileLines, setFileLines] = useState<ParsedLine[]>([])
  const [filterLevel, setFilterLevel] = useState<Level>('ALL')
  const [search, setSearch] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([])
  const [showSessionFiles, setShowSessionFiles] = useState(false)
  const [exported, setExported] = useState(false)
  // Map<sessionId, 'collapsed' | 'expanded'> — overrides the default collapse logic
  const [overrides, setOverrides] = useState<Map<number, 'collapsed' | 'expanded'>>(new Map())

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Load log files on mount
  useEffect(() => {
    async function load() {
      const results: ParsedLine[] = []
      for (const filename of ['pipeline.log', 'flow.log']) {
        try {
          const { lines } = await api.getLogFile(filename)
          lines.forEach((l) => results.push(parseLine(l)))
        } catch {
          // file may not exist yet
        }
      }
      setFileLines(results)
    }
    load()

    // Load session file list
    fetch(`${BASE}/logs/list`)
      .then(r => r.json())
      .then((data: { files: SessionFile[] }) => setSessionFiles(data.files ?? []))
      .catch(() => {})
  }, [])

  // Scroll to bottom on mount
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      atBottom.current = true
    }
  }, [])

  // Auto-scroll on new live lines (only if already at bottom)
  const liveCount = logLines.length
  useEffect(() => {
    if (!atBottom.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [liveCount])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Merge file lines + live SSE lines
  const allLines: ParsedLine[] = useMemo(() => {
    const live = logLines.map((l) => ({
      id: l.id * -1,
      raw: l.text,
      timestamp: l.timestamp,
      level: (l.level === 'error' ? 'ERROR' : l.level === 'ok' ? 'OK' : l.level === 'warn' ? 'WARN' : 'INFO') as ParsedLine['level'],
      message: l.text,
    }))
    return [...fileLines, ...live]
  }, [fileLines, logLines])

  // Group all lines into sessions
  const sessions = useMemo(() => groupBySessions(allLines), [allLines])

  // Apply level + search filter within each session
  const filteredSessions = useMemo(() => {
    return sessions
      .map((s) => ({
        ...s,
        displayLines: s.lines.filter((line) => {
          if (filterLevel !== 'ALL' && line.level !== filterLevel) return false
          if (search.trim() && !line.raw.toLowerCase().includes(search.toLowerCase())) return false
          return true
        }),
      }))
      .filter((s) => s.displayLines.length > 0)
  }, [sessions, filterLevel, search])

  const totalDisplayed = filteredSessions.reduce((sum, s) => sum + s.displayLines.length, 0)

  function isCollapsed(session: Session): boolean {
    const ov = overrides.get(session.id)
    if (ov !== undefined) return ov === 'collapsed'
    return session.ended // default: finished sessions are collapsed
  }

  function toggleSession(session: Session) {
    const next = isCollapsed(session) ? 'expanded' : 'collapsed'
    setOverrides((prev) => new Map(prev).set(session.id, next))
  }

  function copySession(session: Session) {
    const text = session.lines.map((l) => l.raw).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(session.id)
      setTimeout(() => setCopiedId((prev) => (prev === session.id ? null : prev)), 2000)
    })
  }

  async function exportVisibleLogs() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const text = filteredSessions
      .map((session) => {
        const header = `Session ${session.id}${session.startTimestamp ? ` (${session.startTimestamp}${session.endTimestamp ? ` to ${session.endTimestamp}` : ''})` : ''}`
        const body = session.displayLines.map((l) => l.raw).join('\n')
        return `${header}\n${body}`
      })
      .join('\n\n')
    const ok = await window.electron?.saveTextFile?.(`log_${timestamp}.txt`, text)
    if (ok) {
      setExported(true)
      setTimeout(() => setExported(false), 2000)
    }
  }

  function openLogsFolder() {
    window.electronAPI?.openPath('d:/Youtube/5- Animal Channel/logs')
  }

  const levels: Level[] = ['ALL', 'INFO', 'OK', 'WARN', 'ERROR']

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div
        className="relative flex items-center justify-between px-10 py-8 bg-white border-b border-slate-200 sticky top-0 z-10"
        style={{ flexShrink: 0 }}
      >
        <div className="flex flex-col">
          <h1 className="text-3xl font-black tracking-tight text-slate-900">
            Status Logs
          </h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            System History & Debugging
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportVisibleLogs}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
            title="Save the currently visible log entries as a text file"
          >
            {exported ? <Check size={16} className="text-emerald-500" /> : <Download size={16} />}
            {exported ? 'Exported' : 'Export Log'}
          </button>
          <button
            onClick={() => setShowSessionFiles(p => !p)}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
            title="Download a session log file to share with support"
          >
            <Download size={16} />
            Session Logs
            {sessionFiles.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-700">
                {sessionFiles.length}
              </span>
            )}
          </button>
          <button
            onClick={openLogsFolder}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
          >
            <FolderOpen size={16} />
            Open Folder
          </button>
          <button
            onClick={() => setFileLines([])}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-all shadow-lg shadow-red-100"
          >
            <Trash2 size={16} />
            Clear
          </button>
        </div>

        {/* Session log files panel */}
        {showSessionFiles && (
          <div className="absolute top-full right-10 mt-2 z-20 w-96 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-widest text-slate-600">
                Session Log Files
              </span>
              <span className="text-[10px] font-bold text-slate-400">
                Click to download — share with support
              </span>
            </div>
            <div className="max-h-72 overflow-auto">
              {sessionFiles.length === 0 ? (
                <p className="px-5 py-4 text-xs text-slate-400 font-bold">No session logs found yet.</p>
              ) : sessionFiles.map(f => (
                <a
                  key={f.filename}
                  href={`${BASE}/logs/download/${encodeURIComponent(f.filename)}`}
                  download={f.filename}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                >
                  <Download size={13} className="text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{f.filename}</p>
                    <p className="text-[10px] font-medium text-slate-400">
                      {formatBytes(f.size_bytes)} · {new Date(f.modified_at).toLocaleString()}
                    </p>
                  </div>
                  {f.is_current && (
                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">
                      Current
                    </span>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filters Bar */}
      <div
        className="flex items-center gap-8 px-10 py-4 bg-white border-b border-slate-100 sticky top-[104px] z-10"
        style={{ flexShrink: 0 }}
      >
        {/* Level pills */}
        <div className="flex items-center gap-2 p-1 bg-slate-50 rounded-xl border border-slate-100">
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setFilterLevel(l)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                filterLevel === l
                  ? 'bg-white text-emerald-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 flex-1 max-w-md bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-50 transition-all">
          <Search size={16} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
          />
        </div>

        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100">
          <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
            {totalDisplayed} Entries · {filteredSessions.length} Sessions
          </span>
        </div>
      </div>

      {/* Log table — scrollable area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto custom-scrollbar p-10 flex flex-col gap-4"
      >
        {filteredSessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-3xl bg-slate-50 flex items-center justify-center text-slate-200 mb-6">
              <Search size={32} />
            </div>
            <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No matching log entries</p>
          </div>
        )}

        {filteredSessions.map((session) => {
          const collapsed = isCollapsed(session)
          const isCopied = copiedId === session.id

          return (
            <div key={session.id}>
              {/* Session header card */}
              <div
                className={`flex items-center gap-3 px-6 py-3 bg-white border shadow-sm transition-all ${
                  collapsed ? 'rounded-2xl' : 'rounded-t-2xl border-b-0'
                } border-slate-100`}
              >
                {/* Status icon */}
                {!session.ended && runState === 'running' ? (
                  <Loader2 size={15} className="text-blue-500 animate-spin flex-shrink-0" />
                ) : session.success === true ? (
                  <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                ) : session.success === false ? (
                  <XCircle size={15} className="text-red-500 flex-shrink-0" />
                ) : (
                  <XCircle size={15} className="text-slate-400 flex-shrink-0" />
                )}

                {/* Session number */}
                <span className="text-xs font-black text-slate-700 uppercase tracking-widest">
                  Session {session.id}
                </span>

                {/* Timestamp range */}
                {session.startTimestamp && (
                  <span className="text-[10px] font-bold text-slate-400">
                    {session.startTimestamp}
                    {session.endTimestamp && session.endTimestamp !== session.startTimestamp
                      ? ` → ${session.endTimestamp}`
                      : ''}
                  </span>
                )}

                {/* Status badge */}
                <span
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                    !session.ended && runState === 'running'
                      ? 'bg-blue-50 text-blue-600 border-blue-100'
                      : session.success === true
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                      : session.success === false
                      ? 'bg-red-50 text-red-600 border-red-100'
                      : 'bg-slate-50 text-slate-500 border-slate-100'
                  }`}
                >
                  {!session.ended && runState === 'running'
                    ? 'Active'
                    : session.success === true
                    ? 'Complete'
                    : session.success === false
                    ? 'Failed'
                    : 'Incomplete'}
                </span>

                {/* Line count */}
                <span className="text-[10px] font-bold text-slate-400">
                  {session.lines.length} lines
                </span>

                <div className="flex-1" />

                {/* Copy button */}
                <button
                  onClick={() => copySession(session)}
                  title="Copy all logs for this session"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all hover:bg-slate-50 text-slate-400 hover:text-slate-600"
                >
                  {isCopied ? (
                    <Check size={12} className="text-emerald-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                  {isCopied ? 'Copied!' : 'Copy'}
                </button>

                {/* Collapse toggle */}
                <button
                  onClick={() => toggleSession(session)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
                >
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {/* Session log rows */}
              {!collapsed && (
                <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <tbody className="font-mono">
                      {session.displayLines.map((line) => {
                        const lc = LEVEL_LABEL_COLORS[line.level]
                        return (
                          <tr
                            key={line.id}
                            className="hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0"
                          >
                            <td className="px-8 py-3 text-[11px] font-bold text-slate-400 w-40">
                              {line.timestamp || '—'}
                            </td>
                            <td className="px-4 py-3 w-32">
                              <span
                                className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${lc.bg} ${lc.text} ${lc.border}`}
                              >
                                {line.level}
                              </span>
                            </td>
                            <td className={`px-4 py-3 text-[11px] font-bold leading-relaxed ${LEVEL_COLORS[line.level]}`}>
                              <span className="whitespace-pre-wrap break-all">{line.message}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
