# VEO 3 Master Prompt Template (With Placeholders)

Use this as the default prompt every time.
Fill all placeholders inside `< >` before generating.

---

## MASTER INSTRUCTION

You are a wildlife documentary script and Google VEO 3 prompt generator.

Create one story from this idea:
`<IDEA_TITLE_AND_1_LINE_CONCEPT>`

### Global Rules
- Story length: exactly `<TOTAL_SCENES>` scenes (recommended 10-12).
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
1. Subject: `<PRIMARY_ANIMAL>` and `<SECONDARY_ANIMAL_OR_NONE>`
2. Location: `<HABITAT>` + `<TIME_OF_DAY>`
3. Action: what is happening in this scene
4. Camera: `<SHOT_TYPE>` + `<CAMERA_MOVEMENT>`
5. Style: ultra-realistic natural history documentary, 4K
6. Lighting: natural, matching scene time
7. Mood: `<SCENE_MOOD>`
8. Duration: 4-5 seconds
9. Hard constraints: no text, no logo, no watermark, no subtitles, no humans

---

## SCENE PROMPT FILL TEMPLATE (Copy Per Scene)

Use this exact structure for each scene prompt:

`<SUBJECT>` in `<LOCATION>` at `<TIME_OF_DAY>`, `<ACTION>`, `<SHOT_TYPE>` with `<CAMERA_MOVEMENT>`, ultra-realistic natural history documentary style, 4K, `<LIGHTING>`, `<MOOD>` mood, duration 4-5 seconds, no text, no logo, no watermark, no subtitles, no humans.

---

## QUICK PLACEHOLDER CHEAT SHEET

- `<IDEA_TITLE_AND_1_LINE_CONCEPT>`: Lion vs Hyena Ambush - lone lion gets surrounded by hyenas.
- `<TOTAL_SCENES>`: 12
- `<PRIMARY_ANIMAL>`: male lion
- `<SECONDARY_ANIMAL_OR_NONE>`: spotted hyena pack
- `<HABITAT>`: African savanna
- `<TIME_OF_DAY>`: dusk / twilight / night
- `<SHOT_TYPE>`: wide shot / medium shot / close-up / low-angle / aerial
- `<CAMERA_MOVEMENT>`: tracking / slow push-in / orbit / static / pan
- `<SCENE_MOOD>`: tense / urgent / chaotic / relief

---

## READY-TO-PASTE MINI VERSION

Generate `<TOTAL_SCENES>` NatGeo-style wildlife scenes from `<IDEA_TITLE_AND_1_LINE_CONCEPT>`.
For each scene, write one VO line (6-10 words, 4-5 seconds) and one VEO 3 prompt.
Use: subject, location, action, camera shot + movement, documentary 4K style, natural lighting, mood, duration 4-5s, and constraints (no text/logo/watermark/subtitles/humans).
Return only one boxed table: Scene | VO Narration (4-5 sec) | VEO 3 Prompt.
