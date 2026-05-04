from __future__ import annotations

import hashlib
import json
import os
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("ANIMAL_STUDIO_DATA_DIR", str(ROOT_DIR)))
LOGS_DIR = DATA_DIR / "logs"
AUDIT_LOG_PATH = LOGS_DIR / "audit.jsonl"

SECRET_KEYS = {
    "authorization",
    "api_key",
    "deepseek_api_key",
    "elevenlabs_api_key",
    "xi-api-key",
    "password",
    "token",
    "cookie",
    "set-cookie",
}
MAX_STRING_LENGTH = 4000
MAX_LIST_ITEMS = 60


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_run_id(prefix: str = "run") -> str:
    return f"{prefix}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid.uuid4().hex[:8]}"


def current_run_id() -> str:
    value = os.environ.get("ANIMAL_STUDIO_RUN_ID", "").strip()
    if value:
        return value
    value = new_run_id()
    os.environ["ANIMAL_STUDIO_RUN_ID"] = value
    return value


def _is_secret_key(key: str) -> bool:
    low = key.lower()
    return low in SECRET_KEYS or any(part in low for part in ("secret", "api_key", "apikey", "token", "password"))


def _text_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()[:16]


def summarize_text(value: str, limit: int = MAX_STRING_LENGTH) -> dict[str, Any]:
    text = str(value)
    out: dict[str, Any] = {
        "length": len(text),
        "sha256_16": _text_digest(text),
        "preview": text[:limit],
    }
    if len(text) > limit:
        out["truncated"] = True
    return out


def sanitize(value: Any, *, key: str = "") -> Any:
    if key and _is_secret_key(key):
        return "***" if value else value
    if isinstance(value, dict):
        return {str(k): sanitize(v, key=str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        items = [sanitize(v) for v in list(value)[:MAX_LIST_ITEMS]]
        if len(value) > MAX_LIST_ITEMS:
            items.append({"truncated_items": len(value) - MAX_LIST_ITEMS})
        return items
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bytes):
        return {"bytes": len(value), "sha256_16": hashlib.sha256(value).hexdigest()[:16]}
    if isinstance(value, str):
        if len(value) > MAX_STRING_LENGTH:
            return summarize_text(value)
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)


def audit_event(event: str, payload: dict[str, Any] | None = None, *, run_id: str | None = None) -> None:
    row = {
        "ts": utc_now(),
        "run_id": run_id or os.environ.get("ANIMAL_STUDIO_RUN_ID", ""),
        "pid": os.getpid(),
        "event": event,
        **sanitize(payload or {}),
    }
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        # Audit logging must never break the production pipeline.
        pass


def audit_error(event: str, exc: BaseException, payload: dict[str, Any] | None = None) -> None:
    audit_event(
        event,
        {
            **(payload or {}),
            "error_type": exc.__class__.__name__,
            "error": str(exc),
            "traceback": traceback.format_exc(limit=20),
        },
    )
