from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Force UTF-8 output and line buffering for real-time logs
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
else:
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, TypeError):
        pass


def _print(msg: str) -> None:
    """Print with immediate flush to ensure real-time logging."""
    print(msg, flush=True)


def _banner(text: str) -> None:
    line = "=" * 60
    _print(f"\n{line}")
    _print(f"  {text}")
    _print(line)


def _section(text: str) -> None:
    _print(f"\n--- {text} ---")


def _ok(text: str) -> None:
    _print(f"  [OK]  {text}")


def _info(text: str) -> None:
    _print(f"  -->   {text}")


def _warn(text: str) -> None:
    _print(f"  [!]   {text}")

# ── Ensure scripts dir is importable ──────────────────────────────────────────
# When spawned as a subprocess via full path, Python may not add the script's
# own directory to sys.path reliably. Insert it explicitly before any imports.
_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from playwright.sync_api import sync_playwright
from flow_automation import (
    DEFAULT_AUTH_PATH,
    DEFAULT_DOWNLOADS_DIR,
    DEFAULT_ELEMENTS_PATH,
    DEFAULT_FLOW_URL,
    DEFAULT_SELECTORS_PATH,
    DEFAULT_SETTINGS_PATH,
    ensure_config_files,
    load_selectors_config,
    click_new_project,
    open_existing_project,
    rename_project,
    apply_settings,
    fill_prompt,
    submit_generation,
    wait_for_submit_ready,
    list_clip_card_summaries,
    download_clips,
    download_project_zip,
    download_clips_via_edit_pages,
    click_visible_retry_buttons,
)
from generate_story import build_messages, call_deepseek, log_raw_response, validate_payload
from read_ideas import Idea, parse_ideas
from write_stories import append_story_block


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("ANIMAL_STUDIO_DATA_DIR", str(ROOT_DIR)))

# Increment this whenever the run-state JSON schema changes in a breaking way.
RUN_STATE_SCHEMA_VERSION = 1

IDEAS_PATH = ROOT_DIR / "Ideas.md"
IDEAS_DB_PATH = DATA_DIR / "state" / "ideas_db.json"
MASTER_PROMPT_PATH = ROOT_DIR / "Master_Prompts.md"
RUNS_DIR = DATA_DIR / "state" / "runs"
PIPELINE_STATE_PATH = DATA_DIR / "state" / "processed_ideas.json"
OUTPUT_ROOT = DATA_DIR / "output"
LOGS_DIR = DATA_DIR / "logs"
PIPELINE_LOG_PATH = LOGS_DIR / "pipeline.log"
FLOW_LOG_PATH = LOGS_DIR / "flow.log"
ERRORS_LOG_PATH = LOGS_DIR / "errors.log"
DATA_STATE_DIR = DATA_DIR / "state"
DATA_DEFAULT_AUTH_PATH = DATA_STATE_DIR / "flow_auth.json"
DATA_DEFAULT_SELECTORS_PATH = DATA_STATE_DIR / "flow_selectors.json"
DATA_DEFAULT_ELEMENTS_PATH = DATA_STATE_DIR / "flow_elements.json"
DATA_DEFAULT_SETTINGS_PATH = DATA_STATE_DIR / "flow_settings.json"
DATA_DEFAULT_DOWNLOADS_DIR = DATA_DIR / "downloads"
LIVE_FLOW_BUFFER_PATH = DATA_STATE_DIR / "live_flow_buffer.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def save_live_flow_buffer(payload: dict[str, Any]) -> None:
    payload = {
        "updated_at": utc_now(),
        **payload,
    }
    save_json(LIVE_FLOW_BUFFER_PATH, payload)


def media_url_from_card(card: dict[str, Any]) -> str:
    for key in ("video_src", "source_src"):
        value = str(card.get(key, "") or "").strip()
        if value and not value.startswith("blob:"):
            return value
    return ""


def thumbnail_url_from_card(card: dict[str, Any]) -> str:
    for key in ("poster_src", "thumbnail_src"):
        value = str(card.get(key, "") or "").strip()
        if value and not value.startswith("blob:"):
            return value
    return ""


def log_event(path: Path, event: str, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {"ts": utc_now(), "event": event, **payload}
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def select_idea(ideas: list[Idea], story_id: str | None, idea_index: int | None, idea_title: str | None) -> Idea:
    if story_id:
        match = next((item for item in ideas if item.story_id == story_id), None)
        if not match and IDEAS_DB_PATH.exists():
            db = json.loads(IDEAS_DB_PATH.read_text(encoding="utf-8"))
            entry = db.get(story_id)
            if entry:
                match = Idea(
                    index=0,
                    title=entry["title"],
                    description=entry.get("description", ""),
                    story_id=story_id,
                )
    elif idea_index is not None:
        match = next((item for item in ideas if item.index == idea_index), None)
    elif idea_title:
        needle = idea_title.strip().lower()
        match = next((item for item in ideas if item.title.lower() == needle), None)
    else:
        match = ideas[0] if ideas else None

    if not match:
        raise SystemExit("No matching idea found. Use --story-id, --idea-index, or --idea-title.")
    return match


def generate_story_payload(
    idea: Idea,
    master_prompt_path: Path,
    model: str,
    temperature: float,
    max_retries: int,
) -> dict[str, Any]:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is missing. Add it to .env")

    _section("STEP 1 of 3 — Generating story with DeepSeek AI")
    _info(f"Model  : {model}")
    _info(f"Idea   : {idea.title}")
    _info(f"Story ID: {idea.story_id}")

    master_prompt = master_prompt_path.read_text(encoding="utf-8")
    messages = build_messages(master_prompt, idea)
    last_error = "Unknown error"

    for attempt in range(1, max_retries + 1):
        print(f"\n  Attempt {attempt} of {max_retries}...")
        print(f"  Calling DeepSeek API...", flush=True)
        t0 = time.time()
        raw = call_deepseek(
            api_key=api_key,
            base_url=base_url,
            model=model,
            messages=messages,
            temperature=temperature,
        )
        elapsed = time.time() - t0
        print(f"  Response received in {elapsed:.1f}s ({len(raw):,} characters)")
        log_raw_response(raw, idea, attempt)
        print(f"  Validating story structure...")
        try:
            validated = validate_payload(raw)
            payload = validated.model_dump()
            scene_count = len(payload.get("scenes", []))
            _ok(f"Story validated — \"{payload['story_title']}\" ({scene_count} scenes)")
            return payload
        except ValueError as exc:
            last_error = str(exc)
            _warn(f"Validation failed: {last_error}")
            messages.append({"role": "assistant", "content": raw})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Your previous output failed validation: {last_error}. "
                        "Return corrected JSON only with the exact same schema."
                    ),
                }
            )
            if attempt < max_retries:
                print(f"  Retrying with correction prompt...")

    raise SystemExit(f"Failed story generation after {max_retries} attempts. Last error: {last_error}")


