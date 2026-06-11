/**
 * Unit tests for the §3.1 frame-quality builders (axDigest + boxes), driven against a
 * Playwright page populated with `page.setContent(...)` — no app server, no scenario.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { buildAxDigest, collectBoxes } from "./digest.js";

let browser: Browser;
let page: Page;

const HTML = `<!doctype html><html><head><title>Probe</title></head><body>
  <h1 data-heading>Today</h1>
  <input type="text" data-new-todo aria-label="New todo" placeholder="What needs doing?" />
  <button data-add>Add</button>
  <ul data-todo-list>
    <li data-todo="1" class="todo completed">
      <input type="checkbox" data-toggle checked aria-label="Mark Buy groceries complete" />
      <span class="text" data-text>Buy groceries</span>
      <button data-delete aria-label="Delete Buy groceries">x</button>
    </li>
    <li data-todo="2" class="todo">
      <input type="checkbox" data-toggle aria-label="Mark Walk the dog complete" />
      <span class="text" data-text>Walk the dog</span>
      <button data-delete aria-label="Delete Walk the dog">x</button>
    </li>
  </ul>
  <span data-count>1 item left</span>
  <button data-filter="all">All</button>
  <button data-clear-completed>Clear completed</button>
</body></html>`;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(HTML, { waitUntil: "load" });
});

afterAll(async () => {
  await browser.close();
});

describe("buildAxDigest", () => {
  it("produces a non-empty one-line digest", async () => {
    const digest = await buildAxDigest(page);
    expect(digest.length).toBeGreaterThan(0);
    expect(digest).not.toContain("\n");
  });

  it("contains the salient role/name tokens a user would search for", async () => {
    const digest = await buildAxDigest(page);
    expect(digest).toContain("Today"); // heading
    expect(digest).toContain("Add"); // button
    // The actual todo texts must be present for semantic resolution.
    expect(digest).toContain("Buy groceries");
    expect(digest).toContain("Walk the dog");
  });

  it("includes useful domain counts", async () => {
    const digest = await buildAxDigest(page);
    expect(digest).toMatch(/2 todos/);
    expect(digest).toMatch(/1 completed/);
  });
});

describe("collectBoxes", () => {
  it("yields real boxes with positive rects and resolvable selectors", async () => {
    const boxes = await collectBoxes(page);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(typeof b.selector).toBe("string");
      expect(b.selector.length).toBeGreaterThan(0);
      expect(b.rect.w).toBeGreaterThan(0);
      expect(b.rect.h).toBeGreaterThan(0);
    }
  });

  it("every collected selector actually resolves to an element on the page", async () => {
    const boxes = await collectBoxes(page);
    for (const b of boxes) {
      const count = await page.locator(b.selector).count();
      expect(count).toBeGreaterThan(0);
    }
  });

  it("includes the scenario-referenced selectors passed as extras", async () => {
    const boxes = await collectBoxes(page, ["[data-add]"]);
    const hasAdd = boxes.some((b) => b.selector.includes("[data-add]"));
    expect(hasAdd).toBe(true);
  });

  it("respects the cap", async () => {
    const boxes = await collectBoxes(page, [], 3);
    expect(boxes.length).toBeLessThanOrEqual(3);
  });
});

describe("collectBoxes — clean selector derivation (automation-friendly apps)", () => {
  const APP = `<!doctype html><html><head><title>Shop</title></head><body>
    <header id="primary-header"><a data-test="cart-link" href="#">Cart</a>
      <span data-test="cart-badge">1</span></header>
    <button data-test="add-to-cart-backpack">Add to cart</button>
    <input data-testid="search" aria-label="Search" />
    <button data-qa="checkout">Checkout</button>
  </body></html>`;

  it("derives clean per-element selectors from id / data-test / data-testid / data-qa", async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p.setContent(APP, { waitUntil: "load" });
    const boxes = await collectBoxes(p);
    const selectors = boxes.map((b) => b.selector);
    // Every selector resolves to exactly one element (clean + unambiguous).
    for (const s of selectors) expect(await p.locator(s).count()).toBe(1);
    // The meaningful elements get human-readable attribute selectors, not `tag >> nth=N`.
    expect(selectors).toContain("#primary-header");
    expect(selectors).toContain('[data-test="cart-link"]');
    expect(selectors).toContain('[data-test="cart-badge"]');
    expect(selectors).toContain('[data-test="add-to-cart-backpack"]');
    expect(selectors).toContain('[data-testid="search"]');
    expect(selectors).toContain('[data-qa="checkout"]');
    expect(selectors.some((s) => s.includes(">> nth="))).toBe(false);
    await p.close();
  });
});
