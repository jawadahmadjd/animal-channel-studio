# Animal Channel Studio — Production Shipping TODO

---

## For Any AI Reading This File

This is the authoritative task list for shipping **Animal Channel Studio** to paying customers.
When a user asks you to "work on the TODO" or "continue where we left off", start here.
Do not ask for project context — it is all below. Read this entire preamble before touching any code.

**How to use this file:**
- Each section has a context block (indented quote) explaining what exists, why the work is needed, and which files are involved.
- Each task has enough detail to implement it without asking follow-up questions.
- Check off items (`[x]`) as you complete them. Update the Progress Tracker at the bottom.
- Work tasks in priority order: Critical → Auto-Update → High → Medium → Low → Packaging.
- Never skip ahead to polish items while Critical items are open.

---

## Project Overview

**What this tool does:**
Animal Channel Studio is a Windows desktop app that automates the creation of short-form YouTube animal documentary videos. The user provides a video idea (e.g. "Lion vs Hyena Ambush"), and the app:
1. Uses the **DeepSeek LLM API** to generate a 10–12 scene story with voiceover lines and cinematic video prompts per scene
2. Uses **Playwright browser automation** to log into Google Flow (VEO 3 AI video generator), submit each scene's prompt, wait for generation, and download the resulting video clips
3. Uses **ElevenLabs TTS API** to generate narration audio from the voiceover lines
4. Organizes everything into a named output folder ready for video editing

**Who the customer is:**
YouTube content creators who want to produce animal documentary videos at scale without manually prompting AI tools. They are non-technical — they should never need to edit config files, run terminal commands, or understand Python.

**Tech stack:**

| Layer | Technology | Location |
|---|---|---|
| Desktop shell | Electron 34 + electron-builder | `ui/` |
| Frontend UI | React 18 + TypeScript + Tailwind CSS | `ui/src/` |
| State management | Zustand | `ui/src/store/useStore.ts` |
| HTTP bridge | FastAPI + Uvicorn (Python) | `bridge/server.py` |
| Automation | Playwright (Python) | `scripts/flow_automation.py` |
| LLM generation | DeepSeek API via `requests` | `scripts/generate_story.py` |
| TTS generation | ElevenLabs API | called from `bridge/server.py` |
| Pipeline orchestrator | Python script | `scripts/run_pipeline.py` |

**How the layers connect:**
Electron launches a hidden FastAPI bridge server on `localhost:8765` as a child process.
The React UI makes HTTP + SSE requests to this bridge.
The bridge spawns Python subprocess commands and streams their stdout back to the UI via Server-Sent Events (SSE).
The Python scripts write output to `state/`, `output/`, `logs/`, and `downloads/` folders relative to the project root.

**Key data files (runtime state — not source code):**

| File | Purpose |
|---|---|
| `state/flow_auth.json` | Saved Playwright browser session (cookies) for Google Flow login |
| `state/flow_settings.json` | Generation defaults (aspect ratio, model, clip count) |
| `state/app_settings.json` | User-configured settings: API keys, output path, scene count, etc. (TO BE CREATED — see C3) |
| `state/processed_ideas.json` | Tracks which ideas have already been processed |
| `state/runs/<story_id>.json` | Per-story run state for resume support |
| `Ideas.md` | User's list of video ideas (input) |
| `Stories.md` | Generated scene scripts (output, append-only) |
| `output/<Story Title>/` | Final downloaded video clips per story |
| `logs/pipeline.log` | JSONL structured log of pipeline execution |
| `logs/errors.log` | JSONL structured errors |

**Current build state (as of 2026-04-25):**
- Python pipeline scripts are ~95% complete and work in dev
- The Electron + React UI is built (~90% of components exist) but has never been packaged
- The FastAPI bridge exists but has path resolution bugs that only appear in packaged apps
- The Electron main process source (`electron/main.ts`) is missing — only the compiled `.js` exists in `dist-electron/`
- There is no Settings screen — customers would need to hand-edit `.env` to enter API keys (unacceptable)
- Auto-update is not wired up — customers would need to manually reinstall for every update
- Content creation steps 1–5 in the UI are built but not connected to each other or the pipeline

---

## Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- 🔴 Blocks shipping entirely
- 🟠 Degrades customer experience significantly
- 🟡 Feature is incomplete / misleading
- 🟢 Polish, nice-to-have

---

## 🔴 CRITICAL — Must Fix Before Shipping

> These items will cause the app to fail on a customer's machine or make it unusable.
> Do not move on to other sections until all Critical items are done.

---

### C1 — Electron Main Source

**Context:** The Electron main process is the Node.js entry point that creates the app window, spawns the Python bridge, and handles OS-level events. Currently only the compiled output (`ui/dist-electron/main.js`) exists — the TypeScript source (`ui/electron/main.ts`) is missing from the repo. Without the source, we cannot modify or rebuild the Electron layer, and `electron-builder` will fail. This needs to be written from scratch based on what the compiled JS does.

