from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator
from urllib.parse import urlparse

import requests as _requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

# â”€â”€ Directory layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#
# Read-only assets (scripts, bridge code) always relative to this file:
#   dev  â†’ <project_root>/bridge/server.py  â†’  parents[1] = project_root
#   pkg  â†’ resources/bridge/server.py       â†’  parents[1] = resources/
#
# Writable data (state, output, logs) go to DATA_DIR:
#   dev  â†’ project_root  (same as ROOT_DIR)
#   pkg  â†’ %AppData%\AnimalChannelStudio  (set by Electron via env var)

ROOT_DIR  = Path(__file__).resolve().parents[1]   # scripts sibling in both dev & pkg
BASE_DATA_DIR  = Path(os.environ.get("ANIMAL_STUDIO_DATA_DIR", str(ROOT_DIR)))
SECRET_ENV_MAP = {
    "deepseek_api_key": "DEEPSEEK_API_KEY",
    "elevenlabs_api_key": "ELEVENLABS_API_KEY",
}
SECRET_SETTING_KEYS = frozenset(SECRET_ENV_MAP.keys())
SECRET_REDACTION = "***"

IDEAS_FILE    = ROOT_DIR / "Ideas.md"  # legacy; kept for _validate_idea_index fallback only
SCRIPTS_DIR   = ROOT_DIR / "scripts"
PYTHON_EXE    = sys.executable
BOOTSTRAP_APP_SETTINGS = BASE_DATA_DIR / "state" / "app_settings.json"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from audit_log import audit_error, audit_event, new_run_id, sanitize, summarize_text
from flow_intervals import (
    default_flow_intervals,
    flow_interval_fields,
    merge_flow_intervals,
    normalize_flow_intervals,
)


def _candidate_env_files() -> list[Path]:
    candidates: list[Path] = []
    explicit = os.environ.get("ANIMAL_STUDIO_ENV_FILE", "").strip()
    if explicit:
        candidates.append(Path(explicit).expanduser())
    candidates.append(BASE_DATA_DIR / ".env")
    candidates.append(ROOT_DIR / ".env")
    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _resolve_env_file() -> Path:
    for candidate in _candidate_env_files():
        if candidate.exists():
            return candidate
    return _candidate_env_files()[-1]


ENV_FILE = _resolve_env_file()
load_dotenv(ENV_FILE, override=False)


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _quote_env_value(value: str) -> str:
    if value == "":
        return ""
    if re.search(r'[\s#"\'=]', value):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def _upsert_env_vars(updates: dict[str, str]) -> None:
    if not updates:
        return
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    key_pattern = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
    key_to_index: dict[str, int] = {}
    for idx, line in enumerate(lines):
        match = key_pattern.match(line)
        if match:
            key_to_index[match.group(1)] = idx

    for key, value in updates.items():
        normalized = str(value).strip()
        env_line = f"{key}={_quote_env_value(normalized)}"
        if key in key_to_index:
            lines[key_to_index[key]] = env_line
        else:
            lines.append(env_line)
        os.environ[key] = normalized

    ENV_FILE.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    load_dotenv(ENV_FILE, override=True)


def _split_secret_settings(payload: dict) -> tuple[dict, dict]:
    secret_updates: dict[str, str] = {}
    safe_payload: dict = {}
    for key, value in payload.items():
        if key in SECRET_SETTING_KEYS:
            env_key = SECRET_ENV_MAP[key]
            normalized = str(value).strip()
            if normalized and normalized != SECRET_REDACTION:
                secret_updates[env_key] = normalized
            continue
        safe_payload[key] = value
    return safe_payload, secret_updates


