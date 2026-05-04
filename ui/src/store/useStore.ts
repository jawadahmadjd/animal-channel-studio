import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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

export interface MultiScriptEntry {
  ideaTitle: string
  ideaDescription: string
  script: string
  wordCount?: number
  targetWordCount?: number
  lengthOk?: boolean
}

export interface GeneratedIdea {
  title: string
  description: string
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

interface ContentSnapshot {
  ideaInput: string
  ideaNiche: string
  ideaContentType: string
  generatedIdeas: GeneratedIdea[]
  selectedIdeaIds: Set<number>
  approvedIdeas: GeneratedIdea[]
  activeApprovedIdeaIndex: number
  scriptInput: string
  generatedScript: string
  voNarrations: VoNarrationItem[]
  multiScripts: MultiScriptEntry[]
  selectedMultiScriptIndices: Set<number>
  multiVoNarrations: VoNarrationItem[][]
  generatedAudioFilename: string
  sceneAudioFilenames: string[]
  audioStaleReason: string
  selectedStoryId: string
  selectedStoryTitle: string
  activeStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

interface AppState {
  activeView: 'pipeline' | 'logs' | 'prompts' | 'settings'
  setupStage: 'idle' | 'python' | 'pip' | 'bridge' | 'browser' | 'done' | 'error'
  setupDetail: string
  setSetupProgress: (stage: AppState['setupStage'], detail: string) => void
  bridgeReady: boolean
  setBridgeReady: (v: boolean) => void
  apiKeysConfigured: { deepseek: boolean; elevenlabs: boolean }
  setApiKeysConfigured: (v: { deepseek: boolean; elevenlabs: boolean }) => void
  isAuthorized: boolean
  updateAvailable: boolean
  updateVersion: string
  setUpdateReady: (version: string) => void
  dismissUpdate: () => void
  settings: Settings
  runState: 'idle' | 'running' | 'stopped' | 'complete' | 'error'
  pipelineRunning: boolean
  activeStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  currentScene: number
  totalScenes: number
  statusText: string
  logLines: LogLine[]
  pipelineStages: PipelineStage[]

  // Content creation state (steps 2-5)
  ideaInput: string
  ideaNiche: string
  ideaContentType: string
  generatedIdeas: GeneratedIdea[]
  selectedIdeaIds: Set<number>
  approvedIdeas: GeneratedIdea[]
  activeApprovedIdeaIndex: number
  scriptInput: string
  generatedScript: string
  voNarrations: VoNarrationItem[]
  multiScripts: MultiScriptEntry[]
  selectedMultiScriptIndices: Set<number>
  multiVoNarrations: VoNarrationItem[][]
  elevenlabsVoices: ElevenLabsVoice[]
  selectedVoiceId: string
  generatedAudioFilename: string
  sceneAudioFilenames: string[]
  audioStaleReason: string
  selectedStoryId: string
  selectedStoryTitle: string
  contentUndoStack: ContentSnapshot[]
  contentRedoStack: ContentSnapshot[]