**The main process must:**
- Create a `BrowserWindow` (frameless, 1280×950, title bar overlay)
- Spawn `python bridge/server.py` (or `bridge.exe` in packaged mode) as a child process on a fixed port (8765)
- Expose IPC handlers: `dialog:openFolder` (for the folder picker in Settings), `app:getVersion`, `update:install`
- Wait for the bridge to be ready before loading the React app (poll `http://localhost:8765/health`)
- Kill the bridge child process when the app quits (otherwise Python keeps running in background)
- In packaged mode, resolve paths using `process.resourcesPath` not `__dirname`

- [x] Write `ui/electron/main.ts` (see requirements above)
- [x] Write `ui/electron/preload.ts` — exposes a safe `window.electron` API to React via `contextBridge`:
  - `window.electron.openFolder()` → IPC to `dialog:openFolder`
  - `window.electron.getVersion()` → IPC to `app:getVersion`
  - `window.electron.onUpdateReady(cb)` → listens for `"update-ready"` IPC event
  - `window.electron.installUpdate()` → IPC to `update:install`
- [x] Add `tsconfig.electron.json` if it doesn't exist (separate TS config for Node/Electron target)
- [ ] Confirm `npm run electron:build` compiles `ui/electron/` → `ui/dist-electron/` without errors
- [ ] Cold-launch test: build the `.exe`, install it, open it on a machine without the dev repo present

---

### C2 — Packaged App Path Resolution

