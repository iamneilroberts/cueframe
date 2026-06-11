/**
 * Test-only fixture helpers (D5/D6 tests). Not part of the public API.
 *
 * Builds a tiny valid spec plus real PNG frames on disk so the browser-render and video
 * tests have genuine image bytes to inline and record.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import type { Spec } from "../spec/index.js";

export const FIXTURE_VIEWPORT = { w: 320, h: 240 };

/** A 3-golden-frame spec with one selector-anchored callout on a real box. */
export function fixtureSpec(): Spec {
  return {
    meta: {
      title: "Fixture Demo",
      app: "fixture",
      createdAt: "2026-01-01",
      viewport: { ...FIXTURE_VIEWPORT },
    },
    frames: [
      {
        id: "f1",
        n: 1,
        kind: "golden",
        img: "frames/f1.png",
        caption: "Open the app",
        axDigest: "landing screen",
        boxes: [{ selector: "[data-id=hero]", rect: { x: 40, y: 40, w: 120, h: 60 }, label: "hero" }],
      },
      {
        id: "f2",
        n: 2,
        kind: "golden",
        img: "frames/f2.png",
        caption: "Results appear",
        axDigest: "results board with items",
        boxes: [{ selector: "[data-id=board]", rect: { x: 30, y: 80, w: 200, h: 100 }, label: "board" }],
      },
      {
        id: "f3",
        n: 3,
        kind: "golden",
        img: "frames/f3.png",
        caption: "Confirmation",
        axDigest: "confirmation toast",
        boxes: [{ selector: "[data-id=done]", rect: { x: 60, y: 120, w: 80, h: 40 }, label: "done" }],
      },
    ],
    callouts: [
      {
        id: "c1",
        frame: "f2",
        anchor: { selector: "[data-id=board]" },
        eyebrow: "Results",
        title: "Everything aggregates here",
        body: "The board shows the matched items.",
        dwellMs: 600,
        style: "spotlight",
      },
    ],
  };
}

/** A short-reel variant (tiny holds/dwells) so video tests run fast. */
export function fastTimelineOptions(): { baseHoldMs: number; gapMs: number } {
  return { baseHoldMs: 150, gapMs: 30 };
}

/**
 * Write real PNG frames for each golden frame of `spec` under `<dir>/frames/`.
 * Each PNG is a screenshot of a distinctly-colored page, so the bytes are valid PNGs.
 * Returns the directory that CONTAINS the `frames/` folder.
 */
export async function writeFixtureFrames(spec: Spec): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cueframe-fix-"));
  await mkdir(path.join(dir, "frames"), { recursive: true });

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const colors = ["#1b6", "#36c", "#c63", "#693", "#939"];
    const page = await browser.newPage({
      viewport: { width: FIXTURE_VIEWPORT.w, height: FIXTURE_VIEWPORT.h },
    });
    const golden = spec.frames.filter((f) => f.kind === "golden");
    for (let i = 0; i < golden.length; i++) {
      const f = golden[i]!;
      const color = colors[i % colors.length];
      await page.setContent(
        `<html><body style="margin:0;width:100%;height:100vh;background:${color};color:#fff;font:20px sans-serif;display:flex;align-items:center;justify-content:center;">${f.id}</body></html>`,
      );
      const buf = await page.screenshot({ type: "png" });
      await writeFile(path.join(dir, f.img), buf);
    }
  } finally {
    await browser.close();
  }
  return dir;
}
