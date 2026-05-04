import { useEffect, useState } from 'react'
import { FileText, Loader2, CheckCircle, RotateCcw } from 'lucide-react'
import { api } from '../api/client'

interface PromptSettings {
  prompt_idea_generation: string
  prompt_script_generation: string
  prompt_vo_narration_generation: string
  prompt_veo_prompt_generation: string
  prompt_story_master_template: string
}

const DEFAULT_PROMPTS: PromptSettings = {
  prompt_idea_generation:
    'You are a creative content strategist for YouTube. Your job is to generate exactly {idea_count} compelling video ideas for a given niche and content type. Return ONLY a JSON array with exactly {idea_count} objects. Each object must have exactly two keys: "title" (a short, punchy video title) and "description" (one sentence explaining the idea). No markdown, no extra text, no numbering outside the JSON. Output valid JSON only.',
  prompt_script_generation:
    'You are a professional scriptwriter specializing in {niche} content for YouTube. Write a compelling, narration-ready video script for the given idea. The script MUST be approximately {target_words} words - aim for exactly {target_words} words. Each sentence is a self-contained scene or narration beat. Write in vivid, engaging, present-tense prose suitable for a voiceover. Output ONLY the script sentences, one per line, no scene numbers, no timestamps, no headings.',
  prompt_vo_narration_generation:
    'You are an expert voiceover writer for wildlife documentary videos. For each sentence in the script, return a JSON array where every element has exactly two keys:\n  "sentence" - the original sentence (verbatim)\n  "narration" - a warm, conversational, narration-ready line for TTS\n\nReturn ONLY a valid JSON array. No markdown fences, no explanation.',
  prompt_veo_prompt_generation:
    'You are an expert cinematic prompt engineer for AI video generation. For each sentence in the script, return a JSON array where every element has exactly two keys:\n  "sentence" - the original sentence (verbatim)\n  "veo_prompt" - a detailed VEO 3 video generation prompt: camera angle, lighting, animal behavior, environment, mood\n\nReturn ONLY a valid JSON array. No markdown fences, no explanation.',
  prompt_story_master_template: `# VEO 3 Master Prompt Template (With Placeholders)

Use this as the default prompt every time.
Fill all placeholders inside \`< >\` before generating.

---

## MASTER INSTRUCTION

You are a wildlife documentary script and Google VEO 3 prompt generator.

Create one story from this idea:
\`<IDEA_TITLE_AND_1_LINE_CONCEPT>\`

### Global Rules
- Story length: exactly \`<TOTAL_SCENES>\` scenes (recommended 10-12).
- Tone: NatGeo-style, cinematic, realistic, tense.
- Language: simple English only.
- Narration style: short VO lines that fit 4-5 seconds each.
- VO length target: 6-10 words per scene.
- Tense: present tense.
- No fantasy, no gore, no human dialogue.

### Output Format (Mandatory)
Return only one boxed table with columns:
1. Scene
2. VO Narration (4-5 sec)
3. VEO 3 Prompt

### Scene Continuity Rules
- Scene sequence must flow naturally from start to end.
- Each VO line must match its scene prompt exactly.
- Keep animals, location, and time continuity consistent unless explicitly changed.

### VEO 3 Prompt Rules (for every scene)
Each scene prompt must include:
1. Subject: \`<PRIMARY_ANIMAL>\` and \`<SECONDARY_ANIMAL_OR_NONE>\`
2. Location: \`<HABITAT>\` + \`<TIME_OF_DAY>\`
3. Action: what is happening in this scene
4. Camera: \`<SHOT_TYPE>\` + \`<CAMERA_MOVEMENT>\`
5. Style: ultra-realistic natural history documentary, 4K
6. Lighting: natural, matching scene time
7. Mood: \`<SCENE_MOOD>\`
8. Duration: 4-5 seconds
9. Hard constraints: no text, no logo, no watermark, no subtitles, no humans

---

## SCENE PROMPT FILL TEMPLATE (Copy Per Scene)

Use this exact structure for each scene prompt:

\`<SUBJECT>\` in \`<LOCATION>\` at \`<TIME_OF_DAY>\`, \`<ACTION>\`, \`<SHOT_TYPE>\` with \`<CAMERA_MOVEMENT>\`, ultra-realistic natural history documentary style, 4K, \`<LIGHTING>\`, \`<MOOD>\` mood, duration 4-5 seconds, no text, no logo, no watermark, no subtitles, no humans.

---

## QUICK PLACEHOLDER CHEAT SHEET

- \`<IDEA_TITLE_AND_1_LINE_CONCEPT>\`: Lion vs Hyena Ambush - lone lion gets surrounded by hyenas.
- \`<TOTAL_SCENES>\`: 12
- \`<PRIMARY_ANIMAL>\`: male lion
- \`<SECONDARY_ANIMAL_OR_NONE>\`: spotted hyena pack
- \`<HABITAT>\`: African savanna
- \`<TIME_OF_DAY>\`: dusk / twilight / night
- \`<SHOT_TYPE>\`: wide shot / medium shot / close-up / low-angle / aerial
- \`<CAMERA_MOVEMENT>\`: tracking / slow push-in / orbit / static / pan
- \`<SCENE_MOOD>\`: tense / urgent / chaotic / relief

---

## READY-TO-PASTE MINI VERSION

Generate \`<TOTAL_SCENES>\` NatGeo-style wildlife scenes from \`<IDEA_TITLE_AND_1_LINE_CONCEPT>\`.
For each scene, write one VO line (6-10 words, 4-5 seconds) and one VEO 3 prompt.
Use: subject, location, action, camera shot + movement, documentary 4K style, natural lighting, mood, duration 4-5s, and constraints (no text/logo/watermark/subtitles/humans).
Return only one boxed table: Scene | VO Narration (4-5 sec) | VEO 3 Prompt.`,
}

