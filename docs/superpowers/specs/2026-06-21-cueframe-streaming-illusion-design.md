# Cueframe streaming-illusion reel — design

_Date: 2026-06-21 · Status: design approved, pre-plan_

## Problem

We want to record a new Voygent demo by driving a **real, logged-in claude.ai
session** (the live Claude chat interface, plus the folio MCP app widget) and
turn it into a reel. Cueframe today is genuine Playwright automation, but it
captures **discrete screenshots at step boundaries** and plays them as hard cuts
with pop-in callouts. That model cannot show the things that make a Claude
session feel alive: the prompt being typed, the wait before the first token, and
the answer streaming in.

True continuous video (Playwright `recordVideo` / CDP screencast) was considered
and deferred: it makes pacing the model's, makes every take one-shot, and throws
away cueframe's annotation layer. See the conversation that produced this spec.

This spec keeps the **still-frame reel** model and adds techniques that **hide
the lack of streaming**, so a sequence of real screenshots reads as a live
session.

## Decisions (locked during brainstorming)

1. **Output target: both** an exported video (mp4/gif) **and** the self-contained
   standalone HTML reel. Both derive from the same player runtime, so all motion
   lives in the runtime as a pure function of `ms`; nothing is ported into the
   demo's React player.
2. **Motion approach: hybrid.** Real burst-captured streaming is the backbone;
   synthetic polish covers the seams. The synthetic layer never invents words.
3. **Drive mode: cueframe drives.** The scenario types each prompt and clicks
   send against the logged-in claude.ai, so cueframe knows the prompt text (exact
   typewriter) and controls burst timing. Re-runnable: re-run to reshoot.

### Honesty stance

The streaming backbone is **real pixels** — real claude.ai, Claude's real words,
real stream timing. The synthetic layer only adds *motion*: it replays text we
actually typed (typewriter), generic thinking dots (bridge), opacity blends
(crossfade), and a subtle drift. No fabricated content. This preserves the
project's "honest framing" rule — it is a real recording with presentation
polish, not a scripted simulation claiming to be live.

## Architecture

All changes are additive and backward-compatible, across cueframe's three
existing layers. The new principle: **motion math lives in `timeline.ts`
(real TS, unit-tested) as precomputed windows with absolute `ms` boundaries; the
`runtime.ts` string stays a dumb interpolator** that lerps between them. This
mirrors the existing split (timeline = tested pure model, runtime = renderer) and
keeps the hard-to-test string blob thin.

```
CAPTURE (src/capture/)      drive logged-in claude.ai, sample real streaming
  ├─ session.ts   [new]     logged-in BrowserContext (real Chrome profile)
  ├─ scenario.ts  [extend]  new steps: waitForIdle, burst; record typed text
  └─ burst.ts     [new]     "screenshot every ~150ms until stream idle" loop

SPEC (src/spec/)            carry motion metadata through the contract
  ├─ types.ts     [extend]  optional: typed{}, transition, group; stream-kind frames
  └─ validate.ts  [extend]  exempt stream/burst frames from the golden contract

PLAYER (src/player/)        deterministic motion, pure function of ms
  ├─ timeline.ts  [extend]  precompute motion windows (transition/typewriter/bridge/burst)
  └─ runtime.ts   [extend]  render windows: crossfade, typewriter, thinking-dots, drift

EXPORT (src/export/)
  └─ video.ts     [extend]  default fps ~30 so crossfade/typing read smoothly
```

### Determinism guard (non-negotiable)

The headless recorder calls `renderAt(ms)` at fixed intervals, so **every visual
must be a pure function of `ms`**: crossfade blend, typewriter substring, caret
blink, thinking-dots pulse, and drift transform. No `Math.random`, no
`Date.now`, no rAF-derived state inside the render path. The existing runtime
already separates the pure `renderAt` from the rAF clock that only advances
`currentMs`; we keep all new motion inside `renderAt`.

## The five techniques

