#!/usr/bin/env node
/**
 * Build a showcase example: capture a real site, author callouts from plain-English
 * instructions, and export demo.html / demo.mp4 / demo.gif into examples/<name>/.
 *
 *   node dist/examples.js saucedemo
 *
 * These examples point at live third-party sites, so a re-run needs network access and may
 * need its scenario updated if the site changes its markup. The committed artifacts are a
 * snapshot. The deterministic, CI-backed example is the bundled todo app (npm run acceptance).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { capture } from "./capture/index.js";
import type { Scenario } from "./capture/index.js";
import { addCallout, resolveFrame, resolveAnchor, draftCopy } from "./callout/index.js";
import { exportHtml, exportMp4, exportGif } from "./export/index.js";
import { writeSpec } from "./io.js";
import { validateSpec, goldenFrames, formatValidation, type Spec, type CalloutAnchor } from "./spec/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

interface CalloutSpec {
  frameRef: string;
  targetPhrase: string;
  title: string;
}
interface ExampleConfig {
  url: string;
  title: string;
  app: string;
  dir: string; // relative to repo root
  callouts: CalloutSpec[];
}

const EXAMPLES: Record<string, ExampleConfig> = {
  saucedemo: {
    url: "https://www.saucedemo.com/",
    title: "SauceDemo checkout",
    app: "saucedemo.com (Swag Labs)",
    dir: "examples/saucedemo",
    callouts: [
      { frameRef: "the product catalog loads after sign in", targetPhrase: "add to cart backpack", title: "Add to the cart without leaving the page" },
      { frameRef: "reviewing the cart before checkout", targetPhrase: "checkout button", title: "Review the cart, then check out" },
      { frameRef: "order confirmed thank you for your order", targetPhrase: "thank you for your order", title: "Order confirmed in three steps" },
    ],
  },
};

/** Resolve a frame from plain English; on ambiguity take the top candidate (deterministic). */
function authorCallout(spec: Spec, c: CalloutSpec): Spec {
  const fr = resolveFrame(spec, c.frameRef);
  const frameId =
    fr.kind === "resolved" ? fr.frame.id : fr.kind === "ambiguous" ? fr.candidates[0]!.id : undefined;
  if (!frameId) throw new Error(`could not resolve a frame for "${c.frameRef}"`);
  const a = resolveAnchor(spec, frameId, c.targetPhrase);
  const anchor: CalloutAnchor | undefined =
    a.kind === "selector" ? { selector: a.selector } : a.kind === "rect" ? { rect: a.rect } : undefined;
  const copy = draftCopy(spec, frameId, c.title);
  return addCallout(spec, { frame: frameId, anchor, title: c.title, body: copy.body, dwellMs: 3000 }).spec;
}

async function build(name: string): Promise<void> {
  const cfg = EXAMPLES[name];
  if (!cfg) {
    console.error(`Unknown example "${name}". Known: ${Object.keys(EXAMPLES).join(", ")}`);
    process.exit(2);
  }
  const outDir = join(repoRoot, cfg.dir);
  const scenario = JSON.parse(await readFile(join(outDir, "cueframe.scenario.json"), "utf8")) as Scenario;

  // Clear prior capture output (keep the committed scenario file).
  await rm(join(outDir, "frames"), { recursive: true, force: true });
  for (const f of ["demo.html", "demo.mp4", "demo.gif", "spec.json"]) {
    await rm(join(outDir, f), { force: true });
  }

  console.log(`Capturing "${cfg.title}" from ${cfg.url} ...`);
  const { spec: captured } = await capture({ url: cfg.url, outDir, scenario, title: cfg.title, app: cfg.app, headless: true });

  let spec = captured;
  for (const c of cfg.callouts) spec = authorCallout(spec, c);

  const v = validateSpec(spec);
  if (!v.valid) throw new Error(`Example spec is invalid:\n${formatValidation(v)}`);
  await writeSpec(join(outDir, "spec.json"), spec);

  console.log("Exporting html / mp4 / gif ...");
  await exportHtml(spec, { framesDir: outDir, outPath: join(outDir, "demo.html") });
  await exportMp4(spec, { framesDir: outDir, outPath: join(outDir, "demo.mp4"), fps: 12 });
  await exportGif(spec, { framesDir: outDir, outPath: join(outDir, "demo.gif"), fps: 12 });

  const anchored = spec.callouts.filter((c) => c.anchor?.selector).map((c) => c.anchor!.selector);
  console.log(`Done: ${cfg.dir}`);
  console.log(`  ${goldenFrames(spec).length} golden frames, ${spec.callouts.length} callouts`);
  console.log(`  anchors: ${anchored.join(", ")}`);
}

build(process.argv[2] ?? "")
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
