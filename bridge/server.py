from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import AsyncGenerator

import requests as _requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, field_validator

# ── Directory layout ───────────────────────────────────────────────────────────
#
# Read-only assets (scripts, bridge code) always relative to this file:
#   dev  → <project_root>/bridge/server.py  →  parents[1] = project_root
#   pkg  → resources/bridge/server.py       →  parents[1] = resources/
#
# Writable data (state, output, logs) go to DATA_DIR:
#   dev  → project_root  (same as ROOT_DIR)
#   pkg  → %AppData%\AnimalChannelStudio  (set by Electron via env var)

ROOT_DIR  = Path(__file__).resolve().parents[1]   # scripts sibling in both dev & pkg
DATA_DIR  = Path(os.environ.get("ANIMAL_STUDIO_DATA_DIR", str(ROOT_DIR)))

IDEAS_DB_FILE = DATA_DIR / "state" / "ideas_db.json"
IDEAS_FILE    = ROOT_DIR / "Ideas.md"  # legacy; kept for _validate_idea_index fallback only
SCRIPTS_DIR   = ROOT_DIR / "scripts"
PYTHON_EXE    = sys.executable

AUTH_FILE     = DATA_DIR / "state" / "flow_auth.json"
SETTINGS_FILE = DATA_DIR / "state" / "flow_settings.json"
APP_SETTINGS  = DATA_DIR / "state" / "app_settings.json"
RUNS_DIR      = DATA_DIR / "state" / "runs"
LOGS_DIR      = DATA_DIR / "logs"
AUDIO_DIR     = DATA_DIR / "output" / "audio"

# ── Ensure writable dirs exist ─────────────────────────────────────────────────

