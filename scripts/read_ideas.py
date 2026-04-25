from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ROOT_DIR = Path(__file__).resolve().parents[1]
IDEAS_PATH = ROOT_DIR / "Ideas.md"
STATE_PATH = ROOT_DIR / "state" / "processed_ideas.json"


@dataclass
class Idea:
    index: int
    title: str
    description: str
    story_id: str


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def make_story_id(title: str, description: str) -> str:
    raw = f"{normalize_whitespace(title).lower()}::{normalize_whitespace(description).lower()}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
    return f"story_{digest}"


def _flush_idea(ideas: list[Idea], idx: int, title: str, desc_lines: list[str]) -> None:
    description = normalize_whitespace(" ".join(desc_lines))
    if not title or not description:
        return
    ideas.append(
        Idea(
            index=idx,
            title=normalize_whitespace(title),
            description=description,
            story_id=make_story_id(title, description),
        )
    )


def parse_ideas(markdown_text: str) -> list[Idea]:
    lines = markdown_text.splitlines()
    ideas: list[Idea] = []

    current_title = ""
    current_desc: list[str] = []
    current_idx = 0
    fallback_idx = 0

    numbered_re = re.compile(r"^\s*(\d+)\.\s+(.+?)\s*$")
    bullet_re = re.compile(r"^\s*[-*]\s+(.+?)\s*$")

    for line in lines:
        numbered_match = numbered_re.match(line)
        bullet_match = bullet_re.match(line)

        if numbered_match:
            _flush_idea(ideas, current_idx, current_title, current_desc)
            current_idx = int(numbered_match.group(1))
            current_title = numbered_match.group(2)
            current_desc = []
            continue

        if bullet_match and not current_title:
            fallback_idx += 1
            _flush_idea(ideas, current_idx, current_title, current_desc)
            current_idx = 1000 + fallback_idx
            current_title = bullet_match.group(1)
            current_desc = []
            continue

        stripped = line.strip()
        if current_title and stripped:
            current_desc.append(stripped)

    _flush_idea(ideas, current_idx, current_title, current_desc)

    if not ideas:
        # Final fallback parser: title/description blocks separated by blank lines.
        blocks = [b.strip() for b in re.split(r"\n\s*\n", markdown_text) if b.strip()]
        for i in range(0, len(blocks), 2):
            title = blocks[i]
            desc = blocks[i + 1] if i + 1 < len(blocks) else ""
            if title and desc:
                fallback_idx += 1
                ideas.append(
                    Idea(
                        index=2000 + fallback_idx,
                        title=normalize_whitespace(title),
                        description=normalize_whitespace(desc),
                        story_id=make_story_id(title, desc),
                    )
                )

    return ideas


def load_state(state_path: Path) -> dict:
    if not state_path.exists():
        return {
            "processed_story_ids": [],
            "processed_titles": [],
            "history": [],
        }
    with state_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_state(state_path: Path, state: dict) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with state_path.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def select_unprocessed(
    ideas: Iterable[Idea],
    state: dict,
    rerun_id: str | None = None,
    rerun_title: str | None = None,
) -> list[Idea]:
    all_ideas = list(ideas)
    if rerun_id:
        return [idea for idea in all_ideas if idea.story_id == rerun_id]
    if rerun_title:
        needle = rerun_title.strip().lower()
        return [idea for idea in all_ideas if idea.title.lower() == needle]

    processed_ids = set(state.get("processed_story_ids", []))
    return [idea for idea in all_ideas if idea.story_id not in processed_ids]


def mark_processed(state: dict, idea: Idea) -> dict:
    processed_ids = set(state.get("processed_story_ids", []))
    processed_titles = set(state.get("processed_titles", []))
    history = list(state.get("history", []))

    processed_ids.add(idea.story_id)
    processed_titles.add(idea.title)
    history.append(
        {
            "story_id": idea.story_id,
            "title": idea.title,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    state["processed_story_ids"] = sorted(processed_ids)
    state["processed_titles"] = sorted(processed_titles)
    state["history"] = history
    return state


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read and filter ideas from Ideas.md")
    parser.add_argument("--ideas-path", default=str(IDEAS_PATH), help="Path to Ideas.md")
    parser.add_argument("--state-path", default=str(STATE_PATH), help="Path to state JSON")
    parser.add_argument(
        "--format",
        choices=["json", "text"],
        default="text",
        help="Output format",
    )
    parser.add_argument("--rerun-id", help="Include only this story_id", default=None)
    parser.add_argument("--rerun-title", help="Include only this exact title", default=None)
    parser.add_argument(
        "--mark-processed",
        help="Mark this story_id as processed in state file",
        default=None,
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    ideas_path = Path(args.ideas_path)
    state_path = Path(args.state_path)
    ideas_text = ideas_path.read_text(encoding="utf-8")
    ideas = parse_ideas(ideas_text)

    state = load_state(state_path)

    if args.mark_processed:
        target = next((idea for idea in ideas if idea.story_id == args.mark_processed), None)
        if not target:
            raise SystemExit(f"story_id not found in Ideas.md: {args.mark_processed}")
        state = mark_processed(state, target)
        save_state(state_path, state)
        print(f"Marked processed: {target.story_id} ({target.title})")
        return

    selected = select_unprocessed(
        ideas,
        state=state,
        rerun_id=args.rerun_id,
        rerun_title=args.rerun_title,
    )

    if args.format == "json":
        print(json.dumps([asdict(item) for item in selected], indent=2, ensure_ascii=False))
        return

    if not selected:
        print("No matching ideas found.")
        return

    print(f"Found {len(selected)} idea(s):")
    for item in selected:
        print(f"- [{item.story_id}] #{item.index} {item.title}")
        print(f"  {item.description}")


if __name__ == "__main__":
    main()
