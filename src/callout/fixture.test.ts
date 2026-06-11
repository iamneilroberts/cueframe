/**
 * Shared realistic fixture for callout tests. A generic app workflow (not product-specific)
 * with ≥6 golden frames, varied/searchable captions + axDigests, and real boxes with
 * selectors + pixel rects. Two frames share a "results" theme to exercise ambiguity.
 *
 * This file only exports a builder; it is named `.test.ts` so it lives with the suite but
 * registers no tests of its own (vitest tolerates a test file with no tests). It is imported
 * by the other suites.
 */

import type { Spec } from "../spec/index.js";
import { validateSpec } from "../spec/index.js";
import { expect, test } from "vitest";

export function makeFixture(): Spec {
  return {
    meta: {
      title: "Widget app demo",
      app: "https://example.test/app",
      createdAt: "2026-06-10T12:00:00.000Z",
      viewport: { w: 1280, h: 800 },
      // No voice → plain default applies.
    },
    frames: [
      {
        id: "f1",
        n: 1,
        kind: "golden",
        img: "frames/f1.png",
        caption: "Empty dashboard with a Create button",
        axDigest: "heading Dashboard, button Create, empty state illustration",
        boxes: [
          { selector: "[data-action=create]", rect: { x: 1100, y: 24, w: 120, h: 40 }, label: "Create button" },
          { selector: ".empty-state", rect: { x: 400, y: 300, w: 480, h: 200 }, label: "Empty state" },
        ],
        action: { label: "Click Create", selector: "[data-action=create]" },
      },
      {
        id: "f2",
        n: 2,
        kind: "golden",
        img: "frames/f2.png",
        caption: "New widget form opens with name and category fields",
        axDigest: "form New widget, textbox Name, combobox Category, button Save",
        boxes: [
          { selector: "#name", rect: { x: 420, y: 200, w: 440, h: 44 }, label: "Name field" },
          { selector: "#category", rect: { x: 420, y: 260, w: 440, h: 44 }, label: "Category dropdown" },
          { selector: "[data-action=save]", rect: { x: 760, y: 340, w: 100, h: 40 }, label: "Save button" },
        ],
        action: { label: "Fill name and save", selector: "[data-action=save]" },
      },
      {
        id: "f3",
        n: 3,
        kind: "golden",
        img: "frames/f3.png",
        caption: "Search results aggregate into a board",
        axDigest: "search results list, board of widget cards, filter chips, count 24 results",
        boxes: [
          { selector: "[data-board=results]", rect: { x: 80, y: 140, w: 1120, h: 560 }, label: "Results board" },
          { selector: ".filter-chips", rect: { x: 80, y: 100, w: 600, h: 32 }, label: "Filter chips" },
        ],
        action: { label: "Open a result", selector: "[data-board=results] .card:first-child" },
      },
      {
        id: "f4",
        n: 4,
        kind: "golden",
        img: "frames/f4.png",
        caption: "Filtered results narrow the board to favorites",
        axDigest: "results list filtered, favorites only, board of widget cards, count 6 results",
        boxes: [
          { selector: "[data-board=favorites]", rect: { x: 80, y: 140, w: 1120, h: 420 }, label: "Favorites results board" },
          { selector: ".favorite-toggle", rect: { x: 700, y: 100, w: 160, h: 32 }, label: "Favorites toggle" },
        ],
      },
      {
        id: "f5",
        n: 5,
        kind: "golden",
        img: "frames/f5.png",
        caption: "Pricing summary updates with the selected plan",
        axDigest: "pricing panel, plan Pro, total updates to $48, button Continue to checkout",
        boxes: [
          { selector: "[data-panel=pricing]", rect: { x: 820, y: 160, w: 380, h: 300 }, label: "Pricing panel" },
          { selector: "[data-action=checkout]", rect: { x: 860, y: 480, w: 200, h: 44 }, label: "Continue to checkout" },
        ],
        action: { label: "Continue to checkout", selector: "[data-action=checkout]" },
      },
      {
        id: "f6",
        n: 6,
        kind: "golden",
        img: "frames/f6.png",
        caption: "Confirmation screen shows the order is complete",
        axDigest: "confirmation, order number 10042, button Done, success checkmark",
        boxes: [
          { selector: "[data-confirm=order]", rect: { x: 400, y: 240, w: 480, h: 240 }, label: "Order confirmation" },
          { selector: "[data-action=done]", rect: { x: 580, y: 520, w: 120, h: 40 }, label: "Done button" },
        ],
      },
      {
        // A raw frame between golden ones — must never be picked by golden resolution.
        id: "f7raw",
        n: 7,
        kind: "raw",
        img: "frames/f7raw.png",
        caption: "intermediate loading spinner",
        axDigest: "spinner",
        boxes: [],
      },
    ],
    callouts: [],
  };
}

test("fixture is a valid spec with >= 6 golden frames", () => {
  const spec = makeFixture();
  const r = validateSpec(spec);
  expect(r.errors).toEqual([]);
  expect(r.defects).toEqual([]);
  expect(spec.frames.filter((f) => f.kind === "golden").length).toBeGreaterThanOrEqual(6);
});
