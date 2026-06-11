# Cueframe — Build Goal

> **What this document is.** A finite, self-contained build brief for an autonomous
> Claude Code run (driven by `/goal`, optionally with agent-teams). It defines what
> Cueframe is, what to build, and — most importantly — a checkable **Definition of Done**
> so the run knows when the goal is met and can stop. Build the smallest thing that
> satisfies every acceptance check, then stop. Do not gold-plate.

---

## 1. Vision

Cueframe is a conversational demo creator. You point Claude Code (with browser
automation) at a running app or a repo, and it learns how the app works. You then tell
it, in plain English, what workflow to "record." It drives the app and captures a reel of
frames. You watch the reel play back, and you shape it into a demo by *talking* — "call
out the hotel results around the middle," "make that pause longer," "drop the last one."
Cueframe resolves the exact frame, the exact anchor, and the copy for you. When you are
happy, it exports a shareable demo as a self-contained web reel, an MP4, or a GIF.

The problem it kills: screen recorders and editing tools are miserable for making product
demos. You re-record because of a typo, you fight timelines, you hand-place every label.
Cueframe replaces "record your screen and edit a video" with "describe the demo and
narrate the callouts." This repo is the general, open-source version of a reel engine that
was first proven inside a private project; here it is rebuilt clean, with no ties to any
one product, so anyone can clone it and demo their own app.

**Audience:** developers who live in a terminal and Claude Code and have struggled to make
good product demos. Optimize every decision for "clone it and demo my app in ten minutes."

---

## 2. The three acts

Cueframe is a pipeline of three acts over one artifact, `spec.json`.

1. **Capture (the Showrunner).** A skill + CLI that discovers an app and records a
   workflow. It explores the running app via browser automation, takes a conversational
   instruction ("book a trip from search to checkout"), drives the app to execute that
   workflow, and writes a `spec.json` whose `frames[]` describe what happened. The
   capture agent is called the **Showrunner**.

2. **Author (the callout skill).** A conversational skill that edits `callouts[]` in an
   existing `spec.json` from plain English. The user never counts frames or writes JSON;
   they describe *what* to point at and *roughly where*, and the skill resolves the exact
   frame, anchor, and copy. The reference design for this skill is in **Appendix A** — it
   is the quality bar for the whole repo.

3. **Play & Export.** A framework-light web player renders a `spec.json` as an animated
   reel (frames advancing, callouts appearing anchored to elements, dwelling, leaving).
   Exporters turn that reel into a self-contained HTML file, an MP4, and a GIF.

---

## 3. The `spec.json` format (canonical contract)

`spec.json` is the single source of truth that flows through all three acts. Define it
once, validate it everywhere, and write TypeScript types + a runtime validator with tests.

```jsonc
{
  "meta": {
    "title": "string",            // demo title
    "app": "string",              // what was demoed (name / url)
    "createdAt": "ISO-8601",
    "viewport": { "w": 1280, "h": 800 },
    "voice": {                    // OPTIONAL tone hints for callout copy (see §3.3)
      "style": "plain",           // default "plain"; teams may override
      "allowEmDash": false,       // default false
      "notes": "string"           // freeform house-voice guidance
    }
  },
  "frames": [ /* FrameRecord[] — see §3.1 */ ],
  "callouts": [ /* Callout[] — see §3.2 */ ]
}
```

### 3.1 FrameRecord — the load-bearing part

```jsonc
{
  "id": "f186",                   // stable, unique within the spec
  "n": 186,                       // order index
  "kind": "golden" | "raw",       // only "golden" frames appear in exports
  "img": "frames/f186.png",       // relative path to the captured screenshot
  "caption": "string",            // ONE line: what happened on this frame
  "axDigest": "string",           // searchable DOM/accessibility summary of the frame
  "boxes": [                      // meaningful elements on the frame, with pixel rects
    { "selector": "[data-board=hotel]", "rect": { "x": 0, "y": 0, "w": 0, "h": 0 },
      "label": "string" }         // optional human label / action label
  ],
  "action": { "label": "string", "selector": "string" }  // optional: what the user did to reach the next frame
}
```

