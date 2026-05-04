# Automation Setup (Phase 1)

## Customer Install

Customers should use the Windows installer from the latest GitHub Release:

1. Download `Animal Channel Studio Setup <version>.exe`.
2. Run the installer and launch Animal Channel Studio.
3. On first launch, enter the DeepSeek and ElevenLabs API keys in Settings.
4. Use Settings to choose an output folder if the default is not desired.
5. Capture the Google Flow login session, then run the pipeline.

The installed app stores customer data in the app data folder, not in the install directory. Auto-update is delivered through GitHub Releases; when an update is downloaded, the app shows a restart-and-install banner.

---

This project prepares an automation pipeline for:
- story generation from `Ideas.md`
- validation + writing to `Stories.md`
- browser automation for Google Flow video generation

---

## 1) Create and activate virtual environment (PowerShell)

```powershell
cd "D:\Youtube\5- Animal Channel"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If script execution is blocked:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

---

## 2) Install dependencies

```powershell
pip install -r requirements.txt
```

---

## 3) Install Playwright browser binaries (first run required)

```powershell
python -m playwright install chromium
```

Optional OS dependencies:

```powershell
python -m playwright install --with-deps chromium
```

---

## 4) Configure environment variables

1. Copy `.env.example` to `.env`
2. Fill required values:
   - `DEEPSEEK_API_KEY`
   - `DEEPSEEK_BASE_URL` (default already set)
   - `DEEPSEEK_MODEL` (default already set)
   - `FLOW_HEADLESS` (`false` recommended for first login)

PowerShell copy command:

```powershell
Copy-Item ".env.example" ".env"
```

---

## 5) Phase 1 folder layout

- `scripts/` -> Python scripts
- `output/` -> final story video folders
- `downloads/` -> raw downloaded clips
- `logs/` -> run logs and debug artifacts
- `state/` -> processed ideas, auth state, run checkpoints

---

## 6) Quick environment check

```powershell
python --version
python -c "import requests, dotenv, playwright, pydantic; print('OK')"
```

Expected output includes: `OK`

---

## 7) Google Flow automation (Phase 6)

The script `scripts/flow_automation.py` supports:
- first-time manual login and session save
- prompt submission with saved session
- waiting for generation completion
- downloading available clips
- saving failure screenshot + HTML snapshot

### 7.1 First-time login and auth capture

```powershell
python scripts/flow_automation.py --mode login --flow-url "https://labs.google/fx/tools/flow" --headless false
```

After browser opens:
1. Log in manually
2. Reach Flow workspace
3. Press ENTER in terminal

Saved auth file:
- `state/flow_auth.json`

### 7.2 Generate one scene

```powershell
python scripts/flow_automation.py --mode generate --scene-no 1 --prompt "A lion stalks at dusk..." --timeout-sec 900
```

Downloaded clips go to:
- `downloads/scene_01/`

### 7.3 Selector and settings config

Auto-created on first run:
- `state/flow_elements.json` (primary element sheet)
- `state/flow_selectors.json`
- `state/flow_settings.json`

If Google Flow UI changes, update selectors in `state/flow_elements.json`.
`state/flow_selectors.json` remains as backward-compatible flattened overrides.
If you want fixed generation preferences, set values in `state/flow_settings.json`.

### 7.4 Failure artifacts

On failure, script saves:
- screenshot: `logs/flow_failure_generate_<timestamp>.png`
- page dump: `logs/flow_failure_generate_<timestamp>.html`

---

## 8) Multi-scene pipeline (Phase 7)

The script `scripts/run_pipeline.py` orchestrates:
- idea -> story generation (DeepSeek)
- per-scene Flow generation
- retries/timeouts/pacing
- resume from run state
- optional write to `Stories.md`
- optional mark processed in state

### 8.1 Run full pipeline for one idea

```powershell
python scripts/run_pipeline.py --idea-index 1 --wait-between-sec 7 --scene-max-retries 2 --timeout-sec 900
```

### 8.2 Resume unfinished pipeline

```powershell
python scripts/run_pipeline.py --resume story_7a508ce22f
```

Resume state file location:
- `state/runs/<story_id>.json`

### 8.3 Useful flags

- `--headless true|false`
- `--write-stories true|false`
- `--mark-processed true|false`
- `--max-llm-retries 3`
- `--story-id <story_id>` or `--idea-title "<title>"`

---

## 9) File organization and renaming (Phase 8)

After a successful run, `run_pipeline.py` now:
- creates story folder: `output/<Story Title>/`
- moves downloaded clips into story folder
- renames clips as:
  - `Scene 1 - Clip 1.mp4`
  - `Scene 1 - Clip 2.mp4`
  - etc.
- writes metadata manifest:
  - `output/<Story Title>/manifest.json`

Manifest includes:
- story metadata (`story_id`, title, idea index/title)
- scene mapping (`scene_no`, `scene_name`, `vo`, `veo_prompt`)
- final clip paths per scene

Optional output root override:

```powershell
python scripts/run_pipeline.py --idea-index 1 --output-root "D:\Youtube\5- Animal Channel\output"
```

---

## 10) Observability and safety (Phase 9)

`run_pipeline.py` now writes structured JSONL logs:
- `logs/pipeline.log`
- `logs/flow.log`
- `logs/errors.log`

Additional failure artifact:
- `logs/failed_prompt_<story_id>_sceneXX_attemptY.json`

Dry-run mode (no browser automation):

```powershell
python scripts/run_pipeline.py --idea-index 1 --dry-run true
```

Cost confirmation mode (before paid/expensive submissions):

```powershell
python scripts/run_pipeline.py --idea-index 1 --confirm-costly true
```

Notes:
- Dry run still performs idea selection, story generation, and validation.
- Dry run skips Flow submission/download and writes a dry-run manifest.

---

## 11) Basic visual UI (Phase 10)

You can now run the system from a simple desktop UI:

```powershell
python scripts/ui_runner.py
```

UI includes:
- Flow login session capture button
- Full pipeline run button
- Resume pipeline button
- toggles for dry-run / confirmation / headless
- live output console
- stop current task button

Recommended usage order:
1. Click `Capture Flow Login Session`
2. Fill `Idea Index` (or Story ID)
3. Click `Run Full Pipeline`
4. Use `Resume Pipeline` with story ID if interrupted