for _d in (AUTH_FILE.parent, RUNS_DIR, LOGS_DIR, AUDIO_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── App settings (merged from app_settings.json + env vars) ───────────────────

_DEFAULT_APP_SETTINGS = {
    "deepseek_api_key": "",
    "elevenlabs_api_key": "",
    "output_dir": "",
    "default_scene_count": 12,
    "flow_headless": False,
    "wait_between_scenes": 5,
    "max_retries_per_scene": 3,
    "confirm_costly_operations": True,
}


def _load_app_settings() -> dict:
    if APP_SETTINGS.exists():
        try:
            saved = json.loads(APP_SETTINGS.read_text(encoding="utf-8"))
        except Exception:
            saved = {}
    else:
        saved = {}
    merged = {**_DEFAULT_APP_SETTINGS, **saved}
    return merged


def _save_app_settings(new_values: dict) -> None:
    APP_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    current = _load_app_settings()
    _KEY_FIELDS = {"deepseek_api_key", "elevenlabs_api_key"}
    for k, v in new_values.items():
        # Never overwrite a saved key with the redaction sentinel or an empty string
        if v == "***":
            continue
        if k in _KEY_FIELDS and v == "" and current.get(k):
            continue
        current[k] = v
    APP_SETTINGS.write_text(json.dumps(current, indent=2), encoding="utf-8")


# ── Credential resolution (settings file > env vars) ──────────────────────────

def _get_api_key(setting_key: str, env_key: str) -> str:
    cfg = _load_app_settings()
    from_file = cfg.get(setting_key, "")
    if from_file:
        return str(from_file)
    return os.getenv(env_key, "")


def _deepseek_key() -> str:
    return _get_api_key("deepseek_api_key", "DEEPSEEK_API_KEY")


def _elevenlabs_key() -> str:
    return _get_api_key("elevenlabs_api_key", "ELEVENLABS_API_KEY")


DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL    = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# Startup key presence check (C5)
_config_status = {
    "deepseek":   bool(_deepseek_key()),
    "elevenlabs": bool(_elevenlabs_key()),
}
if not _config_status["deepseek"]:
    print("[bridge] WARNING: deepseek_api_key not configured — use Settings to add it")
if not _config_status["elevenlabs"]:
    print("[bridge] WARNING: elevenlabs_api_key not configured — use Settings to add it")

# Subprocess env
_ENV = {**os.environ, "PYTHONUTF8": "1"}

# ── FastAPI app ────────────────────────────────────────────────────────────────

BRIDGE_VERSION = 2  # Increment whenever API contracts change

app = FastAPI(title="Animal Channel Bridge", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Active subprocess state ────────────────────────────────────────────────────

_active_proc: subprocess.Popen | None = None
_log_queue: asyncio.Queue[str | None] = asyncio.Queue()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _load_ideas_db() -> dict:
    if not IDEAS_DB_FILE.exists():
        return {}
    try:
        return json.loads(IDEAS_DB_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_ideas_db(db: dict) -> None:
    IDEAS_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    IDEAS_DB_FILE.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")



def _friendly_error_msg(exc_line: str) -> str:
    """Convert a Python exception line into a user-readable message."""
    low = exc_line.lower()
    if 'timeouterror' in low or 'timeout' in low:
        return 'The operation timed out. Google Flow may be slow or unresponsive.'
    if 'filenotfounderror' in low:
        return 'A required file was not found. Check your settings and try again.'
    if 'connectionerror' in low or 'connectionrefused' in low:
        return 'Could not connect to the service. Check your internet connection.'
    if 'keyerror' in low:
        return 'An internal data error occurred. Pipeline stopped unexpectedly.'
    if 'attributeerror' in low:
        return 'An internal error occurred. Pipeline stopped unexpectedly.'
    if 'permissionerror' in low:
        return 'Permission denied. Check that the output folder is writable.'
    return f'Pipeline stopped with error: {exc_line[:120]}'


def _kill_proc_tree(pid: int) -> None:
    """Kill a process and all its children (handles Playwright + Chromium)."""
    try:
        import psutil
        parent = psutil.Process(pid)
        children = parent.children(recursive=True)
        for child in children:
            try:
                child.kill()
            except Exception:
                pass
        parent.kill()
    except Exception:
        # psutil not available or process already dead — fall back
        try:
            import signal
            os.kill(pid, signal.SIGTERM if os.name != 'nt' else signal.CTRL_BREAK_EVENT)
        except Exception:
            pass


async def _stream_process(cmd: list[str], cwd: str, timeout_seconds: int = 1800) -> None:
    """Spawn a subprocess, push stdout lines to _log_queue, kill after timeout."""
    global _active_proc
    loop = asyncio.get_running_loop()

    def _run():
        global _active_proc
        import threading
        import re as _re

        def _timeout_kill():
            proc = _active_proc
            if proc and proc.poll() is None:
                loop.call_soon_threadsafe(
                    _log_queue.put_nowait,
                    f'\n[Error: Pipeline timed out after {timeout_seconds // 60} minutes. Stopping.]\n',
                )
                _kill_proc_tree(proc.pid)

        timer = threading.Timer(timeout_seconds, _timeout_kill)

        def emit(line: str) -> None:
            loop.call_soon_threadsafe(_log_queue.put_nowait, line)

        try:
            _active_proc = subprocess.Popen(
                cmd, cwd=cwd,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, encoding="utf-8", errors="replace",
                env=_ENV,
            )
            timer.start()
            assert _active_proc.stdout

            tb_buf: list[str] = []
            in_tb = False

            for raw_line in _active_proc.stdout:
                # Always emit raw line for the live log
                emit(raw_line)
                stripped = raw_line.rstrip()

                # Detect start of Python traceback
                if 'Traceback (most recent call last):' in stripped:
                    in_tb = True
                    tb_buf = [stripped]
                    continue

                if in_tb:
                    tb_buf.append(stripped)
                    # Exception class line ends the traceback (e.g. "AttributeError: ...")
                    if _re.match(r'^[A-Za-z][A-Za-z0-9_.]*(?:Error|Exception|Warning)[^:]*:', stripped):
                        struct = json.dumps({
                            "type": "error",
                            "message": _friendly_error_msg(stripped),
                            "detail": '\n'.join(tb_buf),
                        })
                        emit(struct + '\n')
                        in_tb = False
                        tb_buf = []
                    elif stripped and stripped[0] not in (' ', '\t', '|', '+', '_') and stripped != '':
                        # Non-indented line that is not an exception → end tb without match
                        in_tb = False
                        tb_buf = []

            code = _active_proc.wait()
            loop.call_soon_threadsafe(
                _log_queue.put_nowait, f"\n[Done — exit code {code}]\n"
            )
            loop.call_soon_threadsafe(_log_queue.put_nowait, None)
        except Exception as exc:
            loop.call_soon_threadsafe(
                _log_queue.put_nowait, f"\n[Error starting process: {exc}]\n"
            )
            loop.call_soon_threadsafe(_log_queue.put_nowait, None)
        finally:
            timer.cancel()
            _active_proc = None

    await loop.run_in_executor(None, _run)


def _start_background(cmd: list[str], timeout_seconds: int = 1800) -> None:
    asyncio.create_task(_stream_process(cmd, str(ROOT_DIR), timeout_seconds))


# ── Route: Health ──────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    cfg = _load_app_settings()
    keys = {
        "deepseek":   bool(cfg.get("deepseek_api_key") or os.getenv("DEEPSEEK_API_KEY")),
        "elevenlabs": bool(cfg.get("elevenlabs_api_key") or os.getenv("ELEVENLABS_API_KEY")),
    }
    return {
        "status": "ok",
        "bridge_version": BRIDGE_VERSION,
        "python_version": sys.version,
        "data_dir": str(DATA_DIR),
        "keys": keys,
    }


# ── Routes: Ideas DB ──────────────────────────────────────────────────────────

class IdeaDbSaveRequest(BaseModel):
    title: str
    description: str
    script: str
    vo_narrations: list[dict]


@app.post("/ideas/db/save")
def save_idea_to_db(req: IdeaDbSaveRequest):
    sys.path.insert(0, str(SCRIPTS_DIR))
    from read_ideas import make_story_id
    story_id = make_story_id(req.title, req.description)

    db = _load_ideas_db()
    from datetime import datetime, timezone
    db[story_id] = {
        "story_id": story_id,
        "title": req.title,
        "description": req.description,
        "script": req.script,
        "vo_narrations": req.vo_narrations,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_ideas_db(db)
    return {"story_id": story_id}


@app.get("/ideas/db")
def get_ideas_db():
    db = _load_ideas_db()
    return list(db.values())


@app.delete("/ideas/db/{story_id}")
def delete_idea_from_db(story_id: str):
    if not re.match(r'^[a-zA-Z0-9_\-]{1,120}$', story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")

    db = _load_ideas_db()
    entry = db.pop(story_id, None)
    _save_ideas_db(db)
    return {"status": "deleted", "found": entry is not None}


# ── Routes: Auth ───────────────────────────────────────────────────────────────

@app.get("/auth/status")
def get_auth_status():
    cfg = _load_app_settings()
    keys_configured = {
        "deepseek":   bool(cfg.get("deepseek_api_key") or os.getenv("DEEPSEEK_API_KEY")),
        "elevenlabs": bool(cfg.get("elevenlabs_api_key") or os.getenv("ELEVENLABS_API_KEY")),
    }

    # Check if Google session cookies expire within 24 hours (H6)
    expires_soon = False
    if AUTH_FILE.exists():
        try:
            cookies = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
            if isinstance(cookies, list):
                now = time.time()
                for cookie in cookies:
                    exp = cookie.get("expires", -1)
                    if isinstance(exp, (int, float)) and exp > 0:
                        if exp - now < 86400:  # less than 24 hours
                            expires_soon = True
                            break
        except Exception:
            pass

    return {
        "authorized":    AUTH_FILE.exists(),
        "keys_configured": keys_configured,
        "expires_soon":  expires_soon,
    }


@app.delete("/auth")
def delete_auth():
    if AUTH_FILE.exists():
        AUTH_FILE.unlink()
    return {"status": "cleared"}


# ── Routes: Flow Settings ──────────────────────────────────────────────────────

@app.get("/settings")
def get_settings():
    if not SETTINGS_FILE.exists():
        return {
            "mode": "Cinematic",
            "aspect_ratio": "9:16",
            "clip_count": "x4",
            "duration": "8s",
            "model": "Veo 3.1 - Fast",
        }
    return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))


class SettingsPayload(BaseModel):
    mode: str = "Cinematic"
    aspect_ratio: str = "9:16"
    clip_count: str = "x4"
    duration: str = "8s"
    model: str = "Veo 3.1 - Fast"


@app.post("/settings")
def save_settings(payload: SettingsPayload):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(
        json.dumps(payload.model_dump(), indent=2), encoding="utf-8"
    )
    return {"status": "saved"}


# ── Routes: App Settings (C3) ──────────────────────────────────────────────────

@app.get("/settings/app")
def get_app_settings():
    cfg = _load_app_settings()
    # Redact key values — return *** if set
    return {
        "deepseek_api_key":      "***" if cfg.get("deepseek_api_key") else "",
        "elevenlabs_api_key":    "***" if cfg.get("elevenlabs_api_key") else "",
        "output_dir":            cfg.get("output_dir", ""),
        "default_scene_count":   cfg.get("default_scene_count", 12),
        "flow_headless":         cfg.get("flow_headless", False),
        "wait_between_scenes":   cfg.get("wait_between_scenes", 5),
        "max_retries_per_scene": cfg.get("max_retries_per_scene", 3),
        "pipeline_timeout_sec":          cfg.get("pipeline_timeout_sec", 300),
        "confirm_costly_operations":     cfg.get("confirm_costly_operations", True),
    }


class AppSettingsPayload(BaseModel):
    deepseek_api_key: str = ""
    elevenlabs_api_key: str = ""
    output_dir: str = ""
    default_scene_count: int = 12
    flow_headless: bool = False
    wait_between_scenes: int = 5
    max_retries_per_scene: int = 3
    pipeline_timeout_sec: int = 300
    confirm_costly_operations: bool = True

    def validate_fields(self) -> None:
        if not (1 <= self.default_scene_count <= 20):
            raise HTTPException(status_code=422, detail="default_scene_count must be between 1 and 20")
        if not (0 <= self.wait_between_scenes <= 120):
            raise HTTPException(status_code=422, detail="wait_between_scenes must be between 0 and 120")
        if not (1 <= self.max_retries_per_scene <= 10):
            raise HTTPException(status_code=422, detail="max_retries_per_scene must be between 1 and 10")


@app.post("/settings/app")
def save_app_settings(payload: AppSettingsPayload):
    payload.validate_fields()
    _save_app_settings(payload.model_dump())
    # Refresh startup config status
    global _config_status
    _config_status = {
        "deepseek":   bool(_deepseek_key()),
        "elevenlabs": bool(_elevenlabs_key()),
    }
    return {"status": "saved"}


# ── Routes: API Key Validation (C3) ───────────────────────────────────────────

@app.post("/validate/deepseek")
def validate_deepseek():
    key = _deepseek_key()
    if not key:
        return {"ok": False, "error": "No DeepSeek API key configured"}
    try:
        resp = _requests.get(
            f"{DEEPSEEK_BASE_URL}/models",
            headers={"Authorization": f"Bearer {key}"},
            timeout=10,
        )
        resp.raise_for_status()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/validate/elevenlabs")
def validate_elevenlabs():
    key = _elevenlabs_key()
    if not key:
        return {"ok": False, "error": "No ElevenLabs API key configured"}
    try:
        resp = _requests.get(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": key},
            timeout=10,
        )
        resp.raise_for_status()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Routes: Run ────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    headless: bool = False


@app.post("/run/login")
async def run_login(req: LoginRequest):
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "flow_automation.py"),
        "--mode", "login",
        "--headless", "true" if req.headless else "false",
    ]
    _start_background(cmd)
    return {"status": "started"}


class PipelineRequest(BaseModel):
    story_id: str | None = None
    idea_index: int = 1
    wait_between_sec: int = 8
    wait_max_sec: int = 15
    scene_max_retries: int = 2
    timeout_sec: int = 300
    dry_run: bool = False
    headless: bool = False


def _validate_idea_index(idea_index: int) -> None:
    """Raise HTTP 422 if idea_index is out of range."""
    if idea_index < 0:
        raise HTTPException(status_code=422, detail="idea_index must be a non-negative integer")
    if IDEAS_FILE.exists():
        text = IDEAS_FILE.read_text(encoding="utf-8")
        ideas = _parse_ideas(text)
        if ideas and idea_index > max(i["index"] for i in ideas):
            raise HTTPException(
                status_code=422,
                detail=f"idea_index {idea_index} is out of range (max: {max(i['index'] for i in ideas)})"
            )


@app.post("/run/pipeline")
async def run_pipeline(req: PipelineRequest):
    if req.story_id:
        if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
            raise HTTPException(status_code=422, detail="Invalid story_id format")
        cmd = [
            PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
            "--story-id",          req.story_id,
            "--wait-between-sec",  str(req.wait_between_sec),
            "--wait-max-sec",      str(req.wait_max_sec),
            "--scene-max-retries", str(req.scene_max_retries),
            "--timeout-sec",       str(req.timeout_sec),
            "--dry-run",           "true" if req.dry_run else "false",
            "--confirm-costly",    "false",
            "--headless",          "true" if req.headless else "false",
        ]
    else:
        _validate_idea_index(req.idea_index)
        cmd = [
            PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
            "--idea-index",        str(req.idea_index),
            "--wait-between-sec",  str(req.wait_between_sec),
            "--wait-max-sec",      str(req.wait_max_sec),
            "--scene-max-retries", str(req.scene_max_retries),
            "--timeout-sec",       str(req.timeout_sec),
            "--dry-run",           "true" if req.dry_run else "false",
            "--confirm-costly",    "false",
            "--headless",          "true" if req.headless else "false",
        ]
    _start_background(cmd, timeout_seconds=req.timeout_sec * 20 + 300)
    return {"status": "started"}


class ResumeRequest(BaseModel):
    story_id: str
    wait_between_sec: int = 8
    wait_max_sec: int = 15
    scene_max_retries: int = 2
    timeout_sec: int = 300
    dry_run: bool = False
    headless: bool = False


@app.post("/run/resume")
async def run_resume(req: ResumeRequest):
    # Validate story_id to prevent path traversal
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
        "--resume",            req.story_id,
        "--wait-between-sec",  str(req.wait_between_sec),
        "--wait-max-sec",      str(req.wait_max_sec),
        "--scene-max-retries", str(req.scene_max_retries),
        "--timeout-sec",       str(req.timeout_sec),
        "--dry-run",           "true" if req.dry_run else "false",
        "--confirm-costly",    "false",
        "--headless",          "true" if req.headless else "false",
    ]
    _start_background(cmd, timeout_seconds=req.timeout_sec * 20 + 300)
    return {"status": "started"}


