import { create } from 'zustand'
import {
  parseLogLine,
  saveTimingSession,
  computeAverages,
  STAGE_ORDER,
  STAGE_LABELS,
  type StageId,
} from '../api/stageParser'

export type { StageId }

export interface LogLine {
  id: number
  text: string
  level: 'info' | 'ok' | 'error' | 'warn' | 'header'
  timestamp: string
}

export interface StageAction {
  id: string
  label: string
  detail?: string
  status: 'running' | 'done' | 'error'
  startedAt: Date
  completedAt?: Date
}

export interface PipelineStage {
  id: StageId
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  startedAt?: Date
  completedAt?: Date
  collapsed: boolean
  actions: StageAction[]
  avgMs?: number
}

export interface Idea {
  index: number
  title: string
  story_id: string
}

export interface VoNarrationItem {
  sentence: string
  narration: string
  veoPrompt: string
}

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string
  labels: Record<string, string>
}

export interface Settings {
  mode: 'Image' | 'Video'
  sub_type: 'Frames' | 'Ingredients'
  aspect_ratio: string
  clip_count: string
  duration: string
  model: string
}

export interface AdvancedOptions {
  waitBetweenSec: number
  waitMaxSec: number
  sceneMaxRetries: number
  timeoutSec: number
  dryRun: boolean
  headless: boolean
  singleScene: number
}

interface AppState {
  activeView: 'pipeline' | 'logs'
  isAuthorized: boolean
  ideas: Idea[]
  selectedIdeaIndex: number
  settings: Settings
  advanced: AdvancedOptions
  runState: 'idle' | 'running' | 'stopped' | 'complete' | 'error'
  activeStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  currentScene: number
  totalScenes: number
  statusText: string
  logLines: LogLine[]
  pipelineStages: PipelineStage[]

  // Content creation state (steps 2-5)
  ideaInput: string
  generatedIdeas: string
  scriptInput: string
  generatedScript: string
  voNarrations: VoNarrationItem[]
  elevenlabsVoices: ElevenLabsVoice[]
  selectedVoiceId: string
  generatedAudioFilename: string

  setActiveView: (view: 'pipeline' | 'logs') => void
  setIsAuthorized: (v: boolean) => void
  setIdeas: (ideas: Idea[]) => void
  setSelectedIdeaIndex: (idx: number) => void
  setSettings: (s: Partial<Settings>) => void
  setAdvanced: (a: Partial<AdvancedOptions>) => void
  setRunState: (s: AppState['runState']) => void
  setActiveStep: (step: AppState['activeStep']) => void
  setCurrentScene: (n: number) => void
  setTotalScenes: (n: number) => void
  setStatusText: (t: string) => void
  appendLog: (line: Omit<LogLine, 'id'>) => void
  clearLogs: () => void
  resetPipelineStages: () => void
  toggleStageCollapse: (stageId: StageId) => void
  updateStageFromLine: (line: string) => void

  setIdeaInput: (v: string) => void
  setGeneratedIdeas: (v: string) => void
  setScriptInput: (v: string) => void
  setGeneratedScript: (v: string) => void
  setVoNarrations: (items: VoNarrationItem[]) => void
  setElevenLabsVoices: (voices: ElevenLabsVoice[]) => void
  setSelectedVoiceId: (id: string) => void
  setGeneratedAudioFilename: (filename: string) => void
  updateVoNarrationItem: (index: number, patch: Partial<VoNarrationItem>) => void
}

let _logId = 0

// Module-level timing trackers (not reactive — no component reads these)
let _stageStartMs: Partial<Record<StageId, number>> = {}
let _stageDurationMs: Partial<Record<StageId, number>> = {}

function buildDefaultStages(avgs: Partial<Record<StageId, number>> = {}): PipelineStage[] {
  return STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: 'pending' as const,
    collapsed: false,
    actions: [],
    avgMs: avgs[id],
  }))
}

