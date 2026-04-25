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
from pydantic import BaseModel

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

IDEAS_FILE    = ROOT_DIR / "Ideas.md"
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
    for k, v in new_values.items():
        # Never overwrite a real key with the redaction sentinel
        if v == "***":
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

def _parse_ideas(text: str) -> list[dict]:
    sys.path.insert(0, str(SCRIPTS_DIR))
    from read_ideas import parse_ideas
    ideas = parse_ideas(text)
    return [{"index": i.index, "title": i.title, "story_id": i.story_id} for i in ideas]


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

        def _timeout_kill():
            proc = _active_proc
            if proc and proc.poll() is None:
                loop.call_soon_threadsafe(
                    _log_queue.put_nowait,
                    f'\n[Error: Pipeline timed out after {timeout_seconds // 60} minutes. Stopping.]\n',
                )
                _kill_proc_tree(proc.pid)

        timer = threading.Timer(timeout_seconds, _timeout_kill)
        try:
            _active_proc = subprocess.Popen(
                cmd, cwd=cwd,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, encoding="utf-8", errors="replace",
                env=_ENV,
            )
            timer.start()
            assert _active_proc.stdout
            for line in _active_proc.stdout:
                loop.call_soon_threadsafe(_log_queue.put_nowait, line)
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
        "python_version": sys.version,
        "data_dir": str(DATA_DIR),
        "keys": keys,
    }


# ── Routes: Ideas ──────────────────────────────────────────────────────────────

@app.get("/ideas")
def get_ideas():
    if not IDEAS_FILE.exists():
        return []
    text = IDEAS_FILE.read_text(encoding="utf-8")
    return _parse_ideas(text)


# ── Routes: Auth ───────────────────────────────────────────────────────────────

@app.get("/auth/status")
def get_auth_status():
    cfg = _load_app_settings()
    keys_configured = {
        "deepseek":   bool(cfg.get("deepseek_api_key") or os.getenv("DEEPSEEK_API_KEY")),
        "elevenlabs": bool(cfg.get("elevenlabs_api_key") or os.getenv("ELEVENLABS_API_KEY")),
    }
    return {
        "authorized": AUTH_FILE.exists(),
        "keys_configured": keys_configured,
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
        "deepseek_api_key":    "***" if cfg.get("deepseek_api_key") else "",
        "elevenlabs_api_key":  "***" if cfg.get("elevenlabs_api_key") else "",
        "output_dir":          cfg.get("output_dir", ""),
        "default_scene_count": cfg.get("default_scene_count", 12),
        "flow_headless":       cfg.get("flow_headless", False),
        "wait_between_scenes": cfg.get("wait_between_scenes", 5),
        "max_retries_per_scene": cfg.get("max_retries_per_scene", 3),
    }


class AppSettingsPayload(BaseModel):
    deepseek_api_key: str = ""
    elevenlabs_api_key: str = ""
    output_dir: str = ""
    default_scene_count: int = 12
    flow_headless: bool = False
    wait_between_scenes: int = 5
    max_retries_per_scene: int = 3


@app.post("/settings/app")
def save_app_settings(payload: AppSettingsPayload):
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
    idea_index: int = 1
    wait_between_sec: int = 8
    wait_max_sec: int = 15
    scene_max_retries: int = 2
    timeout_sec: int = 300
    dry_run: bool = False
    headless: bool = False


@app.post("/run/pipeline")
async def run_pipeline(req: PipelineRequest):
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
    _start_background(cmd, timeout_seconds=req.timeout_sec + 60)
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
    _start_background(cmd, timeout_seconds=req.timeout_sec + 60)
    return {"status": "started"}


class SingleSceneRequest(BaseModel):
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
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
        "--idea-index",        str(req.idea_index),
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
    prompt: str


@app.post("/generate/idea")
def generate_idea(req: IdeaRequest):
    system = (
        "You are a creative director for a YouTube animal channel. "
        "Generate 5 compelling, emotionally engaging video ideas based on the user's input. "
        "Each idea should have a bold title on its own line followed by a 2-3 sentence description. "
        "Focus on real animal behaviors, survival stories, or heartwarming moments. "
        "Format as a numbered list."
    )
    result = _deepseek_chat(system, req.prompt)
    return {"ideas": result}


class ScriptRequest(BaseModel):
    idea: str


@app.post("/generate/script")
def generate_script(req: ScriptRequest):
    system = (
        "You are a professional scriptwriter for a wildlife documentary YouTube channel. "
        "Write a compelling narration-ready script for the given video idea. "
        "The script should be 8-12 sentences. Each sentence is a self-contained scene or narration beat. "
        "Write in vivid, cinematic present-tense prose suitable for a nature documentary voiceover. "
        "Output ONLY the script sentences, one per line, no scene numbers or timestamps."
    )
    result = _deepseek_chat(system, req.idea)
    return {"script": result}


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7477, log_level="warning")
