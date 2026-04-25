from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# Force UTF-8 output and line buffering for real-time logs
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
else:
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, TypeError):
        pass # Fallback for environments that don't support reconfigure

from dotenv import load_dotenv
from playwright.sync_api import BrowserContext, Page, TimeoutError, sync_playwright, Locator


ROOT_DIR = Path(__file__).resolve().parents[1]


class FlowGenerationFailed(Exception):
    """VEO generation failed (detected via the Flow UI failure card)."""
STATE_DIR = ROOT_DIR / "state"
LOGS_DIR = ROOT_DIR / "logs"
SETTINGS_TRACE_PATH = LOGS_DIR / "flow_settings_trace.jsonl"
SETTINGS_NEEDS_PATH = LOGS_DIR / "flow_settings_needs.jsonl"
DEFAULT_AUTH_PATH = STATE_DIR / "flow_auth.json"
DEFAULT_SELECTORS_PATH = STATE_DIR / "flow_selectors.json"
DEFAULT_ELEMENTS_PATH = STATE_DIR / "flow_elements.json"
DEFAULT_SETTINGS_PATH = STATE_DIR / "flow_settings.json"
DEFAULT_DOWNLOADS_DIR = ROOT_DIR / "downloads"
DEFAULT_FLOW_URL = "https://labs.google/fx/tools/flow"


def now_utc_compact() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ts() -> str:
    """Current local time as HH:MM:SS -- prepended to every browser action log."""
    return datetime.now().strftime("%H:%M:%S")


def _print(msg: str) -> None:
    """Print with immediate flush to ensure real-time logging."""
    print(msg, flush=True)


def _log_settings_trace(event: str, payload: dict[str, Any]) -> None:
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        row = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, **payload}
        with SETTINGS_TRACE_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _request_setting_element(element_key: str, reason: str, context: str = "") -> None:
    msg = f"NEED-ELEMENT {element_key}: {reason}"
    if context:
        msg = f"{msg} | context={context}"
    print(f"             {msg}")
    _log_settings_trace(
        "need_element",
        {"element_key": element_key, "reason": reason, "context": context},
    )
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        row = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "element_key": element_key,
            "reason": reason,
            "context": context,
        }
        with SETTINGS_NEEDS_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _locator_snapshot(locator: Locator) -> dict[str, Any]:
    try:
        data = locator.evaluate(
            """el => ({
                tag: (el.tagName || '').toLowerCase(),
                id: el.id || '',
                role: el.getAttribute('role') || '',
                className: (el.className || '').toString().slice(0, 180),
                text: ((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 180),
                ariaLabel: el.getAttribute('aria-label') || '',
                ariaExpanded: el.getAttribute('aria-expanded') || '',
                ariaPressed: el.getAttribute('aria-pressed') || '',
                ariaSelected: el.getAttribute('aria-selected') || '',
                dataState: el.getAttribute('data-state') || ''
            })"""
        )
    except Exception:
        data = {}
    try:
        box = locator.bounding_box()
    except Exception:
        box = None
    if box:
        data["bbox"] = {
            "x": round(float(box.get("x", 0.0)), 1),
            "y": round(float(box.get("y", 0.0)), 1),
            "w": round(float(box.get("width", 0.0)), 1),
            "h": round(float(box.get("height", 0.0)), 1),
            "cx": round(float(box.get("x", 0.0) + box.get("width", 0.0) / 2), 1),
            "cy": round(float(box.get("y", 0.0) + box.get("height", 0.0) / 2), 1),
        }
    return data


def load_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def default_selectors() -> dict[str, list[str]]:
    return {
        "prompt_input": [
            "[data-slate-editor='true']",
            "[role='textbox'][contenteditable='true']",
            "[contenteditable='true'][role='textbox']",
            "div.sc-f0fc903f-0",
            "textarea",
        ],
        "settings_button": [
            "button[aria-haspopup='menu']:has(i:has-text('crop_9_16'))",
            "button[aria-haspopup='menu']:has(i:has-text('crop_16_9'))",
            "button.sc-67b77035-1",
        ],
        "type_tab_image": [
            "button[role='tab'].flow_tab_slider_trigger:has(i:has-text('image'))",
            "button[role='tab']:has-text('Image')",
        ],
        "type_tab_video": [
            "button[role='tab'].flow_tab_slider_trigger:has(i:has-text('videocam'))",
            "button[role='tab']:has-text('Video')",
        ],
        "subtype_tab_frames": [
            "button[role='tab'].flow_tab_slider_trigger:has(i:has-text('crop_free'))",
            "button[role='tab']:has-text('Frames')",
        ],
        "subtype_tab_ingredients": [
            "button[role='tab'].flow_tab_slider_trigger:has(i:has-text('chrome_extension'))",
            "button[role='tab']:has-text('Ingredients')",
        ],
        "generate_button": [
            "button:has-text('Create')",
            "button.sc-e8425ea6-0",
            "button[aria-label*='generate' i]",
        ],
        "new_project_button": [
            "button:has-text('New project')",
            "button.sc-16c4830a-1.jsIRVP",
            "button:has(i:has-text('add_2'))",
        ],
        "status_running": [
            "text=/Generating|In progress|Processing/i",
            "[aria-busy='true']",
        ],
        "status_done": [
            "button:has-text('Download')",
            "a:has-text('Download')",
            "button:has(i:has-text('download'))",
            "text=/Completed|Done|Ready/i",
            "button[aria-label*='options' i]",
            "button[aria-label*='download' i]",
        ],
        # Progress bar and scene name elements (VEO 3 Flow UI)
        "progress_bar": ["div.sc-55ebc859-7"],
        "scene_name":   ["div.sc-103881de-3"],
        "failure_card": [
            "div.sc-adc89304-1.eQDVum",               # exact class pair from live HTML
            "div.sc-adc89304-1",                       # component class only (fallback)
        ],
        "retry_button": [
            "button.sc-e7a64add-0:has(i:has-text('refresh'))",   # exact component class + refresh icon
            "button.sc-16c4830a-1:has(i:has-text('refresh'))",   # base button class + refresh icon
            "button:has(i:has-text('refresh')):has(span:has-text('Retry'))",  # fully semantic fallback
        ],
        "download_buttons": [
            "button:has-text('Download')",
            "button:text-is('Download')",
            "a:has-text('Download')",
            "button:has(i:has-text('download'))",
            "button:has(i:has-text('file_download'))",
            "[aria-label*='download' i]",
            "[title*='Download' i]",
            "[data-testid*='download' i]",
        ],
        "back_button": [
            "button:has(span:text-is('Go Back'))",
            "button:has-text('arrow_back')",
            "button:has(i:has-text('arrow_back'))",
            "button:has-text('Back')",
        ],
        "clip_title": [
            "div.sc-103881de-3",
        ],
        "clip_progress": [
            "div.sc-55ebc859-7",
        ],
        "clip_anchor": [
            "a[href*='/edit/']",
        ],
        "resolution_720p": [
            "[role='menuitem']:text-is('720p')",
            "button:has-text('720p')",
            "button:text-is('720p')",
            "span:has-text('720p')",
            "div:has-text('720p')",
        ],
        "aspect_ratio_buttons": [
            "button[role='tab']:has-text('9:16')",
            "button[role='tab']:has-text('16:9')",
        ],
        "clip_count_buttons": [
            "button[role='tab']:text-is('x1')",
            "button[role='tab']:text-is('x2')",
            "button[role='tab']:text-is('x3')",
            "button[role='tab']:text-is('x4')",
        ],
        "duration_buttons": [
            "button[role='tab']:text-is('4s')",
            "button[role='tab']:text-is('6s')",
            "button[role='tab']:text-is('8s')",
        ],
        "model_dropdown": [
            "button[aria-haspopup='menu']:has(i:has-text('arrow_drop_down'))",
            "button.sc-a0dcecfb-1",
            "button[aria-haspopup='listbox']",
            "button:has-text('Veo')",
            "[role='combobox']",
        ],
        "model_options": [
            "[role='menuitemradio']",
            "[role='menuitem']",
            "[role='option']",
        ],
        "project_card": [
            "[role='listitem']",
            "a[href*='/project/']",
            "a[href*='/p/']",
        ],
        "project_link": [
            "a[href*='/project/']",
            "a[href*='/p/']",
        ],
        "failure_card": [
            "div.sc-adc89304-1.eQDVum",
            "div.sc-adc89304-1",
            "text=/Failed|Try again|Something went wrong/i",
        ],
        "retry_button": [
            "button.sc-e7a64add-0:has(i:has-text('refresh'))",
            "button.sc-16c4830a-1:has(i:has-text('refresh'))",
            "button:has(i:has-text('refresh')):has(span:has-text('Retry'))",
            "button:text-is('Retry')",
            "button:has(span:text-is('Retry'))",
        ],
    }


