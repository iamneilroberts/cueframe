/**
 * Frame-quality builders: the searchable `axDigest` and the measured `boxes`.
 *
 * These are the load-bearing §3.1 fields. They are factored out of capture.ts so they can
 * be unit-tested against a Playwright `Page` populated with `page.setContent(...)` — no
 * scenario, no app server. Both take a `Page` and read the live DOM / accessibility tree.
 */

import type { Page } from "playwright";
import type { Box, Rect } from "../spec/index.js";

/** A salient accessible node extracted from the live DOM. */
interface AxNode {
  role: string;
  name: string;
}

/** Collapse runs of whitespace and trim — digests are one line. */
function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Build a genuinely SEARCHABLE one-line digest from the live DOM's accessibility state (§3.1).
 *
 * Playwright 1.60 removed `page.accessibility`, so we derive an equivalent role/name list in
 * the page: headings, buttons, links, textboxes, checkboxes, listitems, etc. Salient nodes
 * are emitted as `role "name"` joined by `; `, plus useful counts a user would plausibly
 * search for (todo counts, completed counts, checkbox state). The exact todo texts appear
 * verbatim so a semantic frame query like "walk the dog" resolves.
 */
export async function buildAxDigest(page: Page): Promise<string> {
  const extracted = await page.evaluate(() => {
    function accessibleName(el: Element): string {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return aria.trim();
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const ref = document.getElementById(labelledby);
        if (ref && ref.textContent && ref.textContent.trim()) return ref.textContent.trim();
      }
      if (el instanceof HTMLInputElement) {
        if (el.type === "checkbox" || el.type === "radio") {
          return (aria || el.value || "").trim();
        }
        if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();
        if (el.value && el.value.trim()) return el.value.trim();
      }
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      return text;
    }

    function isVisible(el: Element): boolean {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    }

    const nodes: { role: string; name: string }[] = [];
    const push = (role: string, el: Element) => {
      if (!isVisible(el)) return;
      const name = accessibleName(el).slice(0, 80);
      if (!name) return;
      nodes.push({ role, name });
    };

    document.querySelectorAll("h1,h2,h3,[role=heading]").forEach((el) => push("heading", el));
    document.querySelectorAll("button,[role=button]").forEach((el) => push("button", el));
    document.querySelectorAll("a[href]").forEach((el) => push("link", el));
    document
      .querySelectorAll("input[type=text],input:not([type]),textarea,input[type=search],[role=textbox]")
      .forEach((el) => push("textbox", el));
    document.querySelectorAll("input[type=checkbox],[role=checkbox],input[type=radio]").forEach((el) => push("checkbox", el));
    document.querySelectorAll("li,[role=listitem]").forEach((el) => push("listitem", el));

    // Counts (robust even if roles vary).
    const items = Array.from(document.querySelectorAll("[data-todo]"));
    const completed = items.filter((el) => {
      const cb = el.querySelector("[data-toggle]") as HTMLInputElement | null;
      return !!cb && cb.checked;
    }).length;
    const checkboxesAll = Array.from(
      document.querySelectorAll("input[type=checkbox],[role=checkbox]"),
    ) as HTMLInputElement[];
    const checkboxes = checkboxesAll.length;
    const checked = checkboxesAll.filter((c) => c.checked).length;
    const countEl = document.querySelector("[data-count]");
    const countText = countEl ? (countEl.textContent || "").trim() : "";
    const title = document.title || "";

    return { nodes, todos: items.length, completed, checkboxes, checked, countText, title };
  });

  const parts: string[] = [];
  const seen = new Set<string>();
  for (const node of extracted.nodes as AxNode[]) {
    const name = clean(node.name);
    if (!name) continue;
    const token = `${node.role} "${name}"`;
    if (seen.has(token)) continue;
    seen.add(token);
    parts.push(token);
  }

  const countBits: string[] = [];
  if (extracted.todos > 0 || extracted.completed > 0) {
    countBits.push(`${extracted.todos} todo${extracted.todos === 1 ? "" : "s"}`);
    if (extracted.completed > 0) countBits.push(`${extracted.completed} completed`);
  }
  if (extracted.checkboxes > 0 && extracted.todos === 0) {
    countBits.push(`${extracted.checked}/${extracted.checkboxes} checked`);
  }
  if (extracted.countText) countBits.push(extracted.countText);

  const all = [...parts, ...countBits].filter(Boolean);
  const digest = clean(all.join("; "));
  if (digest) return digest;
  return clean(extracted.title) || "page";
}

