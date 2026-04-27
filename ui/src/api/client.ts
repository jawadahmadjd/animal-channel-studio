const BASE = 'http://127.0.0.1:7477'
export const REQUIRED_BRIDGE_VERSION = 2

// ── UI event logger ──────────────────────────────────────────────────────────
// Sends button clicks and UI state transitions to the bridge so they appear
// in the session log file alongside subprocess output. Fire-and-forget.
export function logUIEvent(action: string, detail?: unknown): void {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
  const detailStr = detail !== undefined
    ? (typeof detail === 'string' ? detail : JSON.stringify(detail))
    : ''
  fetch(`${BASE}/ui/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, detail: detailStr, timestamp: ts }),
  }).catch(() => {})  // never throw — logging must not break the UI
}

// ── API request wrapper ───────────────────────────────────────────────────────
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const t0 = performance.now()
  // Log all calls except high-frequency polling
  const skipLog = path === '/run/stream' || path === '/output/watch' || path === '/health'
  if (!skipLog) {
    const bodyStr = body ? ` ${JSON.stringify(_redactBody(body))}` : ''
    console.debug(`[api] → ${method} ${path}${bodyStr}`)
  }

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    console.error(`[api] ✗ ${method} ${path} — network error:`, err)
    throw err
  }

  const ms = Math.round(performance.now() - t0)
  if (!res.ok) {
    const text = await res.text()
    console.error(`[api] ✗ ${method} ${path} → ${res.status} (${ms}ms): ${text}`)
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }

  if (!skipLog) {
    console.debug(`[api] ✓ ${method} ${path} → ${res.status} (${ms}ms)`)
  }
  return res.json() as Promise<T>
}

function _redactBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body
  const REDACT = new Set(['deepseek_api_key', 'elevenlabs_api_key'])
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) =>
      [k, REDACT.has(k) && v ? '***' : v]
    )
  )
}

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string
  labels: Record<string, string>
}

export interface VoNarrationItem {
  sentence: string
  narration: string
  veo_prompt: string
}

export interface IdeaDbEntry {
  story_id: string
  title: string
  description: string
  script: string
  vo_narrations: VoNarrationItem[]
  saved_at: string
}

export const api = {
  getAuthStatus: () => req<{ authorized: boolean; expires_soon?: boolean; keys_configured?: { deepseek: boolean; elevenlabs: boolean } }>('GET', '/auth/status'),
  deleteAuth: () => req<{ status: string }>('DELETE', '/auth'),
  getSettings: () => req<Record<string, string>>('GET', '/settings'),
  saveSettings: (data: Record<string, string>) => req('POST', '/settings', data),

  runLogin: (headless = false) => req('POST', '/run/login', { headless }),
  runPipeline: (params: Record<string, unknown>) => req('POST', '/run/pipeline', params),
  runResume: (params: Record<string, unknown>) => req('POST', '/run/resume', params),
  runSingleScene: (params: Record<string, unknown>) => req('POST', '/run/single-scene', params),
  runFlowOnly: (params: Record<string, unknown>) => req('POST', '/run/flow-only', params),
  runFinalize: (story_id: string) => req('POST', '/run/finalize', { story_id }),
  runFreshStart: (story_id: string) => req('POST', '/run/fresh-start', { story_id }),
  runStop: () => req('POST', '/run/stop', {}),
  getRunState: (story_id: string) =>
    req<{ story_id: string; run_status: string; schema_version: number; schema_ok: boolean; schema_message: string | null; scenes_done: number; scenes_total: number }>(
      'GET', `/run/state/${encodeURIComponent(story_id)}`
    ),

  getLogFile: (filename: string) => req<{ lines: string[] }>('GET', `/logs/${filename}`),
  getLogSessions: () => req<{ sessions: { id: number; line_count: number; success: boolean | null; start_timestamp: string; end_timestamp: string }[] }>('GET', '/logs/sessions'),

  videoFileUrl: (path: string) => `${BASE}/output/file?path=${encodeURIComponent(path)}`,

  // App settings (C3)
  getAppSettings: () => req<Record<string, unknown>>('GET', '/settings/app'),
  saveAppSettings: (data: Record<string, unknown>) => req('POST', '/settings/app', data),
  validateDeepSeek: () => req<{ ok: boolean; error?: string }>('POST', '/validate/deepseek', {}),
  validateElevenLabs: () => req<{ ok: boolean; error?: string }>('POST', '/validate/elevenlabs', {}),
  getHealth: () => req<{ status: string; bridge_version?: number; keys: { deepseek: boolean; elevenlabs: boolean } }>('GET', '/health'),

  // Content creation
  generateIdea: (niche: string, content_type: string) =>
    req<{ ideas: { title: string; description: string }[] }>('POST', '/generate/idea', { niche, content_type }),
  generateScript: (niche: string, idea: string, word_count: number) =>
    req<{ script: string; word_count: number; target_word_count: number; length_ok: boolean }>('POST', '/generate/script', { niche, idea, word_count }),
  generateVoNarration: (script: string) =>
    req<{ items: VoNarrationItem[] }>('POST', '/generate/vo-narration', { script }),
  getElevenLabsVoices: () =>
    req<{ voices: ElevenLabsVoice[] }>('GET', '/elevenlabs/voices'),
  generateVoiceover: (narration_text: string, voice_id: string) =>
    req<{ filename: string }>('POST', '/generate/voiceover', { narration_text, voice_id }),
  audioUrl: (filename: string) => `${BASE}/audio/${filename}`,

  // Ideas DB
  saveIdeaMetadata: (title: string, description: string, script: string, vo_narrations: VoNarrationItem[]) =>
    req<{ story_id: string }>('POST', '/ideas/db/save', { title, description, script, vo_narrations }),
  getIdeasDb: () => req<IdeaDbEntry[]>('GET', '/ideas/db'),
  deleteIdeaFromDb: (story_id: string) => req<{ status: string; found: boolean }>('DELETE', `/ideas/db/${encodeURIComponent(story_id)}`),
}

export function classifyLogLine(text: string): 'error' | 'ok' | 'warn' | 'header' | 'info' {
  const low = text.toLowerCase()
  if (low.includes('error') || low.includes('failed') || low.includes('exception') || low.includes('traceback'))
    return 'error'
  if (low.includes('✓') || low.includes('success') || low.includes('complete') || low.includes('done') || low.includes(' ok '))
    return 'ok'
  if (text.startsWith('=====') || text.startsWith('> ====='))
    return 'header'
  if (low.includes('warn') || low.includes('skip') || low.includes('retry'))
    return 'warn'
  return 'info'
}

export function parseSceneProgress(text: string): { current: number; total: number } | null {
  const m = text.match(/Scene\s+(\d+)\s*\/\s*(\d+)/i)
  if (m) return { current: parseInt(m[1]), total: parseInt(m[2]) }
  return null
}

export function subscribeToStream(
  onLine: (text: string) => void,
  onDone: () => void
): () => void {
  const es = new EventSource(`${BASE}/run/stream`)
  es.onmessage = (e) => {
    if (e.data === '[DONE]') {
      onDone()
      es.close()
      return
    }
    onLine(e.data.replace(/\\n/g, '\n'))
  }
  es.onerror = () => {
    onDone()
    es.close()
  }
  return () => es.close()
}
