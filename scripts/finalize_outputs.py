from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path
from typing import Any

from run_pipeline import OUTPUT_ROOT, RUNS_DIR, save_json, utc_now


def sanitize_filename(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", value).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or fallback


def load_run_state(story_id: str) -> dict[str, Any]:
    path = RUNS_DIR / f"{story_id}.json"
    if not path.exists():
        raise SystemExit(f"Run state not found: {path}")
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def move_and_rename_from_run_state(run_state: dict[str, Any], output_root: Path) -> tuple[Path, Path]:
    story_id = run_state["story_id"]
    story_title = str(run_state["story_payload"]["story_title"])
    folder_name = sanitize_filename(story_title, fallback=story_id)
    story_dir = output_root / folder_name
    story_dir.mkdir(parents=True, exist_ok=True)

    scenes_by_no = {int(s["scene_no"]): s for s in run_state["story_payload"]["scenes"]}
    manifest: dict[str, Any] = {
        "story_id": story_id,
        "story_title": story_title,
        "idea_index": run_state.get("idea_index"),
        "idea_title": run_state.get("idea_title"),
        "generated_at": utc_now(),
        "story_folder": str(story_dir),
        "scenes": [],
    }

    for scene_state in run_state.get("scenes", []):
        scene_no = int(scene_state["scene_no"])
        source_files = [Path(p) for p in scene_state.get("downloads", [])]
        output_files: list[str] = []
        for clip_idx, src in enumerate(source_files, start=1):
            if not src.exists():
                continue
            target = story_dir / f"Scene {scene_no} - Clip {clip_idx}{src.suffix or '.mp4'}"
            if target.exists():
                target.unlink()
            shutil.move(str(src), str(target))
            output_files.append(str(target))

        scene_payload = scenes_by_no.get(scene_no, {})
        manifest["scenes"].append(
            {
                "scene_no": scene_no,
                "scene_name": scene_payload.get("scene_name", ""),
                "vo": scene_payload.get("vo", ""),
                "veo_prompt": scene_payload.get("veo_prompt", ""),
                "status": scene_state.get("status", ""),
                "downloads": output_files,
            }
        )

    manifest_path = story_dir / "manifest.json"
    save_json(manifest_path, manifest)
    return story_dir, manifest_path


def rename_in_story_folder(story_dir: Path) -> int:
    clips = sorted([p for p in story_dir.glob("*") if p.is_file() and p.suffix.lower() in {".mp4", ".mov", ".webm"}])
    renamed = 0
    for idx, clip in enumerate(clips, start=1):
        new_name = f"Scene Unknown - Clip {idx}{clip.suffix}"
        target = story_dir / new_name
        if clip.name == new_name:
            continue
        if target.exists():
            target.unlink()
        clip.rename(target)
        renamed += 1
    return renamed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Finalize downloaded videos into clean output folders.")
    parser.add_argument("--story-id", required=True)
    parser.add_argument("--output-root", default=str(OUTPUT_ROOT))
    parser.add_argument("--rename-only", choices=["true", "false"], default="false")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_state = load_run_state(args.story_id)
    output_root = Path(args.output_root)

    if args.rename_only == "true":
        folder_name = sanitize_filename(str(run_state["story_payload"]["story_title"]), fallback=args.story_id)
        story_dir = output_root / folder_name
        if not story_dir.exists():
            raise SystemExit(f"Story folder does not exist yet: {story_dir}")
        count = rename_in_story_folder(story_dir)
        print(f"Renamed {count} video file(s) in: {story_dir}")
        return

    story_dir, manifest_path = move_and_rename_from_run_state(run_state, output_root)
    print(f"Videos finalized in: {story_dir}")
    print(f"Manifest written to: {manifest_path}")


if __name__ == "__main__":
    main()
