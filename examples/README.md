# Examples

Two worked examples ship with the repo. Each was produced by the same pipeline: capture a
workflow, author callouts from plain-English instructions, export `demo.html` / `demo.mp4` /
`demo.gif`.

| Example | Command | Target | Output | What it shows |
| --- | --- | --- | --- | --- |
| `todo-app` (golden) | `npm run acceptance` | bundled sample app | `golden/` | The deterministic, CI-backed end-to-end run. Capture, three callouts, three exports, all checks. |
| `saucedemo` | `npm run example:saucedemo` | live saucedemo.com | `saucedemo/` | Capturing a real third-party checkout flow. Callouts auto-anchor to the site's own `#id` / `data-test` elements. |

The `todo-app` example uses the bundled app, so it reproduces byte-for-byte and runs in CI.
The `saucedemo` example points at a live site: the committed artifacts are a snapshot, and a
re-run needs network access and may need its `cueframe.scenario.json` updated if the site
changes its markup.

## Use it on your own app

You do not need a bundled app. Point the CLI at any running URL and pass a scenario describing
the workflow. A scenario is a short list of steps; a step with a `caption` becomes a frame in
the reel.

`my-scenario.json`:

```json
{
  "name": "Sign up and land on the dashboard",
  "steps": [
    { "action": "waitFor", "selector": "#email" },
    { "action": "snapshot", "caption": "The sign-up form." },
    { "action": "fill", "selector": "#email", "value": "ada@example.com" },
    { "action": "fill", "selector": "#password", "value": "hunter2" },
    { "action": "click", "selector": "#submit", "label": "Sign up" },
    { "action": "waitFor", "selector": "[data-dashboard]" },
    { "action": "snapshot", "caption": "The dashboard loads with the welcome panel." }
  ]
}
```

```
npx cueframe capture http://localhost:3000 --scenario my-scenario.json --out demo/spec.json
npx cueframe validate demo/spec.json
npx cueframe export demo/spec.json --format gif --out demo/demo.gif
```

Use stable selectors (`#id`, `[data-*]`, ARIA roles) so the captured boxes are clean and
callouts can auto-anchor to them. See [`saucedemo/cueframe.scenario.json`](saucedemo/cueframe.scenario.json)
for a complete real-world scenario.
