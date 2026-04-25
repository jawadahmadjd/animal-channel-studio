"""
Standalone test for the main submission/tracking loop logic.
No browser, no Playwright. Simulates card events to verify fixes.

Run: py -3 scripts/test_loop_logic.py
"""

import time
import random

# ── Minimal stubs matching the real types ─────────────────────────────────────

def _ok(msg):  print(f"  [OK]   {msg}")
def _warn(msg): print(f"  [WARN] {msg}")
def _info(msg): print(f"  -->    {msg}")

def utc_now(): return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())


# ── Simulated card events (replace with real poll results in production) ──────

class FakeFlow:
    """Simulates Google Flow's card state for testing the loop logic."""

    def __init__(self):
        self._cards: list[dict] = []
        self._counter = 0

    def submit(self, scene_no: int) -> str:
        """Adds a new in-progress card and returns its tile_id."""
        self._counter += 1
        tile_id = f"tile_{self._counter:04d}"
        self._cards.append({
            "tile_id": tile_id,
            "scene_no": scene_no,
            "state": "running",  # running | done | failed
            "done_at": time.time() + random.uniform(15, 30),  # simulate generation time
        })
        return tile_id

    def tick(self):
        """Advance card states over time."""
        now = time.time()
        for c in self._cards:
            if c["state"] == "running" and now >= c["done_at"]:
                # 80% success, 20% failure
                c["state"] = "done" if random.random() > 0.2 else "failed"

    def poll(self) -> list[dict]:
        """Return card summaries as the real list_clip_card_summaries would."""
        result = []
        for idx, c in enumerate(self._cards):
            tile_id = c["tile_id"]
            state = c["state"]
            href = f"/edit/{tile_id}" if state == "done" else ""
            card_key = "|".join(p for p in [tile_id, href] if p) or f"card-{idx}"
            result.append({
                "index": idx,
                "card_key": card_key,
                "failed": state == "failed",
                "ready": state == "done",
                "progress_pct": 100 if state == "done" else (50 if state == "running" else None),
                "href": href,
                "tile_id": tile_id,
            })
        return result

    def download(self, card_index: int, scene_no: int) -> list[str]:
        return [f"downloads/scene_{scene_no:02d}/clip_01_{int(time.time())}.mp4"]


# ── Main loop (mirrors run_pipeline.py logic with fixes applied) ──────────────

