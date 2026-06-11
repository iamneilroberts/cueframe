import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { exportHtml } from "./html.js";
import { fixtureSpec, writeFixtureFrames } from "./_fixture.js";

const cleanups: string[] = [];
afterAll(async () => {
  for (const d of cleanups) await rm(d, { recursive: true, force: true });
});

describe("exportHtml", () => {
  it("writes one self-contained html with inlined frames and no external refs", async () => {
    const spec = fixtureSpec();
    const framesDir = await writeFixtureFrames(spec);
    cleanups.push(framesDir);
    const outDir = await mkdtemp(path.join(tmpdir(), "cueframe-out-"));
    cleanups.push(outDir);
    const outPath = path.join(outDir, "demo.html");

    await exportHtml(spec, { framesDir, outPath });

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("data:image/png;base64,");
    // self-contained: no external http(s):// refs at all
    expect(/https?:\/\//.test(html)).toBe(false);
    // The frame paths appear only as spec metadata + asset keys, never as a loadable
    // reference (no src="frames/..." attribute, no url(frames/...) in CSS).
    expect(html).not.toMatch(/src\s*=\s*["']frames\//i);
    expect(html).not.toMatch(/url\(\s*["']?frames\//i);
  });

  it("loads in chromium, becomes ready, shows the frame image and renders a callout", async () => {
    const spec = fixtureSpec();
    const framesDir = await writeFixtureFrames(spec);
    cleanups.push(framesDir);
    const outDir = await mkdtemp(path.join(tmpdir(), "cueframe-out-"));
    cleanups.push(outDir);
    const outPath = path.join(outDir, "demo.html");
    // autoplay:false so we control time deterministically via renderAt
    await exportHtml(spec, { framesDir, outPath, autoplay: false });

    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
      await page.goto("file://" + outPath);
      await page.waitForFunction(() => (window as any).__CUEFRAME_READY__ === true, undefined, {
        timeout: 30_000,
      });

      // stage shows an image with a data URI src
      const imgSrc = await page.getAttribute(".cf-frame-img", "src");
      expect(imgSrc ?? "").toContain("data:image/png");

      // jump to the callout's appear time (frame f2 segment) and assert it is visible
      const appearMs = await page.evaluate(() => {
        const tl = (window as any).__CUEFRAME__.timeline;
        const seg = tl.segments.find((s: any) => s.frameId === "f2");
        return seg.callouts[0].appearMs + 10;
      });
      await page.evaluate((ms) => (window as any).__CUEFRAME_PLAYER__.renderAt(ms), appearMs);

      const titleText = await page.textContent(".cf-title");
      expect(titleText).toContain("Everything aggregates here");
      const cardVisible = await page.isVisible(".cf-card");
      expect(cardVisible).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