def default_settings() -> dict[str, str]:
    return {
        "mode": "Video",
        "sub_type": "Frames",
        "aspect_ratio": "9:16",
        "clip_count": "x4",
        "duration": "8s",
        "model": "Veo 3.1 - Fast",
    }


def default_element_sheet() -> dict[str, Any]:
    elements: dict[str, dict[str, Any]] = {}
    for key, selectors in default_selectors().items():
        elements[key] = {
            "selectors": selectors,
            "notes": "",
            "used_in": [],
        }
    return {
        "meta": {
            "version": 1,
            "description": "Centralized Flow UI element sheet. Update selectors here when UI changes.",
            "updated_at": now_utc_compact(),
        },
        "elements": elements,
    }


def selectors_from_sheet(sheet: dict[str, Any]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    elements = sheet.get("elements", {})
    if not isinstance(elements, dict):
        return out
    for key, payload in elements.items():
        if isinstance(payload, dict):
            selectors = payload.get("selectors", [])
            if isinstance(selectors, list):
                out[key] = [str(item) for item in selectors if str(item).strip()]
    return out


def load_selectors_config(
    selectors_path: Path,
    elements_path: Path | None = None,
) -> dict[str, list[str]]:
    cfg: dict[str, list[str]] = default_selectors()

    if elements_path and elements_path.exists():
        try:
            sheet = load_json(elements_path, {})
            cfg.update(selectors_from_sheet(sheet))
        except Exception:
            pass

    if selectors_path.exists():
        try:
            legacy = load_json(selectors_path, {})
            for key, selectors in legacy.items():
                if isinstance(selectors, list):
                    cfg[key] = [str(item) for item in selectors if str(item).strip()]
        except Exception:
            pass
    return cfg


def selector_list(selectors_cfg: dict[str, Any], key: str) -> list[str]:
    value = selectors_cfg.get(key, [])
    if isinstance(value, list) and value:
        return [str(item) for item in value if str(item).strip()]
    return default_selectors().get(key, [])


def ensure_config_files(
    selectors_path: Path,
    settings_path: Path,
    elements_path: Path = DEFAULT_ELEMENTS_PATH,
) -> None:
    if not elements_path.exists():
        save_json(elements_path, default_element_sheet())
    if not selectors_path.exists():
        # Backward-compatible flattened selectors file.
        save_json(selectors_path, selectors_from_sheet(load_json(elements_path, default_element_sheet())))
    if not settings_path.exists():
        save_json(settings_path, default_settings())


def first_locator(page: Page, selectors: list[str]):
    for selector in selectors:
        locator = page.locator(selector).first
        if locator.count() > 0:
            return locator, selector
    return None, ""


def wait_for_any_selector(root: Page | Locator, selectors: list[str], timeout_ms: int) -> tuple[bool, str]:
    """Waits for any of the given selectors to appear under the root (Page or Locator)."""
    step_ms = 700
    elapsed = 0
    # Determine the page object for the timeout call
    if hasattr(root, "wait_for_timeout"):
        pg = root
    else:
        pg = root.page

    while elapsed < timeout_ms:
        for selector in selectors:
            locator = root.locator(selector).first
            try:
                if locator.count() > 0 and locator.is_visible(timeout=300):
                    return True, selector
            except Exception:
                pass
        pg.wait_for_timeout(step_ms)
        elapsed += step_ms
    return False, ""


def first_visible_locator(root: Page | Locator, selectors: list[str], timeout_ms: int = 0) -> tuple[Locator | None, str]:
    """Return the first visible locator matching any selector under the root."""
    step_ms = 500
    elapsed = 0
    if hasattr(root, "wait_for_timeout"):
        pg = root
    else:
        pg = root.page

    while elapsed <= timeout_ms:
        for selector in selectors:
            try:
                matches = root.locator(selector)
                count = matches.count()
                for idx in range(count):
                    locator = matches.nth(idx)
                    if locator.is_visible(timeout=200):
                        return locator, selector
            except Exception:
                continue
        if elapsed >= timeout_ms:
            break
        pg.wait_for_timeout(step_ms)
        elapsed += step_ms
    return None, ""


def capture_failure_artifacts(page: Page, tag: str) -> tuple[Path, Path]:
    ts = now_utc_compact()
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    screenshot_path = LOGS_DIR / f"flow_failure_{tag}_{ts}.png"
    html_path = LOGS_DIR / f"flow_failure_{tag}_{ts}.html"
    page.screenshot(path=str(screenshot_path), full_page=True)
    html_path.write_text(page.content(), encoding="utf-8")
    return screenshot_path, html_path


def _click_button_by_text(page: Page, text: str, description: str) -> bool:
    """Click a visible button whose full text matches. Returns True on success."""
    # role='tab' selectors come first — they scope to actual tab buttons and avoid matching
    # the settings toggle button (aria-haspopup='menu', no role='tab') that also contains
    # mode text like 'Video'. :has-text() must precede :text-is() for icon buttons because
    # Google Symbols icons add their ligature text (e.g. 'videocam', 'crop_9_16') to
    # textContent, making :text-is() exact-match fail.
    selectors = [
        f"button[role='tab']:text-is('{text}')",
        f"button[role='tab']:has-text('{text}')",
        f"[role='tab']:text-is('{text}')",
        f"[role='tab']:has-text('{text}')",
        f"button:text-is('{text}')",
        f"[role='button']:text-is('{text}')",
        f"button:has-text('{text}')",
        f"[role='button']:has-text('{text}')",
    ]
    print(f"  [{_ts()}] CLICK    {description} = '{text}'")
    _log_settings_trace("click_start", {"description": description, "target_text": text})

    for selector in selectors:
        print(f"             trying  : {selector}")
        _log_settings_trace(
            "click_try_selector",
            {"description": description, "target_text": text, "selector": selector},
        )
        try:
            matches = page.locator(selector)
            count = matches.count()
            _log_settings_trace(
                "click_selector_count",
                {
                    "description": description,
                    "target_text": text,
                    "selector": selector,
                    "count": count,
                },
            )
            el, matched_sel = first_visible_locator(page, [selector], 400)
            if not el:
                continue

            snap = _locator_snapshot(el)
            is_active = el.evaluate("""el => {
                const cls = (el.className || '').toLowerCase();
                return cls.includes('active') ||
                       cls.includes('selected') ||
                       el.getAttribute('aria-pressed') === 'true' ||
                       el.getAttribute('aria-selected') === 'true' ||
                       el.getAttribute('data-state') === 'active';
            }""")
            if is_active:
                print(f"             SKIP    : '{text}' is already active")
                _log_settings_trace(
                    "click_skip_already_active",
                    {
                        "description": description,
                        "target_text": text,
                        "selector": matched_sel or selector,
                        "element": snap,
                    },
                )
                return True

            el.scroll_into_view_if_needed()
            el.click(force=True)
            page.wait_for_timeout(300)
            _print(f"             OK      : clicked at [{_ts()}]")
            _log_settings_trace(
                "click_success",
                {
                    "description": description,
                    "target_text": text,
                    "selector": matched_sel or selector,
                    "element": snap,
                },
            )
            return True
        except Exception as exc:
            _print(f"             error   : {exc}")
            _log_settings_trace(
                "click_error",
                {
                    "description": description,
                    "target_text": text,
                    "selector": selector,
                    "error": str(exc),
                },
            )

    _print(f"  [{_ts()}] SKIP     {description} = '{text}' — no matching button found")
    missing_key = {
        "mode": "mode_buttons",
        "aspect ratio": "aspect_ratio_buttons",
        "clip count": "clip_count_buttons",
        "duration": "duration_buttons",
    }.get(description, f"{description.replace(' ', '_')}_buttons")
    _request_setting_element(
        missing_key,
        f"Could not find/click '{text}' button",
        f"description={description}",
    )
    return False


def fill_prompt(page: Page, prompt: str) -> None:
    """Find the main Flow prompt textarea and fill it."""
    selectors = [
        "[data-slate-editor='true']",
        "[role='textbox'][contenteditable='true']",
        "[contenteditable='true'][role='textbox']",
        "textarea[placeholder*='create' i]",
        "textarea[placeholder*='prompt' i]",
        "textarea",
    ]
    preview = prompt[:90] + ("..." if len(prompt) > 90 else "")
    print(f"  [{_ts()}] WAITING  3s before filling prompt...")
    page.wait_for_timeout(3000)
    print(f"  [{_ts()}] FILL     prompt textarea  ({len(prompt)} chars)")
    print(f"             preview : {preview}")
    
    # Ensure any overlays (like settings) are cleared
    print(f"             ACTION  clearing potential overlays (Escape)...")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)

    for selector in selectors:
        _print(f"             trying  : {selector}")
        try:
            el = page.locator(selector).first
            el.wait_for(state="visible", timeout=600 if "textarea" in selector else 1500)
            
            if el.count() > 0:
                el.scroll_into_view_if_needed()
                
                # Click to focus
                el.click(force=True)
                page.wait_for_timeout(500)
                
                # Clear existing content more aggressively
                page.keyboard.press("Control+a")
                page.keyboard.press("Backspace")
                page.keyboard.press("Control+a")
                page.keyboard.press("Backspace")
                page.wait_for_timeout(800)
                
                # Fill the prompt
                el.fill(prompt)
                
                # Wait for editor to register content
                page.wait_for_timeout(1000)
                _print(f"             OK      : filled at [{_ts()}]")
                return
        except Exception as exc:
            _print(f"             info    : {selector} failed ({str(exc)[:60]})")
            continue
    raise RuntimeError("Could not find the prompt input on the Flow page.")


