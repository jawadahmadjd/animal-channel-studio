export type StageId = 'text_gen' | 'browser_setup' | 'video_gen' | 'video_download' | 'file_org'

export interface StageEvent {
  stageId: StageId
  stageStart?: boolean
  stageDone?: boolean
  stageError?: boolean
  actionId?: string
  actionLabel?: string
  actionDetail?: string
  actionDone?: boolean
  actionError?: boolean
}

export type ParsedLine =
  | { kind: 'stage'; event: StageEvent }
  | { kind: 'session_end'; success: boolean }

type RuleFactory = (m: RegExpMatchArray) => StageEvent
type Rule = [RegExp, RuleFactory]

const RULES: Rule[] = [
  // ── Text Generation ───────────────────────────────────────────────────────────
  [/STEP 1 of 3/i,
    () => ({ stageId: 'text_gen', stageStart: true })],

  [/LOADING CACHED STORY/i,
    () => ({ stageId: 'text_gen', stageStart: true, actionId: 'cache', actionLabel: 'Loading saved script…' })],

  [/Loaded existing story state/i,
    () => ({ stageId: 'text_gen', actionId: 'cache', actionLabel: 'Using saved script', actionDone: true, stageDone: true })],

  [/Calling DeepSeek API/i,
    () => ({ stageId: 'text_gen', stageStart: true, actionId: 'api', actionLabel: 'Calling AI to write the script…' })],

  [/Response received in ([\d.]+)s.*?\(([\d,]+) char/i,
    (m) => ({ stageId: 'text_gen', actionId: 'api', actionLabel: 'Script received', actionDetail: `${m[1]}s · ${m[2]} chars`, actionDone: true })],

  [/Validating story structure/i,
    () => ({ stageId: 'text_gen', actionId: 'validate', actionLabel: 'Checking story format…' })],

  [/Story validated.*?"([^"]+)".*?\((\d+) scene/i,
    (m) => ({ stageId: 'text_gen', actionId: 'validate', actionLabel: `"${m[1]}"`, actionDetail: `${m[2]} scenes ready`, actionDone: true, stageDone: true })],

  [/Failed story generation after/i,
    () => ({ stageId: 'text_gen', actionId: 'api', actionLabel: 'Script generation failed', actionError: true, stageError: true })],

  // ── Browser Setup ─────────────────────────────────────────────────────────────
  [/STEP 2 of 3/i,
    () => ({ stageId: 'browser_setup', stageStart: true })],

  [/BROWSER\s+opening/i,
    () => ({ stageId: 'browser_setup', stageStart: true, actionId: 'open', actionLabel: 'Opening browser…' })],

  [/waiting for page stabilization/i,
    () => ({ stageId: 'browser_setup', actionId: 'open', actionLabel: 'Browser loading…' })],

  [/Known Flow project URL found/i,
    () => ({ stageId: 'browser_setup', actionId: 'project', actionLabel: 'Resuming existing project…' })],

  [/applying initial settings/i,
    () => ({ stageId: 'browser_setup', actionId: 'settings', actionLabel: 'Applying video settings…' })],

  [/Saved Flow project URL/i,
    () => ({ stageId: 'browser_setup', actionId: 'settings', actionLabel: 'Settings applied', actionDone: true, stageDone: true })],

  // ── Video Generation ──────────────────────────────────────────────────────────
  [/Dynamic loop enabled/i,
    () => ({ stageId: 'video_gen', stageStart: true })],

  [/\[Submit\] Scene (\d+) attempt (\d+)\/(\d+)/i,
    (m) => ({
      stageId: 'video_gen',
      actionId: `scene_${m[1]}`,
      actionLabel: `Submitting Scene ${m[1]} for generation`,
      actionDetail: parseInt(m[2]) > 1 ? `attempt ${m[2]} of ${m[3]}` : undefined,
    })],

  [/Card in progress at (\d+)%/i,
    (m) => ({ stageId: 'video_gen', actionId: 'progress', actionLabel: 'Generating…', actionDetail: `${m[1]}% complete` })],

  [/Scene (\d+): first clip ready/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]} generation complete`, actionDone: true })],

  [/Scene (\d+).*?Retry button clicked \((\d+)\/(\d+)\)/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]}: retry ${m[2]}/${m[3]} in Flow UI…` })],

  [/Scene (\d+).*?Retry button not found/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]}: retry button missing, re-generating…` })],

  [/Scene (\d+).*?queued for re-generation/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]} re-generating…` })],

  [/Scene (\d+) failed.*?queued retry/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]} retrying…` })],

  [/Scene (\d+).*?exhausted all retries.*?skipping/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]} skipped (all retries exhausted)`, actionError: true })],

  [/Scene (\d+).*?exhausted retries/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]} failed (no more retries)`, actionError: true })],

  [/Scene (\d+) timed out.*?retry/i,
    (m) => ({ stageId: 'video_gen', actionId: `scene_${m[1]}`, actionLabel: `Scene ${m[1]} timed out, retrying…` })],

  // ── Video Downloads ───────────────────────────────────────────────────────────
  [/Scene (\d+): downloading (\d+) clip/i,
    (m) => ({ stageId: 'video_download', stageStart: true, actionId: `dl_${m[1]}`, actionLabel: `Downloading Scene ${m[1]}`, actionDetail: `${m[2]} clip(s)` })],

  [/\[Download\] Scene (\d+)/i,
    (m) => ({ stageId: 'video_download', stageStart: true, actionId: `dl_${m[1]}`, actionLabel: `Downloading Scene ${m[1]}…` })],

  [/Scene (\d+) downloaded \((\d+) clip/i,
    (m) => ({ stageId: 'video_download', actionId: `dl_${m[1]}`, actionLabel: `Scene ${m[1]} saved`, actionDetail: `${m[2]} clip(s)`, actionDone: true })],

  [/Thumbnail ready but download failed/i,
    () => ({ stageId: 'video_download', actionId: 'dl_fail', actionLabel: 'Download failed, retrying…' })],

  // ── File Organization ─────────────────────────────────────────────────────────
  [/STEP 3 of 3/i,
    () => ({ stageId: 'file_org', stageStart: true })],

  [/Clips moved to/i,
    () => ({ stageId: 'file_org', actionId: 'move', actionLabel: 'Clips organized into output folder', actionDone: true })],

  [/Manifest saved/i,
    () => ({ stageId: 'file_org', actionId: 'manifest', actionLabel: 'Video index saved', actionDone: true })],

  [/Story written to Stories\.md/i,
    () => ({ stageId: 'file_org', actionId: 'story', actionLabel: 'Story saved to archive', actionDone: true })],

  [/Idea marked as processed/i,
    () => ({ stageId: 'file_org', actionId: 'processed', actionLabel: 'Marked as completed', actionDone: true })],

  [/PIPELINE COMPLETE/i,
    () => ({ stageId: 'file_org', stageDone: true })],
]

export function parseLogLine(line: string): ParsedLine | null {
  const doneMatch = line.match(/\[Done.*exit code (\d+)\]/i)
  if (doneMatch) return { kind: 'session_end', success: doneMatch[1] === '0' }
  if (line.includes('[Stopped by user]')) return { kind: 'session_end', success: false }

  for (const [pattern, factory] of RULES) {
    const m = line.match(pattern)
    if (m) return { kind: 'stage', event: factory(m) }
  }
  return null
}

// ── Stage ordering for auto-completing preceding stages ───────────────────────
export const STAGE_ORDER: StageId[] = [
  'text_gen', 'browser_setup', 'video_gen', 'video_download', 'file_org',
]

export const STAGE_LABELS: Record<StageId, string> = {
  text_gen: 'Writing the Script',
  browser_setup: 'Setting Up Browser',
  video_gen: 'Generating Videos',
  video_download: 'Downloading Videos',
  file_org: 'Organizing Files',
}

// ── Timing history (localStorage) ────────────────────────────────────────────
const LS_KEY = 'animalch_pipeline_timing'
const MAX_SESSIONS = 10

export interface TimingSession {
  stages: Partial<Record<StageId, number>>  // ms per stage
}

export interface TimingHistory {
  completed: TimingSession[]
  incomplete: TimingSession[]
}

export function loadTimingHistory(): TimingHistory {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as TimingHistory
  } catch { /* ignore */ }
  return { completed: [], incomplete: [] }
}

export function saveTimingSession(session: TimingSession, isComplete: boolean): void {
  try {
    const history = loadTimingHistory()
    if (isComplete) {
      history.completed = [...history.completed, session].slice(-MAX_SESSIONS)
    } else {
      history.incomplete = [...history.incomplete, session].slice(-MAX_SESSIONS)
    }
    localStorage.setItem(LS_KEY, JSON.stringify(history))
  } catch { /* ignore */ }
}

export function computeAverages(): Partial<Record<StageId, number>> {
  const history = loadTimingHistory()
  const avgs: Partial<Record<StageId, number>> = {}
  for (const stageId of STAGE_ORDER) {
    const samples = history.completed
      .map((s) => s.stages[stageId])
      .filter((v): v is number => v !== undefined)
    if (samples.length > 0) {
      avgs[stageId] = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
    }
  }
  return avgs
}