**Context:** In development, `bridge/server.py` resolves the project root as `Path(__file__).resolve().parents[1]` — two directories up from the bridge file. This works in the dev repo layout. But when Electron packages the app, Python files are extracted to `%AppData%\Local\Programs\Animal Channel Studio\resources\bridge\` — so `parents[1]` no longer points to the project root; it points inside the resources bundle. Writable folders (`state/`, `output/`, `logs/`, `downloads/`) must live outside the ASAR archive in a user-writable location, typically `%AppData%\Animal Channel Studio\` or next to the `.exe`.

**Rule:** Read-only assets (scripts, bridge code) go inside the ASAR bundle. User data (state, output, logs) goes in `app.getPath('userData')` or a path the user configures.

- [x] In `bridge/server.py`, detect packaged vs dev mode: check if an env var like `ANIMAL_STUDIO_DATA_DIR` is set (Electron main sets this before spawning the bridge), otherwise fall back to `parents[1]`
- [x] In `electron/main.ts`, before spawning the bridge, set `ANIMAL_STUDIO_DATA_DIR` env var to `app.getPath('userData')` + `'/AnimalChannelStudio'`
- [x] Update all path references in `bridge/server.py` and Python scripts to use this data dir for `state/`, `output/`, `logs/`, `downloads/`
- [x] Add path resolution test: on startup, bridge logs all resolved absolute paths at INFO level so they appear in the debug log
- [x] Confirm that `state/`, `output/`, `logs/`, `downloads/` are auto-created on first run if they don't exist
- [ ] Test: install the packaged `.exe`, run a pipeline, verify files appear in the correct user-writable location

---

### C3 — Settings / Onboarding Screen (API Keys)

**Context:** Right now there is no way for a customer to enter their API keys inside the app. They would need to hand-edit a `.env` file in the install directory — completely unacceptable for non-technical users. We need a full Settings screen. There is also no first-launch experience — the app just shows the pipeline with no guidance.

**API keys needed:**
- `DEEPSEEK_API_KEY` — required for story/script generation (get from platform.deepseek.com)
- `ELEVENLABS_API_KEY` — required for voiceover audio (get from elevenlabs.io, has a free tier)

**Where to store settings:** `state/app_settings.json` (inside the user data dir — see C2). Never `.env` for customer installs. The bridge reads this file on startup and merges it with environment variables (env vars take precedence for dev use).

**`app_settings.json` schema to implement:**
```json
{
  "deepseek_api_key": "",
  "elevenlabs_api_key": "",
  "output_dir": "",
  "default_scene_count": 12,
  "flow_headless": false,
  "wait_between_scenes": 5,
  "max_retries_per_scene": 3
}
```

- [x] Create `ui/src/views/SettingsView.tsx` — a full-page settings form
- [x] Add "Settings" nav item to `ui/src/components/layout/Sidebar.tsx` (gear icon, below existing nav)
- [x] Field: DeepSeek API Key — `<input type="password">` + "Test Connection" button
- [x] Field: ElevenLabs API Key — `<input type="password">` + "Test Connection" button
- [x] Field: Output Folder — text input + "Browse" button (calls `window.electron.openFolder()` from preload)
- [x] Field: Default Scene Count — number input (1–20, default 12)
- [x] Field: Headless Browser — toggle (off = browser window visible during automation, on = invisible; leave off by default so users can see what's happening)
- [x] Field: Wait Between Scenes — slider (0–30 seconds, default 5; this paces Google Flow requests to avoid rate limiting)
- [x] Field: Max Retries Per Scene — number input (1–5, default 3)
- [x] "Save Settings" button → calls `POST /settings/app` on bridge
- [x] On save success, show a green "Saved" toast for 2 seconds
- [x] Add `GET /settings/app` endpoint in `bridge/server.py` — reads `app_settings.json`, returns it (redact key values: return `"***"` if set, `""` if not)
- [x] Add `POST /settings/app` endpoint in `bridge/server.py` — merges new values into `app_settings.json` (never overwrite a key with `"***"` — that means user didn't change it)
- [x] Add `POST /validate/deepseek` endpoint — makes a minimal DeepSeek API call (`/models` list or 1-token completion) and returns `{ ok: true }` or `{ ok: false, error: "..." }`
- [x] Add `POST /validate/elevenlabs` endpoint — calls ElevenLabs `/v1/voices` and returns `{ ok: true }` or `{ ok: false, error: "..." }`
- [x] **First-launch gate:** in `ui/src/App.tsx`, on mount call `GET /settings/app`. If both API keys are empty, redirect to SettingsView with a banner: "Welcome! Enter your API keys to get started."
- [ ] After keys are saved and validated, show a "You're all set — go to Pipeline" button

---

### C4 — Subprocess Timeout + Kill

**Context:** The bridge runs Python scripts as subprocesses and streams their stdout to the UI via SSE (`GET /run/stream`). Currently there is no timeout — if Google Flow hangs (the page freezes, a selector fails silently, or a video generation never completes), the subprocess runs forever. The Stop button calls `POST /run/stop` but this may not actually kill the full process tree on Windows (Python spawning Playwright spawning a Chromium browser = 3 levels deep). Customers will experience the UI as "frozen" with no recovery.

- [x] In `bridge/server.py`, add a `timeout_seconds` parameter to `_stream_process()` (default: 1800 = 30 min)
- [x] Use `threading.Timer` or async timeout to kill the process group after timeout
- [x] On Windows, killing a process group requires `os.kill(proc.pid, signal.CTRL_BREAK_EVENT)` or `psutil.Process(pid).kill()` recursively — use `psutil` (add to `bridge/requirements.txt`)
- [x] `POST /run/stop` must call `psutil.Process(pid).children(recursive=True)` and kill each child before killing the parent — this ensures Playwright's Chromium browser is also killed
- [x] On timeout, emit `data: {"type":"error","message":"Pipeline timed out after 30 minutes. Stopping."}\n\n` to the SSE stream before closing it
- [x] In `ui/src/components/layout/Header.tsx`, disable the "Start Pipeline" / "Generate" buttons while `useStore` state shows a run is active — set a `pipelineRunning` boolean in the store when SSE connects and clear it when SSE closes
- [x] Add a visible "Stop" button in the Header that is only enabled when `pipelineRunning` is true

---

### C5 — API Key Validation at Bridge Startup

**Context:** The bridge currently starts without checking whether API keys exist. This means a customer who skips the Settings screen will get a cryptic Python exception deep in a subprocess 2 minutes into a pipeline run. We need to catch this at the earliest possible moment.

- [x] On bridge startup (in the `lifespan` function or `startup` event), load `app_settings.json` and check if `deepseek_api_key` is set
- [x] Store key presence (not values) in a module-level dict: `_config_status = { "deepseek": bool, "elevenlabs": bool }`
- [x] `GET /auth/status` already exists — extend it to also return `{ "keys_configured": { "deepseek": true/false, "elevenlabs": true/false } }` so the UI can show onboarding prompts
- [x] The bridge should NOT crash if keys are missing — log a warning and continue (the Settings screen will handle it)

---

### C6 — App Icon

**Context:** `ui/package.json` references `"icon": "public/icon.ico"` for the Windows build target, but this file does not exist. Without it, `electron-builder` will throw an error, and even if it didn't, the installed app would show a generic Electron icon in the taskbar and Start Menu — unprofessional.

- [x] Create `ui/public/icon.ico` — multi-resolution Windows ICO file (at minimum: 16×16, 32×32, 48×48, 256×256 embedded). Can use an online ICO converter or ImageMagick.
- [x] Create `ui/public/icon.png` — 512×512 PNG version (used by electron-builder for non-Windows platforms and metadata)
- [ ] Verify `electron-builder` picks up the icon: after building, right-click the `.exe` → Properties → should show the custom icon

---

## 🔄 AUTO-UPDATE — Customers Never Reinstall

> **Why this matters:** Every time we fix a bug or add a feature, customers need the update.
> If they must download and reinstall manually, most won't bother — they'll use an outdated,
> possibly broken version forever. Auto-update means we can push fixes silently or with a single
> click in the running app.
>
> **How it works:** `electron-updater` (part of `electron-builder`) checks a GitHub Releases page
> on app launch. If a newer version tag exists, it downloads the new installer in the background.
> When ready, it shows an in-app banner. The user clicks "Restart & Install" — the app quits,
> the new version installs, and the app relaunches. No browser, no download page, no manual steps.
>
> **Release flow:** We push a git tag (e.g. `v1.3.0`) → GitHub Actions builds the `.exe` and
> publishes it as a GitHub Release → running apps detect it on next launch.

---

### U1 — Package Setup

**Context:** `electron-updater` is a separate npm package (despite being from the same authors as `electron-builder`). It must be a runtime dependency, not devDependency, because it runs inside the packaged app. `electron-log` is needed because `electron-updater` uses it for logging update events.

- [x] `cd ui && npm install electron-updater electron-log`
- [x] In `ui/package.json` under the `"build"` key, add a `"publish"` field:
  ```json
  "publish": {
    "provider": "github",
    "owner": "YOUR_GITHUB_USERNAME",
    "repo": "animal-channel-studio"
  }
  ```
  Replace `YOUR_GITHUB_USERNAME` with the actual GitHub account that will host releases.
- [ ] Create a GitHub repository named `animal-channel-studio` (can be private — electron-updater works with private repos if a token is provided)
- [ ] In GitHub repo settings → Secrets → add `GH_TOKEN` with a Personal Access Token that has `repo` scope (needed by GitHub Actions to publish releases)

---

### U2 — Electron Main Update Logic

**Context:** The auto-update check and install logic lives entirely in the Electron main process (Node.js side), not in React. The renderer (React) only needs to know when an update is downloaded so it can show the banner. Communication between main and renderer uses Electron IPC.

- [x] In `ui/electron/main.ts` (created in C1), add at the top:
  ```ts
  import { autoUpdater } from 'electron-updater'
  import log from 'electron-log'
  autoUpdater.logger = log
  ```
- [x] After the window is created and the app is ready, call `autoUpdater.checkForUpdatesAndNotify()` — this is silent if no update is available
- [x] Handle `autoUpdater.on('update-available', (info) => { ... })` — send IPC to renderer: `mainWindow.webContents.send('update-available', info.version)`
- [x] Handle `autoUpdater.on('update-downloaded', (info) => { ... })` — send IPC: `mainWindow.webContents.send('update-ready', info.version)`
- [x] Handle `autoUpdater.on('error', (err) => { log.error('Update error:', err) })` — log only, do not crash or alert the user for update errors
- [x] Add IPC handler: `ipcMain.on('install-update', () => { autoUpdater.quitAndInstall() })`
- [x] In dev mode (`!app.isPackaged`), skip the update check entirely — it only works for signed/published builds

---

### U3 — Update UI in React

**Context:** React needs to receive the IPC message from Electron main and show a non-intrusive banner. The banner should not be a blocking modal — it should appear at the top of the app and allow dismissal. The `window.electron` API is set up in `preload.ts` (C1).

- [x] In `ui/src/store/useStore.ts`, add to the state shape:
  ```ts
  updateAvailable: boolean
  updateVersion: string
  setUpdateReady: (version: string) => void
  ```
- [x] Create `ui/src/components/shared/UpdateBanner.tsx`:
  - Reads `updateAvailable` + `updateVersion` from the store
  - Renders a sticky banner at the top of the app when `updateAvailable` is true
  - Text: `"Version {updateVersion} is ready to install"`
  - "Restart & Install" button → calls `window.electron.installUpdate()`
  - "Later" button → sets `updateAvailable = false` in the store (dismisses for this session)
- [x] Mount `<UpdateBanner />` inside `ui/src/App.tsx` above the main layout, so it appears on all views
- [x] In `ui/src/main.tsx` or App mount, wire up the IPC listener:
  ```ts
  window.electron.onUpdateReady((version) => store.setUpdateReady(version))
  ```
- [x] In `ui/electron/preload.ts` (C1), expose:
  ```ts
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_, version) => cb(version)),
  installUpdate: () => ipcRenderer.send('install-update')
  ```

---

### U4 — Release Workflow (GitHub Actions)

**Context:** We need an automated CI/CD pipeline so that pushing a version tag automatically builds and publishes a new release. Without this, publishing a release requires running `electron-builder` locally with Windows signing certificates configured — fragile and manual.

- [x] Create `.github/workflows/release.yml` with this logic:
  ```yaml
  on:
    push:
      tags: ['v*']        # triggers on v1.0.0, v1.2.4, etc.
  jobs:
    build:
      runs-on: windows-latest   # must be Windows to build .exe
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 20 }
        - run: cd ui && npm ci
        - run: cd ui && npm run electron:build
          env:
            GH_TOKEN: ${{ secrets.GH_TOKEN }}
            # Add signing cert env vars here when P4 (code signing) is done
  ```
- [x] Create `RELEASING.md` documenting the release process:
  1. Bump version in `ui/package.json` (e.g. `"version": "1.3.0"`)
  2. Commit: `git commit -m "chore: bump version to 1.3.0"`
  3. Tag: `git tag v1.3.0`
  4. Push: `git push && git push --tags`
  5. GitHub Actions builds and publishes the release automatically
- [ ] Test a full release cycle: create a `v0.0.1-test` tag, confirm CI builds, confirm a running app detects the update

---

### U5 — Version Display

**Context:** Customers should always be able to see what version they are running. This helps with support ("which version are you on?") and builds trust that updates are working.

- [x] In `ui/electron/main.ts`, add IPC handler: `ipcMain.handle('app:getVersion', () => app.getVersion())`
- [x] In `ui/electron/preload.ts`, expose: `getVersion: () => ipcRenderer.invoke('app:getVersion')`
- [x] In `ui/src/components/layout/Sidebar.tsx`, add a version line at the very bottom of the sidebar (small, muted text): `"v{version}"`
- [ ] On app mount, call `window.electron.getVersion()` and store the result; show "Checking for updates..." briefly, then "Up to date ✓" or the update banner

---

## 🟠 HIGH — Degrades Customer Experience

> These items don't block the app from running but will cause confusion, frustration,
> or data loss for customers. Fix these before the first real customer uses the app.

---

### H1 — Wire Content Creation Steps (Steps 1–5)

**Context:** The UI has 8 step cards in `PipelineView.tsx`. Steps 1–5 (IdeaGenerationStep, ScriptGenerationStep, VoNarrationStep, GenerateVoiceoverStep, PickStoryStep) have fully built React components and corresponding bridge endpoints. However, they are completely disconnected — clicking through them does nothing useful, the output of one step is not passed to the next, and none of them feed into the video generation pipeline (steps 6–8). This makes half the UI useless and confusing.

**Data flow that needs to be wired:**
```
IdeaGenerationStep
  → POST /generate/idea
  → stores { idea_title, idea_description } in Zustand