def _select_model_dropdown(
    page: Page,
    model: str,
    selectors_path: Path | None = None,
    elements_path: Path | None = None,
) -> None:
    """Open the model dropdown and click the matching option."""
    print(f"  [{_ts()}] DROPDOWN model = '{model}'")
    _log_settings_trace("model_select_start", {"target_model": model})
    
    selectors_cfg = load_selectors_config(selectors_path or DEFAULT_SELECTORS_PATH, elements_path)

    hints = ["Veo"] if "Veo" in model else ["Nano", "Imagen", "Banana"]
    opened = False

    current_model_btn, _ = first_visible_locator(
        page,
        [
            f"button:text-is('{model}')",
            f"button:has-text('{model}')",
        ],
        800,
    )
    if current_model_btn:
        try:
            btn_text = current_model_btn.inner_text().strip()
            if btn_text == model:
                print(f"             SKIP    : '{model}' is already active")
                return
        except Exception:
            pass
    
    dropdown_sels = selector_list(selectors_cfg, "model_dropdown") + [
        "button[aria-haspopup='menu']:has(i:has-text('arrow_drop_down'))",
        "button[aria-haspopup='listbox']",
        "button[aria-haspopup='menu']:has-text('Veo')",
        "[role='combobox']",
        "[role='button']:has(i:has-text('expand_more'))",
    ]
    for hint in hints:
        dropdown_sels.append(f"button:has-text('{hint}')")

    for sel in dropdown_sels:
        print(f"             trying  : open dropdown via {sel}")
        _log_settings_trace("model_dropdown_try", {"selector": sel, "target_model": model})
        try:
            btn, _ = first_visible_locator(page, [sel], 1200)
            if btn:
                snap = _locator_snapshot(btn)
                btn.click(force=True)
                page.wait_for_timeout(800)
                print(f"             opened  : dropdown at [{_ts()}]")
                _log_settings_trace(
                    "model_dropdown_opened",
                    {"selector": sel, "target_model": model, "element": snap},
                )
                opened = True
                break
        except Exception:
            continue

    if not opened:
        print(f"  [{_ts()}] WARN     Could not open model dropdown")
        _request_setting_element(
            "model_dropdown",
            f"Could not open model dropdown for '{model}'",
            "provide the exact selector for the model dropdown button",
        )
        return

    page.wait_for_timeout(400)

    def _norm(text: str) -> str:
        text = (text or "").lower().replace("\u2014", "-").replace("\u2013", "-")
        text = re.sub(r"[^a-z0-9]+", " ", text)
        return re.sub(r"\s+", " ", text).strip()

    target_norm = _norm(model)
    try:
        visible_options = page.locator(
            "[role='menuitemradio'], [role='menuitem'], [role='option'], [data-radix-collection-item]"
        )
        for i in range(visible_options.count()):
            opt = visible_options.nth(i)
            if not opt.is_visible(timeout=200):
                continue
            label = (opt.inner_text() or "").strip()
            if target_norm and target_norm in _norm(label):
                snap = _locator_snapshot(opt)
                opt.click(force=True)
                page.wait_for_timeout(500)
                print(f"             OK      : model set to '{model}' at [{_ts()}]")
                _log_settings_trace(
                    "model_option_selected",
                    {"target_model": model, "strategy": "visible_options_scan", "label": label, "element": snap},
                )
                return
    except Exception:
        pass

    option_sels = [
        f"[role='menuitemradio']:text-is('{model}')",
        f"[role='menuitemradio']:has-text('{model}')",
        f"[role='option']:has-text('{model}')",
        f"[role='menuitem']:has-text('{model}')",
        f"li:has-text('{model}')",
        f"button:has-text('{model}')",
        f"text='{model}'"
    ]
    for item_sel in option_sels:
        print(f"             trying  : option {item_sel}")
        _log_settings_trace("model_option_try", {"selector": item_sel, "target_model": model})
        try:
            opt, _ = first_visible_locator(page, [item_sel], 1500)
            if opt:
                snap = _locator_snapshot(opt)
                opt.click(force=True)
                page.wait_for_timeout(500)
                print(f"             OK      : model set to '{model}' at [{_ts()}]")
                _log_settings_trace(
                    "model_option_selected",
                    {"target_model": model, "strategy": "selector_match", "selector": item_sel, "element": snap},
                )
                return
        except Exception:
            continue
    
    try:
        page.locator(f"text='{model}'").first.click(timeout=2000)
        print(f"             OK      : model set to '{model}' (fallback match)")
        return
    except Exception:
        pass

    print(f"  [{_ts()}] WARN     model option '{model}' not found -- leaving as-is")
    try:
        visible_labels: list[str] = []
        opts = page.locator("[role='menuitemradio'], [role='menuitem'], [role='option'], [data-radix-collection-item]")
        for i in range(min(opts.count(), 20)):
            opt = opts.nth(i)
            if opt.is_visible(timeout=150):
                label = (opt.inner_text() or "").strip()
                if label:
                    visible_labels.append(label[:120])
        _log_settings_trace("model_option_missing", {"target_model": model, "visible_options": visible_labels})
    except Exception:
        _log_settings_trace("model_option_missing", {"target_model": model, "visible_options": []})
    _request_setting_element(
        "model_options",
        f"Model option '{model}' not found in opened dropdown",
        "share selector(s) for the dropdown options list items",
    )


