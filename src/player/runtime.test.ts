/**
 * Browser tests for the player runtime's anchor affordance and card placement.
 * Renders the real player HTML (assets inlined as data URIs) at the spec's exact
 * viewport size so stage scale is 1:1 and pixel assertions are direct.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { renderPlayerHtml } from "./template.js";
import type { Spec, Rect } from "../spec/index.js";

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeSpec(anchorRect: Rect): Spec {
  return {
    meta: { title: "t", app: "a", createdAt: "2026-01-01T00:00:00.000Z", viewport: { w: 640, h: 400 } },
    frames: [
      {
        id: "f1",
        n: 1,
        kind: "golden",
        img: "frames/f1.png",
        caption: "A frame",
        axDigest: 'button "Save"',
        boxes: [{ selector: "[data-save]", rect: anchorRect, label: "Save" }],
      },
    ],
    callouts: [{ id: "c1", frame: "f1", anchor: { selector: "[data-save]" }, title: "Save is here" }],
  };
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

async function renderCalloutMoment(spec: Spec): Promise<Page> {
  const html = renderPlayerHtml(spec, { assets: { "frames/f1.png": PNG_1x1 }, autoplay: false });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => (window as any).__CUEFRAME_READY__ === true, undefined, { timeout: 15_000 });
  const appearMs = await page.evaluate(() => {
    const tl = (window as any).__CUEFRAME__.timeline;
    return tl.segments[0].callouts[0].appearMs + 10;
  });
  await page.evaluate((ms) => (window as any).__CUEFRAME_PLAYER__.renderAt(ms), appearMs);
  return page;
}

describe("player runtime — anchor affordance", () => {
  it("draws an anchor ring around the anchored box for the default card style", async () => {
    const rect: Rect = { x: 280, y: 170, w: 80, h: 40 };
    const page = await renderCalloutMoment(makeSpec(rect));
    try {
      const ring = await page.locator(".cf-anchor").boundingBox();
      expect(ring).not.toBeNull();
      // ring = rect padded by 4px, scale 1:1 (small layout tolerance)
      expect(Math.abs(ring!.x - (rect.x - 4))).toBeLessThanOrEqual(2);
      expect(Math.abs(ring!.y - (rect.y - 4))).toBeLessThanOrEqual(2);
      expect(Math.abs(ring!.width - (rect.w + 8))).toBeLessThanOrEqual(4);
      expect(Math.abs(ring!.height - (rect.h + 8))).toBeLessThanOrEqual(4);
    } finally {
      await page.close();
    }
  });
});

describe("player runtime — card placement avoids the anchor", () => {
  it("places the card clear of a wide bottom anchor instead of clamping onto it", async () => {
    // Wide bar across the bottom (like a cart-total row). The old algorithm clamped the
    // card onto this rect; the card must end up fully above it.
    const rect: Rect = { x: 8, y: 330, w: 624, h: 60 };
    const page = await renderCalloutMoment(makeSpec(rect));
    try {
      const card = await page.locator(".cf-card").boundingBox();
      expect(card).not.toBeNull();
      const cardBottom = card!.y + card!.height;
      // Padded anchor zone starts at y = 330 - 6 = 324.
      expect(cardBottom).toBeLessThanOrEqual(324);
    } finally {
      await page.close();
    }
  });

  it("still places the card beside a small mid-screen anchor without overlapping it", async () => {
    const rect: Rect = { x: 280, y: 170, w: 80, h: 40 };
    const page = await renderCalloutMoment(makeSpec(rect));
    try {
      const card = await page.locator(".cf-card").boundingBox();
      expect(card).not.toBeNull();
      const pad = 6;
      const zone = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
      const intersects =
        card!.x < zone.x + zone.w &&
        card!.x + card!.width > zone.x &&
        card!.y < zone.y + zone.h &&
        card!.y + card!.height > zone.y;
      expect(intersects).toBe(false);
    } finally {
      await page.close();
    }
  });
});
