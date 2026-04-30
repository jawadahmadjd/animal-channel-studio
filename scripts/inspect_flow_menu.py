"""
Test: click the correct toolbar kebab (next to help button) and verify
'Download Project' appears in the menu.
"""
import sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

PROJECT_URL = "https://labs.google/fx/tools/flow/project/652057de-3da7-40da-a7b0-2c8ee034355a"
OUT_DIR = Path(__file__).parent.parent / "logs"
auth_path = Path(__file__).parent.parent / "state" / "flow_auth.json"

from playwright.sync_api import sync_playwright
from flow_automation import download_project_zip, load_selectors_config

def ts():
    return time.strftime("%H:%M:%S")

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=False, args=["--start-maximized"])
    ctx: dict = {"accept_downloads": True, "viewport": {"width": 1600, "height": 900}}
    if auth_path.exists():
        ctx["storage_state"] = str(auth_path)
    context = browser.new_context(**ctx)
    page = context.new_page()

    print(f"[{ts()}] Loading project page...")
    page.goto(PROJECT_URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(5000)

    # Count all more_vert buttons
    more_verts = page.locator("button:has(i:has-text('more_vert'))").all()
    print(f"[{ts()}] Total more_vert buttons: {len(more_verts)}")
    for i, btn in enumerate(more_verts):
        label = btn.inner_text().strip()
        aria = btn.get_attribute("aria-label") or ""
        cls = btn.get_attribute("class") or ""
        print(f"  [{i}] text={label!r}  aria-label={aria!r}  class={cls[:80]}")

    # Try the toolbar kebab (last more_vert)
    print(f"\n[{ts()}] Clicking LAST more_vert (toolbar kebab)...")
    page.locator("button:has(i:has-text('more_vert'))").last.click()
    page.wait_for_timeout(2000)
    page.screenshot(path=str(OUT_DIR / "toolbar_kebab_menu.png"))

    items = page.locator("[role='menuitem']").all()
    print(f"[{ts()}] Menu items ({len(items)}):")
    for i, item in enumerate(items):
        print(f"  [{i}] {item.inner_text().strip()!r}")

    page.keyboard.press("Escape")
    page.wait_for_timeout(1000)

    # Now test download_project_zip directly
    print(f"\n[{ts()}] Testing download_project_zip()...")
    selectors_cfg = load_selectors_config(
        Path(__file__).parent.parent / "state" / "flow_selectors.json",
        Path(__file__).parent.parent / "state" / "flow_elements.json",
    )
    zip_path = download_project_zip(page, selectors_cfg, OUT_DIR / "zip_test")
    if zip_path:
        print(f"[{ts()}] ZIP saved: {zip_path}  ({zip_path.stat().st_size:,} bytes)")
    else:
        print(f"[{ts()}] ZIP download returned None")

    page.wait_for_timeout(10000)
    context.close()
    browser.close()
    print(f"[{ts()}] Done.")