def load_pipeline_state(path: Path) -> dict[str, Any]:
    return load_json(path, {"processed_story_ids": [], "processed_titles": [], "history": []})


def mark_processed(path: Path, story_id: str, title: str) -> None:
    state = load_pipeline_state(path)
    ids = set(state.get("processed_story_ids", []))
    titles = set(state.get("processed_titles", []))
    history = list(state.get("history", []))

    ids.add(story_id)
    titles.add(title)
    history.append({"story_id": story_id, "title": title, "processed_at": utc_now()})

    state["processed_story_ids"] = sorted(ids)
    state["processed_titles"] = sorted(titles)
    state["history"] = history
    save_json(path, state)


def init_run_state(run_path: Path, idea: Idea, story_payload: dict[str, Any]) -> dict[str, Any]:
    scenes_state = []
    for scene in story_payload["scenes"]:
        scenes_state.append(
            {
                "scene_no": scene["scene_no"],
                "scene_name": scene.get("scene_name", ""),
                "status": "pending",
                "attempts": 0,
                "downloads": [],
                "error": "",
                "updated_at": utc_now(),
            }
        )

    state = {
        "schema_version": RUN_STATE_SCHEMA_VERSION,
        "story_id": idea.story_id,
        "idea_index": idea.index,
        "idea_title": idea.title,
        "run_status": "in_progress",
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "story_payload": story_payload,
        "scenes": scenes_state,
        "flow_tracker": {
            "downloaded_card_keys": [],
            "failed_card_keys": [],
        },
        "downloaded_cards": [],
    }
    save_json(run_path, state)
    return state


