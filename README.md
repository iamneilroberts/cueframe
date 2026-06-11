# Cueframe

**Describe the demo, narrate the callouts, export the reel.** Cueframe is a conversational
demo creator. You point it at a running web app and tell it, in plain English, what workflow
to record. It drives the app and captures a reel of frames. Then you shape the demo by
talking: "call out the results around the middle," "make that pause longer," "drop the last
one." Cueframe resolves the exact frame, the exact anchor, and the copy for you. When the reel
looks right, it exports as a self-contained web page, an MP4, or a GIF.

Cueframe replaces screen recording and editing with describing the demo and narrating the
callouts. There are no timelines to fight, nothing to re-record over a typo, and no labels to
hand-place.

This is the general, open-source version of the engine. Clone it and demo your own app.

---

## The three acts

Cueframe is a pipeline of three acts over one artifact, [`spec.json`](#the-specjson-contract).

1. **Capture (the Showrunner).** Drive a running app with browser automation and record a
   workflow into a `spec.json` whose `frames[]` describe what happened. Each frame carries a
   real caption, a searchable accessibility digest, and measured element boxes.
2. **Author (callouts).** Edit the `callouts[]` by talking. You describe *what* to point at
   and *roughly where*; Cueframe resolves the exact frame, anchor, and copy. You never count
   frames or write JSON.
3. **Play and export.** A framework-light web player renders the reel: frames advance,
   callouts appear anchored to their elements, dwell, then leave. Exporters turn that into a
   self-contained HTML file, an MP4, and a GIF.

---

## Install

Cueframe ships two ways from one codebase.

### As an `npx` CLI (the engine)

```
npm install
npx playwright install chromium
npm run build
```

Then use the verbs:

```
npx cueframe capture <url> [--out spec.json] [--scenario steps.json] [--viewport 1280x800]
npx cueframe play <spec.json> [--port 5180] [--open]
npx cueframe export <spec.json> --format html|mp4|gif [--out demo.html]
npx cueframe validate <spec.json>
```

Exporting MP4 or GIF needs [`ffmpeg`](https://ffmpeg.org/) on your `PATH`.

### As a Claude Code plugin (the conversational acts)

The `plugin/` directory is an installable Claude Code plugin with two skills and two slash
commands:

- **cueframe-capture** (`/cueframe-capture`), the Showrunner. "Record adding a todo and
  completing it."
- **cueframe-callouts** (`/cueframe-callout`), callout authoring. "Add a callout for the
  results board around frame 6, make it pause longer."

Point your plugin config at this repo's `plugin/` directory (it holds
`.claude-plugin/plugin.json`). The skills call the same core libraries the CLI does.

---

## Quickstart: reproduce the golden example

From a clean clone, one command captures the bundled sample app, authors three callouts,
exports all three formats, and verifies every acceptance check:

```
npm install
npx playwright install chromium
npm run build
npm run acceptance
```

`npm run acceptance` writes the full golden example to `examples/golden/` (`spec.json`,
`frames/`, `demo.html`, `demo.mp4`, `demo.gif`) and prints a PASS or FAIL line for each check
in [the Definition of Done](GOAL.md#6-definition-of-done-the-stop-gate). It is deterministic
and edits no JSON by hand. The callouts are authored from plain-English instructions through
the same `src/callout` engine the conversational skill drives.

Open `examples/golden/demo.html` in any browser to watch the reel.

### The same, step by step

```
# 1. Serve the sample app (terminal A)
npm run sample                       # http://localhost:5173

# 2. Capture a spec (terminal B)
npx cueframe capture http://localhost:5173 --out demo/spec.json
npx cueframe validate demo/spec.json # zero schema errors, zero capture defects

# 3. Author callouts. Talk to the cueframe-callouts skill in Claude Code, e.g.
#    "add a callout for the add button while the first todo is being typed"
#    "point a callout at the active filter near the end, title it 'Filter to focus'"

# 4. Export
npx cueframe export demo/spec.json --format html --out demo/demo.html
npx cueframe export demo/spec.json --format mp4  --out demo/demo.mp4
npx cueframe export demo/spec.json --format gif  --out demo/demo.gif
```

See [`docs/walkthrough.md`](docs/walkthrough.md) for an annotated tour of the golden example.

---

## The `spec.json` contract

`spec.json` is the single source of truth that flows through all three acts. It is defined
once in [`src/spec/`](src/spec/) (TypeScript types plus a runtime validator) and validated
everywhere.

```jsonc
{
  "meta": { "title", "app", "createdAt", "viewport": { "w", "h" }, "voice"? },
  "frames": [
    {
      "id": "f6", "n": 6, "kind": "golden" | "raw", "img": "frames/f6.png",
      "caption": "what happened on this frame",
      "axDigest": "searchable DOM/AX summary",
      "boxes": [ { "selector": "[data-board]", "rect": { "x","y","w","h" }, "label"? } ],
      "action"?: { "label", "selector" }
    }
  ],
  "callouts": [
    { "id": "c1", "frame": "f6", "anchor"?: { "selector"? | "rect"? },
      "eyebrow"?, "title", "body"?, "dwellMs"?, "style"?: "card" | "spotlight" | "arrow" }
  ]
}
```

**Capture quality is a hard contract, not best-effort.** `caption`, `axDigest`, and `boxes`
are the fields semantic frame resolution and auto-anchoring stand on. Every *golden* frame
must have a real caption, a non-empty axDigest, and at least one real box (a selector and a
pixel rect). `cueframe validate` reports violations as **capture defects**, kept separate from
schema errors, so a thin capture fails loudly instead of quietly degrading the callout step.

### Voice is configurable

Callout copy defaults to plain sentences, no em-dashes, written like a person labeling a
screen. That default lives in `meta.voice` (`style: "plain"`, `allowEmDash: false`), and the
callout skill reads `meta.voice` instead of hardcoding the rule, so a team can set its own
house voice. When `meta.voice` is absent, the plain default applies.

---

## Why Playwright for capture?

The capture engine uses [Playwright](https://playwright.dev/) (Chromium). It is scriptable
without Claude Code, so `npx cueframe capture` runs in CI and from a plain shell. It is
deterministic and headless. And it exposes the two APIs the capture-quality contract depends
on: `boundingBox()` for pixel-accurate `boxes`, and DOM and accessibility introspection for
the `axDigest`. The conversational Showrunner skill can also
use the chrome-devtools MCP for interactive discovery, but the engine itself stays on
Playwright so any capture reproduces outside a Claude Code session.

---

## Layout

```
src/spec/      Canonical spec.json types + runtime validator (the contract)
src/capture/   Showrunner: Playwright-driven capture into spec.json (rich frames)
src/callout/   Callout edit library: NL frame/anchor/copy resolution + immutable edits
src/player/    Framework-light web player (timeline + self-contained runtime)
src/export/    Exporters: self-contained HTML, MP4, GIF
src/cli.ts     The cueframe CLI (capture / play / export / validate)
src/acceptance.ts  One-command acceptance gate + golden-example generator
examples/todo-app/  The bundled sample capture target (npm run sample)
examples/golden/    The committed golden example (regenerable via npm run acceptance)
plugin/        Claude Code plugin: capture + callout skills, slash commands
```

Run `npm test` (unit and browser tests), `npm run typecheck`, and `npm run acceptance` (the
end-to-end gate). See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT. See [`LICENSE`](LICENSE).