  setActiveView: (view: 'pipeline' | 'logs' | 'prompts' | 'settings') => void
  setIsAuthorized: (v: boolean) => void
  setSettings: (s: Partial<Settings>) => void
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
  setIdeaNiche: (v: string) => void
  setIdeaContentType: (v: string) => void
  setGeneratedIdeas: (ideas: GeneratedIdea[]) => void
  toggleIdeaSelected: (index: number) => void
  clearSelectedIdeas: () => void
  setApprovedIdeas: (ideas: GeneratedIdea[]) => void
  setActiveApprovedIdeaIndex: (i: number) => void
  setScriptInput: (v: string) => void
  setGeneratedScript: (v: string) => void
  setVoNarrations: (items: VoNarrationItem[]) => void
  setMultiScripts: (scripts: MultiScriptEntry[]) => void
  toggleMultiScriptSelected: (index: number) => void
  setMultiVoNarrationsForIndex: (index: number, items: VoNarrationItem[]) => void
  updateMultiVoNarrationItem: (scriptIdx: number, itemIdx: number, patch: Partial<VoNarrationItem>) => void
  setElevenLabsVoices: (voices: ElevenLabsVoice[]) => void
  setSelectedVoiceId: (id: string) => void
  setGeneratedAudioFilename: (filename: string) => void
  setSceneAudioFilenames: (filenames: string[]) => void
  updateSceneAudioFilename: (index: number, filename: string) => void
  clearAudioStale: () => void
  setSelectedStoryId: (id: string) => void
  setSelectedStoryTitle: (title: string) => void
  updateVoNarrationItem: (index: number, patch: Partial<VoNarrationItem>) => void
  checkpointContentCreation: () => void
  undoContentCreation: () => void
  redoContentCreation: () => void
  resetContentCreation: () => void
}

let _logId = 0
const CONTENT_HISTORY_LIMIT = 30

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

function cloneContentSnapshot(s: ContentSnapshot): ContentSnapshot {
  return {
    ...s,
    generatedIdeas: s.generatedIdeas.map((i) => ({ ...i })),
    selectedIdeaIds: new Set(s.selectedIdeaIds),
    approvedIdeas: s.approvedIdeas.map((i) => ({ ...i })),
    voNarrations: s.voNarrations.map((v) => ({ ...v })),
    multiScripts: s.multiScripts.map((m) => ({ ...m })),
    selectedMultiScriptIndices: new Set(s.selectedMultiScriptIndices),
    multiVoNarrations: s.multiVoNarrations.map((items) => items.map((v) => ({ ...v }))),
    sceneAudioFilenames: [...s.sceneAudioFilenames],
  }
}

function takeContentSnapshot(s: AppState): ContentSnapshot {
  return cloneContentSnapshot({
    ideaInput: s.ideaInput,
    ideaNiche: s.ideaNiche,
    ideaContentType: s.ideaContentType,
    generatedIdeas: s.generatedIdeas,
    selectedIdeaIds: s.selectedIdeaIds,
    approvedIdeas: s.approvedIdeas,
    activeApprovedIdeaIndex: s.activeApprovedIdeaIndex,
    scriptInput: s.scriptInput,
    generatedScript: s.generatedScript,
    voNarrations: s.voNarrations,
    multiScripts: s.multiScripts,
    selectedMultiScriptIndices: s.selectedMultiScriptIndices,
    multiVoNarrations: s.multiVoNarrations,
    generatedAudioFilename: s.generatedAudioFilename,
    sceneAudioFilenames: s.sceneAudioFilenames,
    audioStaleReason: s.audioStaleReason,
    selectedStoryId: s.selectedStoryId,
    selectedStoryTitle: s.selectedStoryTitle,
    activeStep: s.activeStep,
  })
}

function pushContentUndo(s: AppState): Pick<AppState, 'contentUndoStack' | 'contentRedoStack'> {
  return {
    contentUndoStack: [...s.contentUndoStack, takeContentSnapshot(s)].slice(-CONTENT_HISTORY_LIMIT),
    contentRedoStack: [],
  }
}

function clearAfterIdea() {
  return {
    approvedIdeas: [],
    activeApprovedIdeaIndex: 0,
    scriptInput: '',
    generatedScript: '',
    voNarrations: [],
    multiScripts: [],
    selectedMultiScriptIndices: new Set<number>(),
    multiVoNarrations: [],
    generatedAudioFilename: '',
    sceneAudioFilenames: [],
    audioStaleReason: '',
    selectedStoryId: '',
    selectedStoryTitle: '',
  }
}

function clearAfterScript() {
  return {
    voNarrations: [],
    multiVoNarrations: [],
    generatedAudioFilename: '',
    sceneAudioFilenames: [],
    audioStaleReason: '',
    selectedStoryId: '',
    selectedStoryTitle: '',
  }
}

function clearAfterPrompts() {
  return {
    selectedStoryId: '',
    selectedStoryTitle: '',
  }
}

function audioStalePatch(s: AppState, reason: string) {
  return {
    audioStaleReason: s.sceneAudioFilenames.some(Boolean) ? reason : '',
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
  activeView: 'pipeline',
  setupStage: 'idle',
  setupDetail: '',
  setSetupProgress: (setupStage, setupDetail) => set({ setupStage, setupDetail }),
  bridgeReady: false,
  setBridgeReady: (bridgeReady) => set({ bridgeReady }),
  apiKeysConfigured: { deepseek: false, elevenlabs: false },
  setApiKeysConfigured: (apiKeysConfigured) => set({ apiKeysConfigured }),
  isAuthorized: false,
  updateAvailable: false,
  updateVersion: '',
  setUpdateReady: (version) => set({ updateAvailable: true, updateVersion: version }),
  dismissUpdate: () => set({ updateAvailable: false }),
  settings: {
    mode: 'Video',
    sub_type: 'Frames',
    aspect_ratio: '9:16',
    clip_count: 'x4',
    duration: '8s',
    model: 'Veo 3.1 - Fast',
  },
  runState: 'idle',
  pipelineRunning: false,
  activeStep: 1,
  currentScene: 0,
  totalScenes: 0,
  statusText: 'System Standby',
  logLines: [],
  pipelineStages: buildDefaultStages(computeAverages()),

  ideaInput: '',
  ideaNiche: '',
  ideaContentType: '',
  generatedIdeas: [],
  selectedIdeaIds: new Set(),
  approvedIdeas: [],
  activeApprovedIdeaIndex: 0,
  scriptInput: '',
  generatedScript: '',
  voNarrations: [],
  multiScripts: [],
  selectedMultiScriptIndices: new Set(),
  multiVoNarrations: [],
  elevenlabsVoices: [],
  selectedVoiceId: '',
  generatedAudioFilename: '',
  sceneAudioFilenames: [],
  audioStaleReason: '',
  selectedStoryId: '',
  selectedStoryTitle: '',
  contentUndoStack: [],
  contentRedoStack: [],

  setActiveView: (activeView) => set({ activeView }),
  setIsAuthorized: (isAuthorized) => set({ isAuthorized }),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setRunState: (runState) => set({ runState, pipelineRunning: runState === 'running' }),
  setActiveStep: (activeStep) => set({ activeStep }),
  setCurrentScene: (currentScene) => set({ currentScene }),
  setTotalScenes: (totalScenes) => set({ totalScenes }),
  setStatusText: (statusText) => set({ statusText }),
  appendLog: (line) =>
    set((st) => ({ logLines: [...st.logLines, { ...line, id: ++_logId }] })),
  clearLogs: () => set({ logLines: [] }),

  setIdeaInput: (ideaInput) => set({ ideaInput }),
  setIdeaNiche: (ideaNiche) => set({ ideaNiche }),
  setIdeaContentType: (ideaContentType) => set({ ideaContentType }),
  setGeneratedIdeas: (generatedIdeas) => set((st) => ({
    ...pushContentUndo(st),
    ...clearAfterIdea(),
    generatedIdeas,
    selectedIdeaIds: new Set(),
  })),
  toggleIdeaSelected: (index) => set((st) => {
    const next = new Set(st.selectedIdeaIds)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return { selectedIdeaIds: next }
  }),
  clearSelectedIdeas: () => set({ selectedIdeaIds: new Set() }),
  setApprovedIdeas: (approvedIdeas) => set((st) => ({
    ...pushContentUndo(st),
    ...clearAfterIdea(),
    generatedIdeas: st.generatedIdeas,
    selectedIdeaIds: st.selectedIdeaIds,
    approvedIdeas,
  })),
  setActiveApprovedIdeaIndex: (activeApprovedIdeaIndex) => set({ activeApprovedIdeaIndex }),
  setScriptInput: (scriptInput) => set({ scriptInput }),
  setGeneratedScript: (generatedScript) => set((st) => ({
    generatedScript,
    ...(generatedScript !== st.generatedScript ? clearAfterScript() : {}),
  })),
  setVoNarrations: (voNarrations) => set((st) => ({
    ...clearAfterPrompts(),
    ...audioStalePatch(st, 'Narration or VEO prompts changed. Regenerate voiceovers.'),
    voNarrations,
    multiVoNarrations: st.multiVoNarrations,
  })),
  setMultiScripts: (multiScripts) => set((st) => ({
    ...clearAfterScript(),
    multiScripts,
    multiVoNarrations: multiScripts.map(() => []),
    selectedMultiScriptIndices: new Set(),
  })),
  toggleMultiScriptSelected: (index) => set((st) => {
    const next = new Set(st.selectedMultiScriptIndices)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return { selectedMultiScriptIndices: next }
  }),
  setMultiVoNarrationsForIndex: (index, items) =>
    set((st) => {
      const next = [...st.multiVoNarrations]
      next[index] = items
      return {
        ...clearAfterPrompts(),
        ...audioStalePatch(st, 'Narration or VEO prompts changed. Regenerate voiceovers.'),
        multiVoNarrations: next,
      }
    }),
  updateMultiVoNarrationItem: (scriptIdx, itemIdx, patch) =>
    set((st) => {
      const next = st.multiVoNarrations.map((arr, si) =>
        si === scriptIdx ? arr.map((item, ii) => (ii === itemIdx ? { ...item, ...patch } : item)) : arr
      )
      return {
        ...clearAfterPrompts(),
        ...audioStalePatch(st, 'Narration or VEO prompts changed. Regenerate voiceovers.'),
        multiVoNarrations: next,
      }
    }),
  setElevenLabsVoices: (elevenlabsVoices) => set({ elevenlabsVoices }),
  setSelectedVoiceId: (selectedVoiceId) => set({ selectedVoiceId }),
  setGeneratedAudioFilename: (generatedAudioFilename) => set({ generatedAudioFilename, audioStaleReason: '' }),
  setSceneAudioFilenames: (sceneAudioFilenames) => set({ sceneAudioFilenames, audioStaleReason: '' }),
  updateSceneAudioFilename: (index, filename) =>
    set((st) => {
      const updated = [...st.sceneAudioFilenames]
      while (updated.length <= index) updated.push('')
      updated[index] = filename
      return { sceneAudioFilenames: updated, audioStaleReason: '' }
    }),
  clearAudioStale: () => set({ audioStaleReason: '' }),
  setSelectedStoryId: (selectedStoryId) => set({ selectedStoryId }),
  setSelectedStoryTitle: (selectedStoryTitle) => set({ selectedStoryTitle }),
  updateVoNarrationItem: (index, patch) =>
    set((st) => ({
      ...clearAfterPrompts(),
      ...audioStalePatch(st, 'Narration or VEO prompts changed. Regenerate voiceovers.'),
      voNarrations: st.voNarrations.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    })),
  checkpointContentCreation: () =>
    set((st) => pushContentUndo(st)),
  undoContentCreation: () =>
    set((st) => {
      const previous = st.contentUndoStack.at(-1)
      if (!previous) return {}
      return {
        ...cloneContentSnapshot(previous),
        contentUndoStack: st.contentUndoStack.slice(0, -1),
        contentRedoStack: [...st.contentRedoStack, takeContentSnapshot(st)].slice(-CONTENT_HISTORY_LIMIT),
      }
    }),
  redoContentCreation: () =>
    set((st) => {
      const next = st.contentRedoStack.at(-1)
      if (!next) return {}
      return {
        ...cloneContentSnapshot(next),
        contentUndoStack: [...st.contentUndoStack, takeContentSnapshot(st)].slice(-CONTENT_HISTORY_LIMIT),
        contentRedoStack: st.contentRedoStack.slice(0, -1),
      }
    }),
  resetContentCreation: () =>
    set((st) => ({
      ...pushContentUndo(st),
      ideaInput: '',
      ideaNiche: '',
      ideaContentType: '',
      generatedIdeas: [],
      selectedIdeaIds: new Set(),
      approvedIdeas: [],
      activeApprovedIdeaIndex: 0,
      scriptInput: '',
      generatedScript: '',
      voNarrations: [],
      multiScripts: [],
      selectedMultiScriptIndices: new Set(),
      multiVoNarrations: [],
      generatedAudioFilename: '',
      sceneAudioFilenames: [],
      audioStaleReason: '',
      selectedStoryId: '',
      selectedStoryTitle: '',
      activeStep: 2,
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
    }),
    {
      name: 'animal-channel-studio-state',
      storage: createJSONStorage(() => localStorage),
      // Only persist user-facing state — skip runtime/transient fields
      partialize: (state) => ({
        activeStep: state.activeStep,
        settings: state.settings,
        ideaInput: state.ideaInput,
        ideaNiche: state.ideaNiche,
        ideaContentType: state.ideaContentType,
        generatedIdeas: state.generatedIdeas,
        // Serialize Set as array
        selectedIdeaIds: Array.from(state.selectedIdeaIds),
        approvedIdeas: state.approvedIdeas,
        activeApprovedIdeaIndex: state.activeApprovedIdeaIndex,
        scriptInput: state.scriptInput,
        generatedScript: state.generatedScript,
        voNarrations: state.voNarrations,
        multiScripts: state.multiScripts,
        selectedMultiScriptIndices: Array.from(state.selectedMultiScriptIndices),
        multiVoNarrations: state.multiVoNarrations,
        selectedVoiceId: state.selectedVoiceId,
        generatedAudioFilename: state.generatedAudioFilename,
        sceneAudioFilenames: state.sceneAudioFilenames,
        audioStaleReason: state.audioStaleReason,
        selectedStoryId: state.selectedStoryId,
        selectedStoryTitle: state.selectedStoryTitle,
      }),
      // Deserialize array back to Set
      merge: (persisted: unknown, current) => {
        const p = persisted as Partial<AppState> & { selectedIdeaIds?: number[]; selectedMultiScriptIndices?: number[] }
        return {
          ...current,
          ...p,
          selectedIdeaIds: new Set<number>(p.selectedIdeaIds ?? []),
          selectedMultiScriptIndices: new Set<number>(p.selectedMultiScriptIndices ?? []),
        }
      },
    }
  )
)
