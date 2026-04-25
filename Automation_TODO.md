# Animal Channel Automation Engine - TODO

## Goal
Build an end-to-end pipeline that:
1. Reads ideas from `Ideas.md`
2. Generates story scenes + short VO + VEO 3 prompts using DeepSeek API
3. Writes formatted output to `Stories.md`
4. Opens Google Flow in automated browser session
5. Submits scene prompts with predefined settings
6. Waits for generation completion
7. Downloads generated clips
8. Organizes files into a story folder and renames clips by scene

## Flow Reliability Fixes - 2026-04-23

- [x] Stop prompt fill from wasting time on wrong textarea selectors before using the Slate editor
- [x] Tighten settings selectors/click strategy for `9:16`, clip count, model, and duration controls
- [x] Improve existing-project reopen logic before falling back to `New project`
- [x] Replace weak progress-only monitoring with generated-card detection
- [x] Retry visible failed generations in-browser while waiting
- [x] Change pipeline orchestration from batch guessing to per-scene submit -> monitor -> download flow
- [x] Fail a scene when no clips were downloaded instead of marking it completed
- [x] Fix `720p` selection logic to target the actual visible download option
- [x] Run local verification (`py_compile` + dry-run pipeline resume check)

---

## Phase 1 - Foundation Setup

- [x] Create project structure:
  - [x] `scripts/`
  - [x] `output/`
  - [x] `downloads/`
  - [x] `logs/`
  - [x] `state/`
- [x] Add Python dependencies in `requirements.txt`
  - [x] `requests`
  - [x] `python-dotenv`
  - [x] `playwright`
  - [x] `pydantic` (optional but recommended for strict validation)
- [x] Create `.env.example` with required keys:
  - [x] `DEEPSEEK_API_KEY=`
  - [x] `DEEPSEEK_BASE_URL=`
  - [x] `FLOW_EMAIL=` (optional)
  - [x] `FLOW_PASSWORD=` (optional)
  - [x] `FLOW_HEADLESS=false`
- [x] Add setup instructions in `README_Automation.md`
- [x] Add first-run command for Playwright browser install

Acceptance criteria:
- Fresh machine can run install steps without errors.

---

## Phase 2 - Input + State Management

- [x] Implement `scripts/read_ideas.py`
  - [x] Parse numbered and unnumbered ideas from `Ideas.md`
  - [x] Extract `title` and `description`
- [x] Implement state tracking in `state/processed_ideas.json`
  - [x] Mark processed ideas
  - [x] Skip already processed ideas
  - [x] Support rerun for a single idea by ID/title
- [x] Add deterministic `story_id` generation

Acceptance criteria:
- Script lists only unprocessed ideas correctly.

---

## Phase 3 - LLM Generation (DeepSeek)

- [x] Implement `scripts/generate_story.py`
  - [x] Read master template from `Master_Prompts.md`
  - [x] Build strict system + user prompts
  - [x] Request JSON-only response from DeepSeek
- [x] Define response schema:
  - [x] `story_title`
  - [x] `scenes[]`
  - [x] each scene: `scene_no`, `scene_name`, `vo`, `veo_prompt`
- [x] Add retry logic (max 3 retries) for malformed output
- [x] Log raw model response to `logs/llm_raw/`

Acceptance criteria:
- For one idea, returns valid JSON with 10-12 scenes.

---

## Phase 4 - Validation Layer (Critical)

- [x] Implement `scripts/validate_story.py`
  - [x] Validate scene count is 10-12
  - [x] Validate scene numbering is continuous starting from 1
  - [x] Validate VO length target (6-10 words, approx 4-5 sec)
  - [x] Validate each `veo_prompt` contains required fields:
    - [x] subject
    - [x] location/time
    - [x] action
    - [x] camera shot + movement
    - [x] style
    - [x] lighting
    - [x] mood
    - [x] duration 4-5s
    - [x] negative constraints (no text/logo/watermark/subtitles/humans)
- [x] If invalid, auto-reprompt with error report
- [x] Fail with clear message if still invalid after retries

Acceptance criteria:
- Invalid outputs are rejected and corrected automatically when possible.

---

## Phase 5 - Story Writer

