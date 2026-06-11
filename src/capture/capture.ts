/**
 * The Showrunner — drives a running SPA via Playwright and emits a schema-valid spec.json
 * with rich per-frame caption / axDigest / boxes (GOAL.md §2, §3.1, §6.3).
 *
 * Browser automation uses Playwright (chromium). It is chosen over the chrome-devtools MCP
 * for the scriptable CLI/library path: a single npm dependency, a bundled browser, a stable
 * `accessibility.snapshot()` for the axDigest, and `boundingBox()` for measured boxes — all
 * runnable headless in CI with no external MCP server.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import {
  validateSpec,
  formatValidation,
  type Spec,
  type FrameRecord,
} from "../spec/index.js";
import {
  parseScenario,
  isGoldenStep,
  stepActionLabel,
  stepCaption,
  stepSelectors,
  type Scenario,
  type Step,
} from "./scenario.js";
import { buildAxDigest, collectBoxes } from "./digest.js";

export interface CaptureOptions {
  url: string;
  /** spec.json written here; screenshots under <outDir>/frames/. */
  outDir: string;
  /** Explicit scenario override. Beats the page-embedded one. */
  scenario?: Scenario;
  /** Default 1280x800. */
  viewport?: { w: number; h: number };
  title?: string;
  app?: string;
  /** Default true. */
  headless?: boolean;
}

export interface CaptureResult {
  spec: Spec;
  specPath: string;
  framesDir: string;
}

const DEFAULT_VIEWPORT = { w: 1280, h: 800 };

/** Read a scenario embedded in the page, if any (§ capture step 2). */
async function readEmbeddedScenario(page: Page): Promise<Scenario | undefined> {
  // 1. window.__CUEFRAME_SCENARIO__
  try {
    const fromWindow = await page.evaluate(() => {
      return (window as unknown as { __CUEFRAME_SCENARIO__?: unknown }).__CUEFRAME_SCENARIO__ ?? null;
    });
    if (fromWindow !== null) {
      try {
        return parseScenario(fromWindow);
      } catch (err) {
        console.warn(`capture: ignoring embedded scenario: ${(err as Error).message}`);
      }
    }
  } catch {
    /* ignore evaluate errors */
  }
  // 2. <script id="cueframe-scenario" type="application/json">
  try {
    const fromScript = await page.evaluate(() => {
      const el = document.getElementById("cueframe-scenario");
      if (!el || !el.textContent) return null;
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    });
    if (fromScript !== null) {
      try {
        return parseScenario(fromScript);
      } catch (err) {
        console.warn(`capture: ignoring embedded scenario: ${(err as Error).message}`);
      }
    }
  } catch {
    /* ignore evaluate errors */
  }
  return undefined;
}

/**
 * Generic auto-explore fallback (§ capture step 2, tertiary). Best-effort: snapshot the
 * loaded page, then click the first couple of buttons/links, snapshotting each. The
 * scenario path is primary; this just keeps `capture()` from producing nothing on an
 * unknown app. Exported for tests.
 *
 * Selector indexing: each element is addressed as `<probe> >> nth=<k>` where k is the
 * element's index among the matches of ITS OWN probe selector ("button" or "a[href]"),
 * never its index in the combined candidate list.
 */
export async function autoExploreScenario(page: Page): Promise<Scenario> {
  const steps: Step[] = [{ action: "goto", caption: "App loaded." }];
  try {
    const labels = await page.evaluate(() => {
      const out: { selector: string; label: string }[] = [];
      const candidates = Array.from(document.querySelectorAll("button, a[href]")).slice(0, 2);
      for (const el of candidates) {
        const tag = el.tagName.toLowerCase();
        const probe = tag === "a" ? "a[href]" : tag;
        const sameProbe = Array.from(document.querySelectorAll(probe));
        const nth = sameProbe.indexOf(el);
        if (nth < 0) continue;
        const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
        out.push({ selector: `${probe} >> nth=${nth}`, label: text || `${tag} ${nth}` });
      }
      return out;
    });
    labels.forEach((l, i) => {
      steps.push({
        action: "click",
        selector: l.selector,
        caption: `Clicked ${l.label || `element ${i + 1}`}.`,
        label: l.label,
      });
    });
  } catch {
    /* leave the single goto snapshot */
  }
  return { name: "auto-explore", steps };
}