def sanitize_filename(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", value).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or fallback


def organize_story_outputs(
    run_state: dict[str, Any],
    output_root: Path,
) -> tuple[Path, Path]:
    story_title = str(run_state["story_payload"]["story_title"])
    folder_name = sanitize_filename(story_title, fallback=run_state["story_id"])
    story_dir = output_root / folder_name
    story_dir.mkdir(parents=True, exist_ok=True)

    scenes_by_no = {
        int(item["scene_no"]): item for item in run_state["story_payload"]["scenes"]
    }
    manifest: dict[str, Any] = {
        "story_id": run_state["story_id"],
        "story_title": story_title,
        "idea_index": run_state.get("idea_index"),
        "idea_title": run_state.get("idea_title"),
        "generated_at": utc_now(),
        "story_folder": str(story_dir),
        "scenes": [],
    }

    for scene_state in run_state["scenes"]:
        scene_no = int(scene_state["scene_no"])
        scene_payload = scenes_by_no.get(scene_no, {})
        source_files = [Path(item) for item in scene_state.get("downloads", [])]
        copied_files: list[str] = []

        for clip_idx, src in enumerate(source_files, start=1):
            target_name = f"Scene {scene_no} - Clip {clip_idx}{src.suffix or '.mp4'}"
            target_path = story_dir / target_name
            if not src.exists():
                # File may have been moved here by a previous run — accept it as-is
                if target_path.exists():
                    copied_files.append(str(target_path))
                continue
            # Don't move a file onto itself (src already in output folder with same name)
            if src.resolve() == target_path.resolve():
                copied_files.append(str(target_path))
                continue
            if target_path.exists():
                target_path.unlink()
            shutil.move(str(src), str(target_path))
            copied_files.append(str(target_path))

        manifest["scenes"].append(
            {
                "scene_no": scene_no,
                "scene_name": scene_payload.get("scene_name", scene_state.get("scene_name", "")),
                "vo": scene_payload.get("vo", ""),
                "veo_prompt": scene_payload.get("veo_prompt", ""),
                "status": scene_state.get("status", ""),
                "downloads": copied_files,
            }
        )

    manifest_path = story_dir / "manifest.json"
    save_json(manifest_path, manifest)
    return story_dir, manifest_path


def print_download_report(run_state: dict[str, Any], expected_scene_nos: list[int]) -> None:
    scenes = run_state.get("scenes", [])
    scenes_by_no = {int(s["scene_no"]): s for s in scenes}
    downloaded_cards = run_state.get("downloaded_cards", [])

    completed = [s for s in scenes if s.get("status") == "completed"]
    failed = [s for s in scenes if s.get("status") == "failed"]
    pending = [s for s in scenes if s.get("status") in ("pending", "running")]

    total_clips = sum(len(s.get("downloads", [])) for s in completed)

    _banner("DOWNLOAD VERIFICATION REPORT")
    _info(f"Expected scenes  : {len(expected_scene_nos)}")
    _info(f"Completed        : {len(completed)}  ({total_clips} clip file(s) downloaded)")
    if failed:
        _info(f"Failed           : {len(failed)}")
    if pending:
        _info(f"Pending/running  : {len(pending)}")

    # Per-scene download breakdown
    _section("Per-scene status")
    for sno in sorted(expected_scene_nos):
        s = scenes_by_no.get(sno)
        if not s:
            _warn(f"  Scene {sno:>2} — NOT FOUND in run state")
            continue
        clips = s.get("downloads", [])
        card_entries = [c for c in downloaded_cards if int(c.get("scene_no", -1)) == sno]
        key_str = ""
        if card_entries:
            keys = [c["card_key"][:50] for c in card_entries]
            key_str = f"  [id: {' | '.join(keys)}]"
        if s.get("status") == "completed":
            _ok(f"  Scene {sno:>2} — {len(clips)} clip(s){key_str}")
        elif s.get("status") == "failed":
            _warn(f"  Scene {sno:>2} — FAILED: {s.get('error', 'unknown')[:80]}")
        else:
            _warn(f"  Scene {sno:>2} — {s.get('status', '?').upper()}: not yet downloaded")

    # Check for files marked downloaded but missing on disk
    missing: list[tuple[int, str]] = []
    for s in completed:
        for fpath in s.get("downloads", []):
            if not Path(fpath).exists():
                missing.append((int(s["scene_no"]), fpath))
    if missing:
        _section("WARNING — files recorded but not on disk")
        for sno, fpath in missing:
            _warn(f"  Scene {sno}: {fpath}")

    # Scenes that were expected but have no downloads at all
    no_downloads = [
        sno for sno in expected_scene_nos
        if not scenes_by_no.get(sno, {}).get("downloads")
        and scenes_by_no.get(sno, {}).get("status") != "completed"
    ]
    if no_downloads:
        _section("Scenes with no downloaded clips")
        for sno in no_downloads:
            s = scenes_by_no.get(sno, {})
            _warn(f"  Scene {sno}: status={s.get('status', 'unknown')}")


def build_scene_payload_index(
    story_payload: dict[str, Any],
    run_state: dict[str, Any],
) -> dict[int, dict[str, Any]]:
    by_no: dict[int, dict[str, Any]] = {}
    scenes_payload = list(story_payload.get("scenes", []) or [])

    for idx, item in enumerate(scenes_payload, start=1):
        try:
            scene_no = int(item.get("scene_no", idx))
        except (TypeError, ValueError):
            scene_no = idx
        if scene_no not in by_no:
            by_no[scene_no] = item

    if not by_no and scenes_payload:
        for idx, item in enumerate(scenes_payload, start=1):
            by_no[idx] = item

    if scenes_payload:
        # Fallback map by run-state ordering when scene numbers are malformed/duplicated.
        for idx, scene_state in enumerate(run_state.get("scenes", [])):
            try:
                scene_no = int(scene_state.get("scene_no", idx + 1))
            except (TypeError, ValueError):
                continue
            if scene_no in by_no:
                continue
            if idx < len(scenes_payload):
                by_no[scene_no] = scenes_payload[idx]

    return by_no


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run multi-scene generation pipeline with resume support.")
    parser.add_argument("--story-id", help="story_id from read_ideas.py")
    parser.add_argument("--idea-index", type=int, help="Idea number from Ideas.md")
    parser.add_argument("--idea-title", help="Exact idea title")
    parser.add_argument("--resume", help="Resume by story_id (loads state/runs/<story_id>.json)")
    parser.add_argument("--flow-url", default=DEFAULT_FLOW_URL)
    parser.add_argument("--auth-path", default=str(DATA_DEFAULT_AUTH_PATH))
    parser.add_argument("--selectors-path", default=str(DATA_DEFAULT_SELECTORS_PATH))
    parser.add_argument("--elements-path", default=str(DATA_DEFAULT_ELEMENTS_PATH))
    parser.add_argument("--settings-path", default=str(DATA_DEFAULT_SETTINGS_PATH))
    parser.add_argument("--downloads-dir", default=str(DATA_DEFAULT_DOWNLOADS_DIR))
    parser.add_argument("--timeout-sec", type=int, default=300)
    parser.add_argument("--scene-max-retries", type=int, default=2)
    parser.add_argument("--wait-between-sec", type=int, default=40,
                        help="Minimum seconds to wait between scenes (actual wait is random up to --wait-max-sec)")
    parser.add_argument("--wait-max-sec", type=int, default=80,
                        help="Maximum seconds to wait between scenes (random range)")
    parser.add_argument("--max-concurrent", type=int, default=1)
    parser.add_argument("--headless", choices=["true", "false"], default=None)
    parser.add_argument("--model", default=None)
    parser.add_argument("--temperature", type=float, default=0.6)
    parser.add_argument("--max-llm-retries", type=int, default=None)
    parser.add_argument("--write-stories", choices=["true", "false"], default="true")
    parser.add_argument("--mark-processed", choices=["true", "false"], default="true")
    parser.add_argument("--stories-path", default=str(DATA_DIR / "Stories.md"))
    parser.add_argument("--output-root", default=str(OUTPUT_ROOT))
    parser.add_argument("--dry-run", choices=["true", "false"], default="false")
    parser.add_argument("--confirm-costly", choices=["true", "false"], default="false")
    parser.add_argument("--only-scene", type=int, default=None, help="Run only one scene number")
    parser.add_argument("--force", choices=["true", "false"], default="false", 
                        help="Force story regeneration even if a cached JSON exists")
    return parser.parse_args()


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    args = parse_args()
    ensure_config_files(
        Path(args.selectors_path),
        Path(args.settings_path),
        Path(args.elements_path),
    )

    env_headless = os.getenv("FLOW_HEADLESS", "true").strip().lower()
    headless_flag = (args.headless or env_headless) == "true"
    model = (args.model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")).strip()
    max_llm_retries = args.max_llm_retries or int(os.getenv("MAX_LLM_RETRIES", "3"))
    dry_run = args.dry_run == "true"
    confirm_costly = args.confirm_costly == "true"

    log_event(PIPELINE_LOG_PATH, "pipeline_start", {"args": vars(args), "dry_run": dry_run})
    RUNS_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load or resume run state ───────────────────────────────────────────────
    if args.resume:
        run_path = RUNS_DIR / f"{args.resume}.json"
        run_state = load_json(run_path, {})
        if not run_state:
            raise SystemExit(f"Resume file not found: {run_path}")
        idea = Idea(
            index=run_state.get("idea_index", 0),
            title=run_state.get("idea_title", ""),
            description="",
            story_id=run_state["story_id"],
        )
        story_payload = run_state["story_payload"]
        completed_so_far = sum(1 for s in run_state["scenes"] if s["status"] == "completed")
        total_scenes = len(run_state["scenes"])
        _banner("RESUMING PIPELINE")
        _info(f"Story  : {idea.title}")
        _info(f"ID     : {idea.story_id}")
        _info(f"Progress: {completed_so_far} of {total_scenes} scenes already done")
    else:
        # Step 1: Parse ideas and select target
        ideas = parse_ideas(IDEAS_PATH.read_text(encoding="utf-8"))
        idea = select_idea(ideas, args.story_id, args.idea_index, args.idea_title)
        
        _banner("ANIMAL CHANNEL PIPELINE")
        _info(f"Story  : {idea.title}")
        _info(f"Idea # : {idea.index}")
        _info(f"ID     : {idea.story_id}")
        
        log_event(PIPELINE_LOG_PATH, "idea_selected",
                  {"story_id": idea.story_id, "idea_index": idea.index, "idea_title": idea.title})

        run_path = RUNS_DIR / f"{idea.story_id}.json"
        force_regen = args.force == "true"
        story_payload = {}
        run_state = {}
        
        if run_path.exists() and not force_regen:
            _banner("LOADING CACHED STORY")
            run_state = load_json(run_path, {})
            if run_state:
                _info(f"Loaded existing story state: {run_path.name}")
                story_payload = run_state["story_payload"]
                completed_so_far = sum(1 for s in run_state["scenes"] if s["status"] == "completed")
                _info(f"Progress: {completed_so_far} scenes already done")
            else:
                _warn(f"Empty cache file found at {run_path.name}. Regenerating...")
                force_regen = True

        if not run_path.exists() or force_regen:
            _banner("STEP 1 of 3 — Generating story with DeepSeek AI")
            story_payload = generate_story_payload(
                idea=idea,
                master_prompt_path=MASTER_PROMPT_PATH,
                model=model,
                temperature=args.temperature,
                max_retries=max_llm_retries,
            )
            if not story_payload:
                raise SystemExit("Story generation failed to return a valid payload.")
                
            log_event(PIPELINE_LOG_PATH, "story_generated",
                    {"story_id": idea.story_id, "scene_count": len(story_payload.get("scenes", []))})
            run_state = init_run_state(run_path, idea, story_payload)
            _ok(f"Run state saved: {run_path.name}")
            log_event(PIPELINE_LOG_PATH, "run_state_initialized",
                    {"run_path": str(run_path), "story_id": idea.story_id})

    if not story_payload:
        story_payload = run_state.get("story_payload", {})

    # ── Check for already generated media in output folder OR raw downloads dir ──
    story_title = str(story_payload.get("story_title", idea.title))
    folder_name = sanitize_filename(story_title, fallback=idea.story_id)
    story_dir = Path(args.output_root) / folder_name
    downloads_dir = Path(args.downloads_dir)

    found_any = False
    for s in run_state["scenes"]:
        if s["status"] == "completed":
            continue

        scene_no = s["scene_no"]

        # 1) Organized output folder: "Scene X - Clip Y.mp4"
        if story_dir.exists():
            prefix = f"Scene {scene_no} -"
            found_clips = list(story_dir.glob(f"{prefix}*"))
            if found_clips:
                s["status"] = "completed"
                s["downloads"] = [str(p) for p in found_clips]
                s["updated_at"] = utc_now()
                found_any = True
                print(f"  [OK]  Scene {scene_no} — found {len(found_clips)} existing clip(s) in output folder, marking as done")
                continue

        # 2) Raw scene sub-folder inside output dir (before organize renames them)
        raw_scene_dir = story_dir / f"scene_{scene_no:02d}"
        if raw_scene_dir.exists():
            raw_clips = [p for p in raw_scene_dir.iterdir() if p.suffix.lower() in (".mp4", ".webm", ".mov")]
            if raw_clips:
                s["status"] = "completed"
                s["downloads"] = [str(p) for p in raw_clips]
                s["updated_at"] = utc_now()
                found_any = True
                print(f"  [OK]  Scene {scene_no} — found {len(raw_clips)} existing clip(s) in downloads dir, marking as done")

    if found_any:
        save_json(run_path, run_state)
    # ──────────────────────────────────────────────────────────────────────────

    if confirm_costly and not dry_run:
        total = len(run_state["scenes"])
        print(f"\n  {total} Flow generations will be submitted. Type YES to continue: ", end="", flush=True)
        if input().strip() != "YES":
            log_event(PIPELINE_LOG_PATH, "pipeline_cancelled_confirmation", {"story_id": idea.story_id})
            raise SystemExit("Cancelled by user.")

    # ── Scene generation loop ──────────────────────────────────────────────────
    scene_payloads = build_scene_payload_index(story_payload, run_state)
    total_scenes = len(run_state["scenes"])
    force_regen = args.force == "true"
    if force_regen:
        _info("Force mode active: resetting attempts for all non-completed scenes")
        for s in run_state["scenes"]:
            if s["status"] != "completed":
                s["attempts"] = 0
                s["status"] = "pending"
        save_json(run_path, run_state)

    scenes_to_run = [
        s for s in run_state["scenes"]
        if (args.only_scene is None or int(s["scene_no"]) == int(args.only_scene))
        and s["status"] != "completed"
    ]
    scenes_to_run.sort(key=lambda s: int(s["scene_no"]))

    # Reset attempt counters from prior runs so old failure counts don't block re-submission.
    for s in scenes_to_run:
        if s.get("attempts", 0) > 0:
            s["attempts"] = 0
            s["status"] = "pending"
            s["error"] = ""
    if scenes_to_run:
        save_json(run_path, run_state)
    _section("STEP 2 of 3 — Generating videos in Google Flow")
    already_done = total_scenes - len(scenes_to_run)
    _info(f"Total scenes : {total_scenes}")
    if already_done:
        _info(f"Already done : {already_done}")
    _info(f"To generate  : {len(scenes_to_run)}")
    if dry_run:
        _warn("Skipping browser — dry run mode")

    total_clips = 0
    browser_started = False
    selectors_cfg: dict[str, Any] = load_selectors_config(
        Path(args.selectors_path),
        Path(args.elements_path),
    )
    
    if scenes_to_run and not dry_run:
        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=headless_flag)
        context = browser.new_context(
            accept_downloads=True,
            storage_state=str(args.auth_path),
        )
        page = context.new_page()
        print(f"  [{utc_now()}] BROWSER  opening {args.flow_url}")
        page.goto(args.flow_url, wait_until="domcontentloaded")
        print(f"  [{utc_now()}] BROWSER  waiting for page stabilization...")
        page.wait_for_timeout(10000)
        browser_started = True
        
        # ── Initial setup (Run ONCE per session) ──────────────────────────────
        
        known_project_url = str(run_state.get("flow_project_url", "") or "").strip()
        if known_project_url:
            _info("Known Flow project URL found in state")

        # Try to resume existing project first
        if not open_existing_project(
            page,
            idea.story_id,
            known_project_url=known_project_url or None,
            alternate_project_names=[
                str(story_payload.get("story_title", "")).strip(),
                str(idea.title).strip(),
            ],
            selectors_path=Path(args.selectors_path),
            elements_path=Path(args.elements_path),
        ):
            click_new_project(page, Path(args.selectors_path), Path(args.elements_path))
            # Short wait for editor to load before renaming
            page.wait_for_timeout(3000)
            rename_project(
                page,
                idea.story_id,
                Path(args.selectors_path),
                Path(args.elements_path),
            )
        
        settings_cfg = load_json(Path(args.settings_path), {})
        if settings_cfg:
            print(f"  [{utc_now()}] BROWSER  applying initial settings...")
            apply_settings(
                page,
                settings_cfg,
                Path(args.selectors_path),
                Path(args.elements_path),
            )
        current_url = page.url
        if any(token in current_url for token in ["/fx/tools/flow/project/", "/project/", "/p/"]):
            if run_state.get("flow_project_url") != current_url:
                run_state["flow_project_url"] = current_url
                run_state["updated_at"] = utc_now()
                save_json(run_path, run_state)
                _info("Saved Flow project URL for resume")
        # ──────────────────────────────────────────────────────────────────────
    try:
        if dry_run:
            for scene_state in scenes_to_run:
                scene_no = int(scene_state["scene_no"])
                print(f"\n  [Scene] Dry-run skipping Scene {scene_no}")
        elif scenes_to_run:
            max_attempts = max(1, int(args.scene_max_retries) + 1)
            max_concurrent = max(1, int(args.max_concurrent))
            min_wait = max(0, int(args.wait_between_sec))
            max_wait = max(min_wait, int(args.wait_max_sec))
            poll_interval_sec = 5.0

            if min_wait < 20:
                _warn(
                    f"Flow safety: wait_between_sec={min_wait}s is too aggressive; "
                    "using 20s minimum."
                )
                min_wait = 20
                max_wait = max(max_wait, min_wait)

            if max_concurrent > 1:
                _warn(
                    f"Flow safety: max_concurrent={max_concurrent} increases the chance of "
                    "Google flagging unusual activity; 1 is safer."
                )

            tracker = run_state.setdefault("flow_tracker", {})
            downloaded_card_keys = set(tracker.get("downloaded_card_keys", []))
            failed_card_keys = set(tracker.get("failed_card_keys", []))
            downloaded_cards = run_state.setdefault("downloaded_cards", [])

            baseline_cards = list_clip_card_summaries(page, selectors_cfg)
            baseline_card_keys = set()
            for card in baseline_cards:
                card_key = str(card.get("card_key", ""))
                if not card_key:
                    continue
                baseline_card_keys.add(card_key)
                downloaded_card_keys.add(card_key)
                if bool(card.get("failed", False)):
                    failed_card_keys.add(card_key)
            tracker["downloaded_card_keys"] = sorted(downloaded_card_keys)
            tracker["failed_card_keys"] = sorted(failed_card_keys)
            save_json(run_path, run_state)

            pending_scene_nos = [int(s["scene_no"]) for s in scenes_to_run]
            scenes_by_no_state = {int(s["scene_no"]): s for s in run_state["scenes"]}
            active_jobs: list[dict[str, Any]] = []
            next_submit_at = 0.0
            last_poll_at = 0.0

            _info(
                f"Dynamic loop enabled: submit every {min_wait}-{max_wait}s, "
                f"poll thumbnails every {int(poll_interval_sec)}s, max in-flight {max_concurrent}"
            )

            while pending_scene_nos or active_jobs:
                now = time.time()

                can_submit = (
                    pending_scene_nos
                    and len(active_jobs) < max_concurrent
                    and now >= next_submit_at
                )
                if can_submit:
                    scene_no = pending_scene_nos.pop(0)
                    scene_state = scenes_by_no_state[scene_no]
                    attempt = int(scene_state.get("attempts", 0)) + 1

                    if attempt > max_attempts:
                        scene_state["status"] = "failed"
                        scene_state["error"] = (
                            f"Reached max attempts ({max_attempts}) before submission."
                        )
                        scene_state["updated_at"] = utc_now()
                        save_json(run_path, run_state)
                    else:
                        scene_payload = scene_payloads.get(scene_no, {})
                        prompt = str(scene_payload.get("veo_prompt", "")).strip()
                        if not prompt:
                            scene_state["status"] = "failed"
                            scene_state["error"] = (
                                f"Missing veo_prompt for scene {scene_no}; skipping submission."
                            )
                            scene_state["updated_at"] = utc_now()
                            save_json(run_path, run_state)
                            _warn(scene_state["error"])
                            continue
                        print(
                            f"\n  [Submit] Scene {scene_no} attempt {attempt}/{max_attempts} "
                            f"(in-flight: {len(active_jobs)+1}/{max_concurrent})"
                        )
                        wait_for_submit_ready(page, selectors_cfg)
                        # Capture all currently visible card keys right before submitting
                        # so we can exclude pre-existing cards (including old failures) from
                        # failure detection for this new job.
                        pre_submit_cards = list_clip_card_summaries(page, selectors_cfg)
                        known_keys_now = {
                            str(c.get("card_key", ""))
                            for c in pre_submit_cards
                            if str(c.get("card_key", ""))
                        }
                        # Merge into global sets so we don't re-process these cards later.
                        downloaded_card_keys.update(known_keys_now)
                        for c in pre_submit_cards:
                            if bool(c.get("failed", False)):
                                failed_card_keys.add(str(c.get("card_key", "")))

                        fill_prompt(page, prompt)
                        submitted_at = time.time()
                        submit_generation(page, selectors_cfg)

                        scene_state["attempts"] = attempt
                        scene_state["status"] = "running"
                        scene_state["downloads"] = []
                        scene_state["error"] = ""
                        scene_state["updated_at"] = utc_now()
                        save_json(run_path, run_state)
                        for flow_card in scene_flow_cards:
                            if flow_card.get("card_key"):
                                downloaded_cards.append({
                                    "scene_no": scene_no,
                                    **flow_card,
                                })

                        save_live_flow_buffer(
                            {
                                "status": "running",
                                "story_id": idea.story_id,
                                "scene_no": scene_no,
                                "attempt": attempt,
                                "progress_pct": 0,
                                "message": f"Scene {scene_no} submitted to Flow",
                            }
                        )

                        active_jobs.append(
                            {
                                "scene_no": scene_no,
                                "attempt": attempt,
                                "submitted_at": submitted_at,
                                "deadline_at": submitted_at + float(args.timeout_sec),
                                "known_card_keys_at_submit": known_keys_now,
                                "ui_retries": 0,
                            }
                        )
                        next_submit_at = now + random.uniform(min_wait, max_wait)
                        _info(
                            f"Next prompt eligible in ~{max(0, int(next_submit_at - now))}s"
                        )

                now = time.time()
                if now - last_poll_at >= poll_interval_sec:
                    summaries = list_clip_card_summaries(page, selectors_cfg)

                    for card in summaries:
                        card_key = str(card.get("card_key", ""))
                        if not card_key:
                            continue

                        if card.get("failed"):
                            if card_key in failed_card_keys:
                                continue
                            current_job = active_jobs[0] if active_jobs else None
                            if (
                                current_job
                                and card_key in current_job.get("known_card_keys_at_submit", set())
                            ):
                                failed_card_keys.add(card_key)
                                continue

                            # Grace period: scenes take 2-5 minutes to generate; don't count
                            # a failure card within the first 300 seconds of submission.
                            if current_job:
                                secs_since_submit = now - float(current_job.get("submitted_at", 0))
                                if secs_since_submit < 300.0:
                                    continue

                            failed_card_keys.add(card_key)

                            if active_jobs:
                                ui_retries_used = int(active_jobs[0].get("ui_retries", 0))
                                max_ui_retries = 2
                                scene_no_f = int(active_jobs[0]["scene_no"])
                                scene_state_f = scenes_by_no_state[scene_no_f]

                                if ui_retries_used < max_ui_retries:
                                    # Click Retry in Flow UI before doing a full re-generation
                                    clicked = click_visible_retry_buttons(page, selectors_cfg, 1)
                                    if clicked:
                                        active_jobs[0]["ui_retries"] = ui_retries_used + 1
                                        active_jobs[0]["submitted_at"] = now  # Reset grace period
                                        active_jobs[0]["deadline_at"] = now + float(args.timeout_sec)
                                        # Remove from failed_card_keys so the same card can be
                                        # re-evaluated — retry keeps the same tile_id/href so
                                        # the card_key is identical after the retry starts.
                                        failed_card_keys.discard(card_key)
                                        scene_state_f["error"] = (
                                            f"Retry button clicked "
                                            f"({ui_retries_used + 1}/{max_ui_retries})"
                                        )
                                        scene_state_f["updated_at"] = utc_now()
                                        _warn(
                                            f"Scene {scene_no_f}: clip failed — Retry button "
                                            f"clicked ({ui_retries_used + 1}/{max_ui_retries}), "
                                            f"waiting for result..."
                                        )
                                        tracker["failed_card_keys"] = sorted(failed_card_keys)
                                        save_json(run_path, run_state)
                                        continue
                                    # Retry button not found — fall through to re-generation
                                    _warn(
                                        f"Scene {scene_no_f}: Retry button not found; "
                                        f"forcing re-generation."
                                    )

                                # UI retries exhausted (or button missing) → full re-generation
                                failed_job = active_jobs.pop(0)
                                scene_no = int(failed_job["scene_no"])
                                scene_state = scenes_by_no_state[scene_no]
                                scene_state["status"] = "failed"
                                scene_state["error"] = (
                                    f"Flow marked generation as failed after "
                                    f"{failed_job.get('ui_retries', 0)} UI retry click(s)."
                                )
                                scene_state["updated_at"] = utc_now()
                                save_live_flow_buffer(
                                    {
                                        "status": "failed",
                                        "story_id": idea.story_id,
                                        "scene_no": scene_no,
                                        "attempt": int(scene_state.get("attempts", 0)),
                                        "card_key": card_key,
                                        "flow_url": str(card.get("href", "")),
                                        "message": scene_state["error"],
                                    }
                                )

                                if int(scene_state.get("attempts", 0)) < max_attempts:
                                    pending_scene_nos.append(scene_no)
                                    next_submit_at = max(next_submit_at, now + 30.0)
                                    _warn(
                                        f"Scene {scene_no}: {failed_job.get('ui_retries', 0)} "
                                        f"retry click(s) exhausted; queued for re-generation "
                                        f"({int(scene_state.get('attempts', 0)) + 1}/{max_attempts})"
                                    )
                                else:
                                    _warn(
                                        f"Scene {scene_no} failed and exhausted all retries "
                                        f"({max_attempts} attempts) — skipping."
                                    )
                                save_json(run_path, run_state)
                            continue

                        if card_key in downloaded_card_keys:
                            continue

                        if not bool(card.get("ready", False)):
                            progress = card.get("progress_pct")
                            if progress is not None:
                                _info(f"Card in progress at {progress}% (waiting)")
                                if active_jobs:
                                    save_live_flow_buffer(
                                        {
                                            "status": "running",
                                            "story_id": idea.story_id,
                                            "scene_no": int(active_jobs[0]["scene_no"]),
                                            "attempt": int(active_jobs[0]["attempt"]),
                                            "progress_pct": int(progress),
                                            "card_key": card_key,
                                            "flow_url": str(card.get("href", "")),
                                            "thumbnail_url": thumbnail_url_from_card(card),
                                            "message": f"Flow generation at {progress}%",
                                        }
                                    )
                            continue

                        if not active_jobs:
                            # Untracked card from previous sessions; skip to avoid mis-assignment.
                            downloaded_card_keys.add(card_key)
                            continue

                        completed_job = active_jobs.pop(0)
                        scene_no = int(completed_job["scene_no"])
                        known_keys_at_submit = completed_job.get("known_card_keys_at_submit", set())
                        scene_state = scenes_by_no_state[scene_no]

                        # Wait a few seconds so all x4 generated clips finish rendering
                        _info(f"Scene {scene_no}: first clip ready — waiting 8s for all clips to finish...")
                        page.wait_for_timeout(8000)

                        # Collect ALL new ready cards from this generation batch
                        all_summaries = list_clip_card_summaries(page, selectors_cfg)
                        new_ready_cards = [
                            c for c in all_summaries
                            if str(c.get("card_key", "")) not in known_keys_at_submit
                            and str(c.get("card_key", "")) not in downloaded_card_keys
                            and bool(c.get("ready", False))
                            and not bool(c.get("failed", False))
                        ]
                        if not new_ready_cards:
                            new_ready_cards = [card]  # Fallback to the triggering card
                        preview_card = new_ready_cards[0]

                        # Mark all ready cards as seen so we don't re-process them
                        for ready_card in new_ready_cards:
                            downloaded_card_keys.add(str(ready_card.get("card_key", "")))

                        clip_count = len(new_ready_cards)
                        scene_flow_cards = [
                            {
                                "card_key": str(ready_card.get("card_key", "")),
                                "href": str(ready_card.get("href", "")),
                                "tile_id": str(ready_card.get("tile_id", "")),
                                "label": str(ready_card.get("label", "")),
                                "captured_at": utc_now(),
                            }
                            for ready_card in new_ready_cards
                        ]
                        scene_state["status"] = "generated"
                        scene_state["generated_clip_count"] = clip_count
                        scene_state["flow_cards"] = scene_flow_cards
                        scene_state["downloads"] = []
                        scene_state["error"] = ""
                        scene_state["updated_at"] = utc_now()
                        _ok(f"Scene {scene_no}: {clip_count} clip(s) generated — will download via project zip")

                        save_live_flow_buffer(
                            {
                                "status": "ready",
                                "story_id": idea.story_id,
                                "scene_no": scene_no,
                                "attempt": int(completed_job["attempt"]),
                                "progress_pct": 100,
                                "card_key": str(preview_card.get("card_key", "")),
                                "flow_url": str(preview_card.get("href", "")),
                                "media_url": media_url_from_card(preview_card),
                                "thumbnail_url": thumbnail_url_from_card(preview_card),
                                "clip_count": clip_count,
                                "message": f"Scene {scene_no}: {clip_count} Flow clip(s) ready",
                            }
                        )

                        tracker["downloaded_card_keys"] = sorted(downloaded_card_keys)
                        tracker["failed_card_keys"] = sorted(failed_card_keys)
                        run_state["updated_at"] = utc_now()
                        save_json(run_path, run_state)

                    last_poll_at = now

                timed_out_jobs: list[dict[str, Any]] = []
                for job in active_jobs:
                    if now >= float(job["deadline_at"]):
                        timed_out_jobs.append(job)

                for job in timed_out_jobs:
                    if job in active_jobs:
                        active_jobs.remove(job)
                    scene_no = int(job["scene_no"])
                    scene_state = scenes_by_no_state[scene_no]
                    scene_state["status"] = "failed"
                    scene_state["error"] = (
                        f"Timed out after {args.timeout_sec}s without thumbnail completion."
                    )
                    scene_state["updated_at"] = utc_now()
                    save_live_flow_buffer(
                        {
                            "status": "failed",
                            "story_id": idea.story_id,
                            "scene_no": scene_no,
                            "attempt": int(scene_state.get("attempts", 0)),
                            "message": scene_state["error"],
                        }
                    )
                    if int(scene_state.get("attempts", 0)) < max_attempts:
                        pending_scene_nos.append(scene_no)
                        _warn(
                            f"Scene {scene_no} timed out; queued retry "
                            f"{int(scene_state.get('attempts', 0)) + 1}/{max_attempts}"
                        )
                    else:
                        _warn(
                            f"Scene {scene_no} timed out and exhausted retries "
                            f"({max_attempts} attempts)."
                        )
                    tracker["failed_card_keys"] = sorted(failed_card_keys)
                    run_state["updated_at"] = utc_now()
                    save_json(run_path, run_state)

                page.wait_for_timeout(500)

        # ── Project zip download ───────────────────────────────────────────────
        generated_scenes = [
            s for s in run_state["scenes"] if s.get("status") == "generated"
        ]
        if not dry_run and generated_scenes:
            _section("STEP 2b — Downloading clips")
            _info("Waiting 30s for all clips to stabilise before downloading...")
            page.wait_for_timeout(30000)

            project_url = str(run_state.get("flow_project_url") or args.flow_url)
            staging_dir = Path(args.downloads_dir) / "_staging_clips"
            staging_dir.mkdir(parents=True, exist_ok=True)

            # ── Attempt 1: project zip via toolbar kebab → Download Project ──
            remaining_generated_scenes: list[dict[str, Any]] = []
            for scene_state in sorted(generated_scenes, key=lambda s: int(s["scene_no"])):
                scene_no = int(scene_state["scene_no"])
                hrefs = [
                    str(card.get("href", "")).strip()
                    for card in scene_state.get("flow_cards", [])
                    if str(card.get("href", "")).strip()
                ]
                if not hrefs:
                    remaining_generated_scenes.append(scene_state)
                    continue

                scene_dir = Path(args.downloads_dir) / f"scene_{scene_no:02d}"
                scene_dir.mkdir(parents=True, exist_ok=True)
                _info(f"Scene {scene_no}: downloading {len(hrefs)} tracked clip(s) by exact Flow link")
                saved = [str(p) for p in download_clips_via_edit_pages(
                    page,
                    project_url,
                    scene_dir,
                    edit_hrefs=hrefs,
                )]
                if saved:
                    scene_state["status"] = "completed"
                    scene_state["downloads"] = saved
                    scene_state["updated_at"] = utc_now()
                    total_clips += len(saved)
                    _ok(f"Scene {scene_no}: {len(saved)} tracked clip(s) saved")
                else:
                    remaining_generated_scenes.append(scene_state)
                    _warn(f"Scene {scene_no}: tracked download failed; will try fallback assignment")
                save_json(run_path, run_state)

            generated_scenes = remaining_generated_scenes
            zip_path = download_project_zip(page, selectors_cfg, staging_dir) if generated_scenes else None

            if zip_path and zip_path.exists():
                _info(f"Extracting project zip: {zip_path.name}")
                extract_dir = staging_dir / "_zip_extract"
                extract_dir.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(zip_path, "r") as zf:
                    zf.extractall(extract_dir)
                all_clips = sorted(
                    p for p in extract_dir.rglob("*")
                    if p.suffix.lower() in {".mp4", ".mov", ".webm"}
                )
                _info(f"Found {len(all_clips)} clip(s) in zip")
            else:
                # ── Attempt 2: per-clip download via edit pages ───────────────
                _warn("Zip download failed — falling back to per-clip edit-page download...")
                all_clips = download_clips_via_edit_pages(page, project_url, staging_dir)
                _info(f"Downloaded {len(all_clips)} clip(s) individually")

            if all_clips:
                # Distribute clips to scenes in scene_no order, using generated_clip_count
                clip_cursor = 0
                for scene_state in sorted(generated_scenes, key=lambda s: int(s["scene_no"])):
                    scene_no = int(scene_state["scene_no"])
                    clip_count = int(scene_state.get("generated_clip_count", 1))
                    scene_clips = all_clips[clip_cursor : clip_cursor + clip_count]
                    clip_cursor += clip_count

                    scene_dir = Path(args.downloads_dir) / f"scene_{scene_no:02d}"
                    scene_dir.mkdir(parents=True, exist_ok=True)

                    saved: list[str] = []
                    for clip_idx, src in enumerate(scene_clips, start=1):
                        dest = scene_dir / f"clip_{clip_idx:02d}_{int(time.time())}.mp4"
                        shutil.copy2(str(src), str(dest))
                        saved.append(str(dest))

                    if saved:
                        scene_state["status"] = "completed"
                        scene_state["downloads"] = saved
                        scene_state["updated_at"] = utc_now()
                        total_clips += len(saved)
                        _ok(f"Scene {scene_no}: {len(saved)} clip(s) saved")
                    else:
                        scene_state["status"] = "failed"
                        scene_state["error"] = "No clips assigned from download."
                        scene_state["updated_at"] = utc_now()
                        _warn(f"Scene {scene_no}: no clips found")

                shutil.rmtree(staging_dir, ignore_errors=True)
            else:
                _warn("All download attempts failed — scenes marked as failed")
                for scene_state in generated_scenes:
                    scene_state["status"] = "failed"
                    scene_state["error"] = "Both zip and per-clip downloads failed."
                    scene_state["updated_at"] = utc_now()
            save_json(run_path, run_state)

    finally:
        if browser_started:
            browser.close()
            pw.stop()

    # ── Download verification report ───────────────────────────────────────────
    if not dry_run and scenes_to_run:
        all_expected = [int(s["scene_no"]) for s in run_state["scenes"]]
        print_download_report(run_state, all_expected)

    # ── Post-processing ────────────────────────────────────────────────────────
    all_completed = all(
        item.get("status") in ("completed", "skipped") for item in run_state["scenes"]
    )
    if not dry_run:
        run_state["run_status"] = "completed" if all_completed else "in_progress"
        run_state["updated_at"] = utc_now()
        save_json(run_path, run_state)

    log_event(PIPELINE_LOG_PATH, "pipeline_scenes_complete",
              {"story_id": idea.story_id, "dry_run": dry_run, "all_completed": all_completed})

    if not all_completed:
        _info("Some scenes still pending or failed — organising completed clips now.")
        log_event(PIPELINE_LOG_PATH, "pipeline_partial_run", {"story_id": idea.story_id})

    _section("STEP 3 of 3 — Organising outputs")

    if dry_run:
        story_dir = Path(args.output_root) / "dry_run_no_media"
        manifest_path = RUNS_DIR / f"{idea.story_id}_dry_run_manifest.json"
        save_json(manifest_path, {
            "story_id": idea.story_id,
            "story_title": story_payload["story_title"],
            "dry_run": True,
            "note": "No browser automation executed; no media files downloaded.",
            "scenes": run_state["scenes"],
        })
    else:
        story_dir, manifest_path = organize_story_outputs(run_state, Path(args.output_root))
        _ok(f"Clips moved to : {story_dir}")
        _ok(f"Manifest saved : {manifest_path.name}")

    if not all_completed:
        _info("Run will resume remaining scenes on next execution.")
        log_event(PIPELINE_LOG_PATH, "pipeline_partial_run_organized", {"story_id": idea.story_id})
        return

    if not dry_run:
        run_state["output_dir"] = str(story_dir)
        run_state["manifest_path"] = str(manifest_path)
        run_state["updated_at"] = utc_now()
        save_json(run_path, run_state)

    log_event(PIPELINE_LOG_PATH, "pipeline_outputs_ready",
              {"story_id": idea.story_id, "output_dir": str(story_dir),
               "manifest_path": str(manifest_path)})

    if args.write_stories == "true":
        append_story_block(
            stories_path=Path(args.stories_path),
            story_payload=story_payload,
            story_id=idea.story_id,
            idea_index=idea.index,
        )
        _ok(f"Story written to Stories.md")
        log_event(PIPELINE_LOG_PATH, "stories_written",
                  {"story_id": idea.story_id, "stories_path": args.stories_path})

    if args.mark_processed == "true":
        mark_processed(PIPELINE_STATE_PATH, idea.story_id, story_payload["story_title"])
        _ok(f"Idea marked as processed")
        log_event(PIPELINE_LOG_PATH, "marked_processed", {"story_id": idea.story_id})

    log_event(PIPELINE_LOG_PATH, "pipeline_complete", {"story_id": idea.story_id, "dry_run": dry_run})

    _banner("PIPELINE COMPLETE")
    _info(f"Story  : {story_payload['story_title']}")
    _info(f"Scenes : {total_scenes}")
    _info(f"Clips  : {total_clips}")
    _info(f"Output : {story_dir}")
    print()


if __name__ == "__main__":
    main()
