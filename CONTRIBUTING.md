# Contributing to Cueframe

Thanks for helping. Cueframe is a small, dependency-lean TypeScript codebase organized around
one contract (`spec.json`) and three acts (capture, author, play/export).

## Setup

```
npm install
npx playwright install chromium   # capture + export + browser tests need Chromium
npm run build
```

MP4/GIF export and the video tests also need [`ffmpeg`](https://ffmpeg.org/) on your `PATH`.

## The loop

```
npm run typecheck     # tsc --noEmit, strict
npm test              # vitest: unit + browser (capture/player/export) tests
npm run acceptance    # end-to-end §6 gate; regenerates examples/golden/
```

All three must be green before a change lands. CI (`.github/workflows/ci.yml`) runs typecheck,
build, and tests on every push.

## Where things live

| Area | Path | Notes |
| --- | --- | --- |
| Spec contract | `src/spec/` | Types + runtime validator. **Change carefully** — everything imports this. |
| Capture (Showrunner) | `src/capture/` | Playwright-driven; `digest.ts` builds the §3.1 `axDigest`/`boxes`. |
| Callout authoring | `src/callout/` | `resolve.ts` (NL → frame/anchor/copy) + `edit.ts` (immutable edits). |
| Player | `src/player/` | `timeline.ts` (pure model), `runtime.ts` (self-contained browser JS), `template.ts`. |
| Exporters | `src/export/` | `html.ts` (inline everything), `video.ts` (headless player → ffmpeg). |
| CLI | `src/cli.ts` | The four verbs. |
| Sample app | `examples/todo-app/` | The canonical capture target; ships an embedded capture scenario. |
| Plugin | `plugin/` | Claude Code skills + slash commands. |

## Ground rules

- **The spec is the contract.** If you change `src/spec/`, update the validator, its tests,
  and every consumer. Keep schema errors and capture defects as separate failure classes
  (GOAL.md §3.1, §6.3).
- **Capture quality is load-bearing.** Every golden frame needs a real caption, a non-empty
  axDigest, and at least one real box. The validator enforces it; don't weaken it.
- **Keep the core framework-light.** The HTML export inlines the player into one file, so the
  player and spec/callout libraries must stay dependency-free. Only `capture` and the video
  exporter may use Playwright; only the video exporter shells out to ffmpeg.
- **Test every component.** New behavior ships with a test. Prefer fast unit tests; browser
  tests should use short, deterministic fixtures.
- **Read `meta.voice`, never hardcode tone.** Callout copy honors the spec's effective voice.
- **Stay in scope.** See GOAL.md §7. No visual editor, no hosted service, no databases, one
  workflow per spec.

## Conventions

- ESM throughout; relative imports use the `.js` extension (e.g. `../spec/index.js`).
- `strict` + `noUncheckedIndexedAccess` are on — handle possibly-undefined access.
- Commit messages: short imperative subject, body explaining the *why* for non-obvious changes.
