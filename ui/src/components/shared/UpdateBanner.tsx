import { Download, X } from 'lucide-react'
import { useStore } from '../../store/useStore'

export default function UpdateBanner() {
  const { updateAvailable, updateVersion, dismissUpdate } = useStore()

  if (!updateAvailable) return null

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-emerald-600 text-white text-sm font-medium z-50 shrink-0">
      <div className="flex items-center gap-2">
        <Download size={15} />
        <span>Version {updateVersion} is ready to install</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.electron?.installUpdate?.()}
          className="px-3 py-1 rounded bg-white text-emerald-700 text-xs font-bold hover:bg-emerald-50 transition-colors"
        >
          Restart &amp; Install
        </button>
        <button
          onClick={dismissUpdate}
          className="p-1 rounded hover:bg-emerald-700 transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
