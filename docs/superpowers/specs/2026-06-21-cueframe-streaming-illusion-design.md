# Cueframe streaming-illusion reel — design

_Date: 2026-06-21 · Status: design approved (revised after external review), pre-plan_

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
away cueframe's annotation layer.

This spec keeps the **still-frame reel** model and adds techniques that **hide
the lack of streaming**, so a sequence of real screenshots reads as a live
session.

## Decisions (locked during brainstorming)

1. **Output target: both** an exported video (mp4/gif) **and** the self-contained
   standalone HTML reel. Both derive from the same player runtime, so all motion
   lives in the runtime as a pure function of `ms`; nothing is ported into the
   demo's React player.
2. **Motion approach: hybrid.** Real burst-captured streaming is the backbone;
   synthetic touches cover the seams. The synthetic layer never invents words.
3. **Drive mode: cueframe drives.** The scenario types each prompt and clicks
   send against the logged-in claude.ai. Re-runnable: re-run to reshoot.

### Key revision after external (Codex) review

The first draft under-specified two things and over-reached on a third. The
revised design:

- **Real over synthetic, harder.** The prompt-typing is now **burst-captured for
  real** (sample screenshots while Playwright types), using Claude's real
  composer font/layout. The synthetic typewriter overlay is demoted to an
  **optional fallback**, only if real-typing capture proves insufficient. This
  deletes the most fragile component (pixel-matching a contenteditable composer).
- **Motion is opt-in and identity-by-default.** "Pure function of `ms`" is
  necessary but not sufficient: any new motion (crossfade, drift, a second image
  layer, higher fps) would change the rendered output of the *existing* golden
  example and break the byte-identical acceptance gate. So motion is **off by
  default**; specs without motion metadata render pixel-identical to today.
- **Playback vs authoring are separated.** `goldenFrames()` stays the rich,
  callout-addressable set; a new `playbackFrames()` drives export/HTML and
  includes stream frames. Stream frames never pollute callout/frame resolution.

### Honesty stance

The streaming backbone is **real pixels** — real claude.ai, Claude's real words,
real stream timing, and (now) real typing. The only synthetic touches are
*motion between real frames*: generic thinking dots (bridge), opacity blends
(crossfade), and an optional subtle drift. No fabricated content. Preserves the
project's "honest framing" rule — a real recording with presentation polish, not
a scripted simulation claiming to be live.

## Architecture

All changes are additive and backward-compatible across cueframe's existing
layers. Core principle: **motion math lives in `timeline.ts` (real TS,
unit-tested) as precomputed windows with absolute `ms` boundaries; the
`runtime.ts` string stays a dumb interpolator** that lerps between them. This
mirrors the existing split (timeline = tested pure model, runtime = renderer).

```
CAPTURE (src/capture/)      drive logged-in claude.ai, sample real streaming
  ├─ session.ts   [new]     logged-in BrowserContext (real Chrome profile)
  ├─ scenario.ts  [extend]  new steps: waitForIdle, burst (typing + streaming)
  └─ burst.ts     [new]     "screenshot every ~Nms until idle" sampler

SPEC (src/spec/)            carry motion metadata through the contract
  ├─ types.ts     [extend]  kind gains "stream"; optional group/transition/typed;
  │                         NEW playbackFrames() selector; goldenFrames() unchanged
  └─ validate.ts  [extend]  stream frames exempt from caption/axDigest/boxes contract

PLAYER (src/player/)        deterministic motion, pure function of ms, OPT-IN
  ├─ timeline.ts  [extend]  precompute motion windows (transition/bridge/burst pacing)
  └─ runtime.ts   [extend]  render windows: flipbook, crossfade, thinking-dots, drift

EXPORT (src/export/)
  ├─ html.ts      [extend]  use playbackFrames(); stream frames as JPEG; size cap/warn
  └─ video.ts     [extend]  use playbackFrames(); per-spec fps (default unchanged)
```

### Compatibility & determinism (non-negotiable)

1. **Identity-by-default.** A spec with no `meta.motion` and no per-frame motion
   fields MUST render byte-identical to today (single image, hard `src` swaps,
   pop-in callouts). The existing golden example carries no motion metadata, so
   the CI acceptance gate (`src/acceptance.ts`, established in `ba1ff98`) stays
   green untouched. New behavior activates only when motion metadata is present.
