from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, field_validator

from read_ideas import Idea, parse_ideas
# from validate_story import build_validation_report, validate_story_data


ROOT_DIR = Path(__file__).resolve().parents[1]
IDEAS_PATH = ROOT_DIR / "Ideas.md"
MASTER_PROMPT_PATH = ROOT_DIR / "Master_Prompts.md"
RAW_LOG_DIR = ROOT_DIR / "logs" / "llm_raw"


class Scene(BaseModel):
    scene_no: int = Field(ge=1)
    scene_name: str
    vo: str
    veo_prompt: str

    @field_validator("scene_name", "vo", "veo_prompt")
    @classmethod
    def must_not_be_empty(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Field cannot be empty.")
        return normalized


class StoryPayload(BaseModel):
    story_id: str
    story_title: str
    scenes: list[Scene]

    @field_validator("story_title", "story_id")
    @classmethod
    def fields_not_empty(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Field cannot be empty.")
        return normalized


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate one story from an idea using DeepSeek.")
    parser.add_argument("--idea-id", help="story_id from read_ideas.py output")
    parser.add_argument("--idea-index", type=int, help="numeric idea index from Ideas.md")
    parser.add_argument("--idea-title", help="exact idea title to select")
    parser.add_argument("--ideas-path", default=str(IDEAS_PATH))
    parser.add_argument("--master-prompt-path", default=str(MASTER_PROMPT_PATH))
    parser.add_argument("--model", default=None, help="Overrides DEEPSEEK_MODEL from .env")
    parser.add_argument("--max-retries", type=int, default=None, help="Overrides MAX_LLM_RETRIES")
    parser.add_argument("--temperature", type=float, default=0.6)
    parser.add_argument("--output-json", help="Optional output file path for validated JSON")
    return parser.parse_args()


def load_idea(args: argparse.Namespace) -> Idea:
    ideas_text = Path(args.ideas_path).read_text(encoding="utf-8")
    ideas = parse_ideas(ideas_text)
    if not ideas:
        raise SystemExit("No ideas found in Ideas.md")

    if args.idea_id:
        match = next((item for item in ideas if item.story_id == args.idea_id), None)
    elif args.idea_index is not None:
        match = next((item for item in ideas if item.index == args.idea_index), None)
    elif args.idea_title:
        needle = args.idea_title.strip().lower()
        match = next((item for item in ideas if item.title.lower() == needle), None)
    else:
        match = ideas[0]

    if not match:
        raise SystemExit("Idea not found. Provide valid --idea-id, --idea-index, or --idea-title.")
    return match


def build_messages(master_prompt: str, idea: Idea) -> list[dict[str, str]]:
    system_prompt = (
        "You are a world-class cinematic prompt engineer, story architect, and AI video production director. "
        "You specialize in generating automation-ready, ultra-stable, visually consistent video scene plans for AI video models such as Google VEO 3. "
        "Your outputs must minimize visual errors, avoid complex interactions, and ensure high success rate in one-shot generation. "
        "Always return valid JSON only, with no markdown and no extra text."
    )

    user_prompt = f"""
MASTER TEMPLATE:
{master_prompt}

IDEA INPUT:
Title: {idea.title}
Description: {idea.description}
Story ID: {idea.story_id}

GLOBAL DIRECTIVE:
Convert the idea into a structured cinematic sequence optimized for AI video generation with maximum visual stability and minimal generation errors.

OUTPUT FORMAT (STRICT JSON ONLY):
{{
  "story_id": "{idea.story_id}",
  "story_title": "string",
  "scenes": [
    {{
      "scene_no": 1,
      "scene_name": "short scene name",
      "vo": "6-10 words, punchy and dramatic narration",
      "veo_prompt": "cinematic VEO 3 prompt"
    }}
  ]
}}

SCENE STRUCTURE RULES:
- Total scenes: 8 to 10 (strict)
- Each scene must be visually independent and simple
- Each scene must contain ONLY ONE primary subject whenever possible
- Avoid multi-subject interaction unless absolutely necessary
- Prefer slow, controlled, predictable motion
- Prefer static, slow pan, or slow tracking camera
- Each scene must feel like part of a continuous escalation

VOICEOVER RULES:
- 6 to 10 words ONLY
- Must fit 4–5 seconds narration
- No complex sentences
- No commas or multiple clauses
- Tone: dramatic, tense, curiosity-driven

VEO 3 PROMPT ENGINEERING (MANDATORY STRUCTURE):
Each "veo_prompt" MUST strictly follow this 9-part structure in one clean sentence:

1. Subject → Clearly defined single subject (avoid multiple entities)
2. Location → Simple, stable environment description
3. Action → Slow, controlled, visually predictable motion (avoid chaos)
4. Camera → Static, slow pan, or slow tracking only
5. Style → ultra realistic, cinematic, high detail
6. Lighting → clear and simple lighting condition
7. Mood → one emotional tone only
8. Duration → duration 4-5 seconds
9. Constraints → no text, no logo, no watermark, no subtitles, no humans (unless required)

CRITICAL GENERATION RULES (VERY IMPORTANT):
- Avoid fast motion, chaos, or complex physics
- Avoid fighting, collisions, or unpredictable interactions
- Avoid multiple animals attacking simultaneously
- Avoid camera cuts or transitions inside prompt
- Avoid storytelling inside prompt (visual only)
- Avoid abstract or unclear subjects
- Ensure each prompt can generate successfully in one attempt

PROMPT STYLE OPTIMIZATION:
- Keep prompts clean, direct, and highly descriptive
- Do NOT overcomplicate sentences
- Do NOT include narrative or explanation inside prompts
- Prioritize visual clarity over creativity
- Ensure consistency in style across all scenes

GOAL:
Maximize:
- First-pass generation success rate
- Visual stability
- Automation scalability

Minimize:
- Need for refinement
- Model confusion
- Scene inconsistency

FINAL OUTPUT REQUIREMENT:
Return ONLY valid JSON. No markdown. No explanations.
""".strip()

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def call_deepseek(
    api_key: str,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    timeout_seconds: int = 120,
) -> str:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        },
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()
    return payload["choices"][0]["message"]["content"]


def extract_json_block(text: str) -> str:
    candidate = text.strip()
    if candidate.startswith("{") and candidate.endswith("}"):
        return candidate
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end != -1 and start < end:
        return candidate[start : end + 1]
    return candidate


def log_raw_response(raw_text: str, idea: Idea, attempt: int) -> Path:
    RAW_LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RAW_LOG_DIR / f"{timestamp}_{idea.story_id}_attempt{attempt}.txt"
    path.write_text(raw_text, encoding="utf-8")
    return path


def validate_payload(raw_text: str) -> StoryPayload:
    try:
        data = json.loads(extract_json_block(raw_text))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model output is not valid JSON: {exc}") from exc

    try:
        story = StoryPayload.model_validate(data)
    except ValidationError as exc:
        raise ValueError(f"Schema validation failed: {exc}") from exc

    return story


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    args = parse_args()
    idea = load_idea(args)

    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
    model = (args.model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")).strip()
    max_retries = args.max_retries or int(os.getenv("MAX_LLM_RETRIES", "3"))

    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is missing. Add it to .env")

    master_prompt = Path(args.master_prompt_path).read_text(encoding="utf-8")
    messages = build_messages(master_prompt, idea)

    last_error = "Unknown error"
    for attempt in range(1, max_retries + 1):
        raw = call_deepseek(
            api_key=api_key,
            base_url=base_url,
            model=model,
            messages=messages,
            temperature=args.temperature,
        )
        log_path = log_raw_response(raw, idea, attempt)

        try:
            story = validate_payload(raw)
        except ValueError as exc:
            last_error = str(exc)
            correction_message = (
                f"Your previous output failed validation: {last_error}. "
                "Return corrected JSON only. Keep the same schema."
            )
            messages.append({"role": "assistant", "content": raw})
            messages.append({"role": "user", "content": correction_message})
            print(f"Attempt {attempt} failed validation. Logged raw output to: {log_path}")
            continue

        output = story.model_dump()
        if args.output_json:
            output_path = Path(args.output_json)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"Validated story saved to: {output_path}")
        else:
            print(json.dumps(output, indent=2, ensure_ascii=False))
        return

    raise SystemExit(f"Failed after {max_retries} attempts. Last error: {last_error}")


if __name__ == "__main__":
    main()