def _ensure_settings_panel_open(page: Page) -> bool:
    # Markers that are only visible when the settings panel is open.
    # Clip-count tabs (x1-x4) have NO icons so :text-is works perfectly.
    # Orientation tabs (9:16/16:9) DO have crop icons, so use :has-text.
    # Model dropdown button is also always visible when panel is open.
    marker_sels = [
        "button[role='tab']:text-is('x4')",
        "button[role='tab']:text-is('x3')",
        "button[role='tab']:text-is('x2')",
        "button[role='tab']:text-is('x1')",
        "button[role='tab']:has-text('9:16')",
        "button[role='tab']:has-text('16:9')",
        "button[aria-haspopup='menu']:has(i:has-text('arrow_drop_down'))",
        "button:has-text('Veo')",
    ]
    marker, _ = first_visible_locator(page, marker_sels, 500)
    if marker:
        _log_settings_trace("settings_panel_state", {"state": "already_open"})
        return True

    # The settings toggle button shows current mode + orientation icon + clip count.
    # It is NOT labeled 'Settings'. Distinguish from model dropdown (arrow_drop_down icon).
    settings_btn_sels = [
        "button[aria-haspopup='menu']:has(i:has-text('crop_9_16'))",
        "button[aria-haspopup='menu']:has(i:has-text('crop_16_9'))",
        "button.sc-67b77035-1",
    ]
    for s_sel in settings_btn_sels:
        try:
            btn = page.locator(s_sel).first
            if btn.count() > 0 and btn.is_visible():
                snap = _locator_snapshot(btn)
                btn.click()
                page.wait_for_timeout(1200)
                marker, _ = first_visible_locator(page, marker_sels, 800)
                if marker:
                    _log_settings_trace(
                        "settings_panel_opened",
                        {"selector": s_sel, "button": snap},
                    )
                    return True
        except Exception:
            continue
    _log_settings_trace("settings_panel_state", {"state": "not_open"})
    _request_setting_element(
        "settings_button",
        "Could not confirm/open settings panel",
        "provide exact selector for the settings panel toggle button",
    )
    return False


def apply_settings(
    page: Page,
    settings_cfg: dict[str, str],
    selectors_path: Path | None = None,
    elements_path: Path | None = None,
) -> None:
    """Click the exact setting buttons visible in the Flow creation panel."""
    mode     = settings_cfg.get("mode",         "Video").strip()
    sub_type = settings_cfg.get("sub_type",     "").strip()
    aspect   = settings_cfg.get("aspect_ratio", "").strip()
    count    = settings_cfg.get("clip_count",   "").strip()
    model    = settings_cfg.get("model",        "").strip()
    duration = settings_cfg.get("duration",     "").strip()

    print(f"  [{_ts()}] SETTINGS applying --"
          f"  mode={mode}  sub_type={sub_type or 'n/a'}  aspect={aspect}  clips={count}"
          f"  model={model}  duration={duration or 'n/a'}")
    print(f"             TRACE    detailed click telemetry -> {SETTINGS_TRACE_PATH}")
    _log_settings_trace(
        "apply_settings_start",
        {"mode": mode, "aspect_ratio": aspect, "clip_count": count, "model": model, "duration": duration},
    )

    # Wait for editor stability
    print(f"             WAITING for editor panel...")
    success, found_sel = wait_for_any_selector(
        page,
        [
            "[data-slate-editor='true']",
            "[role='textbox'][contenteditable='true']",
            "button[aria-haspopup='menu']:has(i:has-text('crop_9_16'))",
            "button[aria-haspopup='menu']:has(i:has-text('crop_16_9'))",
            "button[role='tab']:text-is('x4')",
        ],
        12000,
    )
    if not success:
        print(f"             ERROR   Editor panel did not appear (timed out). Current URL: {page.url}")
        _log_settings_trace("apply_settings_abort", {"reason": "editor_panel_not_ready", "url": page.url})
        return
    print(f"             OK      Editor panel ready (via {found_sel})")
    page.wait_for_timeout(1000)

    print(f"             ACTION  Checking settings panel visibility...")
    settings_visible = _ensure_settings_panel_open(page)
    if settings_visible:
        print(f"             INFO    Settings panel already open")
    else:
        print(f"             WARN    Could not verify settings panel visibility; proceeding with best effort")

    _click_button_by_text(page, mode, "mode")
    page.wait_for_timeout(1500)

    if sub_type and mode == "Video":
        _click_button_by_text(page, sub_type, "sub type")
        page.wait_for_timeout(1500)

    if aspect:
        _click_button_by_text(page, aspect, "aspect ratio")
        page.wait_for_timeout(3000)
    if count:
        _click_button_by_text(page, count, "clip count")
        page.wait_for_timeout(3000)
    if model:
        _ensure_settings_panel_open(page)
        _select_model_dropdown(page, model, selectors_path, elements_path)
    if mode == "Video" and duration:
        _ensure_settings_panel_open(page)
        _click_button_by_text(page, duration, "duration")

    print(f"  [{_ts()}] ACTION    collapsing settings menu...")
    close_sels = ["button:has-text('Done')", "button:has-text('Close')", "button[aria-label*='close' i]"]
    found_close = False
    for sel in close_sels:
        try:
            btn = page.locator(sel).first
            if btn.count() > 0 and btn.is_visible(timeout=1000):
                snap = _locator_snapshot(btn)
                btn.click()
                _log_settings_trace("settings_panel_collapsed", {"strategy": "close_button", "selector": sel, "element": snap})
                found_close = True
                break
        except Exception:
            continue
    
    if not found_close:
        page.keyboard.press("Escape")
        _log_settings_trace("settings_panel_collapsed", {"strategy": "keyboard_escape"})
    
    page.wait_for_timeout(1000)
    print(f"  [{_ts()}] SETTINGS all applied and collapsed")
    _log_settings_trace("apply_settings_done", {"status": "completed"})