ScriptGenerationStep (takes idea from store)
  → POST /generate/script  { idea_title, idea_description }
  → stores { script } in Zustand

VoNarrationStep (takes script from store)
  → POST /generate/vo-narration  { script }
  → stores { scenes: [{ scene_no, vo, veo_prompt }] } in Zustand

GenerateVoiceoverStep (takes scenes from store)
  → POST /generate/voiceover  { vo_text, voice_id }
  → plays audio preview in UI
  → stores { audio_file } per scene in Zustand

PickStoryStep
  → shows generated story + option to use an existing idea from Ideas.md
  → user selects/confirms → stores { selected_story_id } in Zustand

StartStep (step 6)
  → "Start Pipeline" passes selected_story_id from store into POST /run/pipeline
```

- [x] Add to `useStore.ts`: `generatedIdea`, `generatedScript`, `generatedScenes`, `selectedStoryId` state fields
- [x] **IdeaGenerationStep**: on "Generate" click, call `POST /generate/idea`, store result, mark step complete
- [x] **ScriptGenerationStep**: read `generatedIdea` from store, call `POST /generate/script`, store result; disable this step until previous step is complete
- [x] **VoNarrationStep**: read `generatedScript`, call `POST /generate/vo-narration`, store scenes
- [x] **GenerateVoiceoverStep**: call `POST /generate/voiceover` for each scene, show audio player per scene
- [x] **PickStoryStep**: show the generated story title + a list of existing unprocessed ideas from `GET /ideas`; user picks one and clicks "Use This Story" → store `selectedStoryId`
- [x] **StartStep**: include `selectedStoryId` in the pipeline start request body
- [x] Add "Continue →" button to each step — only enabled when the step has completed successfully
- [x] Add a "Reset" button that clears all generated state and starts over from Step 1

---

### H2 — Error Messages (Human-Readable)

**Context:** Currently Python scripts print exceptions directly to stdout (mixed with normal output) and the UI displays them raw in the log. A customer seeing `AttributeError: 'NoneType' object has no attribute 'click'` or a 50-line traceback has no idea what happened or what to do. We need structured error events on the SSE stream and friendly UI rendering.

- [x] In `bridge/server.py`, wrap all subprocess stderr capture: if a line matches a Python traceback pattern, emit a structured SSE event: `data: {"type":"error","message":"Pipeline stopped unexpectedly. Check logs for details.","detail":"<raw traceback>"}\n\n`
- [ ] In Python scripts, replace bare `except:` and `except Exception as e: print(e)` with structured output: `print(json.dumps({"type": "error", "message": "human-friendly message", "detail": str(e)}))`
- [x] In `ui/src/components/monitor/LiveLog.tsx`, render SSE events with `type == "error"` in red with a collapsed "Show details" toggle that reveals the raw detail
- [x] Never show a Python traceback as the main visible text — always show the human-friendly message first
- [x] Add a "Copy error" button on error log entries (copies the detail text to clipboard for support tickets)

---

### H3 — Live Video Preview

**Context:** `VideoPreview.tsx` exists and has a `<video>` element, but it is static — it doesn't update as new clips are downloaded during a pipeline run. The customer stares at an empty preview box for the entire run (which can take 30–60 minutes). Showing the latest downloaded clip as it arrives makes the tool feel alive and gives confidence the run is working.

- [x] Add `GET /output/watch` SSE endpoint in `bridge/server.py`: watches the `output/` directory for new `.mp4` files using `watchfiles` (add to bridge requirements) and emits `data: {"type":"clip_ready","path":"<relative_path>","scene":N}\n\n` events
- [x] `VideoPreview.tsx` subscribes to this SSE stream on mount; on `clip_ready` event, updates its `src` to the new clip via `GET /output/file?path=<path>` (add a simple file-serving endpoint in bridge)
- [x] Add a scene counter below the video: "Scene 3 of 12 — Clip 2"
- [x] Add a thumbnail strip below the video showing all downloaded clips as small `<video>` thumbnails; clicking one loads it in the main player

---

### H4 — LogsView Live Feed

**Context:** `LogsView` exists as a full-width log viewer but only reads static log files after the fact. During a pipeline run, the customer has to switch back to PipelineView to see what's happening. LogsView should show the same live SSE stream as PipelineView so customers can switch freely.

- [x] In `useStore.ts`, store the live log entries in a persistent array `logEntries: LogEntry[]` that is populated by the SSE stream; entries persist when the user switches views
- [x] Both `LiveLog.tsx` (in PipelineView) and `LogsView.tsx` should read from this same store array
- [x] LogsView should additionally allow browsing historical log files: show a list of past sessions from `GET /logs/sessions` and load a selected session's log
- [x] Add filter buttons in LogsView: All / Info / Warning / Error (filter by `entry.level`)
- [x] Add a search input that filters entries by text

---

### H5 — Advanced Options Persistence

**Context:** The `AdvancedOptions` panel (collapsible section in the UI) lets users set wait time, retries, and timeout per run. Currently these values reset to defaults every time the app is opened. This forces power users to re-enter their preferred settings on every session.

- [x] When the user changes any advanced option, call `POST /settings/app` to persist it immediately (debounced by 500ms — don't call on every keystroke)
- [x] On app launch, `GET /settings/app` and pre-fill the AdvancedOptions panel with the saved values
- [x] The advanced options that should persist: `wait_between_scenes`, `max_retries_per_scene`, `pipeline_timeout_minutes`, `flow_headless`

---

### H6 — Session Expiry Handling

**Context:** Google Flow login state is saved in `state/flow_auth.json` (Playwright browser cookies). These cookies expire after some period (typically 7–30 days depending on Google's session policy). When they expire, the automation silently fails mid-run — Playwright lands on the Google login page instead of Flow, and all scene generation fails. The current code has no expiry check.

- [x] In `bridge/server.py`, extend `GET /auth/status`: instead of just checking if `flow_auth.json` exists, also check the `expires` timestamp of the cookies inside it. If any critical Google cookie (e.g. `SAPISID`, `SID`) expires within 24 hours, return `{ "logged_in": true, "expires_soon": true }`
- [x] In `ui/src/components/layout/Sidebar.tsx`, if `expires_soon` is true, show the auth badge in orange with tooltip "Session expires soon — re-login to avoid interruptions"
- [x] Before starting a pipeline run (in StartStep), check auth status. If `logged_in` is false or `expires_soon` is true, show a modal: "Your Google session has expired. Please re-login before starting." with a "Go to Login" button
- [x] Add a "Re-login" button in the sidebar auth badge area that directly triggers the login flow

---

## 🟡 MEDIUM — Incomplete Features

> These are features that exist in the UI but don't work correctly, or missing
> safeguards that will cause occasional problems in production.

---

### M1 — Input Validation in Bridge

**Context:** The bridge accepts user-controlled values like `story_id` and `idea_index` and passes them directly to Python subprocess arguments and file system paths. A malformed `story_id` like `../../etc/passwd` or `; rm -rf /` could cause unexpected behavior or security issues. Since this is a local desktop app the risk is low, but validation also catches honest mistakes (typos, out-of-bounds indices) early.

- [x] In `bridge/server.py`, add a validator for `story_id`: regex `^[a-zA-Z0-9_-]{1,100}$` — if invalid, return HTTP 422 with `{"error": "Invalid story_id format"}`
- [x] Validate `idea_index`: must be a non-negative integer; check against the actual count of ideas from `Ideas.md`
- [x] Validate `scene_count`: integer between 1 and 20
- [x] Validate file paths returned to the UI: ensure they are within the configured data directory

---

### M2 — Startup Health Check

**Context:** The bridge takes 1–3 seconds to start up (Python import time + Uvicorn startup). If React loads and immediately makes API calls before the bridge is ready, all calls fail and the UI shows errors. We need a loading state while the bridge starts.

- [x] Add `GET /health` endpoint to `bridge/server.py`: returns `{ "status": "ok", "python_version": "...", "data_dir": "...", "keys": { "deepseek": bool, "elevenlabs": bool } }`
- [x] In `electron/main.ts`, after spawning the bridge, poll `http://localhost:8765/health` every 500ms for up to 10 seconds before loading the React app URL
- [x] In React, show a full-screen "Connecting..." splash screen while waiting for the bridge (store a `bridgeReady` boolean in Zustand, set to true when the first successful API call completes)
- [x] If the bridge does not respond within 10 seconds, show an error dialog: "Could not start the background service. Try restarting the app." with a "Restart" button that calls `app.relaunch()`