export default function PromptsView() {
  const [form, setForm] = useState<PromptSettings>(DEFAULT_PROMPTS)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<'saved' | 'error' | null>(null)

  useEffect(() => {
    reloadPrompts().catch(() => {})
  }, [])

  async function reloadPrompts() {
    setLoading(true)
    try {
      const data = await api.getAppSettings()
      const legacyCombined = String(data.prompt_vo_prompt_generation ?? '').trim()
      const remoteVoNarration = String(data.prompt_vo_narration_generation ?? '').trim()
      const remoteVeoPrompt = String(data.prompt_veo_prompt_generation ?? '').trim()
      setForm({
        prompt_idea_generation: String(data.prompt_idea_generation ?? '').trim() || DEFAULT_PROMPTS.prompt_idea_generation,
        prompt_script_generation: String(data.prompt_script_generation ?? '').trim() || DEFAULT_PROMPTS.prompt_script_generation,
        prompt_vo_narration_generation: remoteVoNarration || legacyCombined || DEFAULT_PROMPTS.prompt_vo_narration_generation,
        prompt_veo_prompt_generation: remoteVeoPrompt || legacyCombined || DEFAULT_PROMPTS.prompt_veo_prompt_generation,
        prompt_story_master_template: String(data.prompt_story_master_template ?? '').trim() || DEFAULT_PROMPTS.prompt_story_master_template,
      })
    } catch {
      setForm(DEFAULT_PROMPTS)
    } finally {
      setLoading(false)
    }
  }

  function patch<K extends keyof PromptSettings>(key: K, value: PromptSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function savePrompts() {
    setSaving(true)
    try {
      await api.saveAppSettings({
        prompt_idea_generation: form.prompt_idea_generation,
        prompt_script_generation: form.prompt_script_generation,
        prompt_vo_narration_generation: form.prompt_vo_narration_generation,
        prompt_veo_prompt_generation: form.prompt_veo_prompt_generation,
        prompt_story_master_template: form.prompt_story_master_template,
      })
      setToast('saved')
      setTimeout(() => setToast(null), 2500)
    } catch {
      setToast('error')
      setTimeout(() => setToast(null), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function resetToBuiltIns() {
    setSaving(true)
    try {
      await api.saveAppSettings({
        prompt_idea_generation: '',
        prompt_script_generation: '',
        prompt_vo_narration_generation: '',
        prompt_veo_prompt_generation: '',
        prompt_vo_prompt_generation: '',
        prompt_story_master_template: '',
      })
      await reloadPrompts()
      setToast('saved')
      setTimeout(() => setToast(null), 2500)
    } catch {
      setToast('error')
      setTimeout(() => setToast(null), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-4xl mx-auto px-10 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <FileText size={20} className="text-slate-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Prompts</h1>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              Edit master prompts. Your saved prompts are used first.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Loading prompts...
          </div>
        ) : (
          <div className="space-y-6">
            <PromptField
              label="Idea Generation Prompt"
              description="Used by Step 2 idea generation."
              value={form.prompt_idea_generation}
              onChange={(value) => patch('prompt_idea_generation', value)}
            />
            <PromptField
              label="Script Generation Prompt"
              description="Used by Step 3 script generation."
              value={form.prompt_script_generation}
              onChange={(value) => patch('prompt_script_generation', value)}
            />
            <PromptField
              label="VO Narration Generation Prompt"
              description="Used by Step 4 to generate narration lines."
              value={form.prompt_vo_narration_generation}
              onChange={(value) => patch('prompt_vo_narration_generation', value)}
            />
            <PromptField
              label="VEO Prompt Generation Prompt"
              description="Used by Step 4 to generate per-scene VEO prompts."
              value={form.prompt_veo_prompt_generation}
              onChange={(value) => patch('prompt_veo_prompt_generation', value)}
            />
            <PromptField
              label="Story Master Prompt Template"
              description="Used by full pipeline story generation (run pipeline)."
              value={form.prompt_story_master_template}
              onChange={(value) => patch('prompt_story_master_template', value)}
              rows={14}
            />
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={savePrompts}
            disabled={saving || loading}
            className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-all shadow-lg shadow-emerald-100"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Save Prompts
          </button>

          <button
            onClick={resetToBuiltIns}
            disabled={saving || loading}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-all"
          >
            <RotateCcw size={14} />
            Reset to Built-ins
          </button>

          {toast === 'saved' && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle size={15} />
              Saved
            </div>
          )}
          {toast === 'error' && (
            <div className="text-sm font-medium text-red-500">Save failed</div>
          )}
        </div>
      </div>
    </div>
  )
}

function PromptField({
  label,
  description,
  value,
  onChange,
  rows = 8,
}: {
  label: string
  description: string
  value: string
  onChange: (next: string) => void
  rows?: number
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1">{label}</label>
      <p className="text-xs text-slate-500 mb-2">{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm leading-relaxed font-mono focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
      />
    </div>
  )
}