/** Selectors always probed for boxes, beyond the scenario-referenced ones (§3.1). */
const GENERIC_SELECTORS = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[role]",
  "[data-todo]",
  "[data-text]",
  "[data-toggle]",
  "[data-delete]",
  "[data-add]",
  "[data-new-todo]",
  "[data-count]",
  "[data-clear-completed]",
  "[data-filter]",
  "[data-heading]",
];

function roundRect(r: { x: number; y: number; width: number; height: number }): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

/**
 * Measure the interactive + result-bearing elements present on the current frame (§3.1).
 *
 * For the union of `extraSelectors` (scenario-referenced) and a generic interactive set,
 * each matching element gets a `boundingBox()`. Boxes are kept only when w>0 && h>0 and
 * they overlap the viewport. Each box carries a real, resolvable selector and an accessible
 * label. Guarantees ≥1 real box on any frame with visible interactive content; capped to
 * the `cap` most meaningful boxes.
 */
export async function collectBoxes(
  page: Page,
  extraSelectors: string[] = [],
  cap = 12,
): Promise<Box[]> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const selectors = Array.from(new Set([...extraSelectors, ...GENERIC_SELECTORS]));

  const boxes: Box[] = [];
  const seenRects = new Set<string>();

  for (const selector of selectors) {
    let handles;
    try {
      handles = await page.locator(selector).elementHandles();
    } catch {
      continue; // invalid selector — skip rather than fail the whole capture
    }
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i];
      if (!handle) continue;
      let bb;
      try {
        bb = await handle.boundingBox();
      } catch {
        continue;
      }
      if (!bb || bb.width <= 0 || bb.height <= 0) continue;
      // Overlap with viewport.
      const overlaps =
        bb.x < viewport.width && bb.y < viewport.height && bb.x + bb.width > 0 && bb.y + bb.height > 0;
      if (!overlaps) continue;

      const rect = roundRect(bb);
      const dedupeKey = `${rect.x},${rect.y},${rect.w},${rect.h}`;
      if (seenRects.has(dedupeKey)) continue;
      seenRects.add(dedupeKey);

      // A selector that uniquely & stably resolves to THIS element. Prefer an nth-scoped
      // form when the base selector matches several elements, so the player can rebind.
      const resolvable = handles.length > 1 ? `${selector} >> nth=${i}` : selector;

      // Accessible label: aria-label, visible text, value, or placeholder.
      let label = "";
      try {
        label = await handle.evaluate((el) => {
          const node = el as HTMLElement;
          const aria = node.getAttribute("aria-label");
          if (aria && aria.trim()) return aria.trim();
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (text) return text.slice(0, 80);
          if (node instanceof HTMLInputElement) {
            if (node.value && node.value.trim()) return node.value.trim();
            if (node.placeholder && node.placeholder.trim()) return node.placeholder.trim();
          }
          return "";
        });
      } catch {
        label = "";
      }

      const box: Box = { selector: resolvable, rect };
      if (label) box.label = label;
      boxes.push(box);
    }
  }

  // Most meaningful first: prefer labelled and larger elements, then cap.
  boxes.sort((a, b) => {
    const la = a.label ? 1 : 0;
    const lb = b.label ? 1 : 0;
    if (la !== lb) return lb - la;
    return b.rect.w * b.rect.h - a.rect.w * a.rect.h;
  });

  return boxes.slice(0, cap);
}