- [x] Implement `scripts/write_stories.py`
  - [x] Write one story block into `Stories.md`
  - [x] Use human-friendly boxed table format
  - [x] Include title + timestamp + idea ID
  - [x] Append mode (do not overwrite old stories)
- [x] Ensure output escaping for `|` and special markdown chars

Acceptance criteria:
- `Stories.md` is readable and consistently formatted.

---

## Phase 6 - Google Flow Browser Automation

- [x] Implement Playwright automation `scripts/flow_automation.py`
- [x] First-run login mode:
  - [x] Launch browser (non-headless first time)
  - [x] Pause for manual login
  - [x] Save authenticated session state/cookies in `state/flow_auth.json`
- [x] Reuse saved session for future runs
- [x] Build robust selectors for:
  - [x] prompt input box
  - [x] generation settings panel
  - [x] generate/submit button
  - [x] job status/completion indicator
  - [x] download button(s)
- [x] Inject predefined settings before each generation:
  - [x] aspect ratio
  - [x] duration
  - [x] quality/profile
  - [x] seed behavior (if supported)
- [x] Add fallback handling when UI changes:
  - [x] selector retries
  - [x] screenshot on failure
  - [x] HTML dump for debugging

Acceptance criteria:
- Script can submit one prompt and successfully download generated clips.

---

## Phase 7 - Multi-Scene Generation Orchestrator

- [x] Implement `scripts/run_pipeline.py`
  - [x] For each scene prompt:
    - [x] submit prompt in Flow
    - [x] wait for completion
    - [x] download all clips
  - [x] Track per-scene run status in `state/runs/<story_id>.json`
  - [x] Resume unfinished story without repeating completed scenes
- [x] Add pacing controls:
  - [x] wait between requests
  - [x] max concurrent jobs (usually 1 for stability)
- [x] Add timeout rules and retry for failed scenes

Acceptance criteria:
- Full story (all scenes) can be generated in one run with resume support.

---

## Phase 8 - File Organization + Renaming

- [x] Create story output folder format:
  - [x] `output/<Story Title>/`
- [x] Save clips as:
  - [x] `Scene 1 - Clip 1.mp4`
  - [x] `Scene 1 - Clip 2.mp4`
  - [x] ...
- [x] Preserve source metadata in:
  - [x] `output/<Story Title>/manifest.json`
  - [x] include scene text, prompt, generation timestamp, clip mapping

Acceptance criteria:
- All files are correctly named and grouped per story.

---

## Phase 9 - Observability + Safety

- [x] Add structured logs:
  - [x] `logs/pipeline.log`
  - [x] `logs/flow.log`
  - [x] `logs/errors.log`
- [x] Save failure artifacts:
  - [x] screenshots
  - [x] page HTML snapshot
  - [x] failed prompt payload
- [x] Add dry-run mode:
  - [x] generate and validate stories without launching browser
- [x] Add confirmation mode before submitting costly generations

Acceptance criteria:
- Failures are diagnosable without rerunning blindly.

---

## Phase 10 - Basic UI + Usability

- [x] Add basic visual runner:
  - [x] launch with `python scripts/ui_runner.py`
  - [x] login button, run button, resume button
  - [x] dry-run/confirm/headless toggles
- [x] Add progress output:
  - [x] current scene
  - [x] generation status
  - [x] downloaded clips count
  - [x] live console output in UI
- [x] Add practical run summary surface
  - [x] process exit status in UI output
  - [x] logs and manifests remain source of truth

Acceptance criteria:
- Non-technical user can run pipeline with one command.

---

## Known Risks / Constraints

- Google Flow UI selectors may change; automation must be resilient.
- Platform anti-bot protections may require occasional manual intervention.
- Generation timing can vary widely; robust waiting logic is required.
- API/model outputs are probabilistic; validator + retry loop is mandatory.
- Respect service terms and usage limits.

---

## Handover Checklist (For Any AI Model)

- [ ] Read `Ideas.md`, `Master_Prompts.md`, `Stories.md`
- [ ] Implement Phases 1-5 first (LLM + validation + writing)
- [ ] Test with one story before browser automation
- [ ] Implement Phase 6 with manual login capture
- [ ] Add resume-safe orchestration before batch processing
- [ ] Verify final file naming and folder structure
- [ ] Document exact run commands in `README_Automation.md`

