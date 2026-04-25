import { useState, useEffect } from 'react'
import { Settings, Eye, EyeOff, CheckCircle, XCircle, Folder, Loader2 } from 'lucide-react'
import { api } from '../api/client'

interface AppSettings {
  deepseek_api_key: string
  elevenlabs_api_key: string
  output_dir: string
  default_scene_count: number
  flow_headless: boolean
  wait_between_scenes: number
  max_retries_per_scene: number
}

type ValidateState = 'idle' | 'testing' | 'ok' | 'error'

export default function SettingsView() {
  const [form, setForm] = useState<AppSettings>({
    deepseek_api_key: '',
    elevenlabs_api_key: '',
    output_dir: '',
    default_scene_count: 12,
    flow_headless: false,
    wait_between_scenes: 5,
    max_retries_per_scene: 3,
  })
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
      setForm((f) => ({ ...f, ...data }))
    }).catch(() => {})
  }, [])

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

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
      await api.saveAppSettings(form as unknown as Record<string, unknown>)
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
            <p className="text-xs text-slate-400 font-medium mt-0.5">API keys and pipeline defaults</p>
          </div>
        </div>

        {/* API Keys */}
        <Section title="API Keys">
          <Field label="DeepSeek API Key" hint="platform.deepseek.com">
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
            {dsValidate === 'ok' && <ValidMsg ok text="Connected successfully" />}
            {dsValidate === 'error' && <ValidMsg ok={false} text={dsError} />}
          </Field>

          <Field label="ElevenLabs API Key" hint="elevenlabs.io — free tier available">
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
            {elValidate === 'ok' && <ValidMsg ok text="Connected successfully" />}
            {elValidate === 'error' && <ValidMsg ok={false} text={elError} />}
          </Field>
        </Section>

        <div className="my-6 h-px bg-slate-100" />

        {/* Output */}
        <Section title="Output">
          <Field label="Output Folder" hint="Where generated videos are saved">
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

        {/* Pipeline Defaults */}
        <Section title="Pipeline Defaults">
          <Field label="Default Scene Count" hint="Number of scenes to generate per video (1–20)">
            <input
              type="number"
              min={1}
              max={20}
              value={form.default_scene_count}
              onChange={(e) => patch('default_scene_count', parseInt(e.target.value) || 12)}
              className="w-28 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>

          <Field label="Headless Browser" hint="Hide the browser window during automation (off = visible, recommended)">
            <button
              onClick={() => patch('flow_headless', !form.flow_headless)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.flow_headless ? 'bg-emerald-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.flow_headless ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="ml-3 text-sm text-slate-500">{form.flow_headless ? 'Headless (hidden)' : 'Visible (recommended)'}</span>
          </Field>

          <Field label="Wait Between Scenes" hint={`${form.wait_between_scenes}s — paces requests to avoid rate limiting`}>
            <input
              type="range"
              min={0}
              max={30}
              value={form.wait_between_scenes}
              onChange={(e) => patch('wait_between_scenes', parseInt(e.target.value))}
              className="w-48 accent-emerald-500"
            />
            <span className="ml-3 text-sm font-mono text-slate-600">{form.wait_between_scenes}s</span>
          </Field>

          <Field label="Max Retries Per Scene" hint="How many times to retry a failed scene (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              value={form.max_retries_per_scene}
              onChange={(e) => patch('max_retries_per_scene', parseInt(e.target.value) || 3)}
              className="w-28 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1">{label}</label>
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
      {state === 'error' && <XCircle size={12} className="text-red-500" />}
      Test Connection
    </button>
  )
}

function ValidMsg({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={`text-xs mt-1 font-medium w-full ${ok ? 'text-emerald-600' : 'text-red-500'}`}>
      {text}
    </p>
  )
}