def _sanitize_settings_file(path: Path, payload: dict) -> dict:
    safe_payload, secret_updates = _split_secret_settings(payload)
    if secret_updates:
        _upsert_env_vars(secret_updates)
    if safe_payload != payload:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(safe_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return safe_payload


def _resolve_initial_data_dir() -> Path:
    cfg = _read_json(BOOTSTRAP_APP_SETTINGS)
    configured = str(cfg.get("output_dir", "")).strip()
    if not configured:
        return BASE_DATA_DIR
    try:
        return Path(configured).expanduser().resolve()
    except Exception:
        return Path(configured).expanduser()


def _paths_for(data_dir: Path) -> dict[str, Path]:
    return {
        "data_dir": data_dir,
        "ideas_db": data_dir / "state" / "ideas_db.json",
        "auth": data_dir / "state" / "flow_auth.json",
        "settings": data_dir / "state" / "flow_settings.json",
        "app_settings": data_dir / "state" / "app_settings.json",
        "runs": data_dir / "state" / "runs",
        "logs": data_dir / "logs",
        "audio": data_dir / "output" / "audio",
        "live_flow_buffer": data_dir / "state" / "live_flow_buffer.json",
        "output": data_dir / "output",
        "downloads": data_dir / "downloads",
    }


DATA_DIR = _resolve_initial_data_dir()
_P = _paths_for(DATA_DIR)
IDEAS_DB_FILE = _P["ideas_db"]
AUTH_FILE = _P["auth"]
SETTINGS_FILE = _P["settings"]
APP_SETTINGS = _P["app_settings"]
RUNS_DIR = _P["runs"]
LOGS_DIR = _P["logs"]
AUDIO_DIR = _P["audio"]
LIVE_FLOW_BUFFER_FILE = _P["live_flow_buffer"]
OUTPUT_DIR = _P["output"]
DOWNLOADS_DIR = _P["downloads"]


def _ensure_data_dirs() -> None:
    for _d in (AUTH_FILE.parent, RUNS_DIR, LOGS_DIR, AUDIO_DIR, OUTPUT_DIR, DOWNLOADS_DIR):
        _d.mkdir(parents=True, exist_ok=True)


# â”€â”€ Ensure writable dirs exist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_ensure_data_dirs()

# â”€â”€ Session logger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Each bridge launch gets its own timestamped log file so you can send a user
# a specific file (e.g. session_20250427_143012.log) to diagnose their problem.

_SESSION_START = datetime.now(timezone.utc)
_SESSION_LOG_FILE = LOGS_DIR / f"session_{_SESSION_START.strftime('%Y%m%d_%H%M%S')}.log"

_log_fmt = logging.Formatter(
    fmt="%(asctime)s.%(msecs)03d [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

blog = logging.getLogger("bridge")
blog.setLevel(logging.DEBUG)

_fh = logging.FileHandler(_SESSION_LOG_FILE, encoding="utf-8")
_fh.setLevel(logging.DEBUG)
_fh.setFormatter(_log_fmt)
blog.addHandler(_fh)

_ch = logging.StreamHandler(sys.stdout)
_ch.setLevel(logging.INFO)
_ch.setFormatter(_log_fmt)
blog.addHandler(_ch)

blog.info(f"Session log: {_SESSION_LOG_FILE}")
blog.info(f"ROOT_DIR={ROOT_DIR}  DATA_DIR={DATA_DIR}")
audit_event(
    "bridge.session.start",
    {
        "session_log": str(_SESSION_LOG_FILE),
        "root_dir": str(ROOT_DIR),
        "data_dir": str(DATA_DIR),
        "python_exe": PYTHON_EXE,
        "pid": os.getpid(),
    },
)

# â”€â”€ App settings (merged from app_settings.json + env vars) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_DEFAULT_APP_SETTINGS = {
    "output_dir": "",
    "flow_headless": False,
    "wait_between_scenes": 5,
    "max_retries_per_scene": 3,
    "pipeline_timeout_sec": 300,
    "confirm_costly_operations": True,
    "theme": "system",
    "onboarding_complete": False,
    "prompt_idea_generation": "",
    "prompt_script_generation": "",
    "prompt_vo_narration_generation": "",
    "prompt_veo_prompt_generation": "",
    # Legacy combined prompt key (kept for backward compatibility)
    "prompt_vo_prompt_generation": "",
    "prompt_story_master_template": "",
    "flow_intervals": default_flow_intervals(),
}

_PROMPT_SETTINGS_KEYS = (
    "prompt_idea_generation",
    "prompt_script_generation",
    "prompt_vo_narration_generation",
    "prompt_veo_prompt_generation",
    "prompt_vo_prompt_generation",
    "prompt_story_master_template",
)

_DEFAULT_IDEA_GENERATION_PROMPT = (
    "You are a creative content strategist for YouTube. "
    "Your job is to generate exactly {idea_count} compelling video ideas for a given niche and content type. "
    "Return ONLY a JSON array with exactly {idea_count} objects. Each object must have exactly two keys: "
    '"title" (a short, punchy video title) and "description" (one sentence explaining the idea). '
    "No markdown, no extra text, no numbering outside the JSON. Output valid JSON only."
)

_DEFAULT_SCRIPT_GENERATION_PROMPT = (
    "You are a professional scriptwriter specializing in {niche} content for YouTube. "
    "Write a compelling, narration-ready video script for the given idea. "
    "The script MUST be approximately {target_words} words - aim for exactly {target_words} words. "
    "Each sentence is a self-contained scene or narration beat. "
    "Write in vivid, engaging, present-tense prose suitable for a voiceover. "
    "Output ONLY the script sentences, one per line, no scene numbers, no timestamps, no headings."
)

_DEFAULT_VO_NARRATION_GENERATION_PROMPT = (
    "You are an expert voiceover writer for wildlife documentary videos. "
    "For each sentence in the script, return a JSON array where every element has exactly two keys:\n"
    '  "sentence" - the original sentence (verbatim)\n'
    '  "narration" - a warm, conversational, narration-ready line for TTS\n\n'
    "Return ONLY a valid JSON array. No markdown fences, no explanation."
)

_DEFAULT_VEO_PROMPT_GENERATION_PROMPT = (
    "You are an expert cinematic prompt engineer for AI video generation. "
    "For each sentence in the script, return a JSON array where every element has exactly two keys:\n"
    '  "sentence" - the original sentence (verbatim)\n'
    '  "veo_prompt" - a detailed VEO 3 video generation prompt: camera angle, lighting, animal behavior, '
    "environment, mood\n\n"
    "Return ONLY a valid JSON array. No markdown fences, no explanation."
)


def _default_story_master_prompt() -> str:
    path = ROOT_DIR / "Master_Prompts.md"
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return (
            "Generate cinematic wildlife scenes from the idea input. "
            "Return only a table with Scene, VO Narration, and VEO 3 Prompt."
        )


def _default_prompt_values() -> dict[str, str]:
    return {
        "prompt_idea_generation": _DEFAULT_IDEA_GENERATION_PROMPT,
        "prompt_script_generation": _DEFAULT_SCRIPT_GENERATION_PROMPT,
        "prompt_vo_narration_generation": _DEFAULT_VO_NARRATION_GENERATION_PROMPT,
        "prompt_veo_prompt_generation": _DEFAULT_VEO_PROMPT_GENERATION_PROMPT,
        "prompt_story_master_template": _default_story_master_prompt(),
    }


def _effective_prompt_settings(cfg: dict | None = None) -> dict[str, str]:
    cfg = cfg or _load_app_settings()
    defaults = _default_prompt_values()
    effective: dict[str, str] = {}
    legacy_combined = str(cfg.get("prompt_vo_prompt_generation", "")).strip()
    for key, default_value in defaults.items():
        value = str(cfg.get(key, "")).strip()
        if value:
            effective[key] = value
            continue
        if key in {"prompt_vo_narration_generation", "prompt_veo_prompt_generation"} and legacy_combined:
            effective[key] = legacy_combined
            continue
        effective[key] = default_value
    # Surface legacy key too so existing callsites remain tolerant.
    effective["prompt_vo_prompt_generation"] = legacy_combined or (
        _DEFAULT_VO_NARRATION_GENERATION_PROMPT + "\n\n" + _DEFAULT_VEO_PROMPT_GENERATION_PROMPT
    )
    return effective


def _render_prompt_template(template: str, values: dict[str, Any]) -> str:
    rendered = template
    for key, value in values.items():
        token = str(value)
        rendered = rendered.replace(f"{{{{{key}}}}}", token)
        rendered = rendered.replace(f"{{{key}}}", token)
    return rendered


def _flow_wait_bounds(wait_between_sec: int, wait_max_sec: int) -> tuple[int, int]:
    """Keep Flow submissions paced conservatively to reduce account flags."""
    safe_min = max(20, int(wait_between_sec))
    safe_max = max(safe_min, int(wait_max_sec))
    return safe_min, safe_max


def _flow_runtime_from_settings() -> dict:
    cfg = _load_app_settings()
    wait_between = int(cfg.get("wait_between_scenes", 5) or 5)
    wait_max = wait_between + 10
    safe_wait_between, safe_wait_max = _flow_wait_bounds(wait_between, wait_max)
    intervals = normalize_flow_intervals(cfg.get("flow_intervals"))
    return {
        "wait_between_sec": safe_wait_between,
        "wait_max_sec": safe_wait_max,
        "scene_max_retries": int(cfg.get("max_retries_per_scene", 3) or 3),
        "timeout_sec": int(cfg.get("pipeline_timeout_sec", 300) or 300),
        "headless": bool(cfg.get("flow_headless", False)),
        "flow_intervals": intervals,
    }


def _load_app_settings() -> dict:
    saved = _read_json(APP_SETTINGS)
    if saved:
        saved = _sanitize_settings_file(APP_SETTINGS, saved)
    if not saved and APP_SETTINGS != BOOTSTRAP_APP_SETTINGS:
        # First run after data-dir migration: bootstrap settings can seed the new location.
        saved = _read_json(BOOTSTRAP_APP_SETTINGS)
        if saved:
            saved = _sanitize_settings_file(BOOTSTRAP_APP_SETTINGS, saved)
    merged = {**_DEFAULT_APP_SETTINGS, **saved}
    merged["flow_intervals"] = merge_flow_intervals(
        _DEFAULT_APP_SETTINGS.get("flow_intervals"),
        saved.get("flow_intervals") if isinstance(saved, dict) else None,
    )
    if not merged.get("output_dir"):
        merged["output_dir"] = str(DATA_DIR)
    return merged


def _save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _copy_path(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if src.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            _copy_path(child, dst / child.name)
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _migrate_data_dir(old_dir: Path, new_dir: Path) -> None:
    try:
        if old_dir.resolve() == new_dir.resolve():
            return
    except Exception:
        if str(old_dir) == str(new_dir):
            return
    new_dir.mkdir(parents=True, exist_ok=True)
    for name in ("state", "logs", "output", "downloads", "Stories.md"):
        _copy_path(old_dir / name, new_dir / name)


def _set_data_dir(new_dir: Path, migrate_from: Path | None = None) -> None:
    global DATA_DIR, IDEAS_DB_FILE, AUTH_FILE, SETTINGS_FILE, APP_SETTINGS, RUNS_DIR, LOGS_DIR
    global AUDIO_DIR, LIVE_FLOW_BUFFER_FILE, OUTPUT_DIR, DOWNLOADS_DIR, _ENV

    if migrate_from is not None:
        _migrate_data_dir(migrate_from, new_dir)

    DATA_DIR = new_dir
    p = _paths_for(DATA_DIR)
    IDEAS_DB_FILE = p["ideas_db"]
    AUTH_FILE = p["auth"]
    SETTINGS_FILE = p["settings"]
    APP_SETTINGS = p["app_settings"]
    RUNS_DIR = p["runs"]
    LOGS_DIR = p["logs"]
    AUDIO_DIR = p["audio"]
    LIVE_FLOW_BUFFER_FILE = p["live_flow_buffer"]
    OUTPUT_DIR = p["output"]
    DOWNLOADS_DIR = p["downloads"]
    _ensure_data_dirs()
    _ENV["ANIMAL_STUDIO_DATA_DIR"] = str(DATA_DIR)


def _sync_bootstrap_settings(current: dict) -> None:
    safe_current, secret_updates = _split_secret_settings(current)
    if secret_updates:
        _upsert_env_vars(secret_updates)
    _save_json(BOOTSTRAP_APP_SETTINGS, {**safe_current, "output_dir": str(DATA_DIR)})


def _save_app_settings(new_values: dict) -> None:
    APP_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    safe_values, secret_updates = _split_secret_settings(new_values)
    if secret_updates:
        _upsert_env_vars(secret_updates)
        if "_ENV" in globals():
            _ENV.update(secret_updates)

    current = _load_app_settings()
    for k, v in safe_values.items():
        current[k] = v
    configured_dir = str(current.get("output_dir", "")).strip()
    if configured_dir:
        try:
            target_dir = Path(configured_dir).expanduser().resolve()
        except Exception:
            target_dir = Path(configured_dir).expanduser()
        _set_data_dir(target_dir, migrate_from=DATA_DIR)
    current["output_dir"] = str(DATA_DIR)
    _save_json(APP_SETTINGS, current)
    _sync_bootstrap_settings(current)


# â”€â”€ Credential resolution (settings file > env vars) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _get_api_key(env_key: str) -> str:
    return os.getenv(env_key, "").strip()


def _deepseek_key() -> str:
    return _get_api_key("DEEPSEEK_API_KEY")


def _elevenlabs_key() -> str:
    return _get_api_key("ELEVENLABS_API_KEY")


def _external_request(
    provider: str,
    method: str,
    url: str,
    *,
    operation: str,
    headers: dict | None = None,
    json_body: dict | None = None,
    timeout: int = 60,
) -> _requests.Response:
    started = time.monotonic()
    audit_event(
        "api.request",
        {
            "provider": provider,
            "operation": operation,
            "method": method.upper(),
            "url": url,
            "headers": sanitize(headers or {}),
            "json": sanitize(json_body or {}),
            "timeout": timeout,
        },
    )
    try:
        resp = _requests.request(
            method=method.upper(),
            url=url,
            headers=headers,
            json=json_body,
            timeout=timeout,
        )
        content_type = (resp.headers.get("content-type") or "").lower()
        if "json" in content_type or "text" in content_type:
            response_body: dict | str = summarize_text(resp.text, limit=1200)
        else:
            response_body = {"bytes": len(resp.content), "content_type": content_type}
        audit_event(
            "api.response",
            {
                "provider": provider,
                "operation": operation,
                "method": method.upper(),
                "url": url,
                "status_code": resp.status_code,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
                "content_type": content_type,
                "response": response_body,
            },
        )
        return resp
    except Exception as exc:
        audit_error(
            "api.error",
            exc,
            {"provider": provider, "operation": operation, "method": method.upper(), "url": url},
        )
        raise


DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL    = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# Startup key presence check (C5)
_config_status = {
    "deepseek":   bool(_deepseek_key()),
    "elevenlabs": bool(_elevenlabs_key()),
}

# Subprocess env â€” include scripts/ so run_pipeline.py can import flow_automation etc.
_scripts_path = str(ROOT_DIR / "scripts")
_existing_pythonpath = os.environ.get("PYTHONPATH", "")
_ENV = {
    **os.environ,
    "PYTHONUTF8": "1",
    "PYTHONPATH": f"{_scripts_path}{os.pathsep}{_existing_pythonpath}" if _existing_pythonpath else _scripts_path,
    "ANIMAL_STUDIO_DATA_DIR": str(DATA_DIR),
}

if not _config_status["deepseek"]:
    blog.warning("DEEPSEEK_API_KEY not configured - add it to .env or your environment")
if not _config_status["elevenlabs"]:
    blog.warning("ELEVENLABS_API_KEY not configured - add it to .env or your environment")

# â”€â”€ FastAPI app â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

BRIDGE_VERSION = 2  # Increment whenever API contracts change

app = FastAPI(title="Animal Channel Bridge", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class _RequestLogMiddleware(BaseHTTPMiddleware):
    """Log every HTTP request + response with timing."""

    # Keys whose values should never appear in logs
    _REDACT = {"deepseek_api_key", "elevenlabs_api_key", "xi-api-key", "Authorization"}

    async def dispatch(self, request: Request, call_next):
        t0 = time.monotonic()
        path = request.url.path
        method = request.method

        # Skip noisy polling and binary/streaming endpoints.
        skip_log = (
            path in ("/run/stream", "/output/watch", "/flow/live-buffer/watch", "/health")
            or path.startswith("/audio/")
            or path.startswith("/output/file")
            or path.startswith("/logs/download/")
        )

        body_str = ""
        request_body = {}
        if not skip_log and method in ("POST", "PUT", "PATCH"):
            try:
                raw = await request.body()
                body = json.loads(raw) if raw else {}
                body = self._redact(body)
                request_body = body
                body_str = f" body={json.dumps(body, separators=(',', ':'))}"
                # Rebuild the body so FastAPI can still read it
                async def _receive():
                    return {"type": "http.request", "body": raw}
                request = Request(request.scope, _receive)
            except Exception:
                pass

        if not skip_log:
            audit_event(
                "bridge.http.request",
                {
                    "method": method,
                    "path": path,
                    "query": str(request.url.query),
                    "body": request_body,
                },
            )

        response = await call_next(request)
        ms = int((time.monotonic() - t0) * 1000)
        response_payload: dict | str = ""

        if not skip_log:
            body_bytes = b""
            async for chunk in response.body_iterator:
                body_bytes += chunk
            media_type = response.media_type or response.headers.get("content-type", "")
            text = body_bytes.decode("utf-8", errors="replace")
            try:
                response_payload = self._redact(json.loads(text)) if text else {}
            except Exception:
                response_payload = summarize_text(text, limit=1200)
            headers = dict(response.headers)
            headers.pop("content-length", None)
            response = Response(
                content=body_bytes,
                status_code=response.status_code,
                headers=headers,
            )

        if not skip_log:
            blog.info(f"[http] {method} {path}{body_str} â†’ {response.status_code} ({ms}ms)")

        if not skip_log:
            audit_event(
                "bridge.http.response",
                {
                    "method": method,
                    "path": path,
                    "status_code": response.status_code,
                    "elapsed_ms": ms,
                    "body": response_payload,
                },
            )

        return response

    def _redact(self, obj):
        if isinstance(obj, dict):
            return {
                k: ("***" if k in self._REDACT and v else self._redact(v))
                for k, v in obj.items()
            }
        if isinstance(obj, list):
            return [self._redact(v) for v in obj[:60]]
        return obj


app.add_middleware(_RequestLogMiddleware)

# â”€â”€ Active subprocess state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_active_proc: subprocess.Popen | None = None
_log_queue: asyncio.Queue[str | None] = asyncio.Queue()


# â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


def _metadata_hash(entry: dict) -> str:
    payload = {
        "title": entry.get("title", ""),
        "description": entry.get("description", ""),
        "script": entry.get("script", ""),
        "vo_narrations": entry.get("vo_narrations", []),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _flow_prompt_hash_from_entry(entry: dict) -> str:
    payload = {
        "title": entry.get("title", ""),
        "scenes": [
            {
                "sentence": item.get("sentence", ""),
                "narration": item.get("narration", ""),
                "veo_prompt": item.get("veo_prompt", ""),
            }
            for item in entry.get("vo_narrations", [])
        ],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _flow_prompt_hash_from_run_state(state: dict) -> str:
    story_payload = state.get("story_payload", {})
    payload = {
        "title": story_payload.get("story_title", ""),
        "scenes": [
            {
                "sentence": item.get("scene_name", ""),
                "narration": item.get("vo", ""),
                "veo_prompt": item.get("veo_prompt", ""),
            }
            for item in story_payload.get("scenes", [])
        ],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]



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
        # psutil not available or process already dead â€” fall back
        try:
            import signal
            os.kill(pid, signal.SIGTERM if os.name != 'nt' else signal.CTRL_BREAK_EVENT)
        except Exception:
            pass


async def _stream_process(cmd: list[str], cwd: str, timeout_seconds: int = 1800) -> None:
    """Spawn a subprocess, push stdout lines to _log_queue, kill after timeout."""
    global _active_proc
    loop = asyncio.get_running_loop()
    run_id = new_run_id("subprocess")

    def _run():
        global _active_proc
        import threading
        import re as _re

        short_cmd = " ".join(str(a) for a in cmd[-6:])  # last 6 args for brevity
        audit_event(
            "subprocess.start",
            {"run_id": run_id, "cmd": cmd, "cwd": cwd, "timeout_seconds": timeout_seconds},
            run_id=run_id,
        )
        blog.info(f"[subprocess] START  cmd=â€¦{short_cmd}  cwd={cwd}  timeout={timeout_seconds}s")

        def _timeout_kill():
            proc = _active_proc
            if proc and proc.poll() is None:
                msg = f'\n[Error: Pipeline timed out after {timeout_seconds // 60} minutes. Stopping.]\n'
                blog.error(f"[subprocess] TIMEOUT after {timeout_seconds}s â€” killing PID {proc.pid}")
                audit_event("subprocess.timeout", {"pid": proc.pid, "timeout_seconds": timeout_seconds}, run_id=run_id)
                loop.call_soon_threadsafe(_log_queue.put_nowait, msg)
                _kill_proc_tree(proc.pid)

        timer = threading.Timer(timeout_seconds, _timeout_kill)

        def emit(line: str) -> None:
            loop.call_soon_threadsafe(_log_queue.put_nowait, line)

        # Open a per-run section in the session log file
        with open(_SESSION_LOG_FILE, "a", encoding="utf-8") as _sf:
            def tee(line: str) -> None:
                emit(line)
                _sf.write(line)
                _sf.flush()

            try:
                _active_proc = subprocess.Popen(
                    cmd, cwd=cwd,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, bufsize=1, encoding="utf-8", errors="replace",
                    env={**_ENV, "ANIMAL_STUDIO_RUN_ID": run_id},
                )
                blog.info(f"[subprocess] PID={_active_proc.pid}")
                audit_event("subprocess.pid", {"pid": _active_proc.pid}, run_id=run_id)
                timer.start()
                assert _active_proc.stdout

                tb_buf: list[str] = []
                in_tb = False

                for raw_line in _active_proc.stdout:
                    # Tee raw line to both the SSE stream and the session log
                    tee(raw_line)
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
                            blog.error(f"[subprocess] Python exception: {stripped[:200]}")
                            audit_event(
                                "subprocess.traceback",
                                {"exception": stripped, "traceback": "\n".join(tb_buf)},
                                run_id=run_id,
                            )
                            in_tb = False
                            tb_buf = []
                        elif stripped and stripped[0] not in (' ', '\t', '|', '+', '_') and stripped != '':
                            # Non-indented line that is not an exception â†’ end tb without match
                            in_tb = False
                            tb_buf = []

                code = _active_proc.wait()
                done_msg = f"\n[Done â€” exit code {code}]\n"
                tee(done_msg)
                blog.info(f"[subprocess] EXIT code={code}")
                audit_event("subprocess.exit", {"exit_code": code}, run_id=run_id)
                loop.call_soon_threadsafe(_log_queue.put_nowait, None)
            except Exception as exc:
                err_msg = f"\n[Error starting process: {exc}]\n"
                tee(err_msg)
                blog.error(f"[subprocess] FAILED to start: {exc}")
                audit_error("subprocess.error", exc, {"cmd": cmd, "cwd": cwd})
                loop.call_soon_threadsafe(_log_queue.put_nowait, None)
            finally:
                timer.cancel()
                _active_proc = None

    await loop.run_in_executor(None, _run)


def _start_background(cmd: list[str], timeout_seconds: int = 1800) -> None:
    asyncio.create_task(_stream_process(cmd, str(ROOT_DIR), timeout_seconds))


def _normalize_scene_status(raw: str) -> str:
    s = str(raw or "").strip().lower()
    if s == "done":
        return "completed"
    return s or "pending"


def _existing_files(paths: list[str]) -> list[str]:
    valid: list[str] = []
    for p in paths:
        try:
            if Path(str(p)).exists():
                valid.append(str(p))
        except Exception:
            continue
    return valid


def _reconcile_run_state_file(story_id: str) -> tuple[dict, bool]:
    """Normalize persisted run-state so resume is deterministic after restarts/stops."""
    run_file = RUNS_DIR / f"{story_id}.json"
    if not run_file.exists():
        raise HTTPException(status_code=404, detail="No saved run state for this story")

    try:
        state = json.loads(run_file.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="Could not read run state file")

    changed = False
    now_iso = datetime.now(timezone.utc).isoformat()
    scenes = state.get("scenes", [])

    for scene in scenes:
        normalized = _normalize_scene_status(scene.get("status", "pending"))
        if normalized != scene.get("status"):
            scene["status"] = normalized
            changed = True

        if scene.get("status") == "running":
            scene["status"] = "pending"
            scene["updated_at"] = now_iso
            changed = True

        if scene.get("status") == "completed":
            downloads = scene.get("downloads", [])
            valid_downloads = _existing_files(downloads if isinstance(downloads, list) else [])
            if valid_downloads:
                if valid_downloads != downloads:
                    scene["downloads"] = valid_downloads
                    changed = True
            else:
                scene["status"] = "pending"
                scene["downloads"] = []
                scene["error"] = "Recovered after restart: missing completed media files."
                scene["updated_at"] = now_iso
                changed = True

    all_completed = all(
        str(s.get("status", "")).lower() in ("completed", "skipped")
        for s in scenes
    )
    desired_run_status = "completed" if all_completed else "in_progress"
    if state.get("run_status") != desired_run_status:
        state["run_status"] = desired_run_status
        changed = True

    if changed:
        state["updated_at"] = now_iso
        run_file.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")

    return state, changed


# â”€â”€ Route: Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/health")
def health_check():
    keys = {
        "deepseek":   bool(_deepseek_key()),
        "elevenlabs": bool(_elevenlabs_key()),
    }
    return {
        "status": "ok",
        "bridge_version": BRIDGE_VERSION,
        "python_version": sys.version,
        "data_dir": str(DATA_DIR),
        "keys": keys,
    }


# â”€â”€ Routes: Ideas DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    entry = {
        "story_id": story_id,
        "title": req.title,
        "description": req.description,
        "script": req.script,
        "vo_narrations": req.vo_narrations,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    entry["metadata_hash"] = _metadata_hash(entry)
    entry["flow_prompt_hash"] = _flow_prompt_hash_from_entry(entry)
    db[story_id] = entry
    _save_ideas_db(db)
    return {
        "story_id": story_id,
        "metadata_hash": entry["metadata_hash"],
        "flow_prompt_hash": entry["flow_prompt_hash"],
    }


@app.get("/ideas/db")
def get_ideas_db():
    db = _load_ideas_db()
    changed = False
    for story_id, entry in list(db.items()):
        current_hash = _metadata_hash(entry)
        if entry.get("metadata_hash") != current_hash:
            entry["metadata_hash"] = current_hash
            db[story_id] = entry
            changed = True
        current_flow_hash = _flow_prompt_hash_from_entry(entry)
        if entry.get("flow_prompt_hash") != current_flow_hash:
            entry["flow_prompt_hash"] = current_flow_hash
            db[story_id] = entry
            changed = True
    if changed:
        _save_ideas_db(db)
    return list(db.values())


@app.delete("/ideas/db/{story_id}")
def delete_idea_from_db(story_id: str):
    if not re.match(r'^[a-zA-Z0-9_\-]{1,120}$', story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")

    db = _load_ideas_db()
    entry = db.pop(story_id, None)
    _save_ideas_db(db)
    run_file = RUNS_DIR / f"{story_id}.json"
    run_state_deleted = False
    if run_file.exists():
        run_file.unlink()
        run_state_deleted = True
    return {"status": "deleted", "found": entry is not None, "run_state_deleted": run_state_deleted}


@app.post("/ideas/db/{story_id}/clear-metadata")
def clear_idea_metadata(story_id: str):
    if not re.match(r'^[a-zA-Z0-9_\-]{1,120}$', story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")

    db = _load_ideas_db()
    entry = db.get(story_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Idea not found")

    entry["script"] = ""
    entry["vo_narrations"] = []
    entry["metadata_cleared_at"] = datetime.now(timezone.utc).isoformat()
    entry["metadata_hash"] = _metadata_hash(entry)
    entry["flow_prompt_hash"] = _flow_prompt_hash_from_entry(entry)
    db[story_id] = entry
    _save_ideas_db(db)

    run_file = RUNS_DIR / f"{story_id}.json"
    run_state_deleted = False
    if run_file.exists():
        run_file.unlink()
        run_state_deleted = True

    return {"status": "metadata_cleared", "story_id": story_id, "run_state_deleted": run_state_deleted}


# â”€â”€ Routes: Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/auth/status")
def get_auth_status():
    keys_configured = {
        "deepseek":   bool(_deepseek_key()),
        "elevenlabs": bool(_elevenlabs_key()),
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


# â”€â”€ Routes: Flow Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/settings")
def get_settings():
    if not SETTINGS_FILE.exists():
        return {
            "mode": "Video",
            "sub_type": "Frames",
            "aspect_ratio": "9:16",
            "clip_count": "x4",
            "duration": "8s",
            "model": "Veo 3.1 - Fast",
        }
    return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))


class SettingsPayload(BaseModel):
    mode: str = "Video"
    sub_type: str = "Frames"
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


# â”€â”€ Routes: App Settings (C3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/settings/app")
def get_app_settings():
    cfg = _load_app_settings()
    prompt_values = _effective_prompt_settings(cfg)
    flow_intervals = normalize_flow_intervals(cfg.get("flow_intervals"))
    # Redact key values â€” return *** if set
    return {
        "deepseek_api_key":      SECRET_REDACTION if _deepseek_key() else "",
        "elevenlabs_api_key":    SECRET_REDACTION if _elevenlabs_key() else "",
        "output_dir":            str(DATA_DIR),
        "flow_headless":         cfg.get("flow_headless", False),
        "wait_between_scenes":   cfg.get("wait_between_scenes", 5),
        "max_retries_per_scene": cfg.get("max_retries_per_scene", 3),
        "pipeline_timeout_sec":          cfg.get("pipeline_timeout_sec", 300),
        "confirm_costly_operations":     cfg.get("confirm_costly_operations", True),
        "theme":                         cfg.get("theme", "system"),
        "onboarding_complete":           cfg.get("onboarding_complete", False),
        "prompt_idea_generation":        prompt_values["prompt_idea_generation"],
        "prompt_script_generation":      prompt_values["prompt_script_generation"],
        "prompt_vo_narration_generation": prompt_values["prompt_vo_narration_generation"],
        "prompt_veo_prompt_generation":   prompt_values["prompt_veo_prompt_generation"],
        "prompt_vo_prompt_generation":   prompt_values["prompt_vo_prompt_generation"],
        "prompt_story_master_template":  prompt_values["prompt_story_master_template"],
        "flow_intervals":                flow_intervals,
        "flow_interval_fields":          flow_interval_fields(),
        "first_launch":                  not APP_SETTINGS.exists(),
    }


class AppSettingsPayload(BaseModel):
    deepseek_api_key: str = ""
    elevenlabs_api_key: str = ""
    output_dir: str = ""
    flow_headless: bool = False
    wait_between_scenes: int = 5
    max_retries_per_scene: int = 3
    pipeline_timeout_sec: int = 300
    confirm_costly_operations: bool = True
    theme: str = "system"
    onboarding_complete: bool = False
    prompt_idea_generation: str = ""
    prompt_script_generation: str = ""
    prompt_vo_narration_generation: str = ""
    prompt_veo_prompt_generation: str = ""
    prompt_vo_prompt_generation: str = ""
    prompt_story_master_template: str = ""
    flow_intervals: dict[str, int] = Field(default_factory=dict)

    def validate_fields(self) -> None:
        if not (0 <= self.wait_between_scenes <= 120):
            raise HTTPException(status_code=422, detail="wait_between_scenes must be between 0 and 120")
        if not (1 <= self.max_retries_per_scene <= 10):
            raise HTTPException(status_code=422, detail="max_retries_per_scene must be between 1 and 10")
        if self.theme not in {"light", "dark", "system"}:
            raise HTTPException(status_code=422, detail="theme must be light, dark, or system")
        for key in _PROMPT_SETTINGS_KEYS:
            value = str(getattr(self, key, "") or "")
            if len(value) > 100_000:
                raise HTTPException(status_code=422, detail=f"{key} is too long")
        normalize_flow_intervals(self.flow_intervals)


@app.post("/settings/app")
def save_app_settings(payload: AppSettingsPayload):
    payload.validate_fields()
    patch_payload = payload.model_dump(exclude_unset=True)
    if "flow_intervals" in patch_payload:
        patch_payload["flow_intervals"] = normalize_flow_intervals(patch_payload.get("flow_intervals"))
    # Treat this endpoint as PATCH semantics: only persist fields provided
    # by the caller so partial saves do not reset unrelated settings.
    _save_app_settings(patch_payload)
    # Refresh startup config status
    global _config_status
    _config_status = {
        "deepseek":   bool(_deepseek_key()),
        "elevenlabs": bool(_elevenlabs_key()),
    }
    return {"status": "saved"}


# â”€â”€ Routes: API Key Validation (C3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.post("/validate/deepseek")
def validate_deepseek():
    key = _deepseek_key()
    if not key:
        return {"ok": False, "error": "No DeepSeek API key configured"}
    try:
        resp = _external_request(
            "deepseek",
            "GET",
            f"{DEEPSEEK_BASE_URL}/models",
            operation="validate_key",
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
        resp = _external_request(
            "elevenlabs",
            "GET",
            "https://api.elevenlabs.io/v1/voices",
            operation="validate_key",
            headers={"xi-api-key": key},
            timeout=10,
        )
        resp.raise_for_status()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# â”€â”€ Routes: Run â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class LoginRequest(BaseModel):
    headless: bool | None = None


@app.post("/run/login")
async def run_login(req: LoginRequest):
    runtime = _flow_runtime_from_settings()
    headless = runtime["headless"]
    _ENV["FLOW_INTERVALS_JSON"] = json.dumps(runtime["flow_intervals"], ensure_ascii=False)
    blog.info(f"[run/login] headless={headless}")
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "flow_automation.py"),
        "--mode", "login",
        "--headless", "true" if headless else "false",
        "--auth-path", str(AUTH_FILE),
    ]
    _start_background(cmd)
    return {"status": "started"}


class PipelineRequest(BaseModel):
    story_id: str | None = None
    idea_index: int = 1


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
    runtime = _flow_runtime_from_settings()
    wait_between_sec = runtime["wait_between_sec"]
    wait_max_sec = runtime["wait_max_sec"]
    scene_max_retries = runtime["scene_max_retries"]
    timeout_sec = runtime["timeout_sec"]
    headless = runtime["headless"]
    _ENV["FLOW_INTERVALS_JSON"] = json.dumps(runtime["flow_intervals"], ensure_ascii=False)
    blog.info(
        f"[run/pipeline] story_id={req.story_id!r} idea_index={req.idea_index} "
        f"headless={headless} timeout={timeout_sec}s wait={wait_between_sec}-{wait_max_sec}s retries={scene_max_retries}"
    )
    if req.story_id:
        if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
            raise HTTPException(status_code=422, detail="Invalid story_id format")
        cmd = [
            PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
            "--story-id",          req.story_id,
            "--wait-between-sec",  str(wait_between_sec),
            "--wait-max-sec",      str(wait_max_sec),
            "--scene-max-retries", str(scene_max_retries),
            "--timeout-sec",       str(timeout_sec),
            "--confirm-costly",    "false",
            "--headless",          "true" if headless else "false",
        ]
    else:
        _validate_idea_index(req.idea_index)
        cmd = [
            PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
            "--idea-index",        str(req.idea_index),
            "--wait-between-sec",  str(wait_between_sec),
            "--wait-max-sec",      str(wait_max_sec),
            "--scene-max-retries", str(scene_max_retries),
            "--timeout-sec",       str(timeout_sec),
            "--confirm-costly",    "false",
            "--headless",          "true" if headless else "false",
        ]
    _start_background(cmd, timeout_seconds=timeout_sec * 20 + 300)
    return {"status": "started"}


class ResumeRequest(BaseModel):
    story_id: str


@app.post("/run/resume")
async def run_resume(req: ResumeRequest):
    runtime = _flow_runtime_from_settings()
    wait_between_sec = runtime["wait_between_sec"]
    wait_max_sec = runtime["wait_max_sec"]
    scene_max_retries = runtime["scene_max_retries"]
    timeout_sec = runtime["timeout_sec"]
    headless = runtime["headless"]
    _ENV["FLOW_INTERVALS_JSON"] = json.dumps(runtime["flow_intervals"], ensure_ascii=False)
    blog.info(
        f"[run/resume] story_id={req.story_id!r} headless={headless} "
        f"timeout={timeout_sec}s wait={wait_between_sec}-{wait_max_sec}s retries={scene_max_retries}"
    )
    # Validate story_id to prevent path traversal
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")
    state, reconciled = _reconcile_run_state_file(req.story_id)
    if reconciled:
        blog.info(f"[run/resume] reconciled run-state for story_id={req.story_id!r}")
    if state.get("run_status") == "completed":
        return {
            "status": "already_completed",
            "story_id": req.story_id,
            "message": "Run is already complete; skipping resume.",
        }
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
        "--resume",            req.story_id,
        "--wait-between-sec",  str(wait_between_sec),
        "--wait-max-sec",      str(wait_max_sec),
        "--scene-max-retries", str(scene_max_retries),
        "--timeout-sec",       str(timeout_sec),
        "--confirm-costly",    "false",
        "--headless",          "true" if headless else "false",
    ]
    _start_background(cmd, timeout_seconds=timeout_sec * 20 + 300)
    return {"status": "started"}


class FinalizeRequest(BaseModel):
    story_id: str


@app.post("/run/finalize")
async def run_finalize(req: FinalizeRequest):
    blog.info(f"[run/finalize] story_id={req.story_id!r}")
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


@app.post("/run/flow-only")
async def run_flow_only(req: FlowOnlyRequest):
    """Start browser automation directly, skipping story generation.


    Builds the run state from ideas_db.json if not already present,
    then resumes directly into the Google Flow browser step.
    """
    runtime = _flow_runtime_from_settings()
    wait_between_sec = runtime["wait_between_sec"]
    wait_max_sec = runtime["wait_max_sec"]
    scene_max_retries = runtime["scene_max_retries"]
    timeout_sec = runtime["timeout_sec"]
    headless = runtime["headless"]
    _ENV["FLOW_INTERVALS_JSON"] = json.dumps(runtime["flow_intervals"], ensure_ascii=False)
    blog.info(
        f"[run/flow-only] story_id={req.story_id!r} headless={headless} "
        f"timeout={timeout_sec}s wait={wait_between_sec}-{wait_max_sec}s retries={scene_max_retries}"
    )
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', req.story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")

    run_file = RUNS_DIR / f"{req.story_id}.json"
    db = _load_ideas_db()
    entry = db.get(req.story_id)
    current_metadata_hash = _metadata_hash(entry) if entry else ""
    current_flow_prompt_hash = _flow_prompt_hash_from_entry(entry) if entry else ""

    if run_file.exists() and current_flow_prompt_hash:
        try:
            existing_state = json.loads(run_file.read_text(encoding="utf-8"))
        except Exception:
            existing_state = {}
        saved_flow_prompt_hash = existing_state.get("flow_prompt_hash") or _flow_prompt_hash_from_run_state(existing_state)
        if saved_flow_prompt_hash == current_flow_prompt_hash and not existing_state.get("flow_prompt_hash"):
            existing_state["flow_prompt_hash"] = current_flow_prompt_hash
            if current_metadata_hash:
                existing_state["metadata_hash"] = current_metadata_hash
            run_file.write_text(json.dumps(existing_state, indent=2, ensure_ascii=False), encoding="utf-8")
        elif saved_flow_prompt_hash != current_flow_prompt_hash:
            blog.info(
                f"[run/flow-only] metadata changed for story_id={req.story_id!r}; "
                "clearing stale run state"
            )
            run_file.unlink()

    # If no run state exists yet, build one from the ideas_db entry
    if not run_file.exists():
        if not entry:
            raise HTTPException(
                status_code=404,
                detail=f"No story found for story_id '{req.story_id}'. "
                       "Complete Steps 2â€“5 and save to the database first."
            )

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
            "metadata_hash": current_metadata_hash,
            "flow_prompt_hash": current_flow_prompt_hash,
            "idea_index": 0,
            "idea_title": entry.get("title", ""),
            "run_status": "in_progress",
            "created_at": now_iso,
            "updated_at": now_iso,
            "story_payload": {
                "story_title": entry.get("title", ""),
                "metadata_hash": current_metadata_hash,
                "flow_prompt_hash": current_flow_prompt_hash,
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
    else:
        state, reconciled = _reconcile_run_state_file(req.story_id)
        if reconciled:
            blog.info(f"[run/flow-only] reconciled run-state for story_id={req.story_id!r}")
        if state.get("run_status") == "completed":
            return {
                "status": "already_completed",
                "story_id": req.story_id,
                "message": "Run is already complete; skipping generation.",
            }

    blog.info(f"[DEBUG] PYTHON_EXE={PYTHON_EXE} PYTHONPATH={_ENV.get('PYTHONPATH')}")
    cmd = [
        PYTHON_EXE, str(SCRIPTS_DIR / "run_pipeline.py"),
        "--resume",            req.story_id,
        "--wait-between-sec",  str(wait_between_sec),
        "--wait-max-sec",      str(wait_max_sec),
        "--scene-max-retries", str(scene_max_retries),
        "--timeout-sec",       str(timeout_sec),
        "--confirm-costly",    "false",
        "--headless",          "true" if headless else "false",
    ]
    _start_background(cmd, timeout_seconds=timeout_sec * 20 + 300)
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
        blog.info(f"[run/stop] killing PID {_active_proc.pid}")
        try:
            _kill_proc_tree(_active_proc.pid)
        except Exception:
            try:
                _active_proc.terminate()
            except Exception:
                pass
        return {"status": "stopped"}
    blog.info("[run/stop] nothing running")
    return {"status": "nothing_running"}


# â”€â”€ SSE Stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


# â”€â”€ Log file endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/logs/{filename}")
def get_log_file(filename: str):
    safe_name = Path(filename).name
    log_path = LOGS_DIR / safe_name
    if not log_path.exists():
        return {"lines": []}
    text = log_path.read_text(encoding="utf-8", errors="replace")
    return {"lines": text.splitlines()}


# â”€â”€ DeepSeek helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _deepseek_chat(system_prompt: str, user_message: str, temperature: float = 0.8) -> str:
    key = _deepseek_key()
    if not key:
        raise HTTPException(status_code=400, detail="DeepSeek API key not configured â€” go to Settings")
    body = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": temperature,
    }
    resp = _external_request(
        "deepseek",
        "POST",
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        operation="content_generation",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json_body=body,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# â”€â”€ Routes: Content creation pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class IdeaRequest(BaseModel):
    niche: str
    content_type: str
    idea_count: int = 10

    @field_validator("idea_count")
    @classmethod
    def clamp_idea_count(cls, v: int) -> int:
        return max(1, min(50, v))


@app.post("/generate/idea")
def generate_idea(req: IdeaRequest):
    idea_count = req.idea_count
    prompt_cfg = _effective_prompt_settings()
    system = _render_prompt_template(
        prompt_cfg["prompt_idea_generation"],
        {
            "idea_count": idea_count,
            "niche": req.niche,
            "content_type": req.content_type,
        },
    )
    user_message = (
        f"Niche: {req.niche}\n"
        f"Content type: {req.content_type}\n\n"
        f"Generate {idea_count} video ideas for this niche and content type."
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
        ideas = [{"title": str(i.get("title", "")), "description": str(i.get("description", ""))} for i in ideas[:idea_count]]
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
    prompt_cfg = _effective_prompt_settings()
    system = _render_prompt_template(
        prompt_cfg["prompt_script_generation"],
        {
            "niche": req.niche,
            "target_words": target_words,
            "word_count": target_words,
            "idea": req.idea,
        },
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


def _parse_model_json_array(raw: str, label: str) -> list[dict]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end != -1 and end >= start:
        cleaned = cleaned[start : end + 1]
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"{label} returned invalid JSON:\n{raw[:400]}")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=500, detail=f"{label} returned non-array JSON")
    return [item for item in parsed if isinstance(item, dict)]


@app.post("/generate/vo-narration")
def generate_vo_narration(req: VoNarrationRequest):
    prompt_cfg = _effective_prompt_settings()
    narration_system = _render_prompt_template(
        prompt_cfg["prompt_vo_narration_generation"],
        {"script": req.script},
    )
    veo_system = _render_prompt_template(
        prompt_cfg["prompt_veo_prompt_generation"],
        {"script": req.script},
    )

    raw_narration = _deepseek_chat(narration_system, req.script, temperature=0.6)
    raw_veo = _deepseek_chat(veo_system, req.script, temperature=0.6)

    narration_items = _parse_model_json_array(raw_narration, "VO narration generator")
    veo_items = _parse_model_json_array(raw_veo, "VEO prompt generator")

    script_lines = [line.strip() for line in req.script.splitlines() if line.strip()]
    max_len = max(len(script_lines), len(narration_items), len(veo_items))
    items: list[dict[str, str]] = []
    for i in range(max_len):
        narration_item = narration_items[i] if i < len(narration_items) else {}
        veo_item = veo_items[i] if i < len(veo_items) else {}
        sentence = (
            str(narration_item.get("sentence", "")).strip()
            or str(veo_item.get("sentence", "")).strip()
            or (script_lines[i] if i < len(script_lines) else f"Scene {i + 1}")
        )
        narration = str(narration_item.get("narration", "")).strip()
        if not narration:
            narration = str(narration_item.get("vo", "")).strip()
        veo_prompt = str(veo_item.get("veo_prompt", "")).strip()
        if not veo_prompt:
            veo_prompt = str(narration_item.get("veo_prompt", "")).strip()
        items.append(
            {
                "sentence": sentence,
                "narration": narration,
                "veo_prompt": veo_prompt,
            }
        )
    return {"items": items}

# â”€â”€ Routes: ElevenLabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/elevenlabs/voices")
def get_elevenlabs_voices():
    key = _elevenlabs_key()
    if not key:
        raise HTTPException(status_code=400, detail="ElevenLabs API key not configured â€” go to Settings")
    resp = _external_request(
        "elevenlabs",
        "GET",
        "https://api.elevenlabs.io/v1/voices",
        operation="list_voices",
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


class ImportVoiceoverRequest(BaseModel):
    url: str


class ImportVoiceoverFileRequest(BaseModel):
    filename: str
    content_base64: str


@app.post("/generate/voiceover")
def generate_voiceover(req: VoiceoverRequest):
    key = _elevenlabs_key()
    if not key:
        raise HTTPException(status_code=400, detail="ElevenLabs API key not configured â€” go to Settings")
    resp = _external_request(
        "elevenlabs",
        "POST",
        f"https://api.elevenlabs.io/v1/text-to-speech/{req.voice_id}",
        operation="generate_voiceover",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        json_body={
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


def _voiceover_ext_from_name(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext not in (".mp3", ".wav", ".m4a", ".aac", ".ogg"):
        raise HTTPException(status_code=400, detail="Voiceover file must be mp3, wav, m4a, aac, or ogg")
    return ext


@app.post("/import/voiceover")
def import_voiceover(req: ImportVoiceoverRequest):
    parsed = urlparse(req.url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Voiceover URL must start with http:// or https://")

    try:
        resp = _external_request(
            "external",
            "GET",
            req.url,
            operation="import_voiceover",
            timeout=120,
        )
        resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch voiceover: {exc}") from exc

    content_type = (resp.headers.get("content-type") or "").lower()
    path_ext = Path(parsed.path).suffix.lower()
    if path_ext in (".mp3", ".wav", ".m4a", ".aac", ".ogg"):
        ext = path_ext
    elif "wav" in content_type:
        ext = ".wav"
    elif "mp4" in content_type or "aac" in content_type:
        ext = ".m4a"
    elif "ogg" in content_type:
        ext = ".ogg"
    else:
        ext = ".mp3"

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"imported_voiceover_{int(time.time() * 1000)}{ext}"
    (AUDIO_DIR / filename).write_bytes(resp.content)
    return {"filename": filename}


@app.post("/import/voiceover-file")
def import_voiceover_file(req: ImportVoiceoverFileRequest):
    ext = _voiceover_ext_from_name(req.filename)
    try:
        content = base64.b64decode(req.content_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid audio file data") from exc
    if not content:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"uploaded_voiceover_{int(time.time() * 1000)}{ext}"
    (AUDIO_DIR / filename).write_bytes(content)
    return {"filename": filename}


@app.get("/audio/{filename}")
def serve_audio(filename: str):
    safe_name = Path(filename).name
    audio_path = AUDIO_DIR / safe_name
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(str(audio_path), media_type="audio/mpeg")


# â”€â”€ Routes: Output file serving (H3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


@app.get("/flow/live-buffer")
def get_flow_live_buffer():
    """Return the latest browser-detected Flow generation preview state."""
    if not LIVE_FLOW_BUFFER_FILE.exists():
        return {"status": "idle"}
    try:
        return json.loads(LIVE_FLOW_BUFFER_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"status": "idle"}


@app.get("/flow/live-buffer/watch")
async def watch_flow_live_buffer():
    """SSE stream for Flow progress, thumbnails, and preview links."""
    async def generate() -> AsyncGenerator[str, None]:
        last_payload = ""
        last_mtime = -1.0

        while True:
            await asyncio.sleep(1)
            if not LIVE_FLOW_BUFFER_FILE.exists():
                payload = json.dumps({"status": "idle"})
                if payload != last_payload:
                    last_payload = payload
                    yield f"data: {payload}\n\n"
                continue

            try:
                mtime = LIVE_FLOW_BUFFER_FILE.stat().st_mtime
                if mtime == last_mtime:
                    continue
                last_mtime = mtime
                payload = LIVE_FLOW_BUFFER_FILE.read_text(encoding="utf-8")
                json.loads(payload)
            except Exception:
                payload = json.dumps({"status": "idle"})

            if payload != last_payload:
                last_payload = payload
                yield f"data: {payload}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/output/watch")
async def watch_output():
    """SSE stream: emit clip_ready events when new .mp4 files appear in output/."""
    async def generate() -> AsyncGenerator[str, None]:
        known: set[str] = set()
        output_dir = OUTPUT_DIR

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
                        rel = str(f.relative_to(OUTPUT_DIR))
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


# â”€â”€ Routes: Run state (M4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CURRENT_RUN_STATE_SCHEMA_VERSION = 1


@app.get("/run/state/{story_id}")
def get_run_state(story_id: str):
    """Return saved run state info including schema version check."""
    if not re.match(r'^[a-zA-Z0-9_\- ]{1,120}$', story_id):
        raise HTTPException(status_code=422, detail="Invalid story_id format")
    state, _ = _reconcile_run_state_file(story_id)

    saved_version = state.get("schema_version", 0)
    schema_ok = saved_version == CURRENT_RUN_STATE_SCHEMA_VERSION
    completed = sum(
        1
        for s in state.get("scenes", [])
        if str(s.get("status", "")).lower() in ("completed", "skipped")
    )
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


# â”€â”€ Routes: Log sessions (H4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


# â”€â”€ Routes: UI event logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class UIEventRequest(BaseModel):
    action: str
    detail: str = ""
    timestamp: str = ""


@app.post("/ui/event")
def ui_event(req: UIEventRequest):
    """Frontend sends button clicks and state transitions here for server-side logging."""
    ts = req.timestamp or datetime.now(timezone.utc).strftime("%H:%M:%S")
    blog.info(f"[ui] {ts} {req.action}" + (f" | {req.detail}" if req.detail else ""))
    audit_event("ui.event", {"action": req.action, "detail": req.detail, "timestamp": ts})
    return {"ok": True}


# â”€â”€ Routes: Log file listing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/logs/list")
def list_log_files():
    """Return all session log files with size and modification time, newest first."""
    files = []
    candidates = list(LOGS_DIR.glob("*.log")) + list(LOGS_DIR.glob("*.jsonl"))
    for p in sorted(candidates, key=lambda f: f.stat().st_mtime, reverse=True):
        stat = p.stat()
        files.append({
            "filename": p.name,
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "is_current": p == _SESSION_LOG_FILE,
        })
    return {"files": files, "current_session": _SESSION_LOG_FILE.name}


@app.get("/logs/download/{filename}")
def download_log_file(filename: str):
    """Download a raw log file (for sharing with support)."""
    safe_name = Path(filename).name
    log_path = LOGS_DIR / safe_name
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log file not found")
    # Resolve and verify it's inside LOGS_DIR (path-traversal guard)
    try:
        log_path.resolve().relative_to(LOGS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    return FileResponse(
        str(log_path),
        media_type="text/plain",
        filename=safe_name,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7477, log_level="warning")



