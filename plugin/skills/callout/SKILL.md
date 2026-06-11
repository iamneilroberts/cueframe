---
name: cueframe-callouts
description: >
  Author and edit Cueframe demo callouts from natural language. Use whenever the
  user asks to add, move, reword, retime, re-anchor, or remove a callout / annotation /
  spotlight on a captured demo reel, e.g. "add a callout for the results board around
  frame 6", "make the pricing callout pause longer", "drop the third callout", "point the
  second callout at the Save button instead", "where does the confirmation screen show up?".
  Operates on a Cueframe spec.json and its indexed frame dataset. Do NOT use for the capture
  step (driving the app) or for building the player/exporters, only for editing callouts in
  an existing spec.
---

# Cueframe callout authoring

You edit `callouts` in a Cueframe `spec.json` from plain-English instructions. The whole
point of this skill: the user should never count frames or write JSON. They describe *what*
to point at and *roughly where* in the demo; you resolve the exact frame, the exact anchor,
and the copy, then write the edit.

The mechanism is the `src/callout` edit library (`resolve.ts` + `edit.ts`). You do not
hand-roll resolution, you call its functions, which are deterministic and keep the spec
valid after every operation. Treat this file as the contract for *how* to drive them.

## Data you work with

`spec.json` → `{ meta, frames: FrameRecord[], callouts: Callout[] }`.

- Each `FrameRecord` has: `id` (stable, e.g. `f6`), `n` (order), `kind` (`golden` | `raw`),
  `img`, `caption` (one-line "what happened"), `axDigest` (searchable DOM/AX summary), and
  `boxes: [{ selector, rect, label? }]` (the meaningful elements on that frame, with pixel
  rects). Only `golden` frames appear in exports; never bind a callout to a `raw` frame.
- A `Callout` is `{ id, frame: <id>, anchor?: { selector? | rect? }, eyebrow?, title, body?,
  dwellMs?, style? }`. `title` is required.

Never invent frame ids, selectors, or rects. Every reference you write must come from the
actual `frames` array in the loaded spec. The edit library enforces this, an anchor
`selector` is only ever written when it truly exists in the target frame's `boxes`.

## Step 1: Resolve the FRAME (which frame the callout binds to)

Hand the user's phrasing to `resolveFrame(spec, ref)`. It handles three forms, in priority:

1. **Exact / approximate number & position**: "frame 6", "around 6", "start" /
   "beginning", "middle", "end" / "near the end". For "around N", it prefers the exact
   golden frame `n === N`; otherwise the nearest golden frame. Fuzzy positions map to the
   first / median / last golden frame.
2. **Semantic description**: "the frame where pricing updates", "after they pick the
   plan", "the results board". It ranks frames by token overlap over
   `caption` + `axDigest` + box labels/selectors + `action.label`. "First time X appears"
   ties break to the earliest matching frame.
3. **Relative to an existing callout**: "right before the pricing callout", "the frame of
   the second callout", via `resolveRelativeToCallout(spec, ref)`.

`resolveFrame` returns `{ kind: "resolved", frame, reason }`, `{ kind: "ambiguous",
candidates }`, or `{ kind: "none" }`. If it returns **ambiguous**, do NOT guess silently.
List the top candidates (`n`, `caption`) and ask which. If it resolves cleanly, state which
frame id you chose and why (use `reason`, e.g. `frame f5 (n=5): "Pricing summary updates"`).

## Step 2: Resolve the ANCHOR (where on the frame the callout points)

Auto-anchoring is the point of this skill: prefer a real box `selector` over a manual rect.
Hand the user's target phrase to `resolveAnchor(spec, frameId, targetPhrase)`. It returns:

1. `{ kind: "selector", selector, reason }`, the phrase matched a real box (by selector
   text, `label`, or nearby `axDigest` tokens). Set `anchor.selector` to it; the player
   resolves the rect at render time. **Prefer this outcome.**
2. `{ kind: "suggestFrame", frameId, selector }`, no good box on this frame, but the
   element appears on an adjacent golden frame. Tell the user and offer to retarget there.
3. `{ kind: "rect", rect }`, only a manual rect is available; mention you used an
   approximate box.
4. `{ kind: "none" }`, no anchor. If the user just wants a floating note, omit `anchor`
   (the player parks the card). Otherwise ask for a clearer target.

## Step 3: Fill the COPY

Use `draftCopy(spec, frameId, hint?)` to draft a tight `title` (+ optional one-line `body`)
from the frame's `caption` / `axDigest` (and the user's `hint` if given). `title` is
required; `eyebrow` and `body` are optional. Keep them tight.

