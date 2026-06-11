/**
 * Regression test for the auto-explore fallback: selectors must be indexed per tag,
 * not by position in the combined button+link candidate list. A page whose first two
 * interactive elements are <a> then <button> used to produce "button >> nth=1" —
 * a second button that does not exist.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { autoExploreScenario } from "./capture.js";

let browser: Browser;
let page: Page;

const HTML = `<!doctype html><html><head><title>Probe</title></head><body>
  <h1>Test page</h1>
  <a href="#one">A link first</a>
  <button id="only">Only button</button>
</body></html>`;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(HTML, { waitUntil: "load" });
});

afterAll(async () => {
  await browser.close();
});

describe("autoExploreScenario", () => {
  it("indexes selectors within their own tag, so every step selector resolves", async () => {
    const scenario = await autoExploreScenario(page);
    const clicks = scenario.steps.filter((s) => s.action === "click");
    expect(clicks.length).toBe(2);
    for (const step of clicks) {
      if (step.action !== "click") continue; // narrow for TS
      const count = await page.locator(step.selector).count();
      expect(count, `selector "${step.selector}" must resolve`).toBe(1);
    }
  });

  it("uses per-tag nth indices (the only button is nth=0, not nth=1)", async () => {
    const scenario = await autoExploreScenario(page);
    const selectors = scenario.steps
      .filter((s) => s.action === "click")
      .map((s) => (s as { selector: string }).selector);
    expect(selectors).toContain("a[href] >> nth=0");
    expect(selectors).toContain("button >> nth=0");
  });
});
