from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

from read_ideas import Idea, parse_ideas

# Ensure every subprocess we spawn uses UTF-8 for its stdout/stderr.
_SUBPROCESS_ENV = {**os.environ, "PYTHONUTF8": "1"}

ROOT_DIR        = Path(__file__).resolve().parents[1]
IDEAS_FILE      = ROOT_DIR / "Ideas.md"
AUTH_FILE       = ROOT_DIR / "state" / "flow_auth.json"
SETTINGS_FILE   = ROOT_DIR / "state" / "flow_settings.json"
PYTHON_EXE      = "python"

# ── Colour palette (Stitch Verdant Glass) ──────────────────────────────────
BG      = "#f8faf8"  # Alpine Air (Off-white with green tint)
CARD    = "#ffffff"
BORDER  = "#c2c8c3"
DARK    = "#172c24"  # Deep Forest Green
PRIMARY = "#2d4239"  # Botanical Green
SUCCESS = "#16a34a"
DANGER  = "#dc2626"
WARN    = "#b45309"
PURPLE  = "#7c3aed"
SLATE   = "#424845"
TEXT    = "#191c1b"
MUTED   = "#727874"
ACCENT  = "#4d6359"
GLASS_BG = "#f2f4f2"
STEP_BG = "#e0e7ff"
STEP_FG = "#3730a3"
LOG_BG  = "#0f172a"
LOG_FG  = "#e2e8f0"
LOG_ERR = "#f87171"
LOG_OK  = "#4ade80"
LOG_INF = "#93c5fd"
LOG_WRN = "#fbbf24"
LOG_HDR = "#cbd5e1"

def _load_ideas() -> list[Idea]:
    if not IDEAS_FILE.exists():
        return []
    text = IDEAS_FILE.read_text(encoding="utf-8")
    return parse_ideas(text)


def _font_exists(name: str) -> bool:
    try:
        import tkinter.font as tf
        return name in tf.families()
    except Exception:
        return False


# Fonts
MAIN_FONT = "Inter" if _font_exists("Inter") else "Segoe UI"
MONO_FONT = "Cascadia Code" if _font_exists("Cascadia Code") else "Consolas"


# ── Reusable widget helpers ────────────────────────────────────────────────────

class FlatButton(tk.Button):
    """Modern flat button with hover darkening."""
    def __init__(self, parent, text, command, color=PRIMARY, fg="#ffffff",
                 font_size=10, pad_x=16, pad_y=8, **kw):
        super().__init__(
            parent, text=text, command=command,
            bg=color, fg=fg, activebackground=color, activeforeground=fg,
            relief="flat", cursor="hand2", bd=0,
            font=(MAIN_FONT, font_size, "bold"),
            padx=pad_x, pady=pad_y, **kw,
        )
        self._base = color
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)

    def _on_enter(self, _=None):
        try:
            r, g, b = (x // 256 for x in self.winfo_rgb(self._base))
            dark = f"#{max(0,r-22):02x}{max(0,g-22):02x}{max(0,b-22):02x}"
            self.config(bg=dark)
        except Exception:
            pass

    def _on_leave(self, _=None):
        self.config(bg=self._base)


def _sep(parent, pady=8):
    tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=pady)


