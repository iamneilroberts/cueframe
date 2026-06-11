#!/usr/bin/env node
/**
 * Cueframe acceptance gate + golden-example generator (GOAL.md §6 + D8).
 *
 * Run with `npm run acceptance` (after `npm run build`). It:
 *   1. Serves the bundled sample todo app on an ephemeral port.
 *   2. Captures a spec from it (the Showrunner reads the app's embedded scenario).
 *   3. Authors three callouts from plain-English-style instructions via the callout
 *      library (the same engine the conversational skill drives) — no manual JSON.
 *   4. Exports demo.html / demo.mp4 / demo.gif.
 *   5. Writes the whole golden example to examples/golden/ and asserts every §6 check.
 *
 * Exit code 0 iff all checks pass; non-zero otherwise.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFile, rm, stat } from "node:fs/promises";
import { capture } from "./capture/index.js";
import { addCallout, editCallout, removeCallout, resolveFrame, resolveAnchor, draftCopy } from "./callout/index.js";
import type { CalloutAnchor } from "./spec/index.js";
import { exportHtml, exportMp4, exportGif } from "./export/index.js";
import { serveStatic } from "./server.js";
import { writeSpec } from "./io.js";
import { validateSpec, goldenFrames, type Spec, type Callout } from "./spec/index.js";

const here = dirname(fileURLToPath(import.meta.url)); // dist/
const repoRoot = resolve(here, "..");
const sampleDir = join(repoRoot, "examples", "todo-app");
const goldenDir = join(repoRoot, "examples", "golden");

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  checks.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? " — " + detail : ""}`);
}

async function fileExistsNonEmpty(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : 0;
  } catch {
    return 0;
  }
}

function hasEmDash(c: Callout): boolean {
  const txt = [c.eyebrow, c.title, c.body].filter(Boolean).join(" ");
  return /[—–]/.test(txt);
}

async function main(): Promise<number> {
  console.log("Cueframe acceptance gate (GOAL.md §6)\n");
  await rm(goldenDir, { recursive: true, force: true });

  // --- §6.3 capture ---
  const server = await serveStatic(sampleDir, 0);
  let spec: Spec;
  try {
    console.log("§6.3 capture");
    const result = await capture({
      url: server.url,
      outDir: goldenDir,
      title: "Cueframe todo demo",
      app: "Cueframe sample todo app",
      headless: true,
    });
    spec = result.spec;
    const golden = goldenFrames(spec);
    const v = validateSpec(spec);
    check("captured spec validates (0 errors, 0 capture defects)", v.valid, `${v.errors.length} errors, ${v.defects.length} defects`);
    check("≥ 6 golden frames", golden.length >= 6, `${golden.length} golden frames`);
    const allRich = golden.every(
      (f) => f.caption.trim() && f.axDigest.trim() && f.boxes.some((b) => b.selector.trim() && b.rect.w > 0 && b.rect.h > 0),
    );
    check("every golden frame has caption + axDigest + >=1 real box", allRich);
  } finally {
    // keep server up until exports done? exports read from disk, not the server. Close now.
    await server.close();
  }

  // --- §6.4 callout authoring from plain English, via the lib the skill uses ---
  // This mirrors exactly what the conversational callout skill does internally:
  // resolveFrame -> resolveAnchor (auto-anchoring) -> draftCopy (voice-honored), then
  // commit via addCallout. Ambiguity is resolved deterministically (top candidate) so
  // the gate is reproducible; the skill would instead ask the user.
  console.log("\n§6.4 callout authoring");
  const golden = goldenFrames(spec);
  const validAfterEach: boolean[] = [];

  function pickFrame(ref: string): string {
    const r = resolveFrame(spec, ref);
    if (r.kind === "resolved") return r.frame.id;
    if (r.kind === "ambiguous") return r.candidates[0]!.id;
    throw new Error(`could not resolve frame ref "${ref}"`);
  }
  function author(frameRef: string, targetPhrase: string, title: string): Callout {
    const frameId = pickFrame(frameRef);
    const a = resolveAnchor(spec, frameId, targetPhrase);
    const anchor: CalloutAnchor | undefined =
      a.kind === "selector" ? { selector: a.selector } : a.kind === "rect" ? { rect: a.rect } : undefined;
    const copy = draftCopy(spec, frameId, title);
    const res = addCallout(spec, { frame: frameId, anchor, title, body: copy.body, dwellMs: 3000 });
    spec = res.spec;
    validAfterEach.push(validateSpec(spec).valid);
    return res.callout!;
  }

  // ADD #1 — "typing into the input" → f2, auto-anchored to the add control.
  const r1 = author("typing the first todo into the input", "add", "Add a task fast");
  // ADD #2 — "marked complete" → f5, auto-anchored to the toggle checkbox.
  author("a todo just got marked complete", "toggle checkbox", "Check it off when done");
  // ADD #3 — "filtered to active" → f6, auto-anchored to the active filter.
  author("filtered to show active items", "active filter", "Filter to focus");

  // EDIT — reword the first callout.
  const firstId = r1.id;
  spec = editCallout(spec, { id: firstId }, { title: "Add a task fast" }).spec;
  validAfterEach.push(validateSpec(spec).valid);

  // REMOVE — add a throwaway floating note, then remove it (leaves the 3 golden callouts).
  const tmp = addCallout(spec, { frame: golden[0]!.id, title: "temporary note" });
  spec = tmp.spec;
  validAfterEach.push(validateSpec(spec).valid);
  spec = removeCallout(spec, { id: tmp.callout!.id }).spec;
  validAfterEach.push(validateSpec(spec).valid);

  check("spec validates after every add/edit/remove operation", validAfterEach.every(Boolean), `${validAfterEach.filter(Boolean).length}/${validAfterEach.length} ops valid`);
  check("exactly 3 callouts remain", spec.callouts.length === 3, `${spec.callouts.length} callouts`);
  const anchored = spec.callouts.filter((c) => c.anchor?.selector);
  check("≥ 1 callout auto-anchored to a real box selector (not a manual rect)", anchored.length >= 1, anchored.map((c) => c.anchor!.selector).join(", "));
  // verify those selectors actually exist in their frames' boxes
  const anchorsValid = anchored.every((c) => {
    const f = spec.frames.find((fr) => fr.id === c.frame);
    return f?.boxes.some((b) => b.selector === c.anchor!.selector);
  });
  check("auto-anchored selectors exist in their frame's boxes", anchorsValid);
  check("callout copy honors plain voice (no em-dashes)", !spec.callouts.some(hasEmDash));

  // Persist the golden spec (3 callouts) before exporting.
  await writeSpec(join(goldenDir, "spec.json"), spec);

  // --- §6.5 exports ---
  console.log("\n§6.5 exports");
  const htmlOut = join(goldenDir, "demo.html");
  const mp4Out = join(goldenDir, "demo.mp4");
  const gifOut = join(goldenDir, "demo.gif");

  await exportHtml(spec, { framesDir: goldenDir, outPath: htmlOut });
  const htmlText = await readFile(htmlOut, "utf8");
  const selfContained = htmlText.includes("data:image/png") && !/\b(?:src|href)\s*=\s*["']https?:/i.test(htmlText) && !/url\(\s*https?:/i.test(htmlText);
  check("demo.html exists and is self-contained (frames inlined, no external refs)", (await fileExistsNonEmpty(htmlOut)) > 0 && selfContained);

  await exportMp4(spec, { framesDir: goldenDir, outPath: mp4Out, fps: 12 });
  const mp4Size = await fileExistsNonEmpty(mp4Out);
  const mp4Head = mp4Size ? (await readFile(mp4Out)).subarray(4, 8).toString("latin1") : "";
  check("demo.mp4 exists and is a valid MP4 (ftyp box)", mp4Size > 0 && mp4Head === "ftyp", `${mp4Size} bytes`);

  await exportGif(spec, { framesDir: goldenDir, outPath: gifOut, fps: 12 });
  const gifSize = await fileExistsNonEmpty(gifOut);
  const gifHead = gifSize ? (await readFile(gifOut)).subarray(0, 6).toString("latin1") : "";
  check("demo.gif exists and is a valid GIF (GIF8 header)", gifSize > 0 && /^GIF8/.test(gifHead), `${gifSize} bytes`);

  // --- summary ---
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n${passed === total ? "ALL CHECKS PASS" : "SOME CHECKS FAILED"}: ${passed}/${total}`);
  console.log(`Golden example written to ${goldenDir}`);
  return passed === total ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("\nAcceptance run threw:");
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