class SingleSceneRequest(BaseModel):
    story_id: str | None = None
    idea_index: int = 1
    scene_number: int = 1
    wait_between_sec: int = 8
    wait_max_sec: int = 15
    scene_max_retries: int = 2
    timeout_sec: int = 300
    dry_run: bool = False
    headless: bool = False


@app.post("/run/single-scene")
async def run_single_scene(req: SingleSceneRequest):
    if req.scene_number < 1 or req.scene_number > 50:
        raise HTTPException(status_code=422, detail="scene_number must be between 1 and 50")
    if req.story_id:
        if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
            raise HTTPException(status_code=422, detail="Invalid story_id format")
        idea_selector = ["--story-id", req.story_id]
    else:
        _validate_idea_index(req.idea_index)
        idea_selector = ["--idea-index", str(req.idea_index)]
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
        *idea_selector,
        "--only-scene",        str(req.scene_number),
        "--wait-between-sec",  str(req.wait_between_sec),
        "--wait-max-sec",      str(req.wait_max_sec),
        "--scene-max-retries", str(req.scene_max_retries),
        "--timeout-sec",       str(req.timeout_sec),
        "--dry-run",           "true" if req.dry_run else "false",
        "--confirm-costly",    "false",
        "--headless",          "true" if req.headless else "false",
        "--write-stories",     "false",
        "--mark-processed",    "false",
    ]
    _start_background(cmd)
    return {"status": "started"}


