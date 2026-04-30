import { useEffect, useState } from 'react'
import { LayoutList, ScrollText, Settings, PlusCircle, ShieldCheck, ShieldAlert, AlertCircle, LogIn, KeyRound, CheckCircle2, XCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'

interface Props {
  onNewVideo?: () => void
}

export default function Sidebar({ onNewVideo }: Props) {
  const { activeView, setActiveView, isAuthorized, setIsAuthorized, runState, apiKeysConfigured } = useStore()
  const [appVersion, setAppVersion] = useState<string>('')
  const [expiresSoon, setExpiresSoon] = useState(false)

  useEffect(() => {
    window.electron?.getVersion?.().then(setAppVersion).catch(() => {})
  }, [])

  useEffect(() => {
    const poll = async () => {
      try {
        const result = await api.getAuthStatus()
        setIsAuthorized(result.authorized)
        setExpiresSoon(result.expires_soon ?? false)
      } catch {
        // bridge not ready yet
      }
    }
    // Poll less frequently when no pipeline running
    const interval = runState === 'running' ? 4000 : 15000
    poll()
    const id = setInterval(poll, interval)
    return () => clearInterval(id)
  }, [setIsAuthorized, runState])

  function handleRelogin() {
    api.runLogin().catch(() => {})
    setActiveView('pipeline')
  }

  return (
    <aside
      className="flex flex-col h-full select-none border-r border-slate-200"
      style={{
        width: 260,
        flexShrink: 0,
        background: '#ffffff',
      }}
    >
      {/* Brand */}
      <div className="px-7 py-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-2xl shadow-lg shadow-emerald-200">
            🦁
          </div>
          <div className="flex flex-col">
            <span className="font-black text-lg tracking-tight leading-none text-slate-900">
              ANIMAL
            </span>
            <span className="font-bold text-xs tracking-[0.2em] text-emerald-600 uppercase">
              Channel
            </span>
          </div>
        </div>
      </div>

      {/* Creator Studio badge */}
      <div className="mx-5 mb-8 rounded-2xl px-4 py-4 bg-slate-50 border border-slate-100">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Creator Studio
          </p>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-600">LIVE</span>
          </div>
        </div>
        <p className="text-sm font-bold text-slate-700">
          {appVersion ? `v${appVersion}` : 'v—'}
        </p>
      </div>

      {/* Nav items */}
      <nav className="px-4 space-y-1">
        <NavItem
          icon={<LayoutList size={18} />}
          label="Pipeline"
          active={activeView === 'pipeline'}
          onClick={() => setActiveView('pipeline')}
        />
        <NavItem
          icon={<ScrollText size={18} />}
          label="Status Logs"
          active={activeView === 'logs'}
          onClick={() => setActiveView('logs')}
        />
        <NavItem
          icon={<Settings size={18} />}
          label="Settings"
          active={activeView === 'settings'}
          onClick={() => setActiveView('settings')}
        />
      </nav>

      <div className="mt-6 mx-7 h-px bg-slate-100" />

      {/* Auth Status */}
      <div className="px-7 mt-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
          System Status
        </p>
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all ${
            !isAuthorized
              ? 'bg-red-50 text-red-700 border border-red-100'
              : expiresSoon
              ? 'bg-amber-50 text-amber-700 border border-amber-100'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
          }`}
          title={expiresSoon ? 'Session expires soon — re-login to avoid interruptions' : undefined}
        >
          {!isAuthorized
            ? <ShieldAlert size={16} />
            : expiresSoon
            ? <AlertCircle size={16} />
            : <ShieldCheck size={16} />}
          {!isAuthorized ? 'UNAUTHORIZED' : expiresSoon ? 'EXPIRES SOON' : 'AUTHORIZED'}
        </div>

        {/* Re-login button — shown when expired or expiring soon */}
        {(!isAuthorized || expiresSoon) && (
          <button
            onClick={handleRelogin}
            className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-all"
          >
            <LogIn size={13} />
            Re-login to Google
          </button>
        )}

        {/* API Keys status */}
        <div className="mt-4 flex flex-col gap-1.5">
          <ApiKeyRow
            label="DeepSeek"
            configured={apiKeysConfigured.deepseek}
            onFix={() => setActiveView('settings')}
          />
          <ApiKeyRow
            label="ElevenLabs"
            configured={apiKeysConfigured.elevenlabs}
            onFix={() => setActiveView('settings')}
          />
        </div>
      </div>

      <div className="flex-1" />

      {/* New Video CTA */}
      <div className="px-5 mb-8">
        <button
          onClick={onNewVideo}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          <PlusCircle size={18} />
          New Video
        </button>
      </div>
    </aside>
  )
}

function ApiKeyRow({ label, configured, onFix }: { label: string; configured: boolean; onFix: () => void }) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-bold border ${
        configured
          ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
          : 'bg-red-50 border-red-100 text-red-600'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <KeyRound size={11} strokeWidth={2.5} />
        {label}
      </div>
      {configured
        ? <CheckCircle2 size={12} strokeWidth={2.5} />
        : (
          <button
            onClick={onFix}
            className="text-[10px] font-black uppercase tracking-widest underline underline-offset-2 hover:text-red-800 transition-colors"
          >
            Set up
          </button>
        )
      }
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all text-left ${
        active 
          ? 'bg-emerald-500 text-white shadow-md shadow-emerald-100' 
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <span className={active ? 'text-white' : 'text-slate-400'}>{icon}</span>
      {label}
    </button>
  )
}