export const useStore = create<AppState>((set, get) => ({
  activeView: 'pipeline',
  isAuthorized: false,
  ideas: [],
  selectedIdeaIndex: 0,
  settings: {
    mode: 'Video',
    sub_type: 'Frames',
    aspect_ratio: '9:16',
    clip_count: 'x4',
    duration: '8s',
    model: 'Veo 3.1 - Fast',
  },
  advanced: {
    waitBetweenSec: 8,
    waitMaxSec: 15,
    sceneMaxRetries: 2,
    timeoutSec: 300,
    dryRun: false,
    headless: false,
    singleScene: 1,
  },
  runState: 'idle',
  activeStep: 1,
  currentScene: 0,
  totalScenes: 0,
  statusText: 'System Standby',
  logLines: [],
  pipelineStages: buildDefaultStages(computeAverages()),

  ideaInput: '',
  generatedIdeas: '',
  scriptInput: '',
  generatedScript: '',
  voNarrations: [],
  elevenlabsVoices: [],
  selectedVoiceId: '',
  generatedAudioFilename: '',

  setActiveView: (activeView) => set({ activeView }),
  setIsAuthorized: (isAuthorized) => set({ isAuthorized }),
  setIdeas: (ideas) => set({ ideas }),
  setSelectedIdeaIndex: (selectedIdeaIndex) => set({ selectedIdeaIndex }),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setAdvanced: (a) => set((st) => ({ advanced: { ...st.advanced, ...a } })),
  setRunState: (runState) => set({ runState }),
  setActiveStep: (activeStep) => set({ activeStep }),
  setCurrentScene: (currentScene) => set({ currentScene }),
  setTotalScenes: (totalScenes) => set({ totalScenes }),
  setStatusText: (statusText) => set({ statusText }),
  appendLog: (line) =>
    set((st) => ({ logLines: [...st.logLines, { ...line, id: ++_logId }] })),
  clearLogs: () => set({ logLines: [] }),

  setIdeaInput: (ideaInput) => set({ ideaInput }),
  setGeneratedIdeas: (generatedIdeas) => set({ generatedIdeas }),
  setScriptInput: (scriptInput) => set({ scriptInput }),
  setGeneratedScript: (generatedScript) => set({ generatedScript }),
  setVoNarrations: (voNarrations) => set({ voNarrations }),
  setElevenLabsVoices: (elevenlabsVoices) => set({ elevenlabsVoices }),
  setSelectedVoiceId: (selectedVoiceId) => set({ selectedVoiceId }),
  setGeneratedAudioFilename: (generatedAudioFilename) => set({ generatedAudioFilename }),
  updateVoNarrationItem: (index, patch) =>
    set((st) => ({
      voNarrations: st.voNarrations.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    })),

  resetPipelineStages: () => {
    _stageStartMs = {}
    _stageDurationMs = {}
    set({ pipelineStages: buildDefaultStages(computeAverages()) })
  },

  toggleStageCollapse: (stageId) =>
    set((st) => ({
      pipelineStages: st.pipelineStages.map((s) =>
        s.id === stageId ? { ...s, collapsed: !s.collapsed } : s
      ),
    })),

  updateStageFromLine: (line: string) => {
    const parsed = parseLogLine(line)
    if (!parsed) return

    if (parsed.kind === 'session_end') {
      saveTimingSession({ stages: { ..._stageDurationMs } }, parsed.success)
      // Mark any still-running stages as error on failure, or done on success
      set((st) => ({
        pipelineStages: st.pipelineStages.map((s) => {
          if (s.status !== 'running') return s
          const now = new Date()
          return {
            ...s,
            status: parsed.success ? ('done' as const) : ('error' as const),
            completedAt: now,
            collapsed: true,
          }
        }),
      }))
      return
    }

    const { event } = parsed
    const now = new Date()

    set((st) => {
      const stages = st.pipelineStages.map((s) => {
        // Auto-complete preceding running stages when a later stage starts
        if (event.stageStart && s.id !== event.stageId && s.status === 'running') {
          const currentIdx = STAGE_ORDER.indexOf(event.stageId)
          const thisIdx = STAGE_ORDER.indexOf(s.id)
          // Complete stages that come before the newly starting stage,
          // but let video_gen stay running while video_download starts (they overlap)
          const isOverlap = s.id === 'video_gen' && event.stageId === 'video_download'
          if (thisIdx < currentIdx && !isOverlap) {
            if (!_stageDurationMs[s.id] && _stageStartMs[s.id]) {
              _stageDurationMs[s.id] = Date.now() - _stageStartMs[s.id]!
            }
            return { ...s, status: 'done' as const, completedAt: now, collapsed: true }
          }
        }

        if (s.id !== event.stageId) return s

        let updated = { ...s }

        // ── Stage status ──────────────────────────────────────────────────────
        if (event.stageStart && s.status === 'pending') {
          _stageStartMs[s.id] = Date.now()
          updated = { ...updated, status: 'running', startedAt: now, collapsed: false }
        }
        if (event.stageDone && s.status !== 'done') {
          if (_stageStartMs[s.id] && !_stageDurationMs[s.id]) {
            _stageDurationMs[s.id] = Date.now() - _stageStartMs[s.id]!
          }
          updated = { ...updated, status: 'done', completedAt: now, collapsed: true }
        }
        if (event.stageError) {
          updated = { ...updated, status: 'error', completedAt: now, collapsed: false }
        }

        // ── Action upsert ─────────────────────────────────────────────────────
        if (event.actionId && event.actionLabel) {
          const actionStatus: StageAction['status'] = event.actionError
            ? 'error'
            : event.actionDone
              ? 'done'
              : 'running'

          const existing = updated.actions.find((a) => a.id === event.actionId)
          if (existing) {
            updated = {
              ...updated,
              actions: updated.actions.map((a) =>
                a.id === event.actionId
                  ? {
                      ...a,
                      label: event.actionLabel!,
                      detail: event.actionDetail ?? a.detail,
                      status: actionStatus,
                      completedAt: actionStatus !== 'running' ? now : a.completedAt,
                    }
                  : a
              ),
            }
          } else {
            const newAction: StageAction = {
              id: event.actionId,
              label: event.actionLabel,
              detail: event.actionDetail,
              status: actionStatus,
              startedAt: now,
              completedAt: actionStatus !== 'running' ? now : undefined,
            }
            // If stage was pending, start it now
            if (updated.status === 'pending') {
              if (!_stageStartMs[s.id]) _stageStartMs[s.id] = Date.now()
              updated = { ...updated, status: 'running', startedAt: now, collapsed: false }
            }
            updated = { ...updated, actions: [...updated.actions, newAction] }
          }
        }

        return updated
      })

      return { pipelineStages: stages }
    })
  },
}))