| Seam in a real session | Technique | Real / synthetic | Implemented in |
|---|---|---|---|
| Your prompt appearing | **Typewriter overlay** — text we typed, drawn char-by-char over the real empty-input screenshot, with a blinking caret | synthetic motion, real words | timeline window + runtime overlay |
| Send → first token gap | **Thinking bridge** — generic pulsing dots over the response region for a fixed beat | synthetic, generic | timeline window + runtime overlay |
| Claude streaming the answer | **Burst capture** — real screenshots every ~150ms while it generates, played as a fast flipbook | 100% real pixels | capture/burst.ts → stream-kind frames |
| Hard cut between states | **Crossfade** — ~300ms opacity blend between consecutive frames (2nd img layer) | synthetic transition | timeline window + runtime |
| Frozen held frames | **Ken Burns drift** — subtle scale/translate while a frame holds | synthetic, subtle | runtime transform |

## Components

### 1. `capture/session.ts` (new)

Single purpose: produce a logged-in `BrowserContext`.

- `chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: false })`.
- Headed + real Chrome channel (not bundled Chromium) to minimize bot-detection
  friction on the user's own account.
- Operator logs into claude.ai once in `profileDir`; cueframe reuses it on every run.
- CLI: `--profile <dir>`. (A `--storage-state <file>` variant is a possible
  fallback but not required for v1.)
- Existing fresh-context capture path stays the default when `--profile` is absent,
  so current scenarios are unaffected.

### 2. `capture/scenario.ts` (extend)

New step types alongside the existing `goto/fill/click/press/waitFor/snapshot`:

- **`waitForIdle`** — wait until streaming completes. Detection is
  belt-and-suspenders because claude.ai selectors are obfuscated:
  1. the send/stop button toggles back to "send" state, AND
  2. the last assistant message DOM stops mutating for a stable window (~600ms).
  Configurable selectors + stable-window ms.
- **`burst`** — after an action (typically send), delegate to `capture/burst.ts`:
  sample every `intervalMs` (~150ms) until `waitForIdle` fires or a `maxMs` cap.
- **typed-text recording** — when a step fills the chat input, record
  `{ selector, text }` onto the resulting frame so the player can replay it as a
  typewriter. (The fill still sets the value; we additionally persist the text.)

### 3. `capture/burst.ts` (new)

The sample-while-streaming loop. Loops: `page.screenshot()` every `intervalMs`,
push each as a **`stream`-kind** golden frame tagged with a `group` id, until the
idle condition is met or `maxMs` elapses. Stream frames carry a short per-frame
hold (matching the capture interval) and are exempt from the
caption/axDigest/boxes contract (they are motion, not narration anchors). One
caption may be attached to the group as a whole.

### 4. `spec/types.ts` + `spec/validate.ts` (extend)

Additive optional fields on `FrameRecord`:

- `typed?: { selector: string; text: string }` — text typed into an element on
  this frame, for typewriter replay.
- `transition?: "cut" | "crossfade"` — how to enter this frame (default
  crossfade; `cut` where a hard change is wanted).
- `group?: string` — burst-group id; consecutive same-group frames play fast as
  a flipbook rather than holding.

The `FrameRecord.kind` union (`"golden" | "raw"`) gains `"stream"` for burst
frames: like `golden` they appear in exports, but they are **exempt** from the
golden-frame caption/axDigest/boxes hard contract. `validate.ts` enforces the
exemption so burst frames don't trip the capture-quality validator, while
`golden` frames keep their full contract and `raw` frames stay export-excluded.
`goldenFrames()` (the export selector in `spec/types.ts`) must be widened to
include `stream` frames in playback order.

Optional `meta.motion` defaults block (all overridable per frame): crossfade ms,
typewriter cps, bridge ms, drift amount.

### 5. `player/timeline.ts` (extend)

`buildTimeline` gains precomputed **motion windows** per segment, each with
absolute `ms` boundaries:

- **transition window** at segment start: `{ startMs, endMs, fromFrameId }` for
  the crossfade blend (skipped when `transition: "cut"` or no previous frame).
- **typewriter window**: when the frame has `typed`,
  `{ startMs, endMs, selector, text }` placed before the hold; char count =
  `floor(progress * text.length)`.