class FinalizeRequest(BaseModel):
    story_id: str


@app.post("/run/finalize")
async def run_finalize(req: FinalizeRequest):
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "finalize_outputs.py"),
        "--story-id", req.story_id,
    ]
    _start_background(cmd)
    return {"status": "started"}


class FlowOnlyRequest(BaseModel):
    story_id: str
    wait_between_sec: int = 8
    wait_max_sec: int = 15
    scene_max_retries: int = 2
    timeout_sec: int = 300
    dry_run: bool = False
    headless: bool = False


@app.post("/run/flow-only")
async def run_flow_only(req: FlowOnlyRequest):
    """Start browser automation directly, skipping story generation.

    Builds the run state from ideas_db.json if not already present,
    then resumes directly into the Google Flow browser step.
    """
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")

    run_file = RUNS_DIR / f"{req.story_id}.json"

    # If no run state exists yet, build one from the ideas_db entry
    if not run_file.exists():
        db = _load_ideas_db()
        entry = db.get(req.story_id)
        if not entry:
            raise HTTPException(
                status_code=404,
                detail=f"No story found for story_id '{req.story_id}'. "
                       "Complete Steps 2–5 and save to the database first."
            )

        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        vo_narrations = entry.get("vo_narrations", [])

        scenes_payload = []
        scenes_state = []
        for idx, vo in enumerate(vo_narrations, start=1):
            scenes_payload.append({
                "scene_no": idx,
                "scene_name": vo.get("sentence", f"Scene {idx}"),
                "vo": vo.get("narration", ""),
                "veo_prompt": vo.get("veo_prompt", ""),
            })
            scenes_state.append({
                "scene_no": idx,
                "scene_name": vo.get("sentence", f"Scene {idx}"),
                "status": "pending",
                "attempts": 0,
                "downloads": [],
                "error": "",
                "updated_at": now_iso,
            })

        run_state = {
            "schema_version": 1,
            "story_id": req.story_id,
            "idea_index": 0,
            "idea_title": entry.get("title", ""),
            "run_status": "in_progress",
            "created_at": now_iso,
            "updated_at": now_iso,
            "story_payload": {
                "story_title": entry.get("title", ""),
                "scenes": scenes_payload,
            },
            "scenes": scenes_state,
            "flow_tracker": {
                "downloaded_card_keys": [],
                "failed_card_keys": [],
            },
            "downloaded_cards": [],
        }
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        run_file.write_text(
            json.dumps(run_state, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
        "--resume",            req.story_id,
        "--wait-between-sec",  str(req.wait_between_sec),
        "--wait-max-sec",      str(req.wait_max_sec),
        "--scene-max-retries", str(req.scene_max_retries),
        "--timeout-sec",       str(req.timeout_sec),
        "--dry-run",           "true" if req.dry_run else "false",
        "--confirm-costly",    "false",
        "--headless",          "true" if req.headless else "false",
    ]
    _start_background(cmd, timeout_seconds=req.timeout_sec * 20 + 300)
    return {"status": "started"}


class FreshStartRequest(BaseModel):
    story_id: str


@app.post("/run/fresh-start")
def run_fresh_start(req: FreshStartRequest):
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")
    run_file = RUNS_DIR / f"{req.story_id}.json"
    deleted = False
    if run_file.exists():
        run_file.unlink()
        deleted = True
    return {"status": "cleared", "deleted": deleted}


@app.post("/run/stop")
def run_stop():
    global _active_proc
    if _active_proc and _active_proc.poll() is None:
        try:
            _kill_proc_tree(_active_proc.pid)
        except Exception:
            try:
                _active_proc.terminate()
            except Exception:
                pass
        return {"status": "stopped"}
    return {"status": "nothing_running"}


# ── SSE Stream ─────────────────────────────────────────────────────────────────

@app.get("/run/stream")
async def run_stream():
    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            line = await _log_queue.get()
            if line is None:
                yield "data: [DONE]\n\n"
                break
            safe = line.replace("\n", "\\n")
            yield f"data: {safe}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Log file endpoint ──────────────────────────────────────────────────────────

@app.get("/logs/{filename}")
def get_log_file(filename: str):
    safe_name = Path(filename).name
    log_path = LOGS_DIR / safe_name
    if not log_path.exists():
        return {"lines": []}
    text = log_path.read_text(encoding="utf-8", errors="replace")
    return {"lines": text.splitlines()}


# ── DeepSeek helper ────────────────────────────────────────────────────────────

def _deepseek_chat(system_prompt: str, user_message: str, temperature: float = 0.8) -> str:
    key = _deepseek_key()
    if not key:
        raise HTTPException(status_code=400, detail="DeepSeek API key not configured — go to Settings")
    resp = _requests.post(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": temperature,
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# ── Routes: Content creation pipeline ─────────────────────────────────────────

class IdeaRequest(BaseModel):
    niche: str
    content_type: str


@app.post("/generate/idea")
def generate_idea(req: IdeaRequest):
    system = (
        "You are a creative content strategist for YouTube. "
        "Your job is to generate exactly 10 compelling video ideas for a given niche and content type. "
        "Return ONLY a JSON array with exactly 10 objects. Each object must have exactly two keys: "
        '"title" (a short, punchy video title) and "description" (one sentence explaining the idea). '
        "No markdown, no extra text, no numbering outside the JSON. Output valid JSON only."
    )
    user_message = (
        f"Niche: {req.niche}\n"
        f"Content type: {req.content_type}\n\n"
        "Generate 10 video ideas for this niche and content type."
    )
    raw = _deepseek_chat(system, user_message)

    # Parse and validate the JSON array
    import json as _json
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    try:
        ideas = _json.loads(text)
        if not isinstance(ideas, list):
            raise ValueError("Not a list")
        ideas = [{"title": str(i.get("title", "")), "description": str(i.get("description", ""))} for i in ideas[:10]]
    except Exception:
        ideas = [{"title": "Failed to parse ideas", "description": raw}]

    return {"ideas": ideas}


class ScriptRequest(BaseModel):
    niche: str
    idea: str
    word_count: int = 300

    @field_validator("word_count")
    @classmethod
    def clamp_word_count(cls, v: int) -> int:
        return max(30, min(1200, v))


@app.post("/generate/script")
def generate_script(req: ScriptRequest):
    target_words = req.word_count
    system = (
        f"You are a professional scriptwriter specializing in {req.niche} content for YouTube. "
        f"Write a compelling, narration-ready video script for the given idea. "
        f"The script MUST be approximately {target_words} words — aim for exactly {target_words} words. "
        "Each sentence is a self-contained scene or narration beat. "
        "Write in vivid, engaging, present-tense prose suitable for a voiceover. "
        "Output ONLY the script sentences, one per line, no scene numbers, no timestamps, no headings."
    )
    user_message = f"Niche: {req.niche}\n\nVideo idea: {req.idea}"
    result = _deepseek_chat(system, user_message)

    # Count words and flag if out of 25% tolerance
    actual_words = len(result.split())
    low = int(target_words * 0.75)
    high = int(target_words * 1.25)
    length_ok = low <= actual_words <= high

    return {"script": result, "word_count": actual_words, "target_word_count": target_words, "length_ok": length_ok}


class VoNarrationRequest(BaseModel):
    script: str


@app.post("/generate/vo-narration")
def generate_vo_narration(req: VoNarrationRequest):
    system = (
        "You are an expert adapting wildlife documentary scripts for voiceover recording and AI video generation. "
        "For each sentence in the script, output a JSON array where every element has exactly three keys:\n"
        '  "sentence"  — the original script sentence (verbatim)\n'
        '  "narration" — a natural, warm, conversational voiceover line suitable for text-to-speech\n'
        '  "veo_prompt" — a detailed VEO 3 video generation prompt: cinematic, specific camera angle, '
        "lighting, animal behaviors, environment, mood\n\n"
        "Return ONLY a valid JSON array. No markdown fences, no explanation."
    )
    raw = _deepseek_chat(system, req.script, temperature=0.6)
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        items = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"Model returned invalid JSON:\n{raw[:400]}")
    return {"items": items}


# ── Routes: ElevenLabs ─────────────────────────────────────────────────────────

@app.get("/elevenlabs/voices")
def get_elevenlabs_voices():
    key = _elevenlabs_key()
    if not key:
        raise HTTPException(status_code=400, detail="ElevenLabs API key not configured — go to Settings")
    resp = _requests.get(
        "https://api.elevenlabs.io/v1/voices",
        headers={"xi-api-key": key},
        timeout=15,
    )
    resp.raise_for_status()
    voices = resp.json().get("voices", [])
    return {
        "voices": [
            {
                "voice_id":    v["voice_id"],
                "name":        v["name"],
                "preview_url": v.get("preview_url", ""),
                "labels":      v.get("labels", {}),
            }
            for v in voices[:10]
        ]
    }


class VoiceoverRequest(BaseModel):
    narration_text: str
    voice_id: str


@app.post("/generate/voiceover")
def generate_voiceover(req: VoiceoverRequest):
    key = _elevenlabs_key()
    if not key:
        raise HTTPException(status_code=400, detail="ElevenLabs API key not configured — go to Settings")
    resp = _requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{req.voice_id}",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        json={
            "text": req.narration_text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        },
        timeout=120,
    )
    resp.raise_for_status()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"voiceover_{int(time.time())}.mp3"
    (AUDIO_DIR / filename).write_bytes(resp.content)
    return {"filename": filename}