2. **Pure function of `ms`.** Every visual is computed from `ms`: flipbook frame
   selection, crossfade blend, thinking-dots pulse, drift transform. No
   `Math.random`, no `Date.now`, no rAF-derived state in the render path. (The
   runtime already separates the pure `renderAt` from the rAF clock that only
   advances `currentMs`.)
3. **Live captures stay out of the byte-identical gate.** Burst-captured
   claude.ai frames are inherently non-reproducible (different words/timing per
   run), so they are never part of byte-identical acceptance. Deterministic
   acceptance for the new motion features uses a **fixed local stream fixture**
   (a committed set of PNGs + a hand-authored spec with motion metadata), so
   flipbook/crossfade/bridge/drift are tested for byte-identical render without
   any live capture.
4. **Default fps unchanged.** Export fps stays at the current default (12) so the
   golden example is unaffected. Motion-bearing specs may request a higher fps
   per-spec (e.g. `meta.motion.fps = 30`); the flag does not change old specs.

## The techniques

Backbone (real pixels) vs opt-in polish (synthetic motion between real frames):

| Seam | Technique | Real / synthetic | Default |
|---|---|---|---|
| Your prompt appearing | **Real typing burst** — sample screenshots while Playwright types into the real composer; played as a flipbook | 100% real pixels | backbone |
| Claude streaming the answer | **Streaming burst** — sample every ~150ms while it generates; flipbook | 100% real pixels | backbone |
| Send → first token gap | **Thinking bridge** — generic pulsing dots over the response region for a fixed beat | synthetic, generic | opt-in |
| Hard cut between states | **Crossfade** — opacity blend between consecutive frames (2nd, preloaded img layer) | synthetic transition | opt-in |
| Frozen held frames | **Ken Burns drift** — subtle scale/translate while a frame holds | synthetic, subtle | opt-in, off when a callout/overlay is active (see §6) |
| _(fallback only)_ Prompt typing | **Synthetic typewriter** — overlay text over a captured input rect, using captured typography | synthetic motion, real words | only if real-typing burst is insufficient |

## Components

### 1. `capture/session.ts` (new)

Single purpose: produce a logged-in `BrowserContext`.

- `chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: false })`.
- Headed + real Chrome channel (not bundled Chromium) to minimize bot-detection
  friction on the operator's own account.
- Operator logs into claude.ai once in `profileDir`; cueframe reuses it.
- CLI: `--profile <dir>`. Existing fresh-context path stays the default when
  `--profile` is absent, so current scenarios are unaffected.

### 2. `capture/scenario.ts` (extend)

New step types alongside the existing `goto/fill/click/press/waitFor/snapshot`:

- **`waitForIdle`** — wait until streaming completes, using compound signals
  (selectors alone are too fragile on claude.ai):
  1. the **stop button disappears** (send/stop toggle), AND
  2. the **last assistant message's visible text stops growing** — track its text
     length/hash + bounding box, require stability for a **~2–3s** window (not
     600ms; Claude pauses mid-stream), AND
  3. a hard **`maxMs` timeout** as backstop.
  Prefer accessibility role/name signals over CSS selectors where available.
  Track the last assistant message specifically, not whole-page DOM mutations
  (background timers / widgets / virtualized lists mutate independently). Allow an
  explicit scenario override: "burst for max N ms, then wait for selector / text /
  manual snapshot."
- **`burst`** — sample via `capture/burst.ts`. Used in two places: while typing
  the prompt, and after send while Claude streams.

The capture-time determinism freeze (`*{caret-color:transparent;animation:none;
transition:none}`, from `ba1ff98`) still applies. Claude's streaming text is JS
DOM mutation, not CSS animation, so it is still captured; only CSS fades/caret
are frozen, which is what we want (the real caret is absent → the flipbook shows
text appearing without a flickering native caret).

### 3. `capture/burst.ts` (new)

Sample-while-changing loop: `page.screenshot()` (JPEG, quality ~80) every
`intervalMs`, push each as a **`stream`-kind** frame tagged with a `group` id,
until an idle condition is met or `maxMs` elapses. Hard **frame cap** per group
(e.g. 60) to bound output size; if hit, stop sampling and log a warning. Stream
frames carry a short per-frame hold (≈ `intervalMs`) and skip axDigest/boxes
(they are motion, not narration anchors). An optional caption attaches to the
group as a whole.

