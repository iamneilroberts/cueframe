import { describe, it, expect } from "vitest";
import { validateSpec, assertValidSpec, isSpec } from "./validate.js";
import type { Spec } from "./types.js";

/** A minimal, fully valid spec with one golden frame that satisfies the §3.1 contract. */
function makeValidSpec(): Spec {
  return {
    meta: {
      title: "Demo",
      app: "Todo app",
      createdAt: "2026-06-10T12:00:00.000Z",
      viewport: { w: 1280, h: 800 },
    },
    frames: [
      {
        id: "f1",
        n: 1,
        kind: "golden",
        img: "frames/f1.png",
        caption: "The empty todo list loads",
        axDigest: "heading 'Todos'; textbox 'New todo'; button 'Add'",
        boxes: [
          { selector: "[data-add]", rect: { x: 10, y: 20, w: 80, h: 32 }, label: "Add" },
        ],
      },
    ],
    callouts: [],
  };
}

describe("validateSpec — happy path", () => {
  it("accepts a minimal valid spec with zero errors and zero defects", () => {
    const r = validateSpec(makeValidSpec());
    expect(r.errors).toEqual([]);
    expect(r.defects).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("isSpec returns true for a valid spec", () => {
    expect(isSpec(makeValidSpec())).toBe(true);
  });

  it("assertValidSpec does not throw on a valid spec", () => {
    expect(() => assertValidSpec(makeValidSpec())).not.toThrow();
  });
});

describe("validateSpec — schema errors", () => {
  it("rejects a non-object", () => {
    expect(validateSpec(null).valid).toBe(false);
    expect(validateSpec(42).valid).toBe(false);
    expect(validateSpec("x").valid).toBe(false);
  });

  it("flags missing meta.title", () => {
    const s = makeValidSpec();
    // @ts-expect-error intentional
    delete s.meta.title;
    const r = validateSpec(s);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "meta.title")).toBe(true);
  });

  it("flags a non-ISO createdAt", () => {
    const s = makeValidSpec();
    s.meta.createdAt = "yesterday";
    const r = validateSpec(s);
    expect(r.errors.some((e) => e.path === "meta.createdAt")).toBe(true);
  });

  it("flags a bad viewport", () => {
    const s = makeValidSpec();
    // @ts-expect-error intentional
    s.meta.viewport = { w: "wide", h: 800 };
    expect(validateSpec(s).valid).toBe(false);
  });

  it("flags duplicate frame ids", () => {
    const s = makeValidSpec();
    s.frames.push({ ...s.frames[0]!, n: 2 });
    const r = validateSpec(s);
    expect(r.errors.some((e) => e.code === "duplicate_frame_id")).toBe(true);
  });

  it("flags a bad frame kind", () => {
    const s = makeValidSpec();
    // @ts-expect-error intentional
    s.frames[0]!.kind = "shiny";
    expect(validateSpec(s).valid).toBe(false);
  });

  it("flags a box with a non-numeric rect", () => {
    const s = makeValidSpec();
    // @ts-expect-error intentional
    s.frames[0]!.boxes[0]!.rect = { x: 0, y: 0, w: "wide", h: 10 };
    expect(validateSpec(s).valid).toBe(false);
  });

  it("flags a callout referencing a non-existent frame", () => {
    const s = makeValidSpec();
    s.callouts.push({ id: "c1", frame: "f999", title: "Nope" });
    const r = validateSpec(s);
    expect(r.errors.some((e) => e.code === "callout_frame_missing")).toBe(true);
  });

  it("flags a callout with an empty title", () => {
    const s = makeValidSpec();
    s.callouts.push({ id: "c1", frame: "f1", title: "  " });
    expect(validateSpec(s).valid).toBe(false);
  });

  it("flags a callout anchor.selector that is not in the frame's boxes", () => {
    const s = makeValidSpec();
    s.callouts.push({
      id: "c1",
      frame: "f1",
      anchor: { selector: "[data-nonexistent]" },
      title: "Bad anchor",
    });
    const r = validateSpec(s);
    expect(r.errors.some((e) => e.code === "anchor_selector_missing")).toBe(true);
  });

  it("accepts a callout anchor.selector that IS in the frame's boxes", () => {
    const s = makeValidSpec();
    s.callouts.push({
      id: "c1",
      frame: "f1",
      anchor: { selector: "[data-add]" },
      title: "Good anchor",
    });
    const r = validateSpec(s);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("flags a bad callout style", () => {
    const s = makeValidSpec();
    // @ts-expect-error intentional
    s.callouts.push({ id: "c1", frame: "f1", title: "x", style: "neon" });
    expect(validateSpec(s).valid).toBe(false);
  });

  it("flags duplicate callout ids", () => {
    const s = makeValidSpec();
    s.callouts.push({ id: "c1", frame: "f1", title: "a" });
    s.callouts.push({ id: "c1", frame: "f1", title: "b" });
    const r = validateSpec(s);
    expect(r.errors.some((e) => e.code === "duplicate_callout_id")).toBe(true);
  });
});

describe("validateSpec — capture defects (§3.1, golden frames only)", () => {
  it("flags a golden frame with an empty caption as a capture defect, not a schema error", () => {
    const s = makeValidSpec();
    s.frames[0]!.caption = "   ";
    const r = validateSpec(s);
    expect(r.defects.some((d) => d.code === "empty_caption")).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("flags a placeholder caption like 'Frame 1' as a capture defect", () => {
    const s = makeValidSpec();
    s.frames[0]!.caption = "Frame 1";
    const r = validateSpec(s);
    expect(r.defects.some((d) => d.code === "placeholder_caption")).toBe(true);
  });

  it("flags a golden frame with an empty axDigest", () => {
    const s = makeValidSpec();
    s.frames[0]!.axDigest = "";
    const r = validateSpec(s);
    expect(r.defects.some((d) => d.code === "empty_ax_digest")).toBe(true);
  });

  it("flags a golden frame with no real box (empty boxes)", () => {
    const s = makeValidSpec();
    s.frames[0]!.boxes = [];
    const r = validateSpec(s);
    expect(r.defects.some((d) => d.code === "no_real_box")).toBe(true);
  });

  it("flags a golden frame whose only box has a degenerate (zero-area) rect", () => {
    const s = makeValidSpec();
    s.frames[0]!.boxes = [{ selector: "[data-add]", rect: { x: 0, y: 0, w: 0, h: 0 } }];
    const r = validateSpec(s);
    expect(r.defects.some((d) => d.code === "no_real_box")).toBe(true);
  });

  it("flags a golden frame whose only box has an empty selector", () => {
    const s = makeValidSpec();
    s.frames[0]!.boxes = [{ selector: "  ", rect: { x: 0, y: 0, w: 10, h: 10 } }];
    const r = validateSpec(s);
    expect(r.defects.some((d) => d.code === "no_real_box")).toBe(true);
  });

  it("does NOT flag raw frames for capture-quality (only golden frames are a hard contract)", () => {
    const s = makeValidSpec();
    s.frames.push({
      id: "f2",
      n: 2,
      kind: "raw",
      img: "frames/f2.png",
      caption: "",
      axDigest: "",
      boxes: [],
    });
    const r = validateSpec(s);
    expect(r.defects).toEqual([]);
    expect(r.valid).toBe(true);
  });
});

describe("validateSpec — warnings (non-fatal)", () => {
  it("warns when a callout binds to a raw (non-golden) frame", () => {
    const s = makeValidSpec();
    s.frames.push({
      id: "f2",
      n: 2,
      kind: "raw",
      img: "frames/f2.png",
      caption: "x",
      axDigest: "x",
      boxes: [{ selector: "[data-x]", rect: { x: 0, y: 0, w: 5, h: 5 } }],
    });
    s.callouts.push({ id: "c1", frame: "f2", title: "On a raw frame" });
    const r = validateSpec(s);
    expect(r.warnings.some((w) => w.code === "callout_on_raw_frame")).toBe(true);
    // warnings do not make the spec invalid
    expect(r.valid).toBe(true);
  });

  it("warns when two callouts bind to the same frame", () => {
    const s = makeValidSpec();
    s.callouts.push({ id: "c1", frame: "f1", title: "a" });
    s.callouts.push({ id: "c2", frame: "f1", title: "b" });
    const r = validateSpec(s);
    expect(r.warnings.some((w) => w.code === "callouts_share_frame")).toBe(true);
    expect(r.valid).toBe(true);
  });
});

describe("assertValidSpec", () => {
  it("throws with a useful message on an invalid spec", () => {
    expect(() => assertValidSpec({ meta: {}, frames: [], callouts: [] })).toThrow();
  });
});
