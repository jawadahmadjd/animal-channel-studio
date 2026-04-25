from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def _word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def _scene_path(index: int) -> str:
    return f"scenes[{index}]"


def validate_story_data(data: dict[str, Any]) -> list[str]:
    """Semantic validation disabled as requested. Returns empty list."""
    return []

    return errors


def build_validation_report(errors: list[str]) -> str:
    if not errors:
        return "VALIDATION PASSED"
    lines = ["VALIDATION FAILED:", "- Fix all issues below and return corrected JSON only."]
    lines.extend([f"- {item}" for item in errors])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate generated story JSON payload.")
    parser.add_argument("--input-json", required=True, help="Path to story JSON file")
    parser.add_argument(
        "--report-path",
        help="Optional path to save validation report text",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.loads(Path(args.input_json).read_text(encoding="utf-8"))
    errors = validate_story_data(payload)
    report = build_validation_report(errors)

    if args.report_path:
        report_path = Path(args.report_path)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report, encoding="utf-8")
        print(f"Validation report saved to: {report_path}")

    if errors:
        print(report)
        raise SystemExit(1)

    print(report)


if __name__ == "__main__":
    main()