/** Run one step's side effect (everything except producing the frame). */
async function applyStep(page: Page, step: Step, baseUrl: string): Promise<void> {
  switch (step.action) {
    case "goto": {
      const target = step.url ?? baseUrl;
      await page.goto(target, { waitUntil: "load" });
      break;
    }
    case "fill":
      await page.fill(step.selector, step.value);
      break;
    case "click":
      await page.click(step.selector);
      break;
    case "press":
      if (step.selector) await page.press(step.selector, step.key);
      else await page.keyboard.press(step.key);
      break;
    case "waitFor":
      if (step.selector) await page.waitForSelector(step.selector);
      if (typeof step.ms === "number" && step.ms > 0) await page.waitForTimeout(step.ms);
      break;
    case "snapshot":
      // no side effect — just a capture marker
      break;
    default: {
      // Backstop: parseScenario should have rejected this, but never let an unknown
      // action silently no-op and then capture a "golden" frame for it.
      const action = (step as { action?: unknown }).action;
      throw new Error(`unknown scenario action "${String(action)}"`);
    }
  }
  // Let the SPA settle (re-render) before measuring.
  await page.waitForTimeout(60);
}

export async function capture(opts: CaptureOptions): Promise<CaptureResult> {
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const headless = opts.headless ?? true;
  const framesDir = join(opts.outDir, "frames");
  const specPath = join(opts.outDir, "spec.json");

  await mkdir(framesDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless });
    const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });

    // Initial navigation (also lets us read an embedded scenario).
    await page.goto(opts.url, { waitUntil: "load" });

    // Resolve the scenario: explicit > embedded > auto-explore.
    const scenario =
      opts.scenario ?? (await readEmbeddedScenario(page)) ?? (await autoExploreScenario(page));

    const frames: FrameRecord[] = [];
    let n = 0;

    for (const step of scenario.steps) {
      // A leading goto with no explicit url just re-uses the already-loaded page; avoid a
      // redundant reload for the very first step when we are already on the URL.
      const isFirstGoto = step.action === "goto" && n === 0 && frames.length === 0;
      if (!isFirstGoto) {
        await applyStep(page, step, opts.url);
      } else {
        // already navigated above; still settle
        await page.waitForTimeout(60);
      }

      if (!isGoldenStep(step)) continue;

      const caption = stepCaption(step);
      if (!caption) continue; // snapshots always have one; this is a type guard

      n += 1;
      const id = `f${n}`;
      const imgRel = `frames/${id}.png`;
      const imgAbs = join(opts.outDir, imgRel);

      await page.screenshot({ path: imgAbs, fullPage: false });

      const axDigest = await buildAxDigest(page);
      const boxes = await collectBoxes(page, stepSelectors(step));

      const frame: FrameRecord = {
        id,
        n,
        kind: "golden",
        img: imgRel,
        caption,
        axDigest,
        boxes,
      };
      const action = stepActionLabel(step);
      if (action) frame.action = action;

      frames.push(frame);
    }

    const spec: Spec = {
      meta: {
        title: opts.title ?? scenario.name ?? "Cueframe demo",
        app: opts.app ?? opts.url,
        createdAt: new Date().toISOString(),
        viewport,
      },
      frames,
      callouts: [],
    };

    const result = validateSpec(spec);
    if (result.errors.length || result.defects.length) {
      throw new Error(`Capture produced an invalid spec:\n${formatValidation(result)}`);
    }

    await writeFile(specPath, JSON.stringify(spec, null, 2) + "\n", "utf8");

    return { spec, specPath, framesDir };
  } finally {
    if (browser) await browser.close();
  }
}