**Copy voice: read `meta.voice`, never hardcode the rule.** `draftCopy` already honors the
spec's effective voice via `effectiveVoice(spec)`:

- **Plain default** (no `meta.voice`, or `style: "plain"`, `allowEmDash: false`): plain
  sentences, no em-dashes (`—`) or en-dashes used as em, no over-polished marketing cadence.
  Write like a person labeling a screen. The library *guarantees* no `—`/`–` slips into the
  output under this voice.
- **A team's house voice**: if `meta.voice` sets `allowEmDash: true` or other hints, honor
  them. Read `meta.voice.notes` for freeform guidance.

If the user gives only a target ("callout the results"), draft from the frame and show the
title/body for confirmation rather than committing silently.

`dwellMs`: only set when the user asks. The player default is ~4000ms. Phrase resolution
(via `resolveDwell`): "longer" ≈ +50% of current, "much longer" ≈ +100%, "brief" / "quick"
≈ 1500ms; "6 seconds" / "2500ms" are taken literally. State the value you chose.

`style`: `card` is the default; use `spotlight` / `arrow` only when the user asks for
emphasis.

## Operations you support

All operations are immutable (they return a NEW spec) and re-validate the result, throwing
if an edit would introduce a schema error:

- **Add**: `addCallout(spec, args)`. Either explicit
  (`{ frame, anchor?, title, body?, eyebrow?, dwellMs?, style? }`) or NL-assisted
  (`{ frameRef?, targetPhrase?, titleHint? }`, which runs Steps 1–3). Generates the next
  free `c{n}` id and appends.
- **Edit**: `editCallout(spec, ref, patch)`: reword, restyle, retime, re-eyebrow, body
  (pass `body: null` / `eyebrow: null` to clear).
- **Remove**: `removeCallout(spec, ref)`.
- **Retime**: `retimeCallout(spec, ref, time)` where `time` is a number (ms) or a phrase;
  returns the chosen `dwellMs`.
- **Re-anchor**: `reanchorCallout(spec, ref, targetPhrase)`: re-resolve the anchor on the
  callout's frame, or surface a `suggestion` when the element is on an adjacent frame.
- **Move**: `moveCallout(spec, ref, frameRef)`: rebind to another frame; a selector anchor
  that no longer exists on the new frame is cleared.
- **Query**: `queryFrames(spec, query)`: "where does X happen?" → ranked golden frames
  (`n` + `caption`). No edit.

Identify an existing callout with a `CalloutRef`: `{ id }`, `{ ordinal: n }` (1-based, "the
third callout"), `{ frame: id }`, or `{ titleIncludes: string }`. `findCallout` resolves it.

## Validation (the library runs it for you)

Every operation runs `validateSpec` on the result and throws (with `formatValidation`
output) if it would introduce a schema error. Invariants it upholds:

- The `frame` id exists in `frames`.
- If `anchor.selector` is set, that selector exists in the target frame's `boxes`.
- Callout ids are unique (`c{n}` generation skips collisions).

Two advisory warnings (non-fatal, surface them to the user): two callouts on the same frame
(they queue) and a callout bound to a `raw` frame (it won't appear in exports). Prefer to
avoid both.

## Workflow

1. Read the `spec.json` (ask for its path if not given; default to the obvious one in the
   project). Work from `frames` metadata, do NOT load frame images.
2. Resolve frame → anchor → copy via the Step 1–3 functions.
3. State the resolution in one line, e.g. `Frame f5, anchored to [data-panel=pricing],
   title: "Live pricing"`. For a clear request, apply the edit and write the spec. For an
   ambiguous one (ambiguous frame, unclear target), confirm first.
4. Write `spec.json` back (only the `callouts` array changes; preserve the rest). Report the
   diff in plain terms, what was added/changed/removed and why.
5. If a Cueframe preview/player is running, note the user can scrub to that frame to verify;
   otherwise note the change is saved.

## Examples

- "add a callout for the results board around frame 6"
  → `resolveFrame` picks the golden frame, `resolveAnchor("the results board")` returns the
    board's box selector, `draftCopy` drafts the title/body, `addCallout` appends.
- "where do the search results first show up?"
  → `queryFrames("search results")` → answer "Frame f3 (n=3): 'Search results aggregate
    into a board'", no edit.
- "make the pricing callout pause a little longer"
  → `findCallout({ titleIncludes: "pricing" })`, `retimeCallout(..., "longer")` → state the
    new dwell (e.g. 6000ms).
- "the second callout points at the wrong thing, it should be the Save button"
  → `reanchorCallout({ ordinal: 2 }, "the Save button")`; if the button is on an adjacent
    frame, surface the `suggestion` and offer to move it there.
