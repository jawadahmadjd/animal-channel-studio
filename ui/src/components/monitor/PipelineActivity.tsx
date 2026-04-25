import { useStore, type PipelineStage, type StageAction } from '../../store/useStore'

function formatMs(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`
}

function useElapsed(stage: PipelineStage): number | null {
  if (!stage.startedAt) return null
  const end = stage.completedAt ?? new Date()
  return end.getTime() - stage.startedAt.getTime()
}

function ActionRow({ action }: { action: StageAction }) {
  const icon =
    action.status === 'done' ? '✓' :
    action.status === 'error' ? '✗' : '›'

  const textColor =
    action.status === 'error' ? 'text-red-500' :
    action.status === 'done' ? 'text-slate-500' :
    'text-slate-700'

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className={`text-[10px] mt-[3px] font-black w-3 flex-shrink-0 ${
        action.status === 'error' ? 'text-red-400' :
        action.status === 'done' ? 'text-emerald-500' :
        'text-slate-400'
      }`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold leading-tight ${textColor}`}>
          {action.label}
        </p>
        {action.detail && (
          <p className="text-[10px] text-slate-400 mt-0.5">{action.detail}</p>
        )}
      </div>
    </div>
  )
}

function StageRow({ stage, onToggle }: { stage: PipelineStage; onToggle: () => void }) {
  const elapsed = useElapsed(stage)
  const isPending = stage.status === 'pending'
  const isRunning = stage.status === 'running'
  const isDone = stage.status === 'done'
  const isError = stage.status === 'error'
  const hasActions = stage.actions.length > 0

  return (
    <div>
      {/* Stage header */}
      <button
        onClick={isPending ? undefined : onToggle}
        disabled={isPending || !hasActions}
        className="w-full flex items-center gap-3 text-left group disabled:cursor-default"
      >
        {/* Status indicator */}
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {isRunning && (
            <div className="w-3.5 h-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          )}
          {isDone && (
            <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="text-[8px] font-black text-emerald-600">✓</span>
            </div>
          )}
          {isError && (
            <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center">
              <span className="text-[8px] font-black text-red-500">✗</span>
            </div>
          )}
          {isPending && (
            <div className="w-3 h-3 rounded-full bg-slate-100" />
          )}
        </div>

        {/* Label */}
        <span className={`flex-1 text-xs font-bold tracking-tight ${
          isPending ? 'text-slate-300' :
          isError ? 'text-red-600' :
          isDone ? 'text-slate-500' :
          'text-slate-800'
        }`}>
          {stage.label}
        </span>

        {/* Timing */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {elapsed !== null && (
            <span className={`text-[10px] font-bold ${
              isError ? 'text-red-400' : isDone ? 'text-slate-400' : 'text-emerald-500'
            }`}>
              {formatMs(elapsed)}
            </span>
          )}
          {stage.avgMs !== undefined && isPending && (
            <span className="text-[10px] text-slate-300 font-medium">
              ~{formatMs(stage.avgMs)}
            </span>
          )}
          {stage.avgMs !== undefined && !isPending && elapsed !== null && (
            <span className="text-[10px] text-slate-300 font-medium">
              avg {formatMs(stage.avgMs)}
            </span>
          )}
        </div>

        {/* Collapse arrow */}
        {!isPending && hasActions && (
          <span className="text-slate-300 text-[10px] flex-shrink-0 ml-1">
            {stage.collapsed ? '▸' : '▾'}
          </span>
        )}
      </button>

      {/* Actions list */}
      {!stage.collapsed && hasActions && (
        <div className="mt-2 ml-8 pl-3 border-l-2 border-slate-100 space-y-1">
          {stage.actions.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function PipelineActivity() {
  const { pipelineStages, toggleStageCollapse, runState } = useStore()

  const hasStarted = pipelineStages.some((s) => s.status !== 'pending')
  const allDone = pipelineStages.every((s) => s.status === 'done')
  const hasError = pipelineStages.some((s) => s.status === 'error')

  return (
    <div className="rounded-3xl px-8 py-7 bg-white border border-slate-100 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          Pipeline Activity
        </p>
        {allDone && (
          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
            Complete ✓
          </span>
        )}
        {hasError && runState !== 'running' && (
          <span className="text-[10px] font-black uppercase tracking-widest text-red-400">
            Failed ✗
          </span>
        )}
      </div>

      {/* Empty state */}
      {!hasStarted && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
            <span className="text-2xl">⏳</span>
          </div>
          <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">
            No activity yet
          </p>
        </div>
      )}

      {/* Stage list */}
      {hasStarted && (
        <div className="space-y-4">
          {pipelineStages.map((stage) => (
            <StageRow
              key={stage.id}
              stage={stage}
              onToggle={() => toggleStageCollapse(stage.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
