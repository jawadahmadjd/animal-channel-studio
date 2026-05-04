from __future__ import annotations

import json
from typing import Any


FLOW_INTERVAL_FIELDS: list[dict[str, Any]] = [
    {"key": "selector_wait_step_ms", "label": "Selector Wait Step", "description": "Polling step while waiting for selectors.", "default_ms": 700, "min_ms": 50, "max_ms": 10000},
    {"key": "first_visible_step_ms", "label": "First Visible Step", "description": "Polling step while searching first visible element.", "default_ms": 500, "min_ms": 50, "max_ms": 10000},
    {"key": "selector_visible_check_timeout_ms", "label": "Selector Visible Check Timeout", "description": "Visibility check timeout while scanning selectors.", "default_ms": 300, "min_ms": 50, "max_ms": 10000},
    {"key": "first_visible_check_timeout_ms", "label": "First Visible Check Timeout", "description": "Visibility check timeout while scanning first visible elements.", "default_ms": 200, "min_ms": 50, "max_ms": 10000},
    {"key": "prompt_textarea_visible_timeout_ms", "label": "Prompt Textarea Visible Timeout", "description": "Visible timeout for textarea selector in prompt input.", "default_ms": 600, "min_ms": 50, "max_ms": 10000},
    {"key": "prompt_input_visible_timeout_ms", "label": "Prompt Input Visible Timeout", "description": "Visible timeout for non-textarea prompt selectors.", "default_ms": 1500, "min_ms": 50, "max_ms": 10000},
    {"key": "click_post_delay_ms", "label": "Click Post Delay", "description": "Short settle delay after generic forced clicks.", "default_ms": 300, "min_ms": 0, "max_ms": 10000},
    {"key": "fill_prompt_pre_wait_ms", "label": "Prompt Pre Wait", "description": "Wait before filling the scene prompt editor.", "default_ms": 3000, "min_ms": 0, "max_ms": 60000},
    {"key": "fill_prompt_escape_wait_ms", "label": "Prompt Escape Wait", "description": "Wait after Escape key before prompt interactions.", "default_ms": 500, "min_ms": 0, "max_ms": 10000},
    {"key": "fill_prompt_focus_wait_ms", "label": "Prompt Focus Wait", "description": "Wait after focusing prompt input.", "default_ms": 500, "min_ms": 0, "max_ms": 10000},
    {"key": "fill_prompt_clear_wait_ms", "label": "Prompt Clear Wait", "description": "Wait after clearing existing prompt text.", "default_ms": 800, "min_ms": 0, "max_ms": 10000},
    {"key": "fill_prompt_after_fill_wait_ms", "label": "Prompt After Fill Wait", "description": "Wait after filling prompt text for editor sync.", "default_ms": 1000, "min_ms": 0, "max_ms": 10000},
    {"key": "settings_open_dropdown_wait_ms", "label": "Settings Dropdown Wait", "description": "Wait after opening settings dropdown.", "default_ms": 800, "min_ms": 0, "max_ms": 10000},
    {"key": "settings_model_dropdown_settle_wait_ms", "label": "Model Dropdown Settle Wait", "description": "Wait after opening model menu before scanning options.", "default_ms": 400, "min_ms": 0, "max_ms": 10000},
    {"key": "settings_model_option_click_wait_ms", "label": "Model Option Click Wait", "description": "Wait after clicking a model option.", "default_ms": 500, "min_ms": 0, "max_ms": 10000},
    {"key": "model_option_visible_timeout_ms", "label": "Model Option Visible Timeout", "description": "Visibility timeout while scanning model options.", "default_ms": 200, "min_ms": 50, "max_ms": 10000},
    {"key": "model_fallback_click_timeout_ms", "label": "Model Fallback Click Timeout", "description": "Click timeout for model text fallback action.", "default_ms": 2000, "min_ms": 100, "max_ms": 30000},
    {"key": "model_option_scan_visible_timeout_ms", "label": "Model Option Scan Visible Timeout", "description": "Visibility timeout when listing available model options for debugging.", "default_ms": 150, "min_ms": 50, "max_ms": 10000},
    {"key": "settings_panel_toggle_wait_ms", "label": "Settings Panel Toggle Wait", "description": "Wait after toggling settings panel state.", "default_ms": 1200, "min_ms": 0, "max_ms": 10000},
    {"key": "apply_settings_editor_ready_wait_ms", "label": "Editor Ready Wait", "description": "Wait after editor panel appears before applying settings.", "default_ms": 1000, "min_ms": 0, "max_ms": 10000},
    {"key": "apply_settings_mode_wait_ms", "label": "Mode Apply Wait", "description": "Wait after setting mode tab.", "default_ms": 1500, "min_ms": 0, "max_ms": 10000},
    {"key": "apply_settings_subtype_wait_ms", "label": "Subtype Apply Wait", "description": "Wait after setting subtype tab.", "default_ms": 1500, "min_ms": 0, "max_ms": 10000},
    {"key": "apply_settings_aspect_wait_ms", "label": "Aspect Apply Wait", "description": "Wait after setting aspect ratio.", "default_ms": 3000, "min_ms": 0, "max_ms": 30000},
    {"key": "apply_settings_clip_count_wait_ms", "label": "Clip Count Apply Wait", "description": "Wait after setting clip count.", "default_ms": 3000, "min_ms": 0, "max_ms": 30000},
    {"key": "settings_panel_button_visible_timeout_ms", "label": "Settings Panel Button Timeout", "description": "Visibility timeout while checking settings panel buttons.", "default_ms": 1000, "min_ms": 50, "max_ms": 10000},
    {"key": "apply_settings_collapse_wait_ms", "label": "Settings Collapse Wait", "description": "Wait after collapsing settings panel.", "default_ms": 1000, "min_ms": 0, "max_ms": 10000},
    {"key": "new_project_initial_wait_ms", "label": "New Project Initial Wait", "description": "Wait before clicking New project button.", "default_ms": 3000, "min_ms": 0, "max_ms": 30000},
    {"key": "new_project_post_click_wait_ms", "label": "New Project Post Click Wait", "description": "Wait after opening a new project.", "default_ms": 2000, "min_ms": 0, "max_ms": 30000},
    {"key": "rename_more_menu_wait_ms", "label": "Rename Menu Wait", "description": "Wait after opening project more menu before selecting rename.", "default_ms": 1000, "min_ms": 0, "max_ms": 10000},
    {"key": "rename_item_click_wait_ms", "label": "Rename Item Click Wait", "description": "Wait after clicking Rename menu item.", "default_ms": 2000, "min_ms": 0, "max_ms": 10000},
    {"key": "rename_fallback_edit_wait_ms", "label": "Rename Fallback Wait", "description": "Wait after fallback edit-button rename click.", "default_ms": 2000, "min_ms": 0, "max_ms": 10000},
    {"key": "rename_confirm_wait_ms", "label": "Rename Confirm Wait", "description": "Wait after submitting new project name.", "default_ms": 2000, "min_ms": 0, "max_ms": 10000},
    {"key": "open_project_verify_poll_wait_ms", "label": "Open Project Verify Poll", "description": "Poll delay while verifying project entry.", "default_ms": 400, "min_ms": 50, "max_ms": 10000},
    {"key": "open_project_verify_timeout_ms", "label": "Open Project Verify Timeout", "description": "Max time to verify that project page was entered.", "default_ms": 12000, "min_ms": 500, "max_ms": 120000},
    {"key": "open_project_after_goto_wait_ms", "label": "Open Project After Goto", "description": "Wait after navigating to project or Flow home.", "default_ms": 3000, "min_ms": 0, "max_ms": 30000},
    {"key": "open_project_after_click_wait_ms", "label": "Open Project After Click", "description": "Wait after clicking project link/card.", "default_ms": 1000, "min_ms": 0, "max_ms": 10000},
    {"key": "open_project_after_enter_wait_ms", "label": "Open Project Enter Settle", "description": "Settle wait after entering an existing project.", "default_ms": 2000, "min_ms": 0, "max_ms": 10000},
    {"key": "open_project_link_visible_timeout_ms", "label": "Open Project Link Visible Timeout", "description": "Visibility timeout for project links in listing.", "default_ms": 300, "min_ms": 50, "max_ms": 10000},
    {"key": "submit_ready_poll_wait_ms", "label": "Submit Ready Poll", "description": "Polling delay while waiting for submit readiness.", "default_ms": 500, "min_ms": 50, "max_ms": 10000},
    {"key": "submit_pre_click_wait_ms", "label": "Submit Pre Click Wait", "description": "Wait before clicking Create/Submit.", "default_ms": 3000, "min_ms": 0, "max_ms": 30000},
    {"key": "retry_button_post_click_wait_ms", "label": "Retry Button Post Click", "description": "Wait after clicking retry buttons.", "default_ms": 1500, "min_ms": 0, "max_ms": 10000},
    {"key": "retry_scan_visible_timeout_ms", "label": "Retry Scan Visible Timeout", "description": "Visibility timeout while scanning retry buttons.", "default_ms": 200, "min_ms": 50, "max_ms": 10000},
    {"key": "wait_until_complete_initial_transition_wait_ms", "label": "Generation Initial Transition", "description": "Initial wait after submit for generation card transition.", "default_ms": 5000, "min_ms": 0, "max_ms": 60000},
    {"key": "wait_until_complete_done_stabilize_wait_ms", "label": "Generation Done Stabilize", "description": "Stabilization wait when generation appears done.", "default_ms": 5000, "min_ms": 0, "max_ms": 60000},
    {"key": "wait_until_complete_retry_pause_wait_ms", "label": "Generation Retry Pause", "description": "Pause after in-browser retry click.", "default_ms": 2000, "min_ms": 0, "max_ms": 30000},
    {"key": "wait_until_complete_loop_wait_ms", "label": "Generation Poll Loop", "description": "Loop sleep while waiting for generation completion.", "default_ms": 2000, "min_ms": 100, "max_ms": 30000},
    {"key": "wait_until_complete_fallback_initial_transition_wait_ms", "label": "Fallback Initial Transition", "description": "Initial wait for fallback completion loop.", "default_ms": 5000, "min_ms": 0, "max_ms": 60000},
    {"key": "wait_until_complete_fallback_done_stabilize_wait_ms", "label": "Fallback Done Stabilize", "description": "Stabilization wait when fallback flow reports done.", "default_ms": 5000, "min_ms": 0, "max_ms": 60000},
    {"key": "wait_until_complete_fallback_loop_wait_ms", "label": "Fallback Poll Loop", "description": "Loop sleep for fallback completion logic.", "default_ms": 2000, "min_ms": 100, "max_ms": 30000},
    {"key": "progress_visible_timeout_ms", "label": "Progress Visible Timeout", "description": "Visibility timeout when reading progress bars.", "default_ms": 300, "min_ms": 50, "max_ms": 10000},
    {"key": "failure_visible_timeout_ms", "label": "Failure Visible Timeout", "description": "Visibility timeout when checking failure cards.", "default_ms": 300, "min_ms": 50, "max_ms": 10000},
    {"key": "download_card_open_wait_ms", "label": "Download Card Open Wait", "description": "Wait after scrolling card before opening it.", "default_ms": 1000, "min_ms": 0, "max_ms": 10000},
    {"key": "download_card_view_open_wait_ms", "label": "Download View Open Wait", "description": "Wait after opening a clip view before looking for download actions.", "default_ms": 5000, "min_ms": 0, "max_ms": 60000},
    {"key": "download_menu_open_wait_ms", "label": "Download Menu Open Wait", "description": "Wait after opening download/overflow menu.", "default_ms": 1000, "min_ms": 0, "max_ms": 10000},
    {"key": "download_after_download_click_wait_ms", "label": "Download Click Settle Wait", "description": "Wait after clicking primary download button.", "default_ms": 1500, "min_ms": 0, "max_ms": 10000},
    {"key": "download_after_save_wait_ms", "label": "Download After Save Wait", "description": "Wait after saving clip before returning to grid.", "default_ms": 5000, "min_ms": 0, "max_ms": 60000},
    {"key": "project_zip_menu_open_wait_ms", "label": "Project Zip Menu Wait", "description": "Wait after opening project toolbar menu.", "default_ms": 2000, "min_ms": 0, "max_ms": 20000},
    {"key": "edit_page_list_settle_wait_ms", "label": "Edit Page List Settle", "description": "Wait after opening project page to collect edit links.", "default_ms": 5000, "min_ms": 0, "max_ms": 60000},
    {"key": "edit_page_open_settle_wait_ms", "label": "Edit Page Open Settle", "description": "Wait after opening each clip edit page.", "default_ms": 3000, "min_ms": 0, "max_ms": 60000},
    {"key": "edit_page_download_menu_wait_ms", "label": "Edit Page Download Menu Wait", "description": "Wait after opening edit-page download dropdown.", "default_ms": 1500, "min_ms": 0, "max_ms": 10000},
    {"key": "download_expect_clip_ms", "label": "Download Clip Expect Timeout", "description": "Browser download wait timeout for clip downloads.", "default_ms": 45000, "min_ms": 1000, "max_ms": 600000},
    {"key": "download_expect_project_zip_ms", "label": "Project Zip Expect Timeout", "description": "Browser download wait timeout for project zip.", "default_ms": 180000, "min_ms": 1000, "max_ms": 900000},
    {"key": "download_expect_edit_clip_ms", "label": "Edit Page Download Expect Timeout", "description": "Browser download wait timeout for edit-page clip download.", "default_ms": 120000, "min_ms": 1000, "max_ms": 900000},
    {"key": "download_goto_timeout_ms", "label": "Download Goto Timeout", "description": "Navigation timeout for project/edit pages during download.", "default_ms": 60000, "min_ms": 1000, "max_ms": 300000},
    {"key": "clip_card_visible_timeout_ms", "label": "Clip Card Visible Timeout", "description": "Visibility timeout while scanning clip cards.", "default_ms": 200, "min_ms": 50, "max_ms": 10000},
    {"key": "clip_title_visible_timeout_ms", "label": "Clip Title Visible Timeout", "description": "Visibility timeout while reading clip card titles.", "default_ms": 100, "min_ms": 50, "max_ms": 10000},
    {"key": "clip_progress_visible_timeout_ms", "label": "Clip Progress Visible Timeout", "description": "Visibility timeout while reading clip card progress labels.", "default_ms": 100, "min_ms": 50, "max_ms": 10000},
    {"key": "go_back_after_click_wait_ms", "label": "Go Back Click Wait", "description": "Wait after clicking Go Back button.", "default_ms": 5000, "min_ms": 0, "max_ms": 30000},
    {"key": "go_back_after_escape_wait_ms", "label": "Go Back Escape Wait", "description": "Wait after escape fallback when Go Back button is not found.", "default_ms": 3000, "min_ms": 0, "max_ms": 30000},
    {"key": "login_poll_wait_ms", "label": "Login Poll Wait", "description": "Polling delay while waiting for Google login detection.", "default_ms": 1000, "min_ms": 100, "max_ms": 10000},
    {"key": "login_after_auth_wait_ms", "label": "Login Post Auth Wait", "description": "Wait after sign-in before saving storage state.", "default_ms": 2000, "min_ms": 0, "max_ms": 10000},
    {"key": "pipeline_browser_stabilize_wait_ms", "label": "Pipeline Browser Stabilize", "description": "Wait after initial Flow page open in pipeline.", "default_ms": 10000, "min_ms": 0, "max_ms": 60000},
    {"key": "pipeline_post_new_project_wait_ms", "label": "Pipeline Post New Project", "description": "Wait after New project before rename in pipeline runner.", "default_ms": 3000, "min_ms": 0, "max_ms": 30000},
    {"key": "pipeline_generation_poll_interval_ms", "label": "Pipeline Generation Poll Interval", "description": "Polling cadence for scanning generated thumbnail progress.", "default_ms": 5000, "min_ms": 100, "max_ms": 60000},
    {"key": "pipeline_after_first_ready_wait_ms", "label": "Pipeline First Ready Wait", "description": "Wait after first ready clip to let full batch finish.", "default_ms": 8000, "min_ms": 0, "max_ms": 60000},
    {"key": "pipeline_loop_sleep_ms", "label": "Pipeline Loop Sleep", "description": "Main pipeline loop sleep between checks.", "default_ms": 500, "min_ms": 50, "max_ms": 10000},
    {"key": "pipeline_pre_download_stabilize_wait_ms", "label": "Pipeline Pre Download Stabilize", "description": "Final settle wait before download stage.", "default_ms": 30000, "min_ms": 0, "max_ms": 120000},
]


