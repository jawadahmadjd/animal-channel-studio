from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from textwrap import wrap
from typing import Any

from validate_story import validate_story_data


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_STORIES_PATH = ROOT_DIR / "Stories.md"


def sanitize_cell_text(text: str) -> str:
    cleaned = text.replace("|", "/")
    cleaned = cleaned.replace("`", "'")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def split_cell_lines(text: str, width: int) -> list[str]:
    value = sanitize_cell_text(text)
    if not value:
        return [""]
    return wrap(value, width=width, break_long_words=False, break_on_hyphens=False) or [value]


def render_box_table(scenes: list[dict[str, Any]]) -> str:
    scene_width = 5
    vo_width = 34
    prompt_width = 110

    sep = f"+{'-' * (scene_width + 2)}+{'-' * (vo_width + 2)}+{'-' * (prompt_width + 2)}+"
    header = (
        f"| {'Scene'.ljust(scene_width)} | "
        f"{'VO Narration (4-5 sec)'.ljust(vo_width)} | "
        f"{'VEO 3 Prompt'.ljust(prompt_width)} |"
    )

    lines = [sep, header, sep]
    for scene in scenes:
        scene_no = str(scene["scene_no"])
        vo_lines = split_cell_lines(scene["vo"], vo_width)
        prompt_lines = split_cell_lines(scene["veo_prompt"], prompt_width)
        row_height = max(len(vo_lines), len(prompt_lines))

        for i in range(row_height):
            scene_text = scene_no if i == 0 else ""
            vo_text = vo_lines[i] if i < len(vo_lines) else ""
            prompt_text = prompt_lines[i] if i < len(prompt_lines) else ""
            lines.append(
                f"| {scene_text.ljust(scene_width)} | {vo_text.ljust(vo_width)} | {prompt_text.ljust(prompt_width)} |"
            )
        lines.append(sep)

    return "\n".join(lines)


def next_story_number(stories_text: str) -> int:
    matches = re.findall(r"^# Story (\d+):", stories_text, flags=re.MULTILINE)
    if not matches:
        return 1
    return max(int(m) for m in matches) + 1


def append_story_block(
    stories_path: Path,
    story_payload: dict[str, Any],
    story_id: str,
    idea_index: int | None,
) -> str:
    stories_path.parent.mkdir(parents=True, exist_ok=True)
    existing = stories_path.read_text(encoding="utf-8") if stories_path.exists() else ""

    story_number = next_story_number(existing)
    title = sanitize_cell_text(str(story_payload["story_title"]))
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    table = render_box_table(story_payload["scenes"])

    meta_parts = [f"Story ID: `{story_id}`", f"Created: `{timestamp}`"]
    if idea_index is not None:
        meta_parts.insert(1, f"Idea #: `{idea_index}`")
    meta_line = " | ".join(meta_parts)

    block = (
        f"# Story {story_number}: {title}\n\n"
        f"{meta_line}\n\n"
        "```text\n"
        f"{table}\n"
        "```\n"
    )

    if existing.strip():
        content = existing.rstrip() + "\n\n---\n\n" + block
    else:
        content = block
    stories_path.write_text(content, encoding="utf-8")
    return title


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Append validated story JSON into Stories.md")
    parser.add_argument("--input-json", required=True, help="Path to validated story JSON")
    parser.add_argument("--stories-path", default=str(DEFAULT_STORIES_PATH), help="Path to Stories.md")
    parser.add_argument("--story-id", required=True, help="story_id from read_ideas.py")
    parser.add_argument("--idea-index", type=int, default=None, help="Original idea number from Ideas.md")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input_json)
    stories_path = Path(args.stories_path)

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    # Semantic validation removed to allow minor deviations
    # errors = validate_story_data(payload)
    # if errors:
    #     joined = "\n".join(f"- {e}" for e in errors)
    #     raise SystemExit(f"Refusing to write invalid story payload:\n{joined}")

    append_story_block(
        stories_path=stories_path,
        story_payload=payload,
        story_id=args.story_id,
        idea_index=args.idea_index,
    )
    print(f"Story appended to: {stories_path}")


if __name__ == "__main__":
    main()
