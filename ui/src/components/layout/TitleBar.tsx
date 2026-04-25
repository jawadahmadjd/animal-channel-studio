import { Minus, Square, X } from 'lucide-react'

export default function TitleBar() {
  const minimize = () => window.electronAPI?.minimize()
  const maximize = () => window.electronAPI?.maximize()
  const close = () => window.electronAPI?.close()

  return (
    <div
      className="drag-region flex items-center justify-between h-10 px-8 select-none bg-slate-900 border-b border-slate-800"
      style={{ flexShrink: 0 }}
    >
      <div className="flex items-center gap-3 no-drag">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-[10px] text-slate-400 font-black tracking-[0.3em] uppercase">
          Animal Channel — Creator Studio
        </span>
      </div>
      <div className="no-drag flex items-center gap-2">
        <button
          onClick={minimize}
          className="w-10 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-all"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={maximize}
          className="w-10 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-all"
        >
          <Square size={12} />
        </button>
        <button
          onClick={close}
          className="w-10 h-7 flex items-center justify-center rounded-lg hover:bg-red-500 text-slate-500 hover:text-white transition-all"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