> **CAPTURE QUALITY IS A HARD CONTRACT, NOT BEST-EFFORT.**
> `caption`, `axDigest`, and `boxes` are the fields that semantic frame resolution and
> auto-anchoring stand on. If the Showrunner skimps on them, the callout experience
> silently degrades to plain frame-number editing — the marquee feature dies. Treat these
> as load-bearing:
> - Every golden frame MUST have a non-empty `caption` (a real description, not "Frame 186").
> - Every golden frame MUST have a non-empty `axDigest` summarizing the salient DOM/AX state.
> - `boxes` MUST include the elements a user would plausibly point a callout at on that
>   frame (the interactive and result-bearing elements), each with a real selector and a
>   real pixel rect measured at capture time.
> - The validator MUST flag golden frames that violate these as **capture defects**, and
>   the end-to-end acceptance run MUST produce zero such defects on the sample app.

### 3.2 Callout

```jsonc
{
  "id": "c1",
  "frame": "f186",                // MUST reference an existing FrameRecord.id
  "anchor": {                     // OPTIONAL; prefer selector over rect
    "selector": "[data-board=hotel]",   // MUST exist in that frame's boxes if set
    "rect": { "x": 0, "y": 0, "w": 0, "h": 0 }  // manual fallback
  },
  "eyebrow": "string",            // optional
  "title": "string",             // required
  "body": "string",              // optional
  "dwellMs": 4000,                // optional; player default ~4000
  "style": "card" | "spotlight" | "arrow"   // default "card"
}
```

### 3.3 Voice is configurable

The default callout voice is plain sentences, no em-dashes, written like a person labeling
a screen rather than marketing copy. That default MUST live in `meta.voice` (`style:
"plain"`, `allowEmDash: false`), and the callout skill MUST read `meta.voice` rather than
hardcoding the rule, so other teams can set their own house voice. If `meta.voice` is
absent, fall back to the plain default.

---

## 4. Distribution

Ship Cueframe two ways from one codebase:

1. **A Claude Code plugin** — the `capture` (Showrunner) and `callout` skills, plus slash
   commands, installable as a CC plugin. This is how the conversational acts happen.
2. **An `npx cueframe` CLI** — the engine, runnable without Claude Code, with verbs:
   - `cueframe capture <url> [--out spec.json]` — drive an app and emit a spec. (The
     conversational discovery is richest under the skill; the CLI provides a scriptable
     path and the underlying capture library.)
   - `cueframe play <spec.json>` — open the local web player on a spec.
   - `cueframe export <spec.json> --format html|mp4|gif [--out demo.html]` — render an export.
   - `cueframe validate <spec.json>` — run the schema + capture-quality validator.

Both surfaces call the same core libraries (`spec`, `capture`, `player`, `export`). Keep
the core framework-light and dependency-lean so the HTML export can inline everything into
one self-contained file.

---

## 5. Finite deliverables

Build these. Each must exist, be wired, and be covered by the Definition of Done in §6.

- **D1 — Repo scaffold.** `package.json`, TypeScript config, MIT `LICENSE`, `.gitignore`,
  a CI workflow (GitHub Actions) that runs typecheck + tests on push.
- **D2 — Spec core.** Canonical `spec.json` TypeScript types + a runtime validator that
  enforces §3 (including the capture-quality contract in §3.1), with tests.
- **D3 — Capture engine (Showrunner).** A `capture` skill + the CLI `cueframe capture`
  that drives a running SPA via browser automation and emits a schema-valid `spec.json`
  with rich per-frame `caption` / `axDigest` / `boxes`. Browser automation may use the
  chrome-devtools MCP and/or Playwright; pick one and justify it briefly in the README.