### 4. `spec/types.ts` + `spec/validate.ts` (extend)

- `FrameRecord.kind` union gains `"stream"`. Stream frames appear in **playback**
  but are exempt from the golden caption/axDigest/boxes contract.
- **New `playbackFrames(spec)`** = `golden + stream`, in `n` order — the
  export/HTML/video selector. **`goldenFrames(spec)` is unchanged** (the rich,
  callout-addressable, plain-English-resolvable set). Callout resolution and frame
  authoring keep using `goldenFrames()`, so stream frames never become callout
  candidates.
- Additive optional `FrameRecord` fields:
  - `group?: string` — burst-group id; consecutive same-group frames flipbook.
  - `transition?: "cut" | "crossfade"` — entry transition. **Absent = `"cut"`**
    (identity with today). Crossfade is never implied by default.
  - `typed?: { rect: Rect; text: string; type: TypographyHints }` — fallback
    typewriter data: a captured **rect** (not a selector — the player has no DOM)
    plus typography (font family/size/weight/line-height/padding/wrap-width/scroll).
    Only emitted when the fallback synthetic typewriter is used.
- Optional `meta.motion` block (absent = all motion off): `{ crossfadeMs?,
  bridgeMs?, drift?, fps?, typewriterCps? }`. Presence is what opts a spec into
  motion; the existing golden example omits it and is unaffected.
- `validate.ts` enforces the stream-frame exemption and that `golden`/`raw`
  contracts are unchanged.

### 5. `player/timeline.ts` (extend)

`buildTimeline` gains precomputed **motion windows** per segment (absolute `ms`),
all **gated on motion metadata** so motion-free specs produce today's timeline:

- **transition window** at segment start `{ startMs, endMs, fromFrameId }` — only
  when the frame's effective `transition === "crossfade"`.
- **bridge window** — a thinking-dots interval, only when `meta.motion.bridgeMs`
  is set and a send→stream boundary exists.
- **burst pacing** — frames sharing a `group` get a short fixed per-frame hold and
  hard cuts between them (they are the animation). This works with or without
  `meta.motion` (the flipbook is the real backbone, not a "motion effect"), but
  uses per-frame `hold ≈ intervalMs` from capture.
- **(fallback) typewriter window** — only when a frame has `typed`.

Pure and unit-tested. The existing hold + callout model is preserved for ordinary
golden frames.

### 6. `player/runtime.ts` (extend)

Dumb interpolator over the timeline windows. Additions, each no-op when its window
is absent:

- **Flipbook:** select the active stream frame in a group by `ms` (hard cuts).
  Reuses the single `<img>`; no new layer needed for the backbone.
- **Crossfade:** a **second, preloaded `<img>` layer**. Because export calls
  `renderAt(ms)` then screenshots synchronously, the runtime must **preload/decode
  both frames before the transition window is rendered** (e.g. eager-decode
  upcoming frame images; gate readiness like the existing `__CUEFRAME_READY__`
  signal). Blend opacity from `ms`. Without crossfade metadata, the second layer
  is never created and frames hard-swap as today.
- **Thinking bridge:** a pulsing 3-dot overlay over the response region during
  the bridge window (pulse phase from `ms`).
- **Ken Burns drift:** subtle `transform` on the frame image as a function of
  segment progress. **Callout-safe:** either apply the same transform to the
  callout layer (so anchors track the image) **or** suppress drift whenever a
  callout/overlay is active in that segment. Default: suppress drift while
  callouts are visible (simpler, no anchor drift bugs).
- **(fallback) typewriter:** text element positioned by captured `rect` with
  captured typography, substring by `ms`. Only built when `typed` is present.

### 7. `export/html.ts` + `export/video.ts` (extend)

- Both switch from `goldenFrames()` to **`playbackFrames()`** so stream frames are
  included.
- **HTML size:** stream frames inline as **JPEG** (not PNG); enforce the
  per-group frame cap; if total inlined asset bytes exceed a threshold, **log a
  warning** with the size and frame count (burst PNGs every 150ms would otherwise
  explode the standalone file).
- **video fps:** default unchanged (12); honor `meta.motion.fps` per spec.
- Crossfade correctness depends on the runtime's preload gate (§6); the recorder
  must wait for it before screenshotting each transition frame.