---

### M3 — Loading States + Debouncing

**Context:** Multiple UI buttons currently have no disabled state during API calls. A user clicking "Start Pipeline" twice will spawn two parallel Python processes writing to the same files — causing corrupted state and unpredictable behavior. Step "Generate" buttons also have no loading indicator, so users don't know if their click registered.

- [x] Add `pipelineRunning: boolean` to Zustand store; set to true when SSE stream opens, false when it closes
- [x] Disable the "Start Pipeline" button when `pipelineRunning` is true; show a spinner inside it
- [x] Each step card's "Generate" button: disable during its API call, show a spinner
- [x] If the user clicks "Start Pipeline" while one is already running, show a toast: "A pipeline is already running. Stop it first."
- [x] Debounce the settings save call (H5) by 500ms to avoid hammering the bridge on every keystroke

---

### M4 — Resume State Validation

**Context:** Resume functionality lets a run continue from where it left off after a crash or stop. Run state is saved in `state/runs/<story_id>.json`. If the Python scripts are updated between a stop and a resume, the saved state format might not match the new code, causing crashes on resume. This is a real risk after every update.

- [x] In `state/runs/<story_id>.json`, include a `schema_version` field matching the current code's schema version (a simple incrementing integer in `run_pipeline.py`)
- [x] On resume, if the saved `schema_version` does not match, log a warning and show a UI prompt: "This run was saved with an older version of the app. Resume may be unreliable. Continue anyway or start fresh?"

