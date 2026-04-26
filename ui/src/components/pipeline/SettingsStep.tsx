import { useEffect, useState } from 'react'
import { Save, Zap, Film, Check, CheckCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api } from '../../api/client'
import StepCard from './StepCard'

const VIDEO_ASPECTS = ['9:16', '16:9']
const IMAGE_ASPECTS = ['16:9', '4:3', '1:1', '3:4', '9:16']
const CLIP_COUNTS   = ['x1', 'x2', 'x3', 'x4']
const DURATIONS     = ['4s', '6s', '8s']
const VIDEO_MODELS  = [
  'Veo 3.1 - Fast',
  'Veo 3.1 - Quality',
  'Veo 3.1 - Lite',
  'Veo 3.1 - Lite [Lower Priority]',
  'Veo 3.1 - Fast [Lower Priority]',
]

export default function SettingsStep() {
  const { settings, setSettings, appendLog } = useStore()
  const isVideo = settings.mode === 'Video'
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => {
      const mode = (s.mode === 'Image' || s.mode === 'Video') ? s.mode : 'Video'
      setSettings({
        mode,
        sub_type: (s.sub_type === 'Ingredients') ? 'Ingredients' : 'Frames',
        aspect_ratio: s.aspect_ratio || '9:16',
        clip_count: CLIP_COUNTS.includes(s.clip_count) ? s.clip_count : 'x4',
        duration: DURATIONS.includes(s.duration) ? s.duration : '8s',
        model: s.model || 'Veo 3.1 - Fast',
      })
    }).catch(() => {})
  }, [setSettings])

  // When switching modes, snap aspect ratio and model to valid values
  function handleModeChange(mode: 'Image' | 'Video') {
    const aspects = mode === 'Video' ? VIDEO_ASPECTS : IMAGE_ASPECTS
    const aspect_ratio = aspects.includes(settings.aspect_ratio) ? settings.aspect_ratio : aspects[0]
    setSettings({ mode, aspect_ratio })
  }

  async function handleSave() {
    const payload = {
      mode: settings.mode,
      sub_type: settings.sub_type,
      aspect_ratio: settings.aspect_ratio,
      clip_count: settings.clip_count,
      duration: settings.duration,
      model: settings.model,
    }
    await api.saveSettings(payload)
    appendLog({ text: `\n[Settings saved] ${JSON.stringify(payload)}\n`, level: 'ok', timestamp: ts() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <StepCard title="7. Configure Clip Generation" subtitle="Technical parameters for AI synthesis.">

      {/* MODE: Image / Video */}
      <label className="block text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>
        Mode
      </label>
      <SegmentedTabs
        options={['Image', 'Video']}
        value={settings.mode}
        onChange={(v) => handleModeChange(v as 'Image' | 'Video')}
      />

      {/* SUB TYPE — Video only */}
      {isVideo && (
        <>
          <label className="block text-xs font-bold uppercase tracking-widest mt-7 mb-2" style={{ color: 'var(--muted)' }}>
            Sub Type
          </label>
          <SegmentedTabs
            options={['Frames', 'Ingredients']}
            value={settings.sub_type}
            onChange={(v) => setSettings({ sub_type: v as 'Frames' | 'Ingredients' })}
          />
        </>
      )}

      {/* ASPECT RATIO + MODEL ENGINE */}
      <div className="grid grid-cols-2 gap-4 mt-7 mb-6">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
            Aspect Ratio
          </label>
          <select
            value={settings.aspect_ratio}
            onChange={(e) => setSettings({ aspect_ratio: e.target.value })}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
          >
            {(isVideo ? VIDEO_ASPECTS : IMAGE_ASPECTS).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
            Model Engine
          </label>
          <select
            value={settings.model}
            onChange={(e) => setSettings({ model: e.target.value })}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
          >
            {VIDEO_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* QUICK SELECT — Fast / Quality shortcut (Video only) */}
      {isVideo && (
        <>
          <label className="block text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>
            Quick Select
          </label>
          <div className="flex gap-3 mb-6">
            <ModelCard
              icon={<Zap size={20} />}
              name="Fast"
              desc="Veo 3.1 - Fast"
              selected={settings.model === 'Veo 3.1 - Fast'}
              onClick={() => setSettings({ model: 'Veo 3.1 - Fast' })}
            />
            <ModelCard
              icon={<Film size={20} />}
              name="Quality"
              desc="Veo 3.1 - Quality"
              selected={settings.model === 'Veo 3.1 - Quality'}
              onClick={() => setSettings({ model: 'Veo 3.1 - Quality' })}
            />
          </div>

          {/* CLIPS PER SCENE — discrete tabs */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                Clips per Scene
              </label>
              <SegmentedTabs
                options={CLIP_COUNTS}
                value={settings.clip_count}
                onChange={(v) => setSettings({ clip_count: v })}
              />
            </div>

            {/* DURATION — discrete tabs */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                Duration
              </label>
              <SegmentedTabs
                options={DURATIONS}
                value={settings.duration}
                onChange={(v) => setSettings({ duration: v })}
              />
            </div>
          </div>
        </>
      )}

      {/* SAVE */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold text-emerald-600 bg-emerald-50 border-2 border-emerald-100 hover:bg-emerald-100 transition-all"
        >
          <Save size={18} />
          Save Parameters
        </button>
        {saved && (
          <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-600 whitespace-nowrap">
            <CheckCircle size={15} />
            Saved!
          </div>
        )}
      </div>
    </StepCard>
  )
}

function SegmentedTabs({
  options, value, onChange,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div
      className="flex rounded-xl overflow-hidden p-1 bg-slate-50 border border-slate-100"
    >
      {options.map((opt) => {
        const active = opt === value
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`flex-1 py-2 text-xs font-black transition-all rounded-lg ${
              active ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function ModelCard({
  icon, name, desc, selected, onClick,
}: {
  icon: React.ReactNode
  name: string
  desc: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center py-5 px-4 rounded-2xl transition-all duration-300 border-2 relative ${
        selected 
          ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-lg shadow-emerald-100 scale-[1.02]' 
          : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-200'
      }`}
    >
      {selected && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-sm">
          <Check size={12} strokeWidth={4} />
        </div>
      )}
      <div className={`mb-3 p-3 rounded-xl transition-colors ${selected ? 'bg-white text-emerald-500 shadow-sm' : 'bg-slate-100 text-slate-400'}`}>
        {icon}
      </div>
      <span className="text-sm font-black uppercase tracking-widest">{name}</span>
      <span className="text-[10px] mt-1 font-bold opacity-60 text-center">{desc}</span>
    </button>
  )
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}
