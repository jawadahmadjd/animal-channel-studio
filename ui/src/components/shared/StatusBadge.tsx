interface Props {
  status: 'idle' | 'running' | 'stopped' | 'complete' | 'error'
}

const CONFIG = {
  idle:     { label: 'System Standby',           bg: 'bg-slate-50', text: 'text-slate-500', dot: 'bg-slate-400', border: 'border-slate-100' },
  running:  { label: 'Running Pipeline',         bg: 'bg-amber-50', text: 'text-amber-600', dot: 'bg-amber-500 animate-pulse', border: 'border-amber-100' },
  stopped:  { label: 'Stopped',                  bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500', border: 'border-red-100' },
  complete: { label: 'Completed Successfully',   bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500', border: 'border-emerald-100' },
  error:    { label: 'System Error',             bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500', border: 'border-red-100' },
}

export default function StatusBadge({ status }: Props) {
  const cfg = CONFIG[status]
  return (
    <div
      className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${cfg.bg} ${cfg.text} ${cfg.border} shadow-sm`}
    >
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </div>
  )
}
