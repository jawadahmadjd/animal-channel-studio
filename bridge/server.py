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

ROOT_DIR = Path(__file__).resolve().parents[1]
IDEAS_FILE = ROOT_DIR / "Ideas.md"
AUTH_FILE = ROOT_DIR / "state" / "flow_auth.json"
SETTINGS_FILE = ROOT_DIR / "state" / "flow_settings.json"
RUNS_DIR = ROOT_DIR / "state" / "runs"
LOGS_DIR = ROOT_DIR / "logs"
AUDIO_DIR = ROOT_DIR / "output" / "audio"

SCRIPTS_DIR = ROOT_DIR / "scripts"
PYTHON_EXE = sys.executable

# ── AI / TTS credentials ───────────────────────────────────────────────────────

DEEPSEEK_API_KEY  = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL    = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# Subprocess env: force UTF-8
_ENV = {**os.environ, "PYTHONUTF8": "1"}

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
    """Parse Ideas.md using the existing read_ideas module."""
    sys.path.insert(0, str(SCRIPTS_DIR))
    from read_ideas import parse_ideas
    ideas = parse_ideas(text)
    return [{"index": i.index, "title": i.title, "story_id": i.story_id} for i in ideas]


async def _stream_process(cmd: list[str], cwd: str) -> None:
    """Spawn a subprocess and push its stdout lines to _log_queue."""
    global _active_proc
    loop = asyncio.get_running_loop()

    def _run():
        global _active_proc
        try:
            _active_proc = subprocess.Popen(
                cmd, cwd=cwd,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, encoding="utf-8", errors="replace",
                env=_ENV,
            )
            assert _active_proc.stdout
            for line in _active_proc.stdout:
                loop.call_soon_threadsafe(_log_queue.put_nowait, line)
            code = _active_proc.wait()
            loop.call_soon_threadsafe(
                _log_queue.put_nowait, f"\n[Done — exit code {code}]\n"
            )
            loop.call_soon_threadsafe(_log_queue.put_nowait, None)  # sentinel
        except Exception as exc:
            loop.call_soon_threadsafe(
                _log_queue.put_nowait, f"\n[Error starting process: {exc}]\n"
            )
            loop.call_soon_threadsafe(_log_queue.put_nowait, None)
        finally:
            _active_proc = None

    await loop.run_in_executor(None, _run)


def _start_background(cmd: list[str]) -> None:
    """Fire-and-forget: start subprocess streaming in background task."""
    asyncio.create_task(_stream_process(cmd, str(ROOT_DIR)))


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
    return {"authorized": AUTH_FILE.exists()}


@app.delete("/auth")
def delete_auth():
    if AUTH_FILE.exists():
        AUTH_FILE.unlink()
    return {"status": "cleared"}


# ── Routes: Settings ───────────────────────────────────────────────────────────

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
    _start_background(cmd)
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
    _start_background(cmd)
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
            # Escape SSE: replace bare newlines inside the data value
            safe = line.replace("\n", "\\n")
            yield f"data: {safe}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Log file endpoint ──────────────────────────────────────────────────────────

@app.get("/logs/{filename}")
def get_log_file(filename: str):
    """Read a log file from the logs/ directory."""
    safe_name = Path(filename).name  # strip any path traversal
    log_path = LOGS_DIR / safe_name
    if not log_path.exists():
        return {"lines": []}
    text = log_path.read_text(encoding="utf-8", errors="replace")
    return {"lines": text.splitlines()}


# ── DeepSeek helper ────────────────────────────────────────────────────────────

def _deepseek_chat(system_prompt: str, user_message: str, temperature: float = 0.8) -> str:
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=400, detail="DEEPSEEK_API_KEY not configured")
    resp = _requests.post(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
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
    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=400, detail="ELEVENLABS_API_KEY not configured")
    resp = _requests.get(
        "https://api.elevenlabs.io/v1/voices",
        headers={"xi-api-key": ELEVENLABS_API_KEY},
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
    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=400, detail="ELEVENLABS_API_KEY not configured")
    resp = _requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{req.voice_id}",
        headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
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