def _card(parent, title: str = "") -> tk.Frame:
    """Modern rounded card."""
    outer = tk.Frame(parent, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
    outer.pack(fill="x", padx=16, pady=8)
    if title:
        hdr = tk.Frame(outer, bg=CARD)
        hdr.pack(fill="x", padx=14, pady=(12, 0))
        tk.Label(hdr, text=title, bg=CARD, fg=MUTED,
                 font=(MAIN_FONT, 8, "bold")).pack(side="left")
    inner = tk.Frame(outer, bg=CARD)
    inner.pack(fill="x", padx=14, pady=(6, 14))
    return inner


class SegmentedControl(tk.Frame):
    def __init__(self, parent, options, var, **kw):
        super().__init__(parent, bg=GLASS_BG, **kw)
        self.var = var
        self.buttons = []
        for opt in options:
            btn = tk.Button(self, text=opt, relief="flat", bg=GLASS_BG, fg=TEXT,
                            font=(MAIN_FONT, 9), cursor="hand2", padx=20, pady=6,
                            command=lambda o=opt: self._select(o))
            btn.pack(side="left", expand=True, fill="both")
            self.buttons.append(btn)
        self._select(var.get())

    def _select(self, option):
        self.var.set(option)
        for btn in self.buttons:
            if btn.cget("text") == option:
                btn.config(bg=CARD, fg=PRIMARY)
            else:
                btn.config(bg=GLASS_BG, fg=MUTED)


class Tooltip:
    """Simple tooltip helper for Tkinter widgets."""
    def __init__(self, widget, text):
        self.widget = widget
        self.text = text
        self.tip_window = None
        self.widget.bind("<Enter>", self.show_tip)
        self.widget.bind("<Leave>", self.hide_tip)

    def show_tip(self, event=None):
        if self.tip_window or not self.text:
            return
        x, y, _cx, cy = self.widget.bbox("insert")
        x = x + self.widget.winfo_rootx() + 25
        y = y + cy + self.widget.winfo_rooty() + 25
        self.tip_window = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(1)
        tw.wm_geometry(f"+{x}+{y}")
        label = tk.Label(tw, text=self.text, justify="left",
                         background="#1e293b", foreground="#ffffff",
                         relief="flat", borderwidth=1,
                         font=(MAIN_FONT, 8), padx=8, pady=4)
        label.pack(ipadx=1)

    def hide_tip(self, event=None):
        tw = self.tip_window
        self.tip_window = None
        if tw:
            tw.destroy()


# ── Main application ───────────────────────────────────────────────────────────

class PipelineUI:
    # Options exactly as seen in Google Flow UI
    _VIDEO_ASPECTS  = ["9:16", "16:9"]
    _IMAGE_ASPECTS  = ["16:9", "4:3", "1:1", "3:4", "9:16"]
    _VIDEO_MODELS   = [
        "Veo 3.1 - Fast",
        "Veo 3.1 - Quality",
        "Veo 3.1 - Lite",
        "Veo 3.1 - Lite [Lower Priority]",
        "Veo 3.1 - Fast [Lower Priority]",
    ]
    _IMAGE_MODELS   = ["Nano Banana 2", "Nano Banana Pro", "Imagen 4"]
    _CLIP_COUNTS    = ["x1", "x2", "x3", "x4"]
    _DURATIONS      = ["4s", "6s", "8s"]

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Animal Channel — Creator Studio")
        self.root.geometry("1280x950")
        self.root.minsize(1100, 800)
        self.root.configure(bg=BG)

        self.output_queue: queue.Queue[str] = queue.Queue()
        self.current_process: subprocess.Popen | None = None
        self._advanced_open = False

        # Load ideas for dropdown
        self.ideas = _load_ideas()
        self._idea_labels = [f"{i.index}.  {i.title}" for i in self.ideas] or ["1.  (no ideas found)"]

        # Tkinter variables
        self.idea_var         = tk.StringVar(value=self._idea_labels[0])
        self.resume_var       = tk.StringVar()
        self.dry_run_var      = tk.BooleanVar(value=False)
        self.headless_var     = tk.BooleanVar(value=False)
        self.wait_sec_var     = tk.StringVar(value="8")
        self.retries_var      = tk.StringVar(value="2")
        self.timeout_var      = tk.StringVar(value="300")
        self.single_scene_var = tk.StringVar(value="1")

        self._build_ui()
        self._poll_output_queue()
        self._refresh_login_badge()

    def _build_ui(self):
        # 1. Sidebar (Fixed Left)
        self._sidebar = tk.Frame(self.root, bg=BG, width=220, highlightbackground=BORDER, highlightthickness=1)
        self._sidebar.pack(side="left", fill="y")
        self._sidebar.pack_propagate(False)
        self._build_sidebar()

        # 2. Main Content
        self._main_content = tk.Frame(self.root, bg=BG)
        self._main_content.pack(side="left", fill="both", expand=True)

        self._build_header()

        # Dashboard Columns
        cols = tk.Frame(self._main_content, bg=BG)
        cols.pack(fill="both", expand=True, padx=24, pady=(0, 24))

        # Col 1: Pipeline (Scrollable)
        self._col1 = tk.Frame(cols, bg=BG)
        self._col1.pack(side="left", fill="both", expand=True)
        
        self._can1 = tk.Canvas(self._col1, bg=BG, bd=0, highlightthickness=0)
        vsb1 = tk.Scrollbar(self._col1, orient="vertical", command=self._can1.yview)
        self._can1.configure(yscrollcommand=vsb1.set)
        vsb1.pack(side="right", fill="y")
        self._can1.pack(side="left", fill="both", expand=True)
        
        self._inner = tk.Frame(self._can1, bg=BG)
        self._win1 = self._can1.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", lambda e: self._can1.configure(scrollregion=self._can1.bbox("all")))
        self._can1.bind("<Configure>", lambda e: self._can1.itemconfig(self._win1, width=e.width))

        # Col 2: Monitor & Operations
        self._col2 = tk.Frame(cols, bg=BG, width=440)
        self._col2.pack(side="left", fill="both", padx=(20, 0))
        self._col2.pack_propagate(False)

        self._build_pipeline_section()
        self._build_monitor_section()

    def _build_sidebar(self):
        # Brand
        tk.Label(self._sidebar, text="Animal Channel", bg=BG, fg=PRIMARY,
                 font=(MAIN_FONT, 14, "bold")).pack(anchor="w", padx=24, pady=30)

        # Creator Studio Badge
        badge = tk.Frame(self._sidebar, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        badge.pack(fill="x", padx=16, pady=(0, 20))
        tk.Label(badge, text="Creator Studio", bg=CARD, fg=PRIMARY, font=(MAIN_FONT, 9, "bold")).pack(anchor="w", padx=12, pady=(10, 0))
        tk.Label(badge, text="V1.3.1 Active", bg=CARD, fg=MUTED, font=(MAIN_FONT, 8)).pack(anchor="w", padx=12, pady=(0, 10))

        # Nav
        for icon, label in [("Pipeline", "Pipeline"), ("Status Logs", "Status Logs")]:
            btn = tk.Button(self._sidebar, text=f"  {label}", bg=BG, fg=MUTED,
                            relief="flat", anchor="w", font=(MAIN_FONT, 10),
                            cursor="hand2", activebackground=GLASS_BG, pady=12)
            btn.pack(fill="x", padx=10)

        # Spacer
        tk.Frame(self._sidebar, bg=BG).pack(fill="both", expand=True)

        # New Video Button
        FlatButton(self._sidebar, "+  New Video", lambda: None, color=DARK, pad_y=12).pack(fill="x", padx=16, pady=24)

    def _on_frame_configure(self, _=None):
        self._canvas.configure(scrollregion=self._canvas.bbox("all"))

    def _on_canvas_configure(self, e):
        self._canvas.itemconfig(self._win_id, width=e.width)

    def _on_mousewheel(self, e):
        if isinstance(e.widget, ttk.Combobox):
            return
        self._canvas.yview_scroll(int(-1 * (e.delta / 120)), "units")

    # ── Header ────────────────────────────────────────────────────────────────

    def _build_header(self):
        hdr = tk.Frame(self._main_content, bg=BG)
        hdr.pack(fill="x", padx=24, pady=20)
        
        tk.Label(hdr, text="Video Pipeline", bg=BG, fg=TEXT, font=(MAIN_FONT, 20, "bold")).pack(side="left")
        
        # Stop / Generate Buttons
        btn_row = tk.Frame(hdr, bg=BG)
        btn_row.pack(side="right")
        FlatButton(btn_row, "  Stop", self.stop_current_process, color=DANGER, pad_x=20).pack(side="left", padx=8)
        FlatButton(btn_row, "  Open Browser", self.open_browser, color=SLATE, pad_x=20).pack(side="left", padx=8)
        FlatButton(btn_row, "  Generate All Videos", self.run_pipeline, color=PRIMARY, pad_x=24).pack(side="left")

    def _build_pipeline_section(self):
        # Stepper (Visual Only)
        stepper = tk.Frame(self._inner, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        stepper.pack(fill="x", padx=16, pady=(10, 16))
        
        row = tk.Frame(stepper, bg=CARD)
        row.pack(pady=20)
        for i in ["1", "2", "3", "4"]:
            tk.Label(row, text=i, bg=DARK if i=="1" else GLASS_BG, fg="white" if i=="1" else MUTED,
                     font=(MAIN_FONT, 10, "bold"), width=3, height=1).pack(side="left", padx=10)
            if i != "4":
                tk.Frame(row, bg=BORDER, height=2, width=40).pack(side="left")
        
        tk.Label(stepper, text="Phase: Initialization", bg=GLASS_BG, fg=MUTED, font=(MAIN_FONT, 9, "bold"), padx=12, pady=6).pack(anchor="e", padx=12, pady=(0, 12))

        # Steps
        self._build_step1_login()
        self._build_step2_pick()
        self._build_step2b_settings()
        self._build_step3_generate()
        self._build_advanced_section()

    def _build_monitor_section(self):
        # Video Preview
        prev = _card(self._col2)
        
        vid = tk.Frame(prev, bg="black", height=220)
        vid.pack(fill="x", pady=5)
        tk.Label(vid, text="▶", bg="black", fg="white", font=(MAIN_FONT, 24)).place(relx=0.5, rely=0.5, anchor="center")
        
        tk.Label(prev, text="LIVE BUFFER", bg="#e8f5e9", fg="#2e7d32", font=(MAIN_FONT, 7, "bold"), padx=6, pady=2).pack(anchor="e", pady=(5, 0))
        tk.Label(prev, text="Current Segment: Introduction", bg=CARD, fg=TEXT, font=(MAIN_FONT, 11, "bold")).pack(anchor="w", pady=(10, 0))
        
        progress = tk.Frame(prev, bg=GLASS_BG, height=8)
        progress.pack(fill="x", pady=(10, 5))
        tk.Frame(progress, bg=PRIMARY, width=280, height=8).pack(side="left") 
        
        # Pipeline Activity
        act = _card(self._col2, "PIPELINE ACTIVITY")
        items = [
            ("Script Analysis Complete", "The AI has parsed 12 scenes.", "2 mins ago"),
            ("Asset Pool Initialized", "Connected to Google Flow storage.", "5 mins ago"),
        ]
        for title, desc, time in items:
            row = tk.Frame(act, bg=CARD, pady=4)
            row.pack(fill="x")
            tk.Label(row, text=title, bg=CARD, fg=TEXT, font=(MAIN_FONT, 8, "bold")).pack(anchor="w")
            tk.Label(row, text=time, bg=CARD, fg=MUTED, font=(MAIN_FONT, 7)).pack(anchor="w")

        # Log Panel (Embedded in Dashboard)
        self._build_log_panel(self._col2)

    # ── Step 1: Login ─────────────────────────────────────────────────────────

    def _build_step1_login(self):
        inner = _card(self._inner, "1. Log in to Google Flow")
        tk.Label(inner, text="Authorize access to your story scripts and assets.",
                 bg=CARD, fg=MUTED, font=(MAIN_FONT, 9)).pack(anchor="w", pady=(0, 15))
        
        row = tk.Frame(inner, bg=CARD)
        row.pack(fill="x")
        
        # Connect Button (Special styling)
        FlatButton(row, "Connect", self.run_login, color=DARK, pad_x=24, pad_y=10).pack(side="left")
        
        self.login_badge = tk.Label(row, text="● AUTHORIZED", bg=CARD, fg=SUCCESS, font=(MAIN_FONT, 8, "bold"))
        self.login_badge.pack(side="left", padx=20)
        
        FlatButton(row, "Reset", self.reset_login, color=SLATE, font_size=9, pad_x=12, pad_y=8).pack(side="right")

    def _build_step2_pick(self):
        inner = _card(self._inner, "2. Pick a Story from Ideas")
        tk.Label(inner, text="Select from trending animal narrative concepts.",
                 bg=CARD, fg=MUTED, font=(MAIN_FONT, 9)).pack(anchor="w", pady=(0, 15))
        
        self._idea_combo = ttk.Combobox(inner, textvariable=self.idea_var,
                             values=self._idea_labels, state="readonly",
                             font=(MAIN_FONT, 10), width=62)
        self._idea_combo.pack(fill="x", pady=(0, 5))
        self._idea_combo.bind("<<ComboboxSelected>>", lambda _: None)
        self._idea_combo.bind("<ButtonPress>", lambda _: self._refresh_ideas())
        combo = self._idea_combo

        # Action Buttons for Step 2
        btn_grid = tk.Frame(inner, bg=CARD)
        btn_grid.pack(fill="x", pady=(10, 0))
        
        btn_resume = FlatButton(btn_grid, "Resume Progress", self.resume_pipeline_from_idea, 
                                color="#059669", font_size=9, pad_x=12, pad_y=6)
        btn_resume.pack(side="left", padx=(0, 8))
        Tooltip(btn_resume, "Continue an existing generation for this story.")
        
        btn_fresh = FlatButton(btn_grid, "Fresh Start", self._fresh_start, 
                               color="#dc2626", font_size=9, pad_x=12, pad_y=6)
        btn_fresh.pack(side="left", padx=(0, 8))
        Tooltip(btn_fresh, "Delete all saved progress and start from scratch.")
        
        btn_final = FlatButton(btn_grid, "Finalize Story", self.finalize_story_from_idea,
                               color="#4b5563", font_size=9, pad_x=12, pad_y=6)
        btn_final.pack(side="left")
        Tooltip(btn_final, "Move downloaded clips to the final output folder.")

    # ── Step 2b: Video settings ───────────────────────────────────────────────

    def _build_step2b_settings(self):
        inner = _card(self._inner, "3. Configure Clip Generation")
        tk.Label(inner, text="Technical parameters for AI synthesis.",
                 bg=CARD, fg=MUTED, font=(MAIN_FONT, 9)).pack(anchor="w", pady=(0, 15))

        current = {}
        if SETTINGS_FILE.exists():
            try:
                current = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass

        saved_mode     = current.get("mode", "Video")
        saved_sub_type = current.get("sub_type", "Frames")
        saved_aspect   = current.get("aspect_ratio", "9:16")
        saved_count    = current.get("clip_count", "x4")
        saved_duration = current.get("duration", "8s")
        saved_model    = current.get("model", "Veo 3.1 - Fast")

        self._mode_var     = tk.StringVar(value=saved_mode)
        self._sub_type_var = tk.StringVar(value=saved_sub_type)
        self._aspect_var   = tk.StringVar(value=saved_aspect)
        self._count_var    = tk.StringVar(value=saved_count if saved_count in self._CLIP_COUNTS else "x4")
        self._duration_var = tk.StringVar(value=saved_duration if saved_duration in self._DURATIONS else "8s")
        self._model_var    = tk.StringVar(value=saved_model)

        # MODE: Image / Video  (matches Flow's top-level tabs)
        tk.Label(inner, text="MODE", bg=CARD, fg=MUTED, font=(MAIN_FONT, 7, "bold")).pack(anchor="w")
        SegmentedControl(inner, ["Image", "Video"], self._mode_var).pack(fill="x", pady=(5, 12))

        # ASPECT RATIO + MODEL ENGINE  (always visible; options change by mode)
        grid = tk.Frame(inner, bg=CARD)
        grid.pack(fill="x")
        grid.columnconfigure(0, weight=1)
        grid.columnconfigure(1, weight=1)

        tk.Label(grid, text="ASPECT RATIO", bg=CARD, fg=MUTED, font=(MAIN_FONT, 7, "bold")).grid(row=0, column=0, sticky="w")
        self._aspect_cb = ttk.Combobox(
            grid, textvariable=self._aspect_var,
            values=self._VIDEO_ASPECTS if saved_mode == "Video" else self._IMAGE_ASPECTS,
            state="readonly", font=(MAIN_FONT, 10),
        )
        self._aspect_cb.grid(row=1, column=0, sticky="ew", pady=(5, 12), padx=(0, 10))

        tk.Label(grid, text="MODEL ENGINE", bg=CARD, fg=MUTED, font=(MAIN_FONT, 7, "bold")).grid(row=0, column=1, sticky="w")
        self._model_cb = ttk.Combobox(
            grid, textvariable=self._model_var,
            values=self._VIDEO_MODELS if saved_mode == "Video" else self._IMAGE_MODELS,
            state="readonly", font=(MAIN_FONT, 10),
        )
        self._model_cb.grid(row=1, column=1, sticky="ew", pady=(5, 12))

        # Video-only controls — grouped in a single frame so show/hide is one call
        self._video_frame = tk.Frame(inner, bg=CARD)

        tk.Label(self._video_frame, text="SUB TYPE", bg=CARD, fg=MUTED, font=(MAIN_FONT, 7, "bold")).pack(anchor="w")
        SegmentedControl(self._video_frame, ["Frames", "Ingredients"], self._sub_type_var).pack(fill="x", pady=(5, 12))

        tk.Label(self._video_frame, text="QUICK SELECT", bg=CARD, fg=MUTED, font=(MAIN_FONT, 7, "bold")).pack(anchor="w")
        SegmentedControl(self._video_frame, ["Veo 3.1 - Fast", "Veo 3.1 - Quality"], self._model_var).pack(fill="x", pady=(5, 12))

        count_row = tk.Frame(self._video_frame, bg=CARD)
        count_row.pack(fill="x")
        count_row.columnconfigure(0, weight=1)
        count_row.columnconfigure(1, weight=1)

        tk.Label(count_row, text="CLIPS PER SCENE", bg=CARD, fg=MUTED, font=(MAIN_FONT, 7, "bold")).grid(row=0, column=0, sticky="w")
        SegmentedControl(count_row, self._CLIP_COUNTS, self._count_var).grid(row=1, column=0, sticky="ew", pady=(5, 12), padx=(0, 10))

        tk.Label(count_row, text="DURATION", bg=CARD, fg=MUTED, font=(MAIN_FONT, 7, "bold")).grid(row=0, column=1, sticky="w")
        SegmentedControl(count_row, self._DURATIONS, self._duration_var).grid(row=1, column=1, sticky="ew", pady=(5, 12))

        # Always-visible footer — stored as instance attrs so _on_mode_change can re-pack them
        # after re-showing _video_frame (pack appends to the end, so re-packing footer restores order)
        self._settings_desc = tk.Label(
            inner,
            text="Settings are clicked automatically in the Flow UI before each scene is generated.",
            bg=CARD, fg=MUTED, font=(MAIN_FONT, 8), wraplength=400, justify="left",
        )
        self._settings_desc.pack(anchor="w", pady=(4, 0))

        self._settings_btn_row = tk.Frame(inner, bg=CARD)
        self._settings_btn_row.pack(fill="x", pady=(15, 0))
        FlatButton(self._settings_btn_row, "Save Parameters", self._save_flow_settings, color=PRIMARY, pad_y=10).pack(fill="x")

        # Wire mode changes — must come after all widgets are created
        self._mode_var.trace_add("write", self._on_mode_change)
        self._on_mode_change()

    def _on_mode_change(self, *_):
        is_video = self._mode_var.get() == "Video"

        # Update dropdown options; reset value if no longer valid
        self._aspect_cb["values"] = self._VIDEO_ASPECTS if is_video else self._IMAGE_ASPECTS
        if self._aspect_var.get() not in self._aspect_cb["values"]:
            self._aspect_var.set(self._aspect_cb["values"][0])

        self._model_cb["values"] = self._VIDEO_MODELS if is_video else self._IMAGE_MODELS
        if self._model_var.get() not in self._model_cb["values"]:
            self._model_var.set(self._model_cb["values"][0])

        # Toggle the video-only block.  Tkinter pack always appends to the end when re-packing
        # after pack_forget, so we also re-pack the footer widgets to keep them last.
        if is_video:
            self._video_frame.pack(fill="x")
            self._settings_desc.pack_forget()
            self._settings_desc.pack(anchor="w", pady=(4, 0))
            self._settings_btn_row.pack_forget()
            self._settings_btn_row.pack(fill="x", pady=(15, 0))
        else:
            self._video_frame.pack_forget()

    def _save_flow_settings(self):
        mode = self._mode_var.get()
        data: dict = {
            "mode":         mode,
            "aspect_ratio": self._aspect_var.get(),
            "model":        self._model_var.get(),
        }
        if mode == "Video":
            data["sub_type"]   = self._sub_type_var.get()
            data["clip_count"] = self._count_var.get()
            data["duration"]   = self._duration_var.get()
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        self._append_output(f"\n[Parameters saved]  {data}\n")

    # ── Step 3: Start ─────────────────────────────────────────────────────────

    def _build_step3_generate(self):
        inner = _card(self._inner, "4. Start Pipeline")
        tk.Label(inner, text="Finalize and launch the automated generation.",
                 bg=CARD, fg=MUTED, font=(MAIN_FONT, 9)).pack(anchor="w", pady=(0, 15))
        
        row = tk.Frame(inner, bg=CARD)
        row.pack(fill="x")
        
        # Start Button (With Rocket Icon)
        FlatButton(row, "🚀  Start Pipeline", self.run_pipeline, color=DARK, pad_y=12).pack(fill="x")
        
        self.status_lbl = tk.Label(inner, text="System Standby", bg=CARD, fg=MUTED, font=(MAIN_FONT, 8, "bold"))
        self.status_lbl.pack(pady=(10, 0))

    # ── Advanced Options ──────────────────────────────────────────────────────

    def _build_advanced_section(self):
        self._adv_toggle = tk.Button(
            self._inner, text="▸   Advanced Options",
            bg=BG, fg=MUTED, relief="flat", cursor="hand2",
            font=(MAIN_FONT, 9), command=self._toggle_advanced,
            anchor="w", padx=18, pady=4,
        )
        self._adv_toggle.pack(fill="x")

        self._adv_card = tk.Frame(self._inner, bg=CARD,
                                  highlightbackground=BORDER, highlightthickness=1)
        inner = tk.Frame(self._adv_card, bg=CARD)
        inner.pack(fill="x", padx=14, pady=12)

        # Grid of numeric settings
        fields = [
            ("Min wait between scenes (s)  [random up to 15s]", self.wait_sec_var,     0, 0),
            ("Retries per scene",                                self.retries_var,      0, 1),
            ("Scene timeout (sec)",                              self.timeout_var,      1, 0),
            ("Run only scene number",                            self.single_scene_var, 1, 1),
        ]
        for label, var, r, c in fields:
            col_pad = (0, 4) if c == 0 else (28, 4)
            tk.Label(inner, text=label, bg=CARD, fg=TEXT,
                     font=(MAIN_FONT, 9)).grid(row=r, column=c * 2,
                                                sticky="w", padx=col_pad, pady=4)
            tk.Entry(inner, textvariable=var, width=10,
                     font=(MAIN_FONT, 9), relief="solid", bd=1,
                     bg="#f8fafc").grid(row=r, column=c * 2 + 1, sticky="w", pady=4)

        # Checkboxes
        chk_row = tk.Frame(inner, bg=CARD)
        chk_row.grid(row=2, column=0, columnspan=4, sticky="w", pady=(12, 0))
        for text, var in [
            ("Test mode — no video generated (dry run)", self.dry_run_var),
            ("Hide browser window",                      self.headless_var),
        ]:
            tk.Checkbutton(chk_row, text=text, variable=var,
                           bg=CARD, fg=TEXT, activebackground=CARD,
                           font=(MAIN_FONT, 9), cursor="hand2").pack(side="left", padx=(0, 24))

        # Single scene button
        btn_row = tk.Frame(inner, bg=CARD)
        btn_row.grid(row=3, column=0, columnspan=4, sticky="w", pady=(14, 0))
        FlatButton(btn_row, "Run Single Scene Only", self.run_single_scene,
                   color="#0369a1", font_size=9, pad_x=12, pad_y=6).pack(side="left")

    def _toggle_advanced(self):
        if self._advanced_open:
            self._adv_card.pack_forget()
            self._adv_toggle.config(text="▸   Advanced Options")
        else:
            self._adv_card.pack(fill="x", padx=16, pady=(0, 6))
            self._adv_toggle.config(text="▾   Advanced Options")
        self._advanced_open = not self._advanced_open

    # ── Log panel ─────────────────────────────────────────────────────────────

    def _build_log_panel(self, parent):
        # Console-style log panel for Column 2
        outer = tk.Frame(parent, bg=LOG_BG, highlightbackground="#1e293b", highlightthickness=1)
        outer.pack(fill="both", expand=True, padx=16, pady=(6, 18))

        bar = tk.Frame(outer, bg="#1e293b")
        bar.pack(fill="x")
        tk.Label(bar, text="LIVE_OUTPUT.SH", bg="#1e293b", fg="#94a3b8",
                 font=(MAIN_FONT, 8, "bold")).pack(side="left", padx=12, pady=6)
        
        tk.Button(bar, text="Clear", bg="#1e293b", fg="#64748b",
                  relief="flat", font=(MAIN_FONT, 8), cursor="hand2",
                  activebackground="#1e293b", activeforeground="#94a3b8",
                  command=self.clear_output).pack(side="right", padx=12)

        mono = "Cascadia Code" if _font_exists("Cascadia Code") else "Consolas"
        self.output_text = tk.Text(
            outer, wrap="word", font=(mono, 9),
            bg=LOG_BG, fg=LOG_FG, insertbackground=LOG_FG,
            relief="flat", bd=0, height=14,
        )
        vsb = tk.Scrollbar(outer, orient="vertical", command=self.output_text.yview)
        self.output_text.configure(yscrollcommand=vsb.set)
        self.output_text.pack(side="left", fill="both", expand=True, padx=(10, 0), pady=8)
        vsb.pack(side="right", fill="y", pady=8)

        self.output_text.tag_configure("err",  foreground=LOG_ERR)
        self.output_text.tag_configure("ok",   foreground=LOG_OK)
        self.output_text.tag_configure("info", foreground=LOG_INF)
        self.output_text.tag_configure("warn", foreground=LOG_WRN)
        self.output_text.tag_configure("hdr",  foreground=LOG_HDR,
                                       font=(mono, 9, "bold"))

    # ── Runtime helpers ───────────────────────────────────────────────────────

    def _refresh_ideas(self):
        fresh = _load_ideas()
        if not fresh:
            return
        labels = [f"{i.index}.  {i.title}" for i in fresh]
        if labels == self._idea_labels:
            return
        self.ideas = fresh
        self._idea_labels = labels
        self._idea_combo["values"] = labels
        current = self.idea_var.get()
        if current not in labels:
            self.idea_var.set(labels[0])

    def _selected_index(self) -> str:
        m = re.match(r"^(\d+)", self.idea_var.get())
        return m.group(1) if m else "1"

    def _bool(self, v: bool) -> str:
        return "true" if v else "false"

    def _refresh_login_badge(self):
        if AUTH_FILE.exists():
            self.login_badge.config(text="✓  AUTHORIZED", fg=SUCCESS)
        else:
            self.login_badge.config(text="!  UNAUTHORIZED", fg=DANGER)
        self.root.after(4000, self._refresh_login_badge)

    def _append_output(self, text: str, tag: str | None = None):
        if not tag:
            low = text.lower()
            if any(w in low for w in ("error", "failed", "exception", "traceback")):
                tag = "err"
            elif any(w in low for w in ("success", "complete", "saved", "done", "✓")):
                tag = "ok"
            elif text.startswith("====="):
                tag = "hdr"
            elif any(w in low for w in ("warning", "warn", "skip")):
                tag = "warn"
            else:
                tag = "info"
        self.output_text.insert("end", text, tag)
        self.output_text.see("end")

    def _poll_output_queue(self):
        try:
            while True:
                self._append_output(self.output_queue.get_nowait())
        except Exception:
            pass
        self.root.after(120, self._poll_output_queue)

    def clear_output(self):
        self.output_text.delete("1.0", "end")

    def _run_command(self, cmd: list[str], title: str):
        if self.current_process and self.current_process.poll() is None:
            messagebox.showwarning("Already running",
                                   "A task is already running.\nClick Stop first.")
            return
        self.status_lbl.config(text=f"Running: {title}…", fg=WARN)
        self._append_output(f"\n===== {title} =====\n")

        def worker():
            try:
                self.current_process = subprocess.Popen(
                    cmd, cwd=str(ROOT_DIR),
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, bufsize=1, encoding="utf-8", errors="replace",
                    env=_SUBPROCESS_ENV,
                )
                for line in self.current_process.stdout:
                    self.output_queue.put(line)
                code = self.current_process.wait()
                self.output_queue.put(f"\n[Done — exit code {code}]\n")
                ok = code == 0
                self.root.after(0, lambda: self.status_lbl.config(
                    text="Completed successfully ✓" if ok else f"Finished with errors (code {code})",
                    fg=SUCCESS if ok else DANGER,
                ))
            except Exception as exc:
                self.output_queue.put(f"\n[Could not start: {exc}]\n")
                self.root.after(0, lambda: self.status_lbl.config(
                    text="Failed to start", fg=DANGER))

        threading.Thread(target=worker, daemon=True).start()

    def stop_current_process(self):
        if self.current_process and self.current_process.poll() is None:
            self.current_process.terminate()
            self._append_output(
                "\n[Stopped. Paste the Story ID in the Resume field and click Resume.]\n")
            self.status_lbl.config(text="Stopped", fg=WARN)
        else:
            messagebox.showinfo("Nothing running", "No task is currently running.")

    # ── Actions ───────────────────────────────────────────────────────────────

    def open_browser(self):
        self._run_command(
            [PYTHON_EXE, "scripts/flow_automation.py", "--mode", "open"],
            "Open Browser (Manual Mode)",
        )

    def run_login(self):
        self._run_command(
            [PYTHON_EXE, "scripts/flow_automation.py", "--mode", "login",
             "--headless", self._bool(self.headless_var.get())],
            "Open Google Flow Login",
        )

    def reset_login(self):
        if not messagebox.askyesno(
            "Reset Login?",
            "This will delete your saved session so you can log in again.\n\nContinue?",
        ):
            return
        if AUTH_FILE.exists():
            AUTH_FILE.unlink()
        self._refresh_login_badge()
        self._append_output("\n[Login session cleared. Click 'Open Login Browser' to log in again.]\n")

    def run_pipeline(self):
        self._run_command([
            PYTHON_EXE, "scripts/run_pipeline.py",
            "--idea-index",        self._selected_index(),
            "--wait-between-sec",  self.wait_sec_var.get() or "8",
            "--wait-max-sec",      "15",
            "--scene-max-retries", self.retries_var.get() or "2",
            "--timeout-sec",       self.timeout_var.get() or "300",
            "--dry-run",           self._bool(self.dry_run_var.get()),
            "--confirm-costly",    "false",
            "--headless",          self._bool(self.headless_var.get()),
        ], "Generate All Videos")

    def run_single_scene(self):
        self._run_command([
            PYTHON_EXE, "scripts/run_pipeline.py",
            "--idea-index",        self._selected_index(),
            "--only-scene",        self.single_scene_var.get() or "1",
            "--wait-between-sec",  self.wait_sec_var.get() or "8",
            "--wait-max-sec",      "15",
            "--scene-max-retries", self.retries_var.get() or "2",
            "--timeout-sec",       self.timeout_var.get() or "300",
            "--dry-run",           self._bool(self.dry_run_var.get()),
            "--confirm-costly",    "false",
            "--headless",          self._bool(self.headless_var.get()),
            "--write-stories",     "false",
            "--mark-processed",    "false",
        ], "Run Single Scene")

    def resume_pipeline(self):
        rid = self.resume_var.get().strip()
        if not rid:
            messagebox.showwarning("Story ID missing",
                                   "Paste the Story ID in the field first.")
            return
        self._run_command([
            PYTHON_EXE, "scripts/run_pipeline.py",
            "--resume",            rid,
            "--wait-between-sec",  self.wait_sec_var.get() or "8",
            "--wait-max-sec",      "15",
            "--scene-max-retries", self.retries_var.get() or "2",
            "--timeout-sec",       self.timeout_var.get() or "300",
            "--dry-run",           self._bool(self.dry_run_var.get()),
            "--confirm-costly",    "false",
            "--headless",          self._bool(self.headless_var.get()),
        ], "Resume Pipeline")

    def download_videos(self):
        rid = self.resume_var.get().strip()
        if not rid:
            messagebox.showwarning("Story ID missing",
                                   "Paste the Story ID in the field first.")
            return
        self._run_command(
            [PYTHON_EXE, "scripts/finalize_outputs.py", "--story-id", rid],
            "Move & Rename Videos",
        )

    def rename_videos(self):
        rid = self.resume_var.get().strip()
        if not rid:
            messagebox.showwarning("Story ID missing",
                                   "Paste the Story ID in the field first.")
            return
        self._run_command(
            [PYTHON_EXE, "scripts/finalize_outputs.py",
             "--story-id", rid, "--rename-only", "true"],
            "Rename Videos",
        )

    def _get_selected_idea(self) -> Idea | None:
        val = self.idea_var.get()
        m = re.match(r"^(\d+)\.", val)
        if not m:
            return None
        idx = int(m.group(1))
        for idea in self.ideas:
            if idea.index == idx:
                return idea
        return None

    def resume_pipeline_from_idea(self):
        idea = self._get_selected_idea()
        if not idea:
            messagebox.showwarning("Selection Error", "No valid idea selected.")
            return
        self.resume_var.set(idea.story_id)
        self.resume_pipeline()

    def finalize_story_from_idea(self):
        idea = self._get_selected_idea()
        if not idea:
            messagebox.showwarning("Selection Error", "No valid idea selected.")
            return
        self.resume_var.set(idea.story_id)
        self.download_videos()

    def _fresh_start(self):
        idea = self._get_selected_idea()
        if not idea:
            messagebox.showwarning("Selection Error", "No valid idea selected.")
            return
        
        if not messagebox.askyesno(
            "Fresh Start?",
            f"This will delete ALL progress for '{idea.title}' (ID: {idea.story_id}).\n\n"
            "This cannot be undone. Continue?"
        ):
            return

        # 1. Delete run state
        run_file = ROOT_DIR / "state" / "runs" / f"{idea.story_id}.json"
        if run_file.exists():
            try:
                run_file.unlink()
                self._append_output(f"\n[Fresh Start] Deleted state file: {run_file.name}\n")
            except Exception as e:
                self._append_output(f"\n[Error] Could not delete state file: {e}\n", "err")

        # 2. Delete story/prompts in processed_ideas.json history (optional, but cleaner)
        # For now, let's just delete the run file as that's what controls the pipeline progress.

        # 3. Clear output folder if it exists
        output_dir = ROOT_DIR / "output" / idea.title.replace(" ", "_")
        if output_dir.exists():
            self._append_output(f"\n[Fresh Start] Note: Output directory '{output_dir.name}' still exists. You may want to delete it manually if you want a true clean start.\n", "warn")

        self._append_output(f"\n[Ready] Fresh start for '{idea.title}' complete. Click 'Start Pipeline' to begin.\n", "ok")


def main():
    root = tk.Tk()
    root.minsize(760, 600)
    PipelineUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