## Data flow

```
scenario.json (drives claude.ai; typing burst + streaming burst groups)
   → spec.json (golden frames + stream-kind burst frames + optional motion meta)
      → timeline (precomputed motion windows, absolute ms; gated on motion meta)
         → runtime renderAt(ms)
            ├─ (a) standalone HTML  [playbackFrames(); JPEG stream frames]
            └─ (b) recorder screenshots renderAt → ffmpeg → mp4/gif  [playbackFrames()]
```

## Phasing (independently shippable)

Ordered by risk; ship the backbone before the polish.

1. **Spike: live claude.ai capture** _(highest risk, do first)_. Persistent
   profile, type prompt, burst screenshots of typing + streaming, `waitForIdle`
   detection. Output: PNGs/JPEGs to disk only, no spec integration. Proves the
   uncertain part — authenticated, changing third-party UI — before building on it.
2. **Spec contract.** `kind: "stream"`, validation exemption, `playbackFrames()`
   vs `goldenFrames()` split, export selectors switched, committed deterministic
   stream fixture (fixed PNGs + spec) + acceptance for it.
3. **Flipbook playback.** Stream groups play as hard-cut flipbooks. **This alone
   delivers most of the live-streaming illusion** and needs no synthetic motion.
4. **Opt-in motion.** Crossfade (with preload gate) → thinking bridge → drift
   (callout-safe). Each opt-in via `meta.motion`; old specs stay pixel-identical.
5. **Synthetic typewriter (fallback only).** Build only if the real-typing burst
   from phase 1 looks insufficient.

## Testing

- **timeline.ts** — unit tests for motion-window math: transition boundaries,
  bridge insertion, burst pacing, and that a motion-free spec yields today's
  timeline. All pure.
- **validate.ts** — stream-frame exemption; golden/raw contracts unchanged.
- **playbackFrames/goldenFrames** — stream frames included in playback, excluded
  from callout/authoring selection.
- **scenario.ts** — fixture-driven tests for `waitForIdle` and `burst`.
- **Determinism** — the committed stream fixture renders byte-identical mp4/HTML;
  the existing golden example acceptance is unchanged.
- **Manual** — the live claude.ai drive and perceived "liveness" are verified by
  watching a take; no automated check for that.

## Defaults (overridable; all motion OFF unless `meta.motion` present)

| Setting | Default |
|---|---|
| transition (per frame) | `cut` (identity with today) |
| crossfade (when enabled) | 300 ms |
| thinking bridge (when enabled) | ~900 ms |
| burst interval | 150 ms |
| burst frame cap per group | 60 |
| stream frame encoding | JPEG q≈80 |
| Ken Burns drift (when enabled) | +3% scale over hold, suppressed under callouts |
| export fps | 12 (unchanged); motion specs may set 30 |
| (fallback) typewriter speed | ~45 cps |

## Known constraints / risks

1. **claude.ai selectors are unstable/obfuscated** (composer, send/stop button,
   message container). Pinned in one place; primary maintenance fragility. Prefer
   role/name signals. Recovery: re-pin + re-record.
2. **The folio MCP widget is a cross-origin iframe.** Burst capture grabs its
   pixels fine, but callouts pointing *inside* it must use manual `rect`s, not
   selectors. Matches the "spike the iframe boundary" note in the live-reel plan.
3. **Bot-detection / ToS** — we drive the operator's own logged-in account,
   headed, with the real Chrome channel, within normal-use behavior.
4. **One-shot takes** — re-running reshoots cleanly, but a take where Claude says
   something off-brand requires a re-record, like real video production.
5. **Standalone HTML size** — burst frames inflate the self-contained file;
   mitigated by JPEG + per-group cap + size warning (§7).
6. **Crossfade preload** — synchronous screenshot-after-render means the second
   image layer must be decoded before the transition renders, or frames capture
   blank; handled by the runtime readiness gate (§6).

## Out of scope (v1)

- True continuous video (`recordVideo` / CDP screencast) — deferred; revisit only
  if still-frame liveness proves insufficient.
- Synthetic streaming of the *response* text as an overlay — real burst capture
  covers this faithfully.
- Porting motion into the demo's in-app React reel player.
- `--storage-state` cookie-import auth path (persistent profile is sufficient).