@app.get("/audio/{filename}")
def serve_audio(filename: str):
    safe_name = Path(filename).name
    audio_path = AUDIO_DIR / safe_name
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(str(audio_path), media_type="audio/mpeg")


# ── Routes: Output file serving (H3) ──────────────────────────────────────────

OUTPUT_DIR = DATA_DIR / "output"


@app.get("/output/file")
def serve_output_file(path: str):
    """Serve a video file from the output directory."""
    resolved = (OUTPUT_DIR / path).resolve()
    # Path traversal check
    try:
        resolved.relative_to(OUTPUT_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(resolved))


@app.get("/output/watch")
async def watch_output():
    """SSE stream: emit clip_ready events when new .mp4 files appear in output/."""
    async def generate() -> AsyncGenerator[str, None]:
        known: set[str] = set()
        output_dir = DATA_DIR / "output"

        # Seed with already-existing files so we only emit NEW ones
        if output_dir.exists():
            for f in output_dir.rglob("*.mp4"):
                known.add(str(f.resolve()))

        while True:
            await asyncio.sleep(2)
            if not output_dir.exists():
                continue
            for f in output_dir.rglob("*.mp4"):
                key = str(f.resolve())
                if key not in known:
                    known.add(key)
                    scene_num = _parse_scene_from_filename(f.name)
                    try:
                        rel = str(f.relative_to(DATA_DIR / "output"))
                    except ValueError:
                        rel = f.name
                    event = json.dumps({
                        "type": "clip_ready",
                        "path": rel.replace("\\", "/"),
                        "scene": scene_num,
                    })
                    yield f"data: {event}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _parse_scene_from_filename(name: str) -> int:
    """Extract a scene number from a filename like scene_01_clip.mp4 or 03_output.mp4."""
    m = re.search(r'(?:scene[_\-]?)?(\d+)', Path(name).stem, re.IGNORECASE)
    return int(m.group(1)) if m else 0