def click_new_project(
    page: Page,
    selectors_path: Path | None = None,
    elements_path: Path | None = None,
) -> None:
    """Click the 'New project' button to reset the Flow workspace."""
    selectors_cfg = load_selectors_config(selectors_path or DEFAULT_SELECTORS_PATH, elements_path)

    selectors = selector_list(selectors_cfg, "new_project_button") + [
        "button:has-text('New project')",
        "button.sc-a38764c7-0",
        "button.jsIRVP",
        "button:has(i:has-text('add'))",
    ]
    print(f"  [{_ts()}] ACTION    Clicking 'New project'")
    page.wait_for_timeout(3000)
    for selector in selectors:
        try:
            btn = page.locator(selector).first
            if btn.count() > 0 and btn.is_visible():
                btn.click()
                page.wait_for_timeout(2000)
                print(f"             OK      : clicked at [{_ts()}]")
                return
        except Exception as exc:
            print(f"             error   : {exc}")
    print(f"  [{_ts()}] WARN     Could not find 'New project' button -- skipping")


def rename_project(
    page: Page,
    new_name: str,
    selectors_path: Path | None = None,
    elements_path: Path | None = None,
) -> None:
    """Rename the current Flow project to make it uniquely identifiable."""
    print(f"  [{_ts()}] ACTION    Renaming project to '{new_name}'")
    selectors_cfg = load_selectors_config(selectors_path or DEFAULT_SELECTORS_PATH, elements_path)

    try:
        more_sels = selector_list(selectors_cfg, "project_more_options") or [
            "button[aria-label='More options']", 
            "button:has(i:has-text('more_vert'))", 
        ]
        found_trigger = False
        for sel in more_sels:
            more_btn = page.locator(sel).first
            if more_btn.count() > 0 and more_btn.is_visible():
                more_btn.click()
                page.wait_for_timeout(1000)
                rename_sels = selector_list(selectors_cfg, "project_rename_item") or ["button:has-text('Rename')"]
                for r_sel in rename_sels:
                    rename_item = page.locator(r_sel).first
                    if rename_item.count() > 0:
                        rename_item.click()
                        page.wait_for_timeout(2000)
                        found_trigger = True
                        break
                if found_trigger: break
                page.keyboard.press("Escape")
        
        if not found_trigger:
            edit_btn_sels = selector_list(selectors_cfg, "project_name_container") + ["button:has-text('Edit project')"]
            for sel in edit_btn_sels:
                edit_btn = page.locator(sel).first
                if edit_btn.count() > 0:
                    edit_btn.click()
                    page.wait_for_timeout(2000)
                    found_trigger = True
                    break

        if found_trigger:
            input_sels = selector_list(selectors_cfg, "project_rename_input") or ["input[type='text']"]
            for sel in input_sels:
                input_field = page.locator(sel).first
                if input_field.count() > 0:
                    input_field.fill(new_name)
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(2000)
                    print(f"             OK      : renamed at [{_ts()}]")
                    return
    except Exception as exc:
        print(f"             error   : {exc}")
    print(f"  [{_ts()}] WARN     Project rename failed")


def open_existing_project(
    page: Page,
    project_name: str,
    known_project_url: str | None = None,
    alternate_project_names: list[str] | None = None,
    selectors_path: Path | None = None,
    elements_path: Path | None = None,
) -> bool:
    print(f"  [{_ts()}] ACTION    Looking for existing project: '{project_name}'")
    selectors_cfg = load_selectors_config(selectors_path or DEFAULT_SELECTORS_PATH, elements_path)

    def _is_project_url(url: str) -> bool:
        return any(token in (url or "") for token in ["/fx/tools/flow/project/", "/project/", "/p/"])

    def _has_project_path(url: str) -> bool:
        value = (url or "").lower()
        return ("/fx/tools/flow/project/" in value) or ("/project/" in value)

    def _verify_project_entered(timeout_ms: int = 7000) -> bool:
        # Require explicit project URL path before considering navigation successful.
        start = time.time()
        while (time.time() - start) * 1000 < timeout_ms:
            curr_url = page.url
            if _has_project_path(curr_url):
                return True
            page.wait_for_timeout(400)
        return False

    def _normalize(text: str) -> str:
        text = (text or "").lower()
        text = re.sub(r"[^a-z0-9]+", " ", text)
        return re.sub(r"\s+", " ", text).strip()

    names: list[str] = []
    for value in [project_name] + (alternate_project_names or []):
        v = str(value or "").strip()
        if v and v not in names:
            names.append(v)
    normalized_names = [_normalize(n) for n in names if _normalize(n)]

    def _matches_project_name(haystack: str) -> bool:
        hay = _normalize(haystack)
        if not hay:
            return False
        return any(
            (name and name in hay) or (hay in name and len(hay) >= 8)
            for name in normalized_names
        )

    try:
        card_selectors = selector_list(selectors_cfg, "project_card") or [".sc-7153f67b-1", "[role='listitem']"]
        link_selectors = selector_list(selectors_cfg, "project_link") or ["a[href*='/project/']", "a[href*='/p/']"]

        # ── Strategy 1: Navigate directly to saved URL (fastest, most reliable) ──
        if known_project_url:
            target = str(known_project_url).strip()
            if target.startswith("/"):
                target = f"https://labs.google{target}"
            print(f"             ACTION   navigating to saved project URL: {target}")
            try:
                page.goto(target, wait_until="domcontentloaded")
                page.wait_for_timeout(3000)
                if _verify_project_entered(timeout_ms=12000):
                    print(f"             OK      entered project via saved URL. URL: {page.url}")
                    return True
                print("             DEBUG   saved URL opened but /project/ verification failed; trying name search")
                # Navigate back to Flow home to do name-based search
                page.goto(DEFAULT_FLOW_URL, wait_until="domcontentloaded")
                page.wait_for_timeout(3000)
            except Exception as exc:
                print(f"             DEBUG   saved URL navigation failed: {exc}")
                try:
                    page.goto(DEFAULT_FLOW_URL, wait_until="domcontentloaded")
                    page.wait_for_timeout(3000)
                except Exception:
                    pass

        # ── Strategy 2: Search by name in project list ──────────────────────────
        wait_for_any_selector(page, card_selectors + link_selectors + ["button:has-text('New project')"], 10000)

        for link_sel in link_selectors:
            try:
                links = page.locator(link_sel)
                for idx in range(links.count()):
                    link = links.nth(idx)
                    if not link.is_visible(timeout=300):
                        continue
                    meta = link.evaluate(
                        """el => ({
                            text: ((el.innerText || el.textContent || '') + '').trim(),
                            title: (el.getAttribute('title') || '').trim(),
                            aria: (el.getAttribute('aria-label') || '').trim(),
                            href: (el.getAttribute('href') || '').trim()
                        })"""
                    )
                    hay = f"{meta.get('text','')} {meta.get('title','')} {meta.get('aria','')} {meta.get('href','')}"
                    if not _matches_project_name(hay):
                        continue
                    print(f"             MATCH   found project link via {link_sel}")
                    print(f"             CLICK   attempting entry...")
                    link.click(force=True)
                    page.wait_for_timeout(1000)
                    curr_url = page.url
                    print(f"             DEBUG   Current URL after click: {curr_url}")
                    if _verify_project_entered(timeout_ms=12000):
                        print(f"             OK      entered project. URL: {curr_url}")
                        page.wait_for_timeout(2000)
                        return True
            except Exception:
                continue

        for card_sel in card_selectors:
            cards = page.locator(card_sel)
            for idx in range(cards.count()):
                card = cards.nth(idx)
                try:
                    text = card.inner_text()
                    if not _matches_project_name(text):
                        continue
                    print(f"             MATCH   found card with text: '{text.replace(chr(10), ' ')}'")
                    child, child_sel = first_visible_locator(
                        card,
                        link_selectors
                        + [
                            "a[href*='/fx/tools/flow/project/']",
                            "a[href*='/project/']",
                            "a[href*='/p/']",
                            "a",
                        ],
                        1000,
                    )
                    if child:
                        print(f"             CLICK   attempting child: {child_sel}")
                        child.click(force=True)
                    else:
                        print(f"             CLICK   attempting card entry...")
                        card.click(force=True)
                    page.wait_for_timeout(1000)
                    if _verify_project_entered(timeout_ms=12000):
                        print(f"             OK      entered project. URL: {page.url}")
                        return True
                except Exception as e:
                    print(f"             DEBUG   card check error: {e}")
                    continue

        print(f"  [{_ts()}] INFO     Could not enter existing project '{project_name}' (Verification failed).")
        return False
    except Exception as exc:
        print(f"             error   : {exc}")
    return False