- **D4 — Callout authoring.** A `callout` skill (generalize Appendix A) backed by a
  spec-edit library (`add` / `edit` / `remove` / `retime` / `re-anchor` / `query`) with
  tests. The skill resolves frame → anchor → copy from natural language and reads
  `meta.voice`.
- **D5 — Player.** A framework-light web player that renders a `spec.json` as an animated
  reel: frames advance, callouts appear anchored to their `boxes`/rects, dwell, and leave.
- **D6 — Exporters.** `html` (single self-contained file, assets inlined), `mp4`, and
  `gif`. MP4/GIF may be produced by headless-recording the player or by compositing frames
  + timeline with ffmpeg; choose the simpler reliable path.
- **D7 — Sample app.** A tiny, self-contained todo SPA committed in the repo (e.g.
  `examples/todo-app/`) as the canonical capture target, so Cueframe is demoable with zero
  external setup. It must be trivially launchable (`npm run sample` or similar).
- **D8 — Golden example.** A committed end-to-end artifact: a `spec.json` captured from the
  sample app, three authored callouts, and the three exported files (`demo.html`,
  `demo.mp4`, `demo.gif`) — or a one-command script that regenerates them deterministically.
- **D9 — Docs.** `README.md` (what it is, the three acts, install for both surfaces,
  quickstart that reproduces D8 from a clean clone), `CONTRIBUTING.md`, and a short
  walkthrough of the golden example.
- **D10 — Green bar.** `npm test` passes, `npm run typecheck` is clean, CI is green.

---

## 6. Definition of Done (the stop gate)

The goal is met when **every** check below passes. These are the finish line — when they
are all green, stop.

1. `npm install` on a clean clone succeeds; `npm run typecheck` is clean; `npm test` is
   green; the CI workflow passes.
2. The sample todo SPA launches with a single documented command.
3. `npx cueframe capture <sample-app-url>` produces a `spec.json` that:
   - passes `cueframe validate` with **zero schema errors and zero capture defects**, and
   - contains **≥ 6 golden frames**, each with a non-empty `caption`, a non-empty
     `axDigest`, and at least one real `box` with a selector and pixel rect.
4. The callout skill can, on that spec, **add**, **edit**, and **remove** a callout from
   plain-English instructions, and the spec still validates after each operation. Auto
   anchoring binds at least one callout to a real `box` selector (not a manual rect).
   Callout copy honors `meta.voice` (plain default: no em-dashes).
5. `cueframe export` produces, from the golden spec, a `demo.html` that opens and plays the
   reel locally, a `demo.mp4` that plays, and a `demo.gif` that animates.
6. Following the README quickstart from a clean clone reproduces the golden example (D8) —
   capture (or the committed spec) → three callouts → three exports — with no manual
   JSON editing and no steps missing.
7. The repo is publishable: MIT `LICENSE`, a `README` a stranger can follow, the
   `examples/` sample, and the golden example are all present and committed.

If any check is red, the goal is not met. If a check cannot be made to pass, stop and
surface the blocker rather than weakening the check.

---

## 7. Out of scope (YAGNI — do not build)

- A visual / drag-and-drop callout editor UI (conversational authoring is the product).
- Any hosted service, server, accounts, auth, or multi-user features.
- Cloud storage, databases, or analytics.
- Theming systems beyond `meta.voice`.
- Any code, branding, or assumption specific to the private project this was extracted
  from. This is a clean-room rebuild; that project is **reference only**, never a dependency.
- Capturing more than one workflow per spec, branching demos, or live re-capture.

Resist scope creep. If an idea is not required by §6, it does not get built in this run.

---

## 8. Execution strategy (for the autonomous run)

This is a clean-room rebuild. Use the private reel engine only as reference for *how* the
hard parts were solved; copy no code verbatim and carry over no product-specific names.

**Recommended flow:** brainstorm → write a spec (`docs/`) → write an implementation plan →
execute with TDD per component → verify against §6 before claiming done. Use the
test-driven-development, writing-plans, and verification-before-completion skills.