# ── Routes: Run state (M4) ────────────────────────────────────────────────────

CURRENT_RUN_STATE_SCHEMA_VERSION = 1


@app.get("/run/state/{story_id}")
def get_run_state(story_id: str):
    """Return saved run state info including schema version check."""
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")
    run_file = RUNS_DIR / f"{story_id}.json"
    if not run_file.exists():
        raise HTTPException(status_code=404, detail="No saved run state for this story")
    try:
        state = json.loads(run_file.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="Could not read run state file")

    saved_version = state.get("schema_version", 0)
    schema_ok = saved_version == CURRENT_RUN_STATE_SCHEMA_VERSION
    completed = sum(1 for s in state.get("scenes", []) if s.get("status") == "done")
    total = len(state.get("scenes", []))

    return {
        "story_id":       story_id,
        "run_status":     state.get("run_status", "unknown"),
        "schema_version": saved_version,
        "schema_ok":      schema_ok,
        "schema_message": (
            None if schema_ok
            else f"Saved with schema v{saved_version}, current is v{CURRENT_RUN_STATE_SCHEMA_VERSION}. Resume may be unreliable."
        ),
        "scenes_done":    completed,
        "scenes_total":   total,
    }


# ── Routes: Log sessions (H4) ─────────────────────────────────────────────────

