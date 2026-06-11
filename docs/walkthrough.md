# Walkthrough — the golden example

The golden example is the end-to-end artifact Cueframe produces from the bundled sample app.
It lives committed under [`examples/golden/`](../examples/golden/) and is regenerated
deterministically by `npm run acceptance`. This page walks through what it contains and how
each act produced it.

Regenerate it yourself (from a clean clone):

```
npm install && npx playwright install chromium && npm run build && npm run acceptance
```

Then open `examples/golden/demo.html` in a browser to watch the reel.

## Act 1 — Capture

`npm run acceptance` serves [`examples/todo-app/`](../examples/todo-app/) and runs the
Showrunner against it. The sample app ships an embedded capture scenario
(`window.__CUEFRAME_SCENARIO__`, mirrored in `cueframe.scenario.json`), so capture needs no
flags. The Showrunner drives the workflow and records **seven golden frames**, each with a
real caption, a searchable `axDigest`, and measured `boxes`:

| Frame | Caption |
| --- | --- |
| `f1` | The todo app opens to an empty list. |
| `f2` | Typing the first todo into the input. |
| `f3` | First todo added to the list. |
| `f4` | Second todo added, two items left. |
| `f5` | First todo marked complete. |
| `f6` | Filtered to active todos only. |
| `f7` | Cleared completed todos, one item remains. |

The resulting `examples/golden/spec.json` passes `cueframe validate` with **zero schema errors
and zero capture defects**. Each golden frame carries clean, stable box selectors
(`[data-add]`, `[data-todo]`, `[data-filter="active"]`, …) measured at capture time — these
are what the next act anchors to.

## Act 2 — Author callouts

Three callouts are authored from plain-English instructions, through the same `src/callout`
resolution engine the conversational **cueframe-callouts** skill drives — no manual JSON. Each
one resolves a frame from a description, auto-anchors to a real box selector, and drafts copy
in the spec's plain voice (no em-dashes):

| Callout | Frame | Anchor | Title |
| --- | --- | --- | --- |
| `c1` | `f2` (typing) | `[data-add]` | "Add a task fast" |
| `c2` | `f5` (completed) | the todo's toggle checkbox | "Check it off when done" |
| `c3` | `f6` (filtered) | `[data-filter="active"]` | "Filter to focus" |

For example, `c3` was resolved from *"filtered to show active items"* → frame `f6` (the only
frame whose caption mentions filtering), with the target phrase *"active filter"* → the
`[data-filter="active"]` box. The spec re-validates after every add/edit/remove.

## Act 3 — Play & Export

The player builds a deterministic timeline (each golden frame holds, then its callouts appear,
dwell, and leave) and renders frames with callouts anchored to their boxes. Three exports are
produced from the same spec:

- **`demo.html`** — one self-contained file. Every frame screenshot is inlined as a base64
  data URI and the player runtime is inlined too, so it opens and plays with no server and no
  external requests. Double-click it.
- **`demo.mp4`** — the player is rendered headless and screenshotted frame-by-frame across the
  timeline, then encoded with ffmpeg (H.264).
- **`demo.gif`** — the same frames, encoded as an animated GIF (two-pass palette for quality).

Each is verified by the acceptance gate (valid MP4 `ftyp` box, `GIF8` header, self-contained
HTML). That gate is the project's Definition of Done — see
[GOAL.md §6](../GOAL.md#6-definition-of-done-the-stop-gate).