def wait_for_submit_ready(page: Page, selectors_cfg: dict[str, Any], timeout_ms: int = 15000) -> bool:
    start = time.time()
    while (time.time() - start) * 1000 < timeout_ms:
        try:
            btn_sels = selector_list(selectors_cfg, "generate_button") or ["button:has-text('Create')"]
            for sel in btn_sels:
                l = page.locator(sel).first
                if l.count() > 0 and l.is_visible() and l.is_enabled():
                    return True
        except Exception: pass
        page.wait_for_timeout(500)
    return False


def submit_generation(page: Page, selectors_cfg: dict[str, Any]) -> None:
    selectors = selector_list(selectors_cfg, "generate_button") + ["button:has-text('Create')"]
    print(f"  [{_ts()}] WAITING  3s before submission...")
    page.wait_for_timeout(3000)
    print(f"  [{_ts()}] SUBMIT   generation button")
    for selector in selectors:
        try:
            btns = page.locator(selector)
            for i in range(btns.count()):
                btn = btns.nth(i)
                if btn.is_visible() and btn.is_enabled():
                    btn.click()
                    _print(f"             OK      : submitted at [{_ts()}]")
                    return
        except Exception: pass
    raise RuntimeError("Could not find the Generate/Submit button.")


def _click_retry_button(page: Page, selectors_cfg: dict[str, Any]) -> bool:
    retry_sels = ["button:has-text('Retry')"] + selector_list(selectors_cfg, "retry_button")
    for sel in retry_sels:
        try:
            btn, _ = first_visible_locator(page, [sel], 400)
            if btn:
                btn.click(force=True)
                page.wait_for_timeout(2000)
                return True
        except Exception: pass
    return False


def count_generated_cards(page: Page, selectors_cfg: dict[str, Any]) -> int:
    card_sels = selector_list(selectors_cfg, "clip_card") or ["div:has(> video)", "div:has(> div > video)"]
    highest = 0
    for sel in card_sels:
        try:
            cards = page.locator(sel)
            count = cards.count()
            if count > highest:
                highest = count
        except Exception:
            continue
    return highest