**Dependency order and parallelism:**
- **First, alone:** D1 scaffold and D2 spec core. Everything downstream depends on the
  spec contract, so freeze it early.
- **Then, parallelizable** (good agent-teams split — each owns a library + its tests):
  - Capture/Showrunner (D3) + the sample app it needs (D7)
  - Player (D5)
  - Callout skill + edit library (D4)
  - Exporters (D6)
  - Docs (D9) — drafted alongside, finalized last
- **Last, integrative:** the golden example (D8) and the full §6 acceptance pass, which
  exercise all components together.

**Quality guardrails:**
- The capture-quality contract (§3.1) is the highest-risk area. Invest there first and
  verify it hard — a beautiful player over thin frames is a dead product.
- Keep core libraries framework-light and dependency-lean (the HTML export must inline
  cleanly into one file).
- Every component ships with tests. The §6 gate is non-negotiable and self-checking; wire
  it as a script (e.g. `npm run acceptance`) if practical so "is the goal met?" is one
  command.

**Reference pointers (read for approach, then build clean):** the private project's
`scripts/capture-fixtures.mjs` and `scripts/record-replay.mjs` (capture + replay shape),
`web/src/ReelCallout.tsx` and `web/src/timeline.ts` (player + callout animation), and the
callout skill reproduced in Appendix A (resolution logic).

---

## Appendix A — Reference callout skill (quality bar)

This is the existing, proven design for the **Author** act. Generalize it (remove any
product-specific examples, read `meta.voice` instead of hardcoding the copy rule), but hold
the whole repo to its level of clarity and care.

