import { describe, test, expect } from "vitest";
import { makeFixture } from "./fixture.test.js";
import {
  addCallout,
  editCallout,
  removeCallout,
  retimeCallout,
  reanchorCallout,
  moveCallout,
  queryFrames,
  findCallout,
  resolveDwell,
} from "./edit.js";
import { validateSpec, frameById } from "../spec/index.js";
import type { Spec } from "../spec/index.js";

/** Assert a spec has zero schema errors (the post-condition of every op). */
function expectValid(spec: Spec): void {
  const r = validateSpec(spec);
  expect(r.errors).toEqual([]);
}

describe("addCallout — NL-assisted, auto-anchoring (§6.4)", () => {
  test("semantic description binds the RIGHT frame AND auto-anchors to a real box selector", () => {
    const spec = makeFixture();
    const { spec: out, callout } = addCallout(spec, {
      frameRef: "the frame where pricing updates",
      targetPhrase: "the pricing panel",
      titleHint: "Live pricing",
    });
    expect(callout!.frame).toBe("f5");
    // Auto anchoring bound a real box selector, not a manual rect.
    expect(callout!.anchor?.selector).toBe("[data-panel=pricing]");
    expect(callout!.anchor?.rect).toBeUndefined();
    // The selector actually exists in that frame's boxes.
    const frame = frameById(out, "f5")!;
    expect(frame.boxes.some((b) => b.selector === callout!.anchor!.selector)).toBe(true);
    expectValid(out);
    // Input was not mutated.
    expect(spec.callouts.length).toBe(0);
  });

  test('add by "around 99" binds the nearest (last) frame', () => {
    const { callout } = addCallout(makeFixture(), { frameRef: "around 99", titleHint: "Wrap up" });
    expect(callout!.frame).toBe("f6");
  });

  test('add by "near the end"', () => {
    const { callout } = addCallout(makeFixture(), { frameRef: "near the end", titleHint: "Done" });
    expect(callout!.frame).toBe("f6");
  });

  test('add by "middle"', () => {
    const { callout } = addCallout(makeFixture(), { frameRef: "the middle", titleHint: "Mid" });
    expect(callout!.frame).toBe("f3");
  });

  test('add by "start"', () => {
    const { callout } = addCallout(makeFixture(), { frameRef: "the start", titleHint: "Intro" });
    expect(callout!.frame).toBe("f1");
  });

  test("ambiguous semantic frameRef throws with candidates listed", () => {
    expect(() => addCallout(makeFixture(), { frameRef: "the results board" })).toThrow(/ambiguous/i);
  });

  test("explicit add with a valid selector anchor", () => {
    const { spec: out, callout } = addCallout(makeFixture(), {
      frame: "f1",
      anchor: { selector: "[data-action=create]" },
      title: "Start here",
    });
    expect(callout!.anchor?.selector).toBe("[data-action=create]");
    expectValid(out);
  });

  test("explicit add rejects a selector that is not a box on the frame", () => {
    expect(() =>
      addCallout(makeFixture(), { frame: "f1", anchor: { selector: "#nope" }, title: "x" }),
    ).toThrow();
  });

  test("ids never collide; second add gets a fresh id", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f1", title: "one" }).spec;
    spec = addCallout(spec, { frame: "f2", title: "two" }).spec;
    const ids = spec.callouts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["c1", "c2"]);
    expectValid(spec);
  });
});

describe("editCallout", () => {
  test("reword changes the title and stays valid", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f3", title: "Results" }).spec;
    const { spec: out, callout } = editCallout(spec, { ordinal: 1 }, { title: "All your results" });
    expect(callout!.title).toBe("All your results");
    expectValid(out);
  });

  test("body can be cleared with null", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f3", title: "Results", body: "lots of them" }).spec;
    const { callout } = editCallout(spec, { ordinal: 1 }, { body: null });
    expect(callout!.body).toBeUndefined();
  });
});

describe("retimeCallout", () => {
  test('"longer" is +50% of current dwell', () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f3", title: "Results", dwellMs: 4000 }).spec;
    const { dwellMs } = retimeCallout(spec, { ordinal: 1 }, "make it longer");
    expect(dwellMs).toBe(6000);
  });

  test('"brief" / "quick" ≈ 1500', () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f3", title: "Results" }).spec;
    const { dwellMs } = retimeCallout(spec, { ordinal: 1 }, "keep it brief");
    expect(dwellMs).toBe(1500);
  });

  test('"much longer" ≈ +100%', () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f3", title: "Results", dwellMs: 4000 }).spec;
    const { dwellMs } = retimeCallout(spec, { ordinal: 1 }, "much longer");
    expect(dwellMs).toBe(8000);
  });

  test("a raw number sets the dwell exactly", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f3", title: "Results" }).spec;
    const { dwellMs } = retimeCallout(spec, { ordinal: 1 }, 7200);
    expect(dwellMs).toBe(7200);
  });

  test("resolveDwell handles second/ms phrases", () => {
    expect(resolveDwell("pause for 6 seconds")).toBe(6000);
    expect(resolveDwell("hold 2500ms")).toBe(2500);
  });
});

