import { describe, test, expect } from "vitest";
import { makeFixture } from "./fixture.test.js";
import { resolveFrame, resolveAnchor, draftCopy } from "./resolve.js";
import type { Spec } from "../spec/index.js";

describe("resolveFrame — numeric & positional", () => {
  test('"frame 3" resolves to the golden frame with n=3', () => {
    const r = resolveFrame(makeFixture(), "frame 3");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.id).toBe("f3");
  });

  test('"around 4" with an exact n=4 returns that frame', () => {
    const r = resolveFrame(makeFixture(), "around 4");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.id).toBe("f4");
  });

  test('"around 99" returns the nearest golden frame (last)', () => {
    const r = resolveFrame(makeFixture(), "around 99");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.id).toBe("f6");
  });

  test('"start" → first golden frame', () => {
    const r = resolveFrame(makeFixture(), "the start");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.id).toBe("f1");
  });

  test('"near the end" → last golden frame', () => {
    const r = resolveFrame(makeFixture(), "near the end");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.id).toBe("f6");
  });

  test('"middle" → median golden frame', () => {
    const r = resolveFrame(makeFixture(), "the middle");
    expect(r.kind).toBe("resolved");
    // 6 golden frames (f1..f6), median index floor(5/2)=2 → f3.
    if (r.kind === "resolved") expect(r.frame.id).toBe("f3");
  });

  test("numeric resolution never returns a raw frame", () => {
    const r = resolveFrame(makeFixture(), "frame 7");
    // n=7 is the raw frame; nearest golden is f6.
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.kind).toBe("golden");
  });
});

describe("resolveFrame — semantic", () => {
  test('"where the pricing updates" → pricing frame f5', () => {
    const r = resolveFrame(makeFixture(), "the frame where pricing updates");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.id).toBe("f5");
  });

  test('"order confirmation" → f6', () => {
    const r = resolveFrame(makeFixture(), "the order confirmation");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.frame.id).toBe("f6");
  });

  test('ambiguous "results board" returns candidates (f3 & f4 share the theme)', () => {
    const r = resolveFrame(makeFixture(), "the results board");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      const ids = r.candidates.map((f) => f.id).sort();
      expect(ids).toContain("f3");
      expect(ids).toContain("f4");
      expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("no match returns none", () => {
    const r = resolveFrame(makeFixture(), "quantum teleportation hyperdrive");
    expect(r.kind).toBe("none");
  });
});

describe("resolveAnchor", () => {
  test("phrase matches a real box selector on the frame", () => {
    const spec = makeFixture();
    const a = resolveAnchor(spec, "f3", "the results board");
    expect(a.kind).toBe("selector");
    if (a.kind === "selector") {
      expect(a.selector).toBe("[data-board=results]");
      // the selector must exist in that frame's boxes
      const frame = spec.frames.find((f) => f.id === "f3")!;
      expect(frame.boxes.some((b) => b.selector === a.selector)).toBe(true);
    }
  });

  test("matches by label tokens (e.g. checkout)", () => {
    const a = resolveAnchor(makeFixture(), "f5", "the checkout button");
    expect(a.kind).toBe("selector");
    if (a.kind === "selector") expect(a.selector).toBe("[data-action=checkout]");
  });

  test("suggests an adjacent frame when the element is there instead", () => {
    // "pricing" lives on f5; ask to anchor it on f4 (adjacent).
    const a = resolveAnchor(makeFixture(), "f4", "the pricing panel");
    expect(a.kind).toBe("suggestFrame");
    if (a.kind === "suggestFrame") {
      expect(a.frameId).toBe("f5");
      expect(a.selector).toBe("[data-panel=pricing]");
    }
  });

  test("returns none when nothing matches anywhere nearby", () => {
    const a = resolveAnchor(makeFixture(), "f1", "the spaceship console");
    expect(a.kind).toBe("none");
  });
});

describe("draftCopy — voice enforcement", () => {
  test("plain default produces no em-dash even when the source has one", () => {
    const spec = makeFixture();
    // Inject an em-dash into the caption to prove it gets stripped.
    spec.frames[2]!.caption = "Search results aggregate — into a board";
    const c = draftCopy(spec, "f3");
    expect(c.title).not.toMatch(/[—–]/);
    if (c.body) expect(c.body).not.toMatch(/[—–]/);
  });

  test("title is drawn from the caption", () => {
    const c = draftCopy(makeFixture(), "f5");
    expect(c.title.toLowerCase()).toContain("pricing");
  });

  test("hint takes precedence as the title", () => {
    const c = draftCopy(makeFixture(), "f3", "Hotels, aggregated");
    expect(c.title).toBe("Hotels, aggregated");
  });

  test("allowEmDash:true lets an em-dash through", () => {
    const spec: Spec = makeFixture();
    spec.meta.voice = { style: "house", allowEmDash: true };
    spec.frames[2]!.caption = "Search results aggregate — into a board";
    const c = draftCopy(spec, "f3", "Results aggregate — fast");
    expect(c.title).toMatch(/[—]/);
  });
});