```markdown
---
name: cueframe-callouts
description: >
  Author and edit Cueframe demo callouts from natural language. Use whenever the
  user asks to add, move, reword, retime, or remove a callout/annotation/spotlight on
  a captured demo reel — e.g. "add a callout for the aggregated hotel results around
  frame 186", "make the pricing callout pause longer", "drop the third callout",
  "where does the hotel board first show up?". Operates on a Cueframe spec.json + its
  indexed frame dataset. Do NOT use for the capture step (driving the app) or for
  building the player/editor — only for editing callouts in an existing spec.
---

# Cueframe callout authoring

You edit `callouts` in a Cueframe `spec.json` from plain-English instructions. The whole
point of this skill: the user should never have to count frames or write JSON. They
describe *what* to point at and *roughly where* in the demo; you resolve the exact frame
and the exact anchor, then write the edit.

## Data you work with
- `spec.json` → `{ meta, frames: FrameRecord[], callouts: Callout[] }`.
- Each `FrameRecord` has: `id` (stable, e.g. `f186`), `n` (order), `img`, `caption`
  (one-line "what happened"), `axDigest` (searchable DOM/AX summary), and
  `boxes: [{ selector, rect }]` (the meaningful elements on that frame, with pixel rects).
- A `Callout` is `{ frame: <id>, anchor?: {selector?|rect?}, eyebrow?, title, body?,
  dwellMs?, style? }`.

Never invent frame ids, selectors, or rects. Every reference you write must come from the
actual `frames` array in the loaded spec.

## Step 1 — Resolve the FRAME (which frame the callout binds to)
The user gives one of three forms. Resolve in this priority:
1. **Exact / approximate number** — "frame 186", "around 186", "near the end". For
   "around N", prefer the exact frame `n===N` if it exists; otherwise the nearest frame.
   For fuzzy positions ("start/middle/end"), map to the first/median/last golden frame.
2. **Semantic description** — "the frame where hotels aggregate", "after they pick the
   flight", "when the pricing updates". Search `caption` + `axDigest` (and `action.label`)
   across frames; rank by match; pick the best. If the description implies "first time X
   appears", choose the earliest matching frame.
3. **Relative to an existing callout** — "right before the pricing callout", "two frames
   after that one". Resolve against callouts already in the spec.

If two or more frames match a semantic query almost equally, do NOT guess silently — list
the top 2–3 (`n`, `caption`) and ask which. If the match is clear, proceed and state which
frame id you chose and why ("frame 186 — caption: 'Hotel options aggregate into a board'").

## Step 2 — Resolve the ANCHOR (where on the frame the callout points)
Auto-anchoring is the marquee feature: prefer it over manual rects.
1. **Description → selector.** Match the user's target phrase ("the aggregated hotel
   results", "the Send button") against the chosen frame's `boxes` (by selector text,
   nearby `axDigest`, or `action.label`). If one box clearly matches, set
   `anchor.selector` to it — the player resolves its rect at render time.
2. **No clear box on that frame.** Check adjacent golden frames; if the element appears
   there, suggest re-targeting to that frame. Otherwise fall back to a manual
   `anchor.rect` and tell the user you used an approximate box.
3. **No anchor wanted.** If the user just wants a floating card ("add a note that says…"),
   omit `anchor` — the player centers/parks the card.

## Step 3 — Fill the COPY
- `title` is required; `eyebrow` and `body` optional. Keep them tight.
- **Copy voice: read `meta.voice`.** Default (no `meta.voice`, or `style: "plain"`): plain
  sentences, no em-dashes, no over-polished "authored-by-AI" cadence. Write like a person
  labeling a screen, not marketing. If a team sets `meta.voice`, honor it.
- If the user gives only a target ("callout the hotel results"), draft a short title +
  one-line body from the frame's `caption`/`axDigest`, and show it for confirmation rather
  than committing silently.
- `dwellMs`: only set when the user asks ("pause longer", "quick flash"). Default is the
  player's (~4000ms). "Longer" ≈ +50%, "brief" ≈ ~1500ms — state the value you chose.
- `style`: `card` default; use `spotlight`/`arrow` only if the user asks for emphasis.

## Operations you support
- **Add** a callout (resolve frame + anchor + copy, append to `callouts`).
- **Edit** an existing one (reword, restyle, retime, re-anchor, move to another frame).
  Identify the target callout by ordinal ("the third callout"), by frame, or by its title.
- **Remove** a callout.
- **Reorder / retime** (adjust `dwellMs`, or move which frame it binds to).
- **Query** ("where does X happen?") — answer with frame `n` + `caption`, no edit.

## Validation (run before writing)
- The `frame` id exists in `frames`.
- If `anchor.selector` is set, that selector exists in the target frame's `boxes`.
- Warn if two callouts bind to the same frame (they'll queue — confirm that's intended).
- Warn if a callout binds to a non-golden (`raw`) frame — it won't appear in the export.

## Workflow
1. Read the spec.json (ask for its path if not given; default to the obvious one in the
   project). Don't load frame images — work from the `frames` metadata.
2. Resolve frame → anchor → copy per the steps above.
3. State the resolution in one line ("Frame f186, anchored to `[data-board=hotel]`,
   title: 'Hotels, aggregated'"). For a clear request, apply the edit and write the spec.
   For an ambiguous one, confirm first.
4. Write `spec.json` (preserve key order and formatting; only touch `callouts`). Report the
   diff in plain terms.
5. If a Cueframe preview/editor is running, mention the user can scrub to that frame to
   verify; otherwise note the change is saved.

## Examples
- "add a callout for the aggregated hotel results around frame 186"
  → frame `f186` (n=186, caption match), anchor `[data-board=hotel]` from its boxes,
    drafted title/body, appended.
- "where do hotels first show up?"
  → search captions/axDigest, answer "Frame 186 — 'Hotel options aggregate into a board'",
    no edit.
- "make the pricing callout pause a little longer"
  → find callout whose title/frame is about pricing, set `dwellMs` from default to ~6000,
    report the value.
- "the second callout points at the wrong thing, it should be the Send button"
  → re-anchor that callout's `selector` to the Send-button box on its frame; if absent
    there, suggest the frame where it appears.
```