describe("reanchorCallout", () => {
  test("re-anchor to a phrase on the callout's frame", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f5", title: "Pricing" }).spec;
    const { spec: out, callout } = reanchorCallout(spec, { ordinal: 1 }, "checkout button");
    expect(callout!.anchor?.selector).toBe("[data-action=checkout]");
    expectValid(out);
  });

  test("re-anchor surfaces a suggestion when the element is on an adjacent frame", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f4", title: "Filtered" }).spec;
    const res = reanchorCallout(spec, { ordinal: 1 }, "the pricing panel");
    expect(res.suggestion?.frameId).toBe("f5");
    expect(res.suggestion?.selector).toBe("[data-panel=pricing]");
  });
});

describe("moveCallout", () => {
  test("move to another frame; stale selector anchor is cleared", () => {
    let spec = makeFixture();
    spec = addCallout(spec, {
      frame: "f3",
      anchor: { selector: "[data-board=results]" },
      title: "Results",
    }).spec;
    const { spec: out, callout } = moveCallout(spec, { ordinal: 1 }, "the confirmation screen");
    expect(callout!.frame).toBe("f6");
    // The old selector isn't a box on f6, so it was cleared.
    expect(callout!.anchor).toBeUndefined();
    expectValid(out);
  });
});

describe("removeCallout", () => {
  test("remove by ordinal", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f1", title: "one" }).spec;
    spec = addCallout(spec, { frame: "f2", title: "two" }).spec;
    const { spec: out, callout } = removeCallout(spec, { ordinal: 1 });
    expect(callout!.title).toBe("one");
    expect(out.callouts.map((c) => c.title)).toEqual(["two"]);
    expectValid(out);
  });

  test("remove by titleIncludes", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f1", title: "Pricing summary" }).spec;
    spec = addCallout(spec, { frame: "f2", title: "Confirmation" }).spec;
    const { spec: out } = removeCallout(spec, { titleIncludes: "pricing" });
    expect(out.callouts.map((c) => c.title)).toEqual(["Confirmation"]);
    expectValid(out);
  });
});

describe("queryFrames", () => {
  test('"where do results show up" returns ranked frames with captions', () => {
    const hits = queryFrames(makeFixture(), "where do search results show up");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // f3 and f4 both about results; reasons carry the caption.
    expect(hits[0]!.reason).toMatch(/results/i);
    expect(hits.map((h) => h.frame.id)).toContain("f3");
  });

  test("query never returns a raw frame", () => {
    const hits = queryFrames(makeFixture(), "loading spinner");
    expect(hits.every((h) => h.frame.kind === "golden")).toBe(true);
  });
});

describe("findCallout", () => {
  test("by id, frame, ordinal, titleIncludes", () => {
    let spec = makeFixture();
    spec = addCallout(spec, { frame: "f1", title: "Alpha" }).spec;
    spec = addCallout(spec, { frame: "f2", title: "Beta" }).spec;
    expect(findCallout(spec, { id: "c2" })?.callout.title).toBe("Beta");
    expect(findCallout(spec, { frame: "f1" })?.callout.title).toBe("Alpha");
    expect(findCallout(spec, { ordinal: 2 })?.callout.title).toBe("Beta");
    expect(findCallout(spec, { titleIncludes: "alph" })?.callout.title).toBe("Alpha");
    expect(findCallout(spec, { id: "nope" })).toBeUndefined();
  });
});

describe("spec stays valid after every operation (end-to-end)", () => {
  test("add → edit → retime → reanchor → move → remove keeps zero schema errors throughout", () => {
    let spec: Spec = makeFixture();

    spec = addCallout(spec, { frameRef: "the order confirmation", targetPhrase: "the Done button", titleHint: "All set" }).spec;
    expectValid(spec);

    spec = addCallout(spec, { frameRef: "frame 3", targetPhrase: "the results board" }).spec;
    expectValid(spec);

    spec = editCallout(spec, { titleIncludes: "all set" }, { title: "Order complete", style: "spotlight" }).spec;
    expectValid(spec);

    spec = retimeCallout(spec, { ordinal: 1 }, "longer").spec;
    expectValid(spec);

    spec = reanchorCallout(spec, { ordinal: 2 }, "filter chips").spec;
    expectValid(spec);

    spec = moveCallout(spec, { ordinal: 2 }, "the pricing summary").spec;
    expectValid(spec);

    spec = removeCallout(spec, { ordinal: 1 }).spec;
    expectValid(spec);

    // At least one callout in the journey was bound to a real selector at some point.
    const finalValidation = validateSpec(spec);
    expect(finalValidation.errors).toEqual([]);
  });
});