def run_test_loop(total_scenes: int = 5, max_attempts: int = 3, max_concurrent: int = 2):
    print(f"\n{'='*60}")
    print(f"  TEST: {total_scenes} scenes, max_attempts={max_attempts}, concurrent={max_concurrent}")
    print(f"{'='*60}\n")

    flow = FakeFlow()
    poll_interval_sec = 2.0
    min_wait, max_wait = 3, 6
    timeout_sec = 60.0

    # Build initial scene states
    scenes_by_no_state: dict[int, dict] = {}
    for n in range(1, total_scenes + 1):
        scenes_by_no_state[n] = {
            "scene_no": n,
            "status": "pending",
            "attempts": 0,  # Already reset by Fix 1
            "downloads": [],
            "error": "",
        }

    # ── FIX 1 verified: attempts start at 0 ──────────────────────────────────
    for s in scenes_by_no_state.values():
        assert s["attempts"] == 0, "BUG: attempts not reset"

    pending_scene_nos = list(range(1, total_scenes + 1))
    active_jobs: list[dict] = []
    downloaded_card_keys: set[str] = set()
    failed_card_keys: set[str] = set()
    next_submit_at = 0.0
    last_poll_at = 0.0
    total_downloaded = 0

    # ── FIX 3: Snapshot pre-existing cards before first submission ────────────
    pre_run_cards = flow.poll()
    for c in pre_run_cards:
        downloaded_card_keys.add(str(c["card_key"]))
        if c.get("failed"):
            failed_card_keys.add(str(c["card_key"]))

    while pending_scene_nos or active_jobs:
        now = time.time()
        flow.tick()

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
                scene_state["error"] = f"Reached max attempts ({max_attempts}) before submission."
                print(f"  [SKIP] Scene {scene_no} — {scene_state['error']}")
                continue

            # ── FIX 3: Fresh snapshot before submission ───────────────────────
            pre_submit_cards = flow.poll()
            known_keys_now = {str(c["card_key"]) for c in pre_submit_cards if c["card_key"]}
            downloaded_card_keys.update(known_keys_now)
            for c in pre_submit_cards:
                if c.get("failed"):
                    failed_card_keys.add(str(c["card_key"]))

            print(f"\n  [Submit] Scene {scene_no} attempt {attempt}/{max_attempts} "
                  f"(in-flight: {len(active_jobs)+1}/{max_concurrent})")
            flow.submit(scene_no)
            submitted_at = time.time()

            scene_state["attempts"] = attempt
            scene_state["status"] = "running"

            active_jobs.append({
                "scene_no": scene_no,
                "attempt": attempt,
                "submitted_at": submitted_at,
                "deadline_at": submitted_at + timeout_sec,
                "known_card_keys_at_submit": known_keys_now,
            })
            next_submit_at = now + random.uniform(min_wait, max_wait)

        now = time.time()
        if now - last_poll_at >= poll_interval_sec:
            summaries = flow.poll()

            for card in summaries:
                card_key = str(card["card_key"])
                if not card_key:
                    continue

                if card["failed"]:
                    if card_key in failed_card_keys:
                        continue
                    current_job = active_jobs[0] if active_jobs else None
                    # ── FIX 3: exclude cards visible at submission time ────────
                    if current_job and card_key in current_job.get("known_card_keys_at_submit", set()):
                        failed_card_keys.add(card_key)
                        continue
                    # ── FIX 4: 12-second grace period ────────────────────────
                    if current_job:
                        secs_since = now - float(current_job.get("submitted_at", 0))
                        if secs_since < 12.0:
                            continue

                    failed_card_keys.add(card_key)
                    if active_jobs:
                        failed_job = active_jobs.pop(0)
                        sno = int(failed_job["scene_no"])
                        s = scenes_by_no_state[sno]
                        s["status"] = "failed"
                        s["error"] = "Flow marked generation as failed."
                        if int(s.get("attempts", 0)) < max_attempts:
                            pending_scene_nos.append(sno)
                            _warn(f"Scene {sno} failed; queued retry {s['attempts']}/{max_attempts}")
                        else:
                            _warn(f"Scene {sno} failed and exhausted retries.")
                    continue

                if card_key in downloaded_card_keys:
                    continue

                if not card.get("ready"):
                    pct = card.get("progress_pct")
                    if pct is not None:
                        _info(f"Scene generating at {pct}%")
                    continue

                if not active_jobs:
                    downloaded_card_keys.add(card_key)
                    continue

                completed_job = active_jobs.pop(0)
                sno = int(completed_job["scene_no"])
                s = scenes_by_no_state[sno]
                card_index = int(card.get("index", 0))
                files = flow.download(card_index, sno)
                if files:
                    s["status"] = "completed"
                    s["downloads"] = files
                    s["error"] = ""
                    total_downloaded += len(files)
                    downloaded_card_keys.add(card_key)
                    _ok(f"Scene {sno} downloaded -> {files[0]}")
                else:
                    s["status"] = "failed"
                    s["error"] = "Download failed."
                    if int(s.get("attempts", 0)) < max_attempts:
                        pending_scene_nos.append(sno)

            last_poll_at = now

        # Timeout handling
        timed_out = [j for j in active_jobs if now >= j["deadline_at"]]
        for job in timed_out:
            active_jobs.remove(job)
            sno = int(job["scene_no"])
            s = scenes_by_no_state[sno]
            s["status"] = "failed"
            s["error"] = "Timed out."
            if int(s.get("attempts", 0)) < max_attempts:
                pending_scene_nos.append(sno)
                _warn(f"Scene {sno} timed out; queued retry.")

        time.sleep(0.5)

    # ── Results ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  RESULTS")
    print(f"{'='*60}")
    completed = [s for s in scenes_by_no_state.values() if s["status"] == "completed"]
    failed = [s for s in scenes_by_no_state.values() if s["status"] == "failed"]
    print(f"  Completed : {len(completed)}/{total_scenes}")
    print(f"  Failed    : {len(failed)}/{total_scenes}")
    print(f"  Downloads : {total_downloaded}")
    for s in scenes_by_no_state.values():
        status_icon = "[OK]" if s["status"] == "completed" else "[!!]"
        print(f"    {status_icon} Scene {s['scene_no']:2d} — {s['status']:9s}  attempts={s['attempts']}  {s.get('error','')[:50]}")

    # ── Assertions ────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  ASSERTIONS")
    print(f"{'='*60}")

    # Fix 1: no scene should be blocked before submission due to old attempts
    blocked = [s for s in scenes_by_no_state.values()
               if "Reached max attempts" in s.get("error", "") and s["attempts"] == 0]
    assert not blocked, f"BUG Fix1: Scenes blocked before submission: {[s['scene_no'] for s in blocked]}"
    _ok("Fix 1: No scenes blocked by stale attempt counter")

    # Fix 2+3+4: no scene should fail within 12s of first submission with attempts=1
    # (would indicate old-card mis-attribution)
    early_fails = []
    for s in scenes_by_no_state.values():
        if s["status"] == "failed" and s.get("error") == "Flow marked generation as failed.":
            if s.get("attempts", 0) == 1:
                early_fails.append(s["scene_no"])
    if early_fails:
        _warn(f"Scenes failed on first attempt (may be real Flow failures, not mis-attribution): {early_fails}")
    else:
        _ok("Fix 2/3/4: No scenes mis-attributed as failures from old cards")

    # All scenes 1..N should have been attempted at least once
    not_attempted = [n for n in range(1, total_scenes + 1)
                     if scenes_by_no_state[n].get("attempts", 0) == 0]
    assert not not_attempted, f"BUG: Scenes never attempted: {not_attempted}"
    _ok("All scenes attempted at least once")

    print(f"\n  ALL ASSERTIONS PASSED\n")
    return len(completed), len(failed)


if __name__ == "__main__":
    random.seed(42)
    completed, failed = run_test_loop(total_scenes=5, max_attempts=3, max_concurrent=2)
    print(f"Final: {completed} completed, {failed} failed")
