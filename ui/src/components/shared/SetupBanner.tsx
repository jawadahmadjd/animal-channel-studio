import { useStore } from '../../store/useStore'

const STAGE_LABELS: Record<string, string> = {
  python:  'Downloading Python',
  pip:     'Installing Python packages',
  bridge:  'Starting background service',
  browser: 'Downloading browser engine',
  done:    'Setup complete',
  error:   'Setup error',
}

export default function SetupBanner() {
  const { setupStage, setupDetail } = useStore()

  if (setupStage === 'idle' || setupStage === 'done') return null

  const isError = setupStage === 'error'

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 text-xs border-b ${
        isError
          ? 'bg-red-950/60 border-red-800/40 text-red-300'
          : 'bg-sky-950/60 border-sky-800/30 text-sky-300'
      }`}
    >
      {/* spinner or error dot */}
      {isError ? (
        <span className="w-3 h-3 rounded-full bg-red-400 shrink-0" />
      ) : (
        <span className="w-3 h-3 rounded-full border-2 border-sky-600 border-t-sky-300 animate-spin shrink-0" />
      )}

      <span className="font-semibold shrink-0">
        {STAGE_LABELS[setupStage] ?? setupStage}
      </span>

      {setupDetail && (
        <>
          <span className="text-sky-700 shrink-0">—</span>
          <span className="truncate text-slate-400">{setupDetail}</span>
        </>
      )}

      {!isError && (
        <span className="ml-auto shrink-0 text-slate-500 italic">
          First-time setup · happens once
        </span>
      )}
    </div>
  )
}