---

### M5 — Cost Confirmation

**Context:** ElevenLabs charges per character of text-to-speech. DeepSeek charges per token. A user accidentally clicking "Generate All" for a 12-scene story with long voiceover scripts could spend $5–10 without realizing it. We need visible cost estimates and confirmation before expensive operations.

- [x] Before calling ElevenLabs voiceover (`POST /generate/voiceover`), count the total characters in the VO text and show an estimate dialog: "This will use approximately X characters (~$Y). Continue?"
- [ ] In the bridge, calculate estimated DeepSeek token count before making LLM calls and log it at INFO level
- [x] Add a "Confirm costly operations" toggle in Settings (default: on) — when off, skips these confirmation dialogs for power users who know what they're doing

---

## 🟢 LOW — Polish

> Nice-to-have improvements. Only work on these after all Critical, Auto-Update, High, and Medium items are done.

---

### L1 — Dark Mode

**Context:** The UI is currently light mode only. Many YouTube creators work at night and prefer dark UIs. Not blocking, but notable absence.

- [ ] Add `prefers-color-scheme: dark` media query support in `ui/src/globals.css`
- [ ] Define a dark-mode CSS variable palette (background `#0f0f0f`, surface `#1a1a1a`, etc.)
- [ ] Add a manual theme toggle in the Settings screen (Light / Dark / System)
- [ ] Store preference in `app_settings.json` under `"theme": "light" | "dark" | "system"`