@app.get("/logs/sessions")
def get_log_sessions():
    """Return session summaries parsed from pipeline.log."""
    log_path = LOGS_DIR / "pipeline.log"
    if not log_path.exists():
        return {"sessions": []}

    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    sessions = []
    session_lines: list[str] = []
    session_start = ""
    session_num = 1

    for line in lines:
        if not session_start and line.strip():
            m = re.match(r'^(\d{2}:\d{2}:\d{2})', line)
            session_start = m.group(1) if m else ""
        session_lines.append(line)

        if re.search(r'\[done.*exit code', line, re.IGNORECASE) or '[Stopped by user]' in line:
            success = bool(re.search(r'\[done.*exit code 0', line, re.IGNORECASE))
            m = re.match(r'^(\d{2}:\d{2}:\d{2})', line)
            end_ts = m.group(1) if m else ""
            sessions.append({
                "id": session_num,
                "line_count": len(session_lines),
                "success": success,
                "start_timestamp": session_start,
                "end_timestamp": end_ts,
            })
            session_num += 1
            session_lines = []
            session_start = ""

    if session_lines:
        sessions.append({
            "id": session_num,
            "line_count": len(session_lines),
            "success": None,
            "start_timestamp": session_start,
            "end_timestamp": "",
        })

    return {"sessions": sessions}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7477, log_level="warning")
