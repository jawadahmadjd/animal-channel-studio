# UI Migration Plan — Animal Channel Creator Studio
**Electron + React frontend over existing Python backend**

> **Scope:** UI layer only. No changes to `run_pipeline.py`, `flow_automation.py`,
> `generate_story.py`, `read_ideas.py`, `write_stories.py`, `finalize_outputs.py`,
> `validate_story.py`, or any state/data files. The Python scripts run exactly as
> they do today.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                  Electron Shell                       │
│  ┌────────────────────────────────────────────────┐  │
│  │         React App  (Renderer Process)          │  │
│  │   • All UI components                          │  │
│  │   • Fetches data via localhost HTTP            │  │
│  │   • Streams logs via Server-Sent Events (SSE)  │  │
│  └────────────────────────┬───────────────────────┘  │
│                           │ localhost:7477             │
│  ┌────────────────────────▼───────────────────────┐  │
│  │         FastAPI Bridge  (Main Process)         │  │
│  │   • Spawns & manages Python subprocesses       │  │
│  │   • Streams subprocess stdout → SSE            │  │
│  │   • Reads Ideas.md, state/*.json               │  │
│  │   • Wraps ALL existing Python scripts as-is    │  │
│  └────────────────────────────────────────────────┘  │
│                           │ subprocess                 │
│  ┌────────────────────────▼───────────────────────┐  │
│  │   Existing Python Scripts (UNTOUCHED)          │  │
│  │   run_pipeline.py · flow_automation.py · etc.  │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Key principle:** The FastAPI bridge is a thin wrapper. It only:
- Spawns subprocesses using the same commands `ui_runner.py` uses today
- Pipes stdout/stderr back to the frontend via SSE
- Reads/writes the same JSON state files the scripts already use

No business logic moves into the bridge.

---

## 2. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Desktop shell | **Electron 30+** | Cross-platform, ships a Chromium renderer |
| Frontend framework | **React 18 + TypeScript** | Component model, strong ecosystem |
| Styling | **Tailwind CSS v4** | Utility-first, easy dark mode, no fighting CSS |
| UI component library | **shadcn/ui** | Headless, Tailwind-native, no bloat |
| Icons | **Lucide React** | Lightweight, consistent SVG icons |
| State management | **Zustand** | Minimal, no boilerplate |
| Python bridge server | **FastAPI + Uvicorn** | Async, SSE built-in, starts in <1s |
| Build tool | **Vite** | Fast HMR, works perfectly in Electron renderer |
| Packaging | **electron-builder** | Creates Windows installer (.exe / NSIS) |

---

## 3. New File Structure

Only new files are created. Existing `scripts/` directory is untouched.

```
d:\Youtube\5- Animal Channel\
│
├── scripts/                  ← UNTOUCHED (all Python automation)
├── state/                    ← UNTOUCHED (runtime state)
├── output/                   ← UNTOUCHED
├── logs/                     ← UNTOUCHED
├── Ideas.md                  ← UNTOUCHED
│
├── bridge/                   ← NEW: thin Python HTTP server
│   ├── server.py             ← FastAPI app (~120 lines)
│   └── requirements.txt      ← fastapi, uvicorn (added to main reqs too)
│
└── ui/                       ← NEW: Electron + React app
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── electron/
    │   ├── main.ts           ← Electron main process (starts bridge, opens window)
    │   └── preload.ts        ← Context bridge (ipcRenderer expose)
    └── src/
        ├── main.tsx          ← React entry point
        ├── App.tsx           ← Root layout + router
        ├── store/
        │   └── useStore.ts   ← Zustand global state
        ├── api/
        │   └── client.ts     ← fetch() wrappers + SSE hook
        ├── components/
        │   ├── layout/
        │   │   ├── Sidebar.tsx
        │   │   ├── Header.tsx
        │   │   └── TitleBar.tsx   ← Custom frameless title bar
        │   ├── pipeline/
        │   │   ├── StepCard.tsx
        │   │   ├── LoginStep.tsx
        │   │   ├── PickStoryStep.tsx
        │   │   ├── SettingsStep.tsx
        │   │   ├── StartStep.tsx
        │   │   └── AdvancedOptions.tsx
        │   ├── monitor/
        │   │   ├── VideoPreview.tsx
        │   │   ├── PipelineActivity.tsx
        │   │   └── LiveLog.tsx
        │   └── shared/
        │       ├── StatusBadge.tsx
        │       ├── ProgressStepper.tsx
        │       └── ModelEngineCard.tsx
        └── views/
            ├── PipelineView.tsx
            └── LogsView.tsx
```

---

## 4. FastAPI Bridge — Endpoints

File: `bridge/server.py`

These endpoints map 1-to-1 with the actions in the current `ui_runner.py`.
No new logic — just subprocess spawning + file reads.

| Method | Path | Action |
|---|---|---|
| `GET` | `/ideas` | Read `Ideas.md`, return parsed list |
| `GET` | `/auth/status` | Check if `state/flow_auth.json` exists |
| `DELETE` | `/auth` | Delete `state/flow_auth.json` (reset login) |
| `GET` | `/settings` | Read `state/flow_settings.json` |
| `POST` | `/settings` | Write `state/flow_settings.json` |
| `POST` | `/run/login` | Spawn `flow_automation.py --mode login`, stream logs |
| `POST` | `/run/pipeline` | Spawn `run_pipeline.py` with full args, stream logs |
| `POST` | `/run/resume` | Spawn `run_pipeline.py --resume <id>`, stream logs |
| `POST` | `/run/single-scene` | Spawn `run_pipeline.py --only-scene <n>`, stream logs |
| `POST` | `/run/finalize` | Spawn `finalize_outputs.py --story-id <id>`, stream logs |
| `POST` | `/run/fresh-start` | Delete `state/runs/<id>.json` (no subprocess needed) |
| `POST` | `/run/stop` | Send SIGTERM to active subprocess |
| `GET` | `/run/stream` | SSE endpoint — streams live stdout of active process |

All `/run/*` POST endpoints immediately return `{"status": "started"}`.
The client connects to `/run/stream` separately to receive log lines as SSE events.

---

## 5. Screen Layouts

### 5.1 App Shell

```
┌─────────────────────────────────────────────────────────────┐
│  [●][─][□]   Animal Channel — Creator Studio          [─][□][✕] │  ← Custom frameless title bar (32px)
├──────────────┬──────────────────────────────────────────────┤
│   Sidebar    │   Content Area (view-dependent)              │
│   (220px)    │                                              │
│              │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

**Window:** 1280×950, min 1100×800, frameless with custom title bar.
Dark title bar matching the sidebar color (`#0f172a`).

---

### 5.2 Sidebar

```
┌────────────────────┐
│  🦁 Animal Channel │  ← Logo + name (bold, primary green)
│  ─────────────────  │
│  Creator Studio    │  ← Badge card
│  V1.2.4  ● Active │
│  ─────────────────  │
│  ▶ Pipeline        │  ← Nav item (active = white bg, primary fg)
│    Status Logs     │  ← Nav item (inactive = muted)
│                    │
│  ─────────────────  │
│  ● AUTHORIZED      │  ← Live auth badge (green/red, polls /auth/status)
│  ─────────────────  │
│                    │
│  [+  New Video   ] │  ← CTA button (dark bg, full width, bottom)
└────────────────────┘
```

**Behavior:**
- Auth badge polls `/auth/status` every 4 seconds and updates color + text live
- Clicking "Pipeline" or "Status Logs" switches the content view (was broken before)
- "+ New Video" scrolls the Pipeline view back to the top (phase 2 feature)

---

### 5.3 Pipeline View (main view)

Two-column layout. Left column is scrollable.

```
Header: "Video Pipeline"                    [■ Stop]  [▶ Generate All Videos]
─────────────────────────────────────────────────────────────────────────────
LEFT COLUMN (scrollable)           │  RIGHT COLUMN (fixed 440px)
                                   │
┌─ Progress Stepper ──────────────┐│  ┌─ Video Preview ──────────────────┐
│  ●1 ──── ○2 ──── ○3 ──── ○4   ││  │  [         video.mp4          ]  │
│  Phase: Initialization           ││  │  ► play / pause  00:00 / 00:08   │
└──────────────────────────────────┘│  │  ▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░  │
                                   │  │  ● LIVE BUFFER    Scene 3 / 12   │
┌─ 1. Log in to Google Flow ──────┐│  │  Scene: The Hunt Begins          │
│  [Connect]  ✓ AUTHORIZED  [Reset]││  └──────────────────────────────────┘
└──────────────────────────────────┘│
                                   │  ┌─ Pipeline Activity ──────────────┐
┌─ 2. Pick a Story ───────────────┐│  │  ✓ Script Analysis Complete      │
│  [▼ Dropdown — idea titles    ] ││  │    The AI parsed 12 scenes  2m   │
│  [Resume Progress] [Fresh Start] ││  │  ✓ Asset Pool Initialized        │
│  [Finalize Story ]               ││  │    Connected to Flow     5m ago  │
└──────────────────────────────────┘│  └──────────────────────────────────┘
                                   │
┌─ 3. Configure Clip Generation ──┐│  ┌─ LIVE_OUTPUT.SH ─────── [Clear] ┐
│  MODE:  [Cinematic] [Realistic]  ││  │> ===== Generate All Videos ===  │
│                                  ││  │> Scene 3/12: The Hunt Begins    │
│  ASPECT RATIO      MODEL ENGINE  ││  │> Submitting prompt to Flow...   │
│  [▼ 9:16       ]   [▼ Veo 3.1 ] ││  │> Waiting for generation (45s).. │
│                                  ││  │> ✓ Clip downloaded: scene_03_1  │
│  CLIPS PER SCENE   DURATION      ││  │                                  │
│  ──●──────────  4  ──────●───  8s││  │                                  │
│                                  ││  └──────────────────────────────────┘
│  [      Save Parameters       ]  ││
└──────────────────────────────────┘│
                                   │
┌─ 4. Start Pipeline ─────────────┐│
│  [🚀  Start Pipeline           ]││
│  ● System Standby               ││
└──────────────────────────────────┘│
                                   │
▸ Advanced Options                 │
```

---

### 5.4 Status Logs View (was missing before)

Full-width log viewer — this view is currently completely absent.

```
Header: "Status Logs"                              [Open logs/ folder]  [Clear All]
─────────────────────────────────────────────────────────────────────────────────
[All ▼]  [search logs...              ]          Showing 247 lines

┌──────────────────────────────────────────────────────────────────────────────┐
│ TIMESTAMP       LEVEL    MESSAGE                                              │
│─────────────────────────────────────────────────────────────────────────────│
│ 14:32:01.204    INFO  ▶  ===== Generate All Videos =====                     │
│ 14:32:01.891    INFO     Scene 1/12: Opening Savanna at Dawn                │
│ 14:32:12.033    INFO     Submitting prompt to Flow...                        │
│ 14:32:57.441    OK    ✓  Clip downloaded: scene_01_clip_1.mp4               │
│ 14:33:01.002    WARN  ⚠  Retrying scene 2 (attempt 1/2)                    │
│ 14:35:22.881    ERROR ✕  Timeout waiting for video — scene 4                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Level filter pills: [All] [INFO] [OK] [WARN] [ERROR]
```

**Data source:** Reads `logs/pipeline.log` and `logs/flow.log` on mount,
then subscribes to live SSE stream while a pipeline is running.

---

## 6. Component Specifications

### ProgressStepper
- 4 steps: Login → Pick Story → Configure → Generate
- Step state: `idle | active | complete | error`
- Active step = filled green circle with step number
- Complete step = filled green circle with ✓ icon
- Error step = red circle with ✕
- Connecting lines turn green as steps complete
- Updates via Zustand store that maps to pipeline stdout events (e.g. when
  log contains "Scene 1/12" the stepper advances to step 4)

### VideoPreview
- Uses HTML `<video>` element — actual video playback, not a fake black box
- Watches `output/<story-title>/` folder for new `.mp4` files
- Auto-loads most recently downloaded clip
- Shows scene counter "Scene 3 / 12" from pipeline state
- Falls back to a placeholder when no clip exists yet

### LiveLog
- Uses `EventSource` (SSE) to subscribe to `/run/stream`
- Color tags: errors = red, success = green, info = blue, headers = bold white
- Auto-scrolls to bottom, with a "scroll lock" button to pause auto-scroll
- Virtualized list (react-virtuoso) so 10,000+ lines don't freeze the UI
- Clear button wipes the in-memory buffer only (does not delete log files)

### PipelineActivity
- Reads from Zustand store, populated by parsing SSE log lines
- Each line that matches known patterns (scene complete, download, error) gets
  added as an activity card with a relative timestamp
- Not hardcoded strings — actual live events

### ModelEngineCard (Settings step)
- Two clickable cards: one per model tier (Fast / Quality)
- Clicking a card updates `model` in settings state
- Selected card gets a green border + checkmark
- Maps to `Veo 3.1 - Fast` and `Veo 3.1 - Quality` in the backend

### AdvancedOptions (accordion)
- Uses shadcn `<Collapsible>` — proper animated expand/collapse
- Same fields as today: wait, retries, timeout, single scene, dry run, headless
- Validates numeric fields before allowing pipeline start

---

## 7. State Shape (Zustand)

```typescript
interface AppState {
  // Navigation
  activeView: 'pipeline' | 'logs';

  // Auth
  isAuthorized: boolean;

  // Ideas
  ideas: { index: number; title: string; storyId: string }[];
  selectedIdeaIndex: number;

  // Settings (mirrors flow_settings.json)
  settings: {
    mode: 'Cinematic' | 'Realistic';
    aspectRatio: string;
    clipCount: number;
    duration: number;
    model: string;
  };

  // Pipeline run state
  runState: 'idle' | 'running' | 'stopped' | 'complete' | 'error';
  activeStep: 1 | 2 | 3 | 4;
  currentScene: number;
  totalScenes: number;
  statusText: string;

  // Log buffer (in-memory, cleared on app restart)
  logLines: LogLine[];

  // Activity feed
  activityItems: ActivityItem[];
}
```

---

## 8. Color Palette (preserved from current design)

The existing "Stitch Verdant Glass" palette is kept. Tailwind CSS variables:

```css
/* globals.css */
:root {
  --bg:       #f8faf8;
  --card:     #ffffff;
  --border:   #c2c8c3;
  --dark:     #172c24;
  --primary:  #2d4239;
  --success:  #16a34a;
  --danger:   #dc2626;
  --warn:     #b45309;
  --slate:    #424845;
  --text:     #191c1b;
  --muted:    #727874;
  --accent:   #4d6359;
  --glass-bg: #f2f4f2;
  --log-bg:   #0f172a;
  --log-fg:   #e2e8f0;
}
```

Typography: Inter (primary), Cascadia Code (monospace log panel).

---

## 9. Fixes Included (from audit)

Every broken item found in the current Tkinter UI is fixed as part of this migration:

| # | Issue | Fix |
|---|---|---|
| 1 | Mouse wheel scroll broken (`self._canvas` missing) | React scroll containers handle this natively |
| 2 | Three orphaned methods (dead code) | Not ported |
| 3 | `resume_var` has no input field; resume/download/rename unreachable | Resume is auto-derived from selected idea; shown as subtle text under dropdown |
| 4 | Model selection has no UI control | `ModelEngineCard` + combobox for full model list |
| 5 | Sidebar nav does nothing | React Router switches between `PipelineView` and `LogsView` |
| 6 | "+ New Video" is a no-op | Scrolls to top of pipeline / resets form |
| 7 | Stepper is always static at step 1 | `ProgressStepper` driven by `runState` in Zustand |
| 8 | Video preview is a fake black box | Real `<video>` element with actual clip playback |
| 9 | Progress bar is a fixed-width Frame | CSS `width` driven by `(currentScene / totalScenes) * 100%` |
| 10 | Pipeline Activity is hardcoded | Populated by parsing live SSE log lines |
| 11 | Tooltip misplaces on buttons | shadcn `<Tooltip>` uses Radix UI positioning |
| 12 | Status Logs view missing entirely | New `LogsView` with filter + search |

---

## 10. Implementation Phases

### Phase 1 — Bridge Server (1 day)
- [x] Create `bridge/server.py` with all endpoints listed in §4
- [x] Add `fastapi` and `uvicorn` to `requirements.txt`
- [ ] Test each endpoint from the command line (no UI yet)
- [ ] Verify SSE streaming works for a full pipeline run

### Phase 2 — Electron Shell (0.5 day)
- [x] Scaffold `ui/` with Vite + React + TypeScript + Tailwind + shadcn
- [x] Write `electron/main.ts`: starts bridge server on port 7477, opens BrowserWindow
- [x] Write `electron/preload.ts`: expose minimal IPC (app version, open folder)
- [x] Confirm the bridge starts automatically when Electron launches
- [x] Frameless window + custom `TitleBar.tsx` with drag region

### Phase 3 — Layout & Navigation (0.5 day)
- [x] `App.tsx` with sidebar + content area layout
- [x] `Sidebar.tsx`: brand, nav items, auth badge (polling `/auth/status`), CTA button
- [x] `Header.tsx`: title + Stop / Generate All buttons
- [x] `useStore.ts` (Zustand) + `client.ts` (API + SSE)
- [x] Routing: `PipelineView` ↔ `LogsView` on nav click

### Phase 4 — Pipeline Steps (1.5 days)
- [x] `StepCard.tsx`: reusable wrapper (title, subtitle, card border)
- [x] `LoginStep.tsx`: Connect + Reset buttons, wired to `/run/login` and `DELETE /auth`
- [x] `PickStoryStep.tsx`: dropdown populated from `/ideas`, Resume / Fresh Start / Finalize buttons
- [x] `SettingsStep.tsx`: mode toggle, aspect ratio select, clip/duration sliders, `ModelEngineCard` pair, model dropdown, Save button wired to `POST /settings`
- [x] `StartStep.tsx`: Start Pipeline button wired to `POST /run/pipeline`, status label
- [x] `AdvancedOptions.tsx`: collapsible panel with all advanced fields
- [x] `ProgressStepper.tsx`: driven by `runState` in Zustand

### Phase 5 — Monitor Panel (1 day)
- [x] `LiveLog.tsx`: SSE subscription, color tagging, virtualized list, auto-scroll + lock
- [x] `VideoPreview.tsx`: HTML `<video>` element, progress bar driven by scene counter
- [x] `PipelineActivity.tsx`: parses SSE lines into activity cards with timestamps
- [x] Live progress bar: `(currentScene / totalScenes) * 100%` width

### Phase 6 — Status Logs View (0.5 day)
- [x] `LogsView.tsx`: reads `logs/pipeline.log` + `logs/flow.log`
- [x] Level filter pills (All / INFO / OK / WARN / ERROR)
- [x] Search bar (client-side filter, no debounce needed for <10k lines)
- [x] "Open logs/ folder" button using Electron shell.openPath

### Phase 7 — Polish & Packaging (0.5 day)
- [x] Electron Builder config for Windows `.exe` (NSIS installer) — in `package.json`
- [ ] App icon (reuse or create a simple animal channel icon)
- [ ] Verify all Python scripts are invoked with correct paths relative to app resources folder
- [ ] Test cold start, pipeline run, stop, resume end-to-end

**Total estimated effort: ~6 working days**

---

## 11. What is NOT Changing

This is an explicit "do not touch" list:

- `scripts/run_pipeline.py`
- `scripts/flow_automation.py`
- `scripts/generate_story.py`
- `scripts/read_ideas.py`
- `scripts/write_stories.py`
- `scripts/finalize_outputs.py`
- `scripts/validate_story.py`
- `state/*.json` — same files, same format
- `Ideas.md`, `Stories.md`, `Master_Prompts.md`
- `.env` / `.env.example`
- `output/`, `downloads/`, `logs/` — same folder structure

The bridge server reads these files and invokes these scripts. It does not
replicate, replace, or wrap their internal logic.

---

## 12. Keeping Tkinter During Migration

`scripts/ui_runner.py` can coexist and remain the fallback while the Electron UI
is being built. Run either:

```bash
# Old Tkinter UI (still works)
python scripts/ui_runner.py

# New bridge server (for development)
uvicorn bridge.server:app --port 7477 --reload

# New Electron UI
cd ui && npm run dev
```

Delete `scripts/ui_runner.py` only after the Electron app is fully tested.
