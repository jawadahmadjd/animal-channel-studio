const BASE = 'http://127.0.0.1:7477'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
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

export const api = {
  getIdeas: () => req<{ index: number; title: string; story_id: string }[]>('GET', '/ideas'),
  getAuthStatus: () => req<{ authorized: boolean }>('GET', '/auth/status'),
  deleteAuth: () => req<{ status: string }>('DELETE', '/auth'),
  getSettings: () => req<Record<string, string>>('GET', '/settings'),
  saveSettings: (data: Record<string, string>) => req('POST', '/settings', data),

  runLogin: (headless = false) => req('POST', '/run/login', { headless }),
  runPipeline: (params: Record<string, unknown>) => req('POST', '/run/pipeline', params),
  runResume: (params: Record<string, unknown>) => req('POST', '/run/resume', params),
  runSingleScene: (params: Record<string, unknown>) => req('POST', '/run/single-scene', params),
  runFinalize: (story_id: string) => req('POST', '/run/finalize', { story_id }),
  runFreshStart: (story_id: string) => req('POST', '/run/fresh-start', { story_id }),
  runStop: () => req('POST', '/run/stop', {}),

  getLogFile: (filename: string) => req<{ lines: string[] }>('GET', `/logs/${filename}`),

  // App settings (C3)
  getAppSettings: () => req<Record<string, unknown>>('GET', '/settings/app'),
  saveAppSettings: (data: Record<string, unknown>) => req('POST', '/settings/app', data),
  validateDeepSeek: () => req<{ ok: boolean; error?: string }>('POST', '/validate/deepseek', {}),
  validateElevenLabs: () => req<{ ok: boolean; error?: string }>('POST', '/validate/elevenlabs', {}),
  getHealth: () => req<{ status: string; keys: { deepseek: boolean; elevenlabs: boolean } }>('GET', '/health'),

  // Content creation
  generateIdea: (prompt: string) => req<{ ideas: string }>('POST', '/generate/idea', { prompt }),
  generateScript: (idea: string) => req<{ script: string }>('POST', '/generate/script', { idea }),
  generateVoNarration: (script: string) =>
    req<{ items: VoNarrationItem[] }>('POST', '/generate/vo-narration', { script }),
  getElevenLabsVoices: () =>
    req<{ voices: ElevenLabsVoice[] }>('GET', '/elevenlabs/voices'),
  generateVoiceover: (narration_text: string, voice_id: string) =>
    req<{ filename: string }>('POST', '/generate/voiceover', { narration_text, voice_id }),
  audioUrl: (filename: string) => `${BASE}/audio/${filename}`,
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