- **bridge window**: a synthetic thinking-dots interval inserted between a
  send frame and the first stream frame of the following group.
- **burst pacing**: frames sharing a `group` get a short fixed per-frame hold
  and hard cuts between them (they are the animation); the group as a whole acts
  as one streaming beat.

All of this is pure and unit-tested. The existing hold + callout model is
preserved for ordinary golden frames.

### 6. `player/runtime.ts` (extend)

A dumb interpolator over the timeline windows. Additions:

- **Crossfade:** a second `<img>` layer; blend opacity between previous and
  current frame across the transition window (factor from `ms`).
- **Typewriter:** a positioned text element over the input box rect, showing the
  `typed.text` substring for the current `ms`, plus a deterministic blinking
  caret (`floor(ms/500) % 2`). It overlays the real empty-input screenshot; at
  window end the reel cuts to the screenshot of the filled/sent state.
- **Thinking bridge:** a pulsing 3-dot overlay over the response region during
  the bridge window (pulse phase from `ms`).
- **Ken Burns drift:** a subtle `transform: scale()/translate()` on the frame
  image as a function of segment progress, so held frames never sit dead-still.

### 7. `export/video.ts` (extend)

Default fps raised to ~30 so crossfades and typing read smoothly. The recorder
still screenshots `renderAt(ms)` at `1000/fps` intervals → ffmpeg. Total
`durationMs` grows (typewriter + bridges + bursts) but the pipeline is otherwise
unchanged.

## Data flow

```
scenario.json (drives claude.ai; records typed text + burst groups)
   → spec.json (frames + motion metadata; stream-kind burst frames)
      → timeline (precomputed motion windows, absolute ms)
         → runtime renderAt(ms)
            ├─ (a) standalone HTML (autoplay loop / scrubbable)
            └─ (b) headless recorder screenshots renderAt @30fps → ffmpeg → mp4/gif
```

## Testing

- **timeline.ts** — unit tests for motion-window math: transition boundaries,
  typewriter char progression, bridge insertion, burst pacing. All pure.
- **validate.ts** — tests for the stream-frame exemption (burst frames pass
  without caption/axDigest/boxes; golden frames still require them).
- **scenario.ts** — fixture-driven tests for the new step types
  (`waitForIdle`, `burst`, typed-text recording), like the existing
  `scenario.test.ts`.
- **Manual** — the live claude.ai drive and the perceived "liveness" of a take
  are verified by watching a recording; no automated check for that.

## Defaults (overridable)

| Setting | Default |
|---|---|
| crossfade | 300 ms |
| typewriter speed | ~45 cps |
| thinking bridge | ~900 ms |
| burst interval | 150 ms |
| Ken Burns drift | +3% scale over hold |
| export fps | 30 |

## Known constraints / risks

1. **claude.ai selectors are unstable/obfuscated** (input, send/stop button,
   message container). Pinned in one place; the primary maintenance fragility.
   Recovery path is re-pinning + re-recording.
2. **The folio MCP widget is a cross-origin iframe.** Burst capture grabs its
   pixels fine, but callouts pointing *inside* the widget must use manual `rect`s,
   not selectors (we cannot read its DOM). Matches the "spike the iframe
   boundary" note in the existing live-reel plan.
3. **Bot-detection / ToS** — we drive the operator's own logged-in account,
   headed, with the real Chrome channel, to stay well within normal-use behavior.
4. **Take quality is one-shot per content** — re-running reshoots cleanly
   (repeatable drive), but a take where Claude says something off-brand requires
   a re-record, same as real video production.

## Out of scope (v1)

- True continuous video (`recordVideo` / CDP screencast) — deferred; revisit only
  if still-frame liveness proves insufficient.
- Synthetic streaming of the *response* text as an overlay — the real burst
  capture covers this faithfully; overlay reconstruction risks font/layout drift
  vs real claude.ai pixels.
- Porting motion into the demo's in-app React reel player — not needed given the
  both-outputs decision.
- `--storage-state` cookie-import auth path (persistent profile is sufficient).