---

### L2 — Responsive Layout

**Context:** The app targets desktop use (1280×950) but content creators sometimes use laptops with 1280×800 or 1366×768 screens. The current fixed layout breaks at these sizes.

- [ ] In `electron/main.ts`, set `minWidth: 1100, minHeight: 700` on the BrowserWindow so the window can't be resized below usable size
- [ ] Ensure sidebar collapses to icon-only mode at narrow widths (< 200px sidebar)
- [ ] Test the full layout at 1280×800

---

### L3 — Copy / Export

- [ ] Add "Copy to clipboard" button on error messages in LiveLog (copies the detail text)
- [ ] Add "Export Log" button in LogsView that saves the currently visible log as `log_<timestamp>.txt` using Electron's `dialog.showSaveDialog`

---

### L4 — Sidebar Auth Badge Polish

**Context:** The sidebar currently polls `/auth/status` every 4 seconds unconditionally. This is 15 extra API calls per minute doing nothing useful when no pipeline is running.

- [ ] Increase polling interval to 15 seconds when no pipeline is running
- [ ] Increase to 30 seconds when the app window is not focused (use Electron's `BrowserWindow.on('blur')`)
- [ ] Add a CSS `transition` on the badge color so it doesn't flash when it updates

---

### L5 — Onboarding Tour

- [ ] On very first launch (detect by absence of `app_settings.json`), show a 3-step modal walkthrough:
  1. "Enter your API keys in Settings"
  2. "Login to Google Flow once"
  3. "Start generating videos"
- [ ] Store `state/onboarding_complete: true` in `app_settings.json` after the user completes or dismisses the tour so it never shows again

---

### L6 — Telemetry / Crash Reporting (Optional)

- [ ] Evaluate Sentry for Electron (has a native SDK)
- [ ] If added, show an opt-in prompt on first launch: "Help us improve by sending anonymous crash reports?" — store preference in `app_settings.json`
- [ ] Never enable telemetry without explicit user opt-in

---

## 📦 PACKAGING + RELEASE

> These tasks turn the development project into an installable product.
> Many depend on Critical and Auto-Update tasks being done first.

---

### P1 — Build Pipeline Verification

**Context:** `electron-builder` is configured in `ui/package.json` under the `"build"` key. It packages `dist/` (Vite frontend build) and `dist-electron/` (compiled Electron main) into a Windows NSIS installer. The `extraResources` config copies `scripts/` and `bridge/` into the installed app's `resources/` folder.

- [x] TypeScript (`tsconfig.electron.json`) compiles without errors
- [x] Vite frontend build completes cleanly
- [x] `npm run electron:build` produces `dist-app/Animal Channel Studio Setup 1.2.6.exe` (85 MB) + `latest.yml` blockmap
- [x] `extraResources` correctly copies `scripts/` and `bridge/` — verified in `win-unpacked/resources/`
- [ ] Install the `.exe` on a test machine and verify: app launches, bridge starts, Settings opens, API key can be entered
- [ ] Verify writable folders (`state/`, `output/`, `logs/`) are created in the user data dir (not inside the install dir, which may be read-only on some systems)

---

### P2 — Python Bundling Decision

**Context:** The app currently requires Python 3.10+ to be installed on the customer's machine. This is a huge friction point for non-technical users. The solution is to bundle Python using PyInstaller — compiling `bridge/server.py` and all its imports into a single `bridge.exe` that Electron spawns. The customer never needs Python.

**Recommended approach (Option A — PyInstaller):**
- [ ] Add a `build_bridge.spec` PyInstaller spec file in the `bridge/` folder
- [ ] Run `pyinstaller build_bridge.spec` to produce `bridge/dist/bridge.exe`
- [ ] Update `electron/main.ts` to spawn `bridge.exe` in packaged mode (detect via `app.isPackaged`)
- [ ] Update `electron-builder` `extraResources` to include `bridge/dist/bridge.exe` instead of the raw Python files
- [ ] Test: uninstall Python from the test machine, install the packaged app, verify everything still works

**Fallback (Option B — require Python):**
- [x] In `electron/main.ts`, `getPythonExe()` checks for bundled runtime first, then falls back to system Python. If system Python is not found, shows an error dialog with python.org download instructions.

---

### P3 — Installer UX

- [x] In `ui/package.json` electron-builder config, added NSIS options: `createDesktopShortcut`, `createStartMenuShortcut`, `runAfterFinish`, `license`
- [x] Created `ui/LICENSE.txt` — proprietary license agreement shown during install
- [ ] Test uninstall via Windows "Add or Remove Programs" — verify no orphaned files remain in `%AppData%` or `Program Files`

---

### P4 — Code Signing (Windows)

**Context:** Without a code signing certificate, Windows SmartScreen will show a red "Unknown publisher — this app may harm your computer" warning when customers try to install. Most non-technical users will stop here. Code signing costs ~$100–300/year from a certificate authority (DigiCert, Sectigo, etc.).

- [ ] Obtain a Windows Authenticode code signing certificate (EV certificate is preferred — avoids SmartScreen reputation accumulation period)
- [ ] Configure in `electron-builder`: add `"certificateFile"` and `"certificatePassword"` to the `"win"` build target (store password in GitHub Actions secret, not in source)
- [ ] Test: install the signed `.exe`, verify SmartScreen does not block it

---

### P5 — First Shipping Checklist

Run through this before sending the app to any customer:

- [ ] All 🔴 Critical items (C1–C6) are complete and tested
- [ ] All 🔄 Auto-Update items (U1–U5) are complete and a test release has been published
- [ ] App icon is present (`ui/public/icon.ico`)
- [ ] Settings screen works end-to-end (enter key → validate → save → pipeline uses the key)
- [ ] Auto-update tested: install an old build, publish a new release tag, confirm the app detects and installs the update
- [ ] Cold-start tested on a clean Windows 11 machine with no dev tools
- [ ] `README_Automation.md` updated with customer install instructions (download link, first-run steps)
- [ ] Version number in `ui/package.json` is a proper release version (not `1.2.4-dev` etc.)

---

## 📊 Progress Tracker

Update these counts as you check off items above.

| Category | Total Tasks | Done | Remaining |
|---|---|---|---|
| Critical (C1–C6) | 22 | 18 | 4 |
| Auto-Update (U1–U5) | 17 | 13 | 4 |
| High (H1–H6) | 18 | 17 | 1 |
| Medium (M1–M5) | 10 | 9 | 1 |
| Low (L1–L6) | 10 | 0 | 10 |
| Packaging (P1–P5) | 12 | 6 | 6 |
| **Total** | **89** | **63** | **26** |

---

## 🗓 Suggested Sprint Order

Work sprints in this order. Do not skip ahead.

| Sprint | Tasks | Goal |
|---|---|---|
| **Sprint 1** | C1, C2, C6, U1–U4 | Packaged `.exe` launches, builds cleanly, and auto-updates |
| **Sprint 2** | C3, C5, H6 | Customer can enter API keys in-app, login to Google Flow |
| **Sprint 3** | C4, H1, H2 | Pipeline runs reliably end-to-end in the packaged app with good errors |
| **Sprint 4** | H3, H4, H5, M1–M3 | Live preview, log feed, loading states, settings persist |
| **Sprint 5** | P1–P5 | Installer, signing, first real customer release |
| **Sprint 6** | M4, M5, U5, L1–L6 | Post-launch polish and cost safeguards |
