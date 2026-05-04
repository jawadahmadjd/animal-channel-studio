import { useState, useEffect, type CSSProperties } from 'react'
import { Settings, Eye, EyeOff, CheckCircle, XCircle, Folder, Loader2, KeyRound, Sun, Moon, Monitor, RotateCcw } from 'lucide-react'
import { api } from '../api/client'
import { useStore } from '../store/useStore'

interface AppSettings {
  deepseek_api_key: string
  elevenlabs_api_key: string
  output_dir: string
  flow_headless: boolean
  wait_between_scenes: number
  max_retries_per_scene: number
  pipeline_timeout_sec: number
  confirm_costly_operations: boolean
  theme: 'light' | 'dark' | 'system'
  flow_intervals: Record<string, number>
}

type ValidateState = 'idle' | 'configured' | 'testing' | 'ok' | 'error'

interface FlowIntervalField {
  key: string
  label: string
  description: string
  default_ms: number
  min_ms: number
  max_ms: number
}

const MIN_VISIBLE_INTERVAL_MS = 1000

function intervalLabelFromKey(key: string) {
  return key
    .replace(/_ms$/i, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function applyTheme(theme: AppSettings['theme']) {
  const effective = theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : theme === 'system'
    ? 'light'
    : theme
  document.documentElement.dataset.theme = effective
  document.documentElement.dataset.themePreference = theme
}

function formatIntervalSeconds(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const sec = ms / 1000
  const rounded = sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)
  return `${rounded}s`
}

export default function SettingsView() {
  const { setApiKeysConfigured } = useStore()
  const waitBetweenScenesMin = 0
  const waitBetweenScenesMax = 30
  const [form, setForm] = useState<AppSettings>({
    deepseek_api_key: '',
    elevenlabs_api_key: '',
    output_dir: '',
    flow_headless: false,
    wait_between_scenes: 5,
    max_retries_per_scene: 3,
    pipeline_timeout_sec: 300,
    confirm_costly_operations: true,
    theme: 'system',
    flow_intervals: {},
  })
  const [flowIntervalFields, setFlowIntervalFields] = useState<FlowIntervalField[]>([])
  const [showDeepSeek, setShowDeepSeek] = useState(false)
  const [showElevenLabs, setShowElevenLabs] = useState(false)
  const [dsValidate, setDsValidate] = useState<ValidateState>('idle')
  const [elValidate, setElValidate] = useState<ValidateState>('idle')
  const [dsError, setDsError] = useState('')
  const [elError, setElError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<'saved' | 'error' | null>(null)

  useEffect(() => {
    api.getAppSettings().then((data) => {
      const flowIntervalsRaw =
        data.flow_intervals && typeof data.flow_intervals === 'object'
          ? (data.flow_intervals as Record<string, unknown>)
          : {}
      const parsedFlowIntervals = Object.fromEntries(
        Object.entries(flowIntervalsRaw).map(([key, value]) => [key, Number(value) || 0])
      ) as Record<string, number>
      const apiFields = Array.isArray(data.flow_interval_fields)
        ? (data.flow_interval_fields as FlowIntervalField[])
        : []
      const fallbackFields: FlowIntervalField[] = Object.keys(parsedFlowIntervals)
        .sort()
        .map((key) => ({
          key,
          label: intervalLabelFromKey(key),
          description: 'Flow automation timing interval.',
          default_ms: parsedFlowIntervals[key],
          min_ms: 0,
          max_ms: 600000,
        }))
      setFlowIntervalFields(apiFields.length > 0 ? apiFields : fallbackFields)
      setForm((f) => ({
        ...f,
        deepseek_api_key: String(data.deepseek_api_key ?? f.deepseek_api_key),
        elevenlabs_api_key: String(data.elevenlabs_api_key ?? f.elevenlabs_api_key),
        output_dir: String(data.output_dir ?? f.output_dir),
        flow_headless: Boolean(data.flow_headless ?? f.flow_headless),
        wait_between_scenes: Number(data.wait_between_scenes ?? f.wait_between_scenes),
        max_retries_per_scene: Number(data.max_retries_per_scene ?? f.max_retries_per_scene),
        pipeline_timeout_sec: Number(data.pipeline_timeout_sec ?? f.pipeline_timeout_sec),
        confirm_costly_operations: Boolean(data.confirm_costly_operations ?? f.confirm_costly_operations),
        theme: (data.theme as AppSettings['theme']) ?? f.theme,
        flow_intervals: parsedFlowIntervals,
      }))
      if (data.deepseek_api_key === '***') setDsValidate('configured')
      if (data.elevenlabs_api_key === '***') setElValidate('configured')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'theme') {
      applyTheme(value as AppSettings['theme'])
    }
  }

  function patchFlowInterval(field: FlowIntervalField, value: number) {
    const min = Math.max(MIN_VISIBLE_INTERVAL_MS, field.min_ms || 0)
    const max = field.max_ms || 600000
    const clamped = Math.max(min, Math.min(max, value || field.default_ms || MIN_VISIBLE_INTERVAL_MS))
    setForm((f) => ({
      ...f,
      flow_intervals: {
        ...f.flow_intervals,
        [field.key]: clamped,
      },
    }))
  }

  const waitBetweenScenesProgress =
    ((form.wait_between_scenes - waitBetweenScenesMin) / (waitBetweenScenesMax - waitBetweenScenesMin)) * 100
  const waitBetweenScenesStyle = {
    ['--range-progress' as string]: `${waitBetweenScenesProgress}%`,
  } as CSSProperties

  const visibleFlowIntervalFields = flowIntervalFields
    .filter((field) => {
      const baseline = Number.isFinite(field.default_ms) ? field.default_ms : 0
      return baseline >= MIN_VISIBLE_INTERVAL_MS
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  async function handleBrowse() {
    const win = window as unknown as { electron?: { openFolder: () => Promise<string | null> } }
    const folder = await win.electron?.openFolder()
    if (folder) patch('output_dir', folder)
  }

  async function handleTestDeepSeek() {
    setDsValidate('testing')
    setDsError('')
    // If user typed a new key, save it first so the bridge can test it
    if (form.deepseek_api_key && form.deepseek_api_key !== '***') {
      await api.saveAppSettings({ deepseek_api_key: form.deepseek_api_key })
    }
    const result = await api.validateDeepSeek()
    setDsValidate(result.ok ? 'ok' : 'error')
    if (!result.ok) setDsError(result.error ?? 'Connection failed')
  }

  async function handleTestElevenLabs() {
    setElValidate('testing')
    setElError('')
    if (form.elevenlabs_api_key && form.elevenlabs_api_key !== '***') {
      await api.saveAppSettings({ elevenlabs_api_key: form.elevenlabs_api_key })
    }
    const result = await api.validateElevenLabs()
    setElValidate(result.ok ? 'ok' : 'error')
    if (!result.ok) setElError(result.error ?? 'Connection failed')
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== '***')
      ) as Record<string, unknown>
      await api.saveAppSettings(payload)
      applyTheme(form.theme)
      // Refresh global key status so Sidebar updates immediately
      const health = await api.getHealth()
      setApiKeysConfigured(health.keys)
      setToast('saved')
      setTimeout(() => setToast(null), 2500)
    } catch {
      setToast('error')
      setTimeout(() => setToast(null), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-2xl mx-auto px-10 py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <Settings size={20} className="text-slate-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Settings</h1>
            <p className="text-xs text-slate-400 font-medium mt-0.5">API keys and runtime defaults</p>
          </div>
        </div>

        {/* API Keys */}
        <Section title="API Keys">
          <Field
            label="DeepSeek API Key"
            description="Used to generate ideas, scripts, and scene prompts."
            hint="Provider: platform.deepseek.com"
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showDeepSeek ? 'text' : 'password'}
                  value={form.deepseek_api_key}
                  onChange={(e) => { patch('deepseek_api_key', e.target.value); setDsValidate('idle') }}
                  placeholder="sk-..."
                  className="w-full px-3 py-2.5 pr-10 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <button
                  onClick={() => setShowDeepSeek((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showDeepSeek ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <TestButton state={dsValidate} onClick={handleTestDeepSeek} />
            </div>
            {dsValidate === 'configured' && <ValidMsg state="configured" text="Key saved — click Test Connection to verify" />}
            {dsValidate === 'ok' && <ValidMsg state="ok" text="Connected successfully" />}
            {dsValidate === 'error' && <ValidMsg state="error" text={dsError} />}
          </Field>

          <Field
            label="ElevenLabs API Key"
            description="Used to generate per-scene narration audio."
            hint="Provider: elevenlabs.io (free tier available)"
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showElevenLabs ? 'text' : 'password'}
                  value={form.elevenlabs_api_key}
                  onChange={(e) => { patch('elevenlabs_api_key', e.target.value); setElValidate('idle') }}
                  placeholder="sk_..."
                  className="w-full px-3 py-2.5 pr-10 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <button
                  onClick={() => setShowElevenLabs((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showElevenLabs ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <TestButton state={elValidate} onClick={handleTestElevenLabs} />
            </div>
            {elValidate === 'configured' && <ValidMsg state="configured" text="Key saved — click Test Connection to verify" />}
            {elValidate === 'ok' && <ValidMsg state="ok" text="Connected successfully" />}
            {elValidate === 'error' && <ValidMsg state="error" text={elError} />}
          </Field>
        </Section>

        <div className="my-6 h-px bg-slate-100" />

        {/* Output */}
        <Section title="Output">
          <Field
            label="Output Folder"
            description="Primary data folder for this app. State, logs, generated audio, and output files are stored here."
            hint="Changing this moves app data to the new folder."
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={form.output_dir}
                onChange={(e) => patch('output_dir', e.target.value)}
                placeholder="C:\Users\You\Videos\AnimalChannel"
                className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
              <button
                onClick={handleBrowse}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Folder size={15} />
                Browse
              </button>
            </div>
          </Field>
        </Section>

        <div className="my-6 h-px bg-slate-100" />

        {/* Appearance */}
        <Section title="Appearance">
          <Field
            label="Theme"
            description="Choose a light interface, a dark interface, or follow Windows."
            hint="System uses your computer's current theme."
          >
            <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-50 border border-slate-100">
              <ThemeButton
                active={form.theme === 'light'}
                icon={<Sun size={14} />}
                label="Light"
                onClick={() => patch('theme', 'light')}
              />
              <ThemeButton
                active={form.theme === 'dark'}
                icon={<Moon size={14} />}
                label="Dark"
                onClick={() => patch('theme', 'dark')}
              />
              <ThemeButton
                active={form.theme === 'system'}
                icon={<Monitor size={14} />}
                label="System"
                onClick={() => patch('theme', 'system')}
              />
            </div>
          </Field>
        </Section>

        <div className="my-6 h-px bg-slate-100" />

        {/* Pipeline Defaults */}
        <Section title="Pipeline Defaults">
          <Field
            label="Headless Browser"
            description="Runs Flow automation without showing the browser window."
            hint="Off keeps the browser visible (recommended for debugging)"
          >
            <button
              onClick={() => patch('flow_headless', !form.flow_headless)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.flow_headless ? 'bg-emerald-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.flow_headless ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="ml-3 text-sm text-slate-500">{form.flow_headless ? 'Headless (hidden)' : 'Visible (recommended)'}</span>
          </Field>

          <Field
            label="Wait Between Scenes"
            description="Minimum pause between scene submissions to reduce rate-limit and anti-abuse risk."
            hint={`${form.wait_between_scenes}s`}
          >
            <input
              type="range"
              min={waitBetweenScenesMin}
              max={waitBetweenScenesMax}
              value={form.wait_between_scenes}
              onChange={(e) => patch('wait_between_scenes', parseInt(e.target.value))}
              className="settings-range w-48 accent-emerald-500"
              style={waitBetweenScenesStyle}
            />
            <span className="ml-3 text-sm font-mono text-slate-600">{form.wait_between_scenes}s</span>
          </Field>

          <Field
            label="Max Retries Per Scene"
            description="Maximum retry attempts for a scene before it is marked failed."
            hint="Range: 1-5"
          >
            <input
              type="number"
              min={1}
              max={5}
              value={form.max_retries_per_scene}
              onChange={(e) => patch('max_retries_per_scene', parseInt(e.target.value) || 3)}
              className="w-28 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>

          <Field
            label="Pipeline Timeout (seconds)"
            description="Base timeout used for each scene run before the runner gives up and moves on."
            hint="Range: 60-3600 seconds"
          >
            <input
              type="number"
              min={60}
              max={3600}
              value={form.pipeline_timeout_sec}
              onChange={(e) => patch('pipeline_timeout_sec', parseInt(e.target.value) || 300)}
              className="w-28 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>

          <Field
            label="Confirm Costly Operations"
            description="Shows a confirmation dialog with estimated ElevenLabs cost before bulk voice generation."
            hint="Recommended: enabled"
          >
            <button
              onClick={() => patch('confirm_costly_operations', !form.confirm_costly_operations)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.confirm_costly_operations ? 'bg-emerald-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.confirm_costly_operations ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="ml-3 text-sm text-slate-500">{form.confirm_costly_operations ? 'Enabled (show cost estimate)' : 'Disabled (skip confirmation)'}</span>
          </Field>
        </Section>

        <div className="my-6 h-px bg-slate-100" />

        <Section title="Flow Intervals">
          <p className="text-xs text-slate-500">
            Only user-meaningful waits are shown here ({'>='} 1 second). Short system click delays are hidden.
          </p>
          <div className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100">
            {visibleFlowIntervalFields.map((field) => {
              const currentValue = form.flow_intervals[field.key] ?? field.default_ms
              const min = Math.max(MIN_VISIBLE_INTERVAL_MS, field.min_ms || 0)
              const max = field.max_ms || 600000
              return (
                <div key={field.key} className="px-3 py-2.5 grid grid-cols-[1fr_auto] gap-3 items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{field.label}</p>
                    <p className="text-xs text-slate-500 leading-snug">{field.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => patchFlowInterval(field, currentValue - 500)}
                      className="h-8 w-8 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                      title="Decrease by 500ms"
                    >
                      -
                    </button>
                    <div className="flex flex-col items-end">
                      <input
                        type="number"
                        min={min}
                        max={max}
                        value={currentValue}
                        onChange={(e) => patchFlowInterval(field, parseInt(e.target.value) || field.default_ms)}
                        className="w-28 px-2.5 py-1.5 rounded-md border border-slate-200 text-sm text-right focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                      <span className="text-[11px] text-slate-400 mt-0.5">{formatIntervalSeconds(currentValue)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => patchFlowInterval(field, currentValue + 500)}
                      className="h-8 w-8 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                      title="Increase by 500ms"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => patchFlowInterval(field, field.default_ms)}
                      className="h-8 w-8 rounded-md border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                      title="Reset to default"
                    >
                      <RotateCcw size={13} className="mx-auto" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* Save */}
        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-all shadow-lg shadow-emerald-100"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Save Settings
          </button>

          {toast === 'saved' && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle size={15} />
              Saved
            </div>
          )}
          {toast === 'error' && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-red-500">
              <XCircle size={15} />
              Save failed
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">{title}</h2>
      <div className="space-y-5">{children}</div>
    </div>
  )
}

function Field({
  label,
  description,
  hint,
  children,
}: {
  label: string
  description?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1">{label}</label>
      {description && <p className="text-xs text-slate-500 mb-1">{description}</p>}
      {hint && <p className="text-xs text-slate-400 mb-2">{hint}</p>}
      <div className="flex items-center flex-wrap gap-y-1">{children}</div>
    </div>
  )
}

function TestButton({ state, onClick }: { state: ValidateState; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={state === 'testing'}
      className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
    >
      {state === 'testing' && <Loader2 size={12} className="animate-spin" />}
      {state === 'ok' && <CheckCircle size={12} className="text-emerald-500" />}
      {state === 'configured' && <KeyRound size={12} className="text-slate-400" />}
      {state === 'error' && <XCircle size={12} className="text-red-500" />}
      Test Connection
    </button>
  )
}

function ValidMsg({ state, text }: { state: 'configured' | 'ok' | 'error'; text: string }) {
  const styles = {
    configured: 'text-slate-500 bg-slate-50 border-slate-100',
    ok:         'text-emerald-700 bg-emerald-50 border-emerald-100',
    error:      'text-red-600 bg-red-50 border-red-100',
  }
  const icons = {
    configured: <KeyRound size={11} className="shrink-0 mt-0.5" />,
    ok:         <CheckCircle size={11} className="shrink-0 mt-0.5" />,
    error:      <XCircle size={11} className="shrink-0 mt-0.5" />,
  }
  return (
    <div className={`flex items-start gap-1.5 text-xs mt-1.5 font-medium w-full px-2.5 py-1.5 rounded-lg border ${styles[state]}`}>
      {icons[state]}
      {text}
    </div>
  )
}

function ThemeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
        active
          ? 'bg-white text-emerald-600 shadow-sm'
          : 'text-slate-500 hover:text-slate-800 hover:bg-white/70'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