def list_clip_card_summaries(page: Page, selectors_cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Return visible clip card summaries with a stable-ish signature for dedupe tracking."""
    card_sels = selector_list(selectors_cfg, "clip_card") or ["div:has(> video)", "div:has(> div > video)"]
    title_sels = selector_list(selectors_cfg, "clip_title") or ["div.sc-103881de-3"]
    progress_sels = selector_list(selectors_cfg, "clip_progress") or ["div.sc-55ebc859-7"]
    anchor_sels = selector_list(selectors_cfg, "clip_anchor") or ["a[href*='/edit/']"]
    cards_loc: Locator | None = None
    for sel in card_sels:
        try:
            loc = page.locator(sel)
            if loc.count() > 0:
                cards_loc = loc
                break
        except Exception:
            continue

    if not cards_loc:
        return []

    summaries: list[dict[str, Any]] = []
    total = cards_loc.count()
    for idx in range(total):
        card = cards_loc.nth(idx)
        try:
            if not card.is_visible(timeout=200):
                continue
            info = card.evaluate(
                """el => {
                    const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
                    const video = el.querySelector("video");
                    const source = el.querySelector("source");
                    const img = el.querySelector("img");
                    const tileHost = el.closest('[data-tile-id]') || el.querySelector('[data-tile-id]');
                    const tileId = tileHost ? (tileHost.getAttribute('data-tile-id') || '') : '';
                    const anchor = el.closest('a[href*="/edit/"]') || el.querySelector('a[href*="/edit/"]');
                    const href = anchor ? (anchor.getAttribute('href') || '') : '';
                    const poster = video ? (video.getAttribute("poster") || "") : "";
                    const videoSrc = video ? (video.currentSrc || video.src || "") : "";
                    const sourceSrc = source ? (source.src || "") : "";
                    const imgSrc = img ? (img.currentSrc || img.src || "") : "";
                    const bg = getComputedStyle(el).backgroundImage || "";
                    const failed = /failed|try again|something went wrong/i.test(text);
                    return { text, poster, videoSrc, sourceSrc, imgSrc, bg, failed, tileId, href };
                }"""
            )
            title = ""
            for sel in title_sels:
                try:
                    t = card.locator(sel).first
                    if t.count() > 0 and t.is_visible(timeout=100):
                        title = t.inner_text().strip()
                        if title:
                            break
                except Exception:
                    continue

            progress_text = ""
            progress_pct: int | None = None
            for sel in progress_sels:
                try:
                    p = card.locator(sel).first
                    if p.count() > 0 and p.is_visible(timeout=100):
                        progress_text = p.inner_text().strip()
                        m = re.search(r"(\\d{1,3})%", progress_text)
                        if m:
                            progress_pct = int(m.group(1))
                        break
                except Exception:
                    continue

            href = str(info.get("href", "")).strip()
            if not href:
                for sel in anchor_sels:
                    try:
                        a = card.locator(sel).first
                        if a.count() > 0:
                            href = (a.get_attribute("href") or "").strip()
                            if href:
                                break
                    except Exception:
                        continue

            has_media_preview = any(
                str(info.get(k, "")).strip()
                for k in ("videoSrc", "sourceSrc", "poster", "imgSrc")
            )
            ready = bool(has_media_preview and (progress_pct is None or progress_pct >= 100))
            # Use only stable identifiers — video/poster URLs contain expiry tokens that
            # change between polls, causing old failed cards to bypass the dedupe filter.
            tile_id = str(info.get("tileId", "")).strip()
            stable_parts = [tile_id, href]
            if not any(stable_parts):
                # No server-assigned ID available; fall back to failure text or position.
                stable_parts = [title or str(info.get("text", "")).strip()[:120], f"card-{idx}"]
            signature = "|".join(p for p in stable_parts if p) or f"card-{idx}"
            summaries.append(
                {
                    "index": idx,
                    "card_key": signature,
                    "failed": bool(info.get("failed", False)),
                    "ready": ready,
                    "progress_pct": progress_pct,
                    "href": href,
                    "tile_id": str(info.get("tileId", "")).strip(),
                    "label": (title or str(info.get("text", "")).strip())[:80],
                }
            )
        except Exception:
            continue
    return summaries


def count_visible_failures(page: Page, selectors_cfg: dict[str, Any]) -> int:
    failure_sels = selector_list(selectors_cfg, "failure_card") or ["text=/Failed|Try again|Something went wrong/i"]
    total = 0
    for sel in failure_sels:
        try:
            matches = page.locator(sel)
            for idx in range(matches.count()):
                if matches.nth(idx).is_visible(timeout=200):
                    total += 1
        except Exception:
            continue
    return total


def click_visible_retry_buttons(page: Page, selectors_cfg: dict[str, Any], max_clicks: int) -> int:
    if max_clicks <= 0:
        return 0
    clicked = 0
    retry_sels = selector_list(selectors_cfg, "retry_button") + ["button:text-is('Retry')", "button:has-text('Retry')"]
    for sel in retry_sels:
        try:
            buttons = page.locator(sel)
            for idx in range(buttons.count()):
                btn = buttons.nth(idx)
                if not btn.is_visible(timeout=200):
                    continue
                btn.scroll_into_view_if_needed()
                btn.click(force=True)
                page.wait_for_timeout(1500)
                clicked += 1
                if clicked >= max_clicks:
                    return clicked
        except Exception:
            continue
    return clicked


def wait_for_new_generations(
    page: Page,
    selectors_cfg: dict[str, Any],
    baseline_ready_cards: int,
    expected_new_cards: int,
    timeout_ms: int,
    max_in_browser_retries: int = 4,
) -> None:
    start = time.time()
    last_heartbeat = start
    last_ready = baseline_ready_cards
    retry_clicks_used = 0

    _print(f"  [{_ts()}] WAITING  5s for UI transition...")
    page.wait_for_timeout(5000)

    while (time.time() - start) * 1000 < timeout_ms:
        now = time.time()
        ready_cards = count_generated_cards(page, selectors_cfg)
        failed_cards = count_visible_failures(page, selectors_cfg)

        if ready_cards > last_ready:
            _print(
                f"  [{_ts()}] READY    generated cards: {ready_cards - baseline_ready_cards}/{expected_new_cards}"
            )
            last_ready = ready_cards

        if ready_cards >= baseline_ready_cards + expected_new_cards:
            _print(f"  [{_ts()}] OK       complete (new generated card(s) detected)")
            _print(f"  [{_ts()}] WAITING  5s for stabilization...")
            page.wait_for_timeout(5000)
            return

        remaining_retries = max_in_browser_retries - retry_clicks_used
        if failed_cards and remaining_retries > 0:
            clicked = click_visible_retry_buttons(page, selectors_cfg, remaining_retries)
            if clicked:
                retry_clicks_used += clicked
                _print(
                    f"  [{_ts()}] RETRY    clicked {clicked} visible retry button(s) "
                    f"({retry_clicks_used}/{max_in_browser_retries})"
                )
                page.wait_for_timeout(2000)
                continue

        if now - last_heartbeat > 15:
            _print(
                f"  [{_ts()}] HEARTBEAT elapsed: {int(now - start)}s, "
                f"ready: {max(0, ready_cards - baseline_ready_cards)}/{expected_new_cards}, "
                f"failures: {failed_cards}"
            )
            last_heartbeat = now

        page.wait_for_timeout(2000)

    raise TimeoutError(
        f"Timed out waiting for {expected_new_cards} new generated card(s); "
        f"ready cards increased from {baseline_ready_cards} to {count_generated_cards(page, selectors_cfg)}"
    )


def wait_until_complete(
    page: Page,
    selectors_cfg: dict[str, Any],
    timeout_ms: int,
    max_in_browser_retries: int = 4,
    card_index: int | None = None,
) -> None:
    start = float(time.time())
    last_pct = -1
    in_browser_retries_used = 0

    _print(f"  [{_ts()}] WAITING  5s for UI transition...")
    page.wait_for_timeout(5000)

    last_heartbeat = time.time()
    last_progress_time = time.time()

    while (time.time() - start) * 1000 < timeout_ms:
        now = time.time()
        if now - last_heartbeat > 15:
            _print(f"  [{_ts()}] HEARTBEAT elapsed: {int(now - start)}s, pct: {last_pct if last_pct != -1 else '??'}%")
            last_heartbeat = now

        if last_pct != -1 and (now - last_progress_time) > 90:
            done, _ = wait_for_any_selector(page, selectors_cfg["download_buttons"], 1000)
            if done:
                _print(f"  [{_ts()}] INFO     Progress stale but Download button found. Assuming done.")
                return

        pct_locators = [".sc-55ebc859-7", "div:has-text('%')", "span:has-text('%')", "p:has-text('%')"]
        clip_card_sels = selector_list(selectors_cfg, "clip_card") or ["div.sc-103881de-0"]
        clip_card_sel = clip_card_sels[0]
        for p_sel in pct_locators:
            try:
                root = page.locator(clip_card_sel).nth(card_index) if card_index is not None else page
                p_el = root.locator(p_sel).first
                if p_el.count() > 0 and p_el.is_visible(timeout=300):
                    p_text = p_el.inner_text().strip()
                    m = re.search(r"(\d+)%", p_text)
                    if m:
                        pct = int(m.group(1))
                        if pct != last_pct:
                            _print(f"  [{_ts()}] PROGRESS {pct}%")
                            last_pct = pct
                            last_progress_time = now
                            start = now
            except Exception: pass

        fail_sels = selector_list(selectors_cfg, "failure_card") or ["div.sc-adc89304-1"]
        for sel in fail_sels:
            try:
                root = page.locator(clip_card_sel).nth(card_index) if card_index is not None else page
                if root.locator(sel).first.is_visible(timeout=300):
                    if in_browser_retries_used < max_in_browser_retries:
                        in_browser_retries_used += 1
                        if _click_retry_button(page, selectors_cfg):
                            last_pct = -1
                            last_progress_time = now
                            continue
                        raise FlowGenerationFailed("Retry failed")
                    raise FlowGenerationFailed("Max retries hit")
            except Exception: pass

        # Check for done state on every iteration
        done_root = page.locator(clip_card_sel).nth(card_index) if card_index is not None else page
        done_sels = selector_list(selectors_cfg, "status_done")
        done, done_sel = wait_for_any_selector(done_root, done_sels, 200)
        if done:
            _print(f"  [{_ts()}] OK       complete (via {done_sel})")
            _print(f"  [{_ts()}] WAITING  5s for stabilization...")
            page.wait_for_timeout(5000)
            return
        
        page.wait_for_timeout(2000)
    raise TimeoutError("Timed out")


def download_clips(page: Page, selectors_cfg: dict[str, Any], target_dir: Path, card_index: int | None = None) -> list[Path]:
    """Find generated clips, open them one by one, and download via full view."""
    target_dir.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []
    
    _print(f"  [{_ts()}] DOWNLOAD scanning for generated clips...")
    
    card_sels = selector_list(selectors_cfg, "clip_card") or ["div.sc-103881de-0"]
    cards_loc = None
    for sel in card_sels:
        if page.locator(sel).count() > 0:
            cards_loc = page.locator(sel)
            break
            
    if not cards_loc:
        _print(f"  [{_ts()}] WARN     No clip cards found")
        return []

    total_found = cards_loc.count()
    indices = [card_index] if card_index is not None and card_index < total_found else list(range(total_found))

    for idx in indices:
        _print(f"\n  [{_ts()}] ACTION   processing card {idx+1}/{total_found}...")
        try:
            card = cards_loc.nth(idx)
            card.scroll_into_view_if_needed()
            page.wait_for_timeout(1000)
            
            _print("             CLICK   opening video view...")
            card.click()
            page.wait_for_timeout(5000)
            
            dl_sels = selector_list(selectors_cfg, "download_buttons") or ["button:has-text('Download')"]
            done, dl_sel = wait_for_any_selector(page, dl_sels, 5000)
            
            if not done:
                # Try clicking more options
                more_sels = selector_list(selectors_cfg, "clip_more_options") + ["button:has(i:has-text('more_vert'))"]
                more_done, more_sel = wait_for_any_selector(page, more_sels, 2000)
                if more_done:
                    page.locator(more_sel).first.click()
                    page.wait_for_timeout(1000)
                    menu_sels = selector_list(selectors_cfg, "download_menu_item") or dl_sels
                    done, dl_sel = wait_for_any_selector(page, menu_sels, 3000)

            if not done:
                _print("             WARN    Download button not found")
                _go_back(page, selectors_cfg)
                continue
                
            _print(f"             CLICK   Download button...")
            dl_btn, _ = first_visible_locator(page, [dl_sel], 1500)
            if not dl_btn:
                _print("             WARN    Download button became unavailable")
                _go_back(page, selectors_cfg)
                continue
            dl_btn.click(force=True)
            page.wait_for_timeout(1500)
            
            res_sels = selector_list(selectors_cfg, "resolution_720p") or ["button:has-text('720p')"]
            res_btn, res_sel = first_visible_locator(page, res_sels, 5000)
            if not res_btn:
                _print("             WARN    720p option not found")
                page.keyboard.press("Escape")
                _go_back(page, selectors_cfg)
                continue
            
            _print(f"             CLICK   720p version...")
            try:
                with page.expect_download(timeout=45000) as download_info:
                    res_btn.click(force=True)
                download = download_info.value
            except TimeoutError:
                _print("             WARN    720p click did not trigger a browser download")
                page.keyboard.press("Escape")
                _go_back(page, selectors_cfg)
                continue
            filename = f"clip_{idx+1:02d}_{int(time.time())}.mp4"
            dest_path = target_dir / filename
            download.save_as(str(dest_path))
            _print(f"             OK      : downloaded as {filename}")
            downloaded.append(dest_path)
            
            page.wait_for_timeout(5000)
            _go_back(page, selectors_cfg)
            
        except Exception as exc:
            _print(f"             ERROR   card {idx+1} failed: {exc}")
            page.keyboard.press("Escape")
            _go_back(page, selectors_cfg)

    return downloaded


def _go_back(page: Page, selectors_cfg: dict[str, Any]):
    back_sels = selector_list(selectors_cfg, "back_button") or ["button:has-text('arrow_back')", "button:has-text('Back')"]
    _print("             ACTION  returning to grid...")
    done, back_sel = wait_for_any_selector(page, back_sels, 3000)
    if done:
        page.locator(back_sel).first.click()
        page.wait_for_timeout(5000)
    else:
        page.keyboard.press("Escape")
        page.keyboard.press("Escape")
        page.wait_for_timeout(3000)


def _is_authenticated(page: Page) -> bool:
    if urlparse(page.url).hostname != "labs.google": return False
    for selector in ["img[alt='User profile image']", "img[alt*='profile' i]"]:
        try:
            if page.locator(selector).first.is_visible(): return True
        except Exception: pass
    return False


def run_open_mode(flow_url: str, auth_path: Path) -> None:
    """Open Google Flow in a visible browser with the saved session and wait until it is closed."""
    downloads_path = Path.home() / "Downloads"
    downloads_path.mkdir(parents=True, exist_ok=True)

    def _on_download(download: Any) -> None:
        dest = downloads_path / download.suggested_filename
        try:
            download.save_as(str(dest))
            print(f"  [Download] Saved: {dest}")
        except Exception as exc:
            print(f"  [Download] Could not save {download.suggested_filename}: {exc}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        ctx_kwargs: dict = {"accept_downloads": True}
        if auth_path.exists():
            ctx_kwargs["storage_state"] = str(auth_path)
        context = browser.new_context(**ctx_kwargs)
        page = context.new_page()
        page.on("download", _on_download)
        page.goto(flow_url, wait_until="domcontentloaded")
        print(f"  [Browser]  Google Flow is open. Downloads will save to: {downloads_path}")
        print(f"  [Browser]  Close the browser window when you are done.")
        page.wait_for_event("close", timeout=0)
        browser.close()


def run_login_mode(flow_url: str, headless: bool, auth_path: Path, timeout_sec: int = 300) -> None:
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.goto(flow_url, wait_until="domcontentloaded")
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            if _is_authenticated(page): break
            page.wait_for_timeout(1000)
        else: raise SystemExit("Login timed out")
        page.wait_for_timeout(15000)
        context.storage_state(path=str(auth_path))
        browser.close()


def run_generate_mode(
    page: Page,
    selectors_path: Path,
    elements_path: Path,
    settings_path: Path,
    downloads_dir: Path,
    prompt: str,
    scene_no: int,
    timeout_sec: int,
    apply_settings_flag: bool = True,
) -> list[Path]:
    selectors_cfg = load_selectors_config(selectors_path, elements_path)
    settings_cfg = load_json(settings_path, default_settings())
    try:
        if apply_settings_flag:
            apply_settings(page, settings_cfg, selectors_path, elements_path)
        fill_prompt(page, prompt)
        submit_generation(page, selectors_cfg)
        wait_until_complete(page, selectors_cfg, timeout_sec * 1000)
        scene_dir = downloads_dir / f"scene_{scene_no:02d}"
        return download_clips(page, selectors_cfg, scene_dir)
    except Exception as exc:
        capture_failure_artifacts(page, "generate")
        raise RuntimeError(f"Flow failed: {exc}")


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    args = parse_args()
    ensure_config_files(
        Path(args.selectors_path),
        Path(args.settings_path),
        Path(args.elements_path),
    )
    headless = (args.headless or os.getenv("FLOW_HEADLESS", "false")).lower() == "true"
    if args.mode == "open":
        run_open_mode(args.flow_url, Path(args.auth_path))
    elif args.mode == "login":
        run_login_mode(args.flow_url, headless, Path(args.auth_path))
    elif args.mode == "generate":
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=headless)
            context = browser.new_context(accept_downloads=True, storage_state=args.auth_path)
            page = context.new_page()
            page.goto(args.flow_url, wait_until="domcontentloaded")
            files = run_generate_mode(
                page,
                Path(args.selectors_path),
                Path(args.elements_path),
                Path(args.settings_path),
                Path(args.downloads_dir),
                args.prompt,
                args.scene_no,
                args.timeout_sec,
            )
            browser.close()
            for p in files: print(f"- {p}")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["login", "generate", "open"], required=True)
    parser.add_argument("--flow-url", default=DEFAULT_FLOW_URL)
    parser.add_argument("--auth-path", default=str(DEFAULT_AUTH_PATH))
    parser.add_argument("--selectors-path", default=str(DEFAULT_SELECTORS_PATH))
    parser.add_argument("--elements-path", default=str(DEFAULT_ELEMENTS_PATH))
    parser.add_argument("--settings-path", default=str(DEFAULT_SETTINGS_PATH))
    parser.add_argument("--downloads-dir", default=str(DEFAULT_DOWNLOADS_DIR))
    parser.add_argument("--scene-no", type=int, default=1)
    parser.add_argument("--prompt", default="")
    parser.add_argument("--timeout-sec", type=int, default=300)
    parser.add_argument("--headless", choices=["true", "false"], default=None)
    return parser.parse_args()


if __name__ == "__main__":
    main()