FLOW_INTERVAL_DEFAULTS_MS: dict[str, int] = {
    field["key"]: int(field["default_ms"]) for field in FLOW_INTERVAL_FIELDS
}

FLOW_INTERVAL_BOUNDS_MS: dict[str, tuple[int, int]] = {
    field["key"]: (int(field["min_ms"]), int(field["max_ms"])) for field in FLOW_INTERVAL_FIELDS
}


def default_flow_intervals() -> dict[str, int]:
    return dict(FLOW_INTERVAL_DEFAULTS_MS)


def flow_interval_fields() -> list[dict[str, Any]]:
    return [dict(field) for field in FLOW_INTERVAL_FIELDS]


def normalize_flow_intervals(raw: dict[str, Any] | None) -> dict[str, int]:
    normalized: dict[str, int] = default_flow_intervals()
    if not isinstance(raw, dict):
        return normalized
    for key, value in raw.items():
        if key not in normalized:
            continue
        try:
            parsed = int(float(value))
        except Exception:
            continue
        lo, hi = FLOW_INTERVAL_BOUNDS_MS[key]
        normalized[key] = max(lo, min(hi, parsed))
    return normalized


def merge_flow_intervals(
    base: dict[str, Any] | None,
    override: dict[str, Any] | None,
) -> dict[str, int]:
    return normalize_flow_intervals({**(base or {}), **(override or {})})


def parse_flow_intervals_json(raw: str | None) -> dict[str, int]:
    if not raw:
        return default_flow_intervals()
    try:
        payload = json.loads(raw)
    except Exception:
        return default_flow_intervals()
    return normalize_flow_intervals(payload if isinstance(payload, dict) else {})


def interval_ms(intervals: dict[str, int], key: str) -> int:
    return int(intervals.get(key, FLOW_INTERVAL_DEFAULTS_MS.get(key, 0)))
