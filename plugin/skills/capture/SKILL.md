---
name: cueframe-capture
description: >
  Drive a running web app with browser automation and record a workflow into a Cueframe
  spec.json (the "Showrunner"). Use whenever the user wants to CAPTURE or RECORD a demo of
  an app from a plain-English workflow — e.g. "record adding a todo and completing it",
  "capture the signup flow from the landing page to the dashboard", "demo searching and
  checking out". Explores the app to learn its selectors, turns the instruction into a
  capture scenario, drives the app, and writes a schema-valid spec.json with rich per-frame
  caption / axDigest / boxes. Do NOT use for editing callouts on an existing reel (that is
  the cueframe-callouts skill) or for building the player/exporters.
---

# Cueframe capture (the Showrunner)

You record a workflow on a running web app into a Cueframe `spec.json`. The user describes,
in plain English, the workflow to demo. You learn how the app works, drive it through that
workflow, and capture a reel of **golden frames** — each a screenshot plus the metadata that
the rest of Cueframe stands on.

The mechanism is the `cueframe capture` CLI, backed by the `src/capture` library (Playwright
under the hood). You author a **capture scenario** (an ordered list of steps) and let the
engine execute it and measure every frame. You do not hand-place screenshots or hand-write
pixel rects — the engine measures them at capture time.

## The capture-quality contract is the whole game (GOAL.md §3.1)

`caption`, `axDigest`, and `boxes` on each golden frame are load-bearing: the callout skill's
semantic frame resolution and auto-anchoring stand entirely on them. If they are thin, the
conversational callout experience silently collapses to frame-number editing. So:

- Every golden frame gets a **real one-line caption** — what happened on this frame, in plain
  words ("First todo added to the list"), never "Frame 3".
- Every golden frame gets a **non-empty axDigest** — the engine builds this from the live DOM
  (roles, names, counts). You do not write it, but you DO choose steps that land on states
  worth describing.
- `boxes` must include the elements a user would plausibly point a callout at on that frame.
  The engine measures these; your job is to reference the meaningful selectors in your steps
  so they are captured.

`cueframe validate` flags any golden frame that violates this as a **capture defect**. A good
capture has zero schema errors and zero capture defects.

## Step 1 — Learn the app

You need the app's URL and enough of its structure to write reliable steps.

- If the app is not already running, ask the user how to start it (or use the bundled sample:
  `npm run sample` serves `examples/todo-app` on http://localhost:5173).
- Open the app and read its DOM: prefer stable selectors — `[data-*]`, `id`, ARIA roles —
  over brittle nth-of-type/text selectors. (If the chrome-devtools MCP is available you can
  explore interactively; otherwise inspect the page source / ask the user for key selectors.)
- Note the inputs, buttons, and result regions involved in the workflow the user named.

If the app already ships a capture scenario (a `window.__CUEFRAME_SCENARIO__` global or a
`<script id="cueframe-scenario" type="application/json">` tag — as the sample app does), the
engine will use it automatically. In that case you can capture with zero authoring; only
write your own scenario when the app does not provide one or the user wants a different flow.

## Step 2 — Turn the instruction into a scenario

A scenario is `{ name?, steps: Step[] }`. Each step is one of:

- `{ "action": "goto", "url"?, "caption"? }` — navigate (optional first golden frame).
- `{ "action": "fill", "selector", "value", "caption"?, "label"? }` — type into a field.
- `{ "action": "click", "selector", "caption"?, "label"? }` — click an element.
- `{ "action": "press", "selector"?, "key", "caption"? }` — press a key (e.g. "Enter").
- `{ "action": "waitFor", "selector"?, "ms"? }` — wait for an element / a beat (no frame).
- `{ "action": "snapshot", "caption" }` — capture the current state as a golden frame.

**A step with a `caption` (and every `snapshot`) produces a golden frame, captured AFTER the
step's effect.** A `fill`/`click` without a caption just acts. So caption the steps that land
on a state worth showing, and leave intermediate mechanics uncaptioned.

Translate the user's workflow into the smallest sequence of steps that lands on each
meaningful state, captioning each landing. Aim for a coherent reel (typically 5–10 golden
frames). Reference real, stable selectors you confirmed in Step 1.

Example (the sample todo app, "add a todo then complete it"):

```json
{
  "name": "Add and complete a todo",
  "steps": [
    { "action": "goto", "caption": "The todo app opens to an empty list." },
    { "action": "fill", "selector": "[data-new-todo]", "value": "Buy groceries", "caption": "Typing the first todo into the input." },
    { "action": "click", "selector": "[data-add]", "caption": "First todo added to the list.", "label": "Add" },
    { "action": "click", "selector": "[data-todo] [data-toggle]", "caption": "First todo marked complete.", "label": "Mark complete" }
  ]
}
```

Write the scenario to a file (e.g. `scenario.json`) and show it to the user before running if
the workflow is non-trivial.

## Step 3 — Capture

Run the engine:

```
npx cueframe capture <url> --scenario scenario.json --out <dir>/spec.json
```

(Use `--viewport 1280x800`, `--title`, `--app` as needed. Drop `--scenario` to let the engine
use the app's embedded scenario or a generic auto-explore fallback.)

The engine writes `spec.json` and the frame screenshots under `<dir>/frames/`, and it
**refuses to write a defective spec** — if any golden frame fails the §3.1 contract it throws,
so a successful run is already clean.

## Step 4 — Verify

Always validate before declaring success:

```
npx cueframe validate <dir>/spec.json
```

Confirm **zero schema errors and zero capture defects**, and that there are at least a handful
of golden frames, each with a real caption, a non-empty axDigest, and at least one real box.
If validation reports defects, your steps landed on empty/ambiguous states — adjust the
scenario (add waits, caption different states, reference the result elements) and re-capture.

## Step 5 — Hand off

State, in one line, what you captured ("7 golden frames from the todo workflow, validated
clean"). Then point the user at the next acts:

- Author callouts conversationally with the **cueframe-callouts** skill.
- Preview locally with `npx cueframe play <dir>/spec.json`.
- Export with `npx cueframe export <dir>/spec.json --format html|mp4|gif`.

## Guardrails

- Never invent selectors. Every selector in a step must resolve in the running app.
- Prefer stable selectors (`[data-*]`, `id`, role) so the captured `boxes` are clean and the
  callout skill can auto-anchor to them.
- One workflow per spec (GOAL.md §7) — do not branch or capture multiple flows into one spec.
- Keep captions plain and literal. They are descriptions of what happened, not marketing.
