import { describe, it, expect } from "vitest";
import type { Spec, FrameRecord, Callout } from "../spec/index.js";
import { DEFAULT_DWELL_MS } from "../spec/index.js";
import {
  buildTimeline,
  DEFAULT_BASE_HOLD_MS,
  DEFAULT_GAP_MS,
} from "./timeline.js";

function frame(id: string, n: number, kind: "golden" | "raw" = "golden"): FrameRecord {
  return {
    id,
    n,
    kind,
    img: `frames/${id}.png`,
    caption: `caption ${id}`,
    axDigest: `ax ${id}`,
    boxes: [{ selector: `#${id}`, rect: { x: 0, y: 0, w: 10, h: 10 } }],
  };
}

function callout(id: string, frameId: string, dwellMs?: number): Callout {
  const c: Callout = { id, frame: frameId, title: `title ${id}` };
  if (dwellMs !== undefined) c.dwellMs = dwellMs;
  return c;
}

function spec(frames: FrameRecord[], callouts: Callout[]): Spec {
  return {
    meta: { title: "t", app: "a", createdAt: "2026-01-01", viewport: { w: 1280, h: 800 } },
    frames,
    callouts,
  };
}

describe("buildTimeline", () => {
  it("creates one segment per golden frame, in n order", () => {
    const s = spec([frame("f2", 2), frame("f1", 1), frame("f3", 3)], []);
    const tl = buildTimeline(s);
    expect(tl.segments.map((seg) => seg.frameId)).toEqual(["f1", "f2", "f3"]);
  });

  it("excludes raw frames from segments", () => {
    const s = spec([frame("f1", 1, "golden"), frame("r1", 2, "raw"), frame("f2", 3, "golden")], []);
    const tl = buildTimeline(s);
    expect(tl.segments.map((seg) => seg.frameId)).toEqual(["f1", "f2"]);
  });

  it("a frame with no callouts just holds baseHoldMs", () => {
    const s = spec([frame("f1", 1)], []);
    const tl = buildTimeline(s);
    expect(tl.segments[0]).toMatchObject({ frameId: "f1", startMs: 0, endMs: DEFAULT_BASE_HOLD_MS });
    expect(tl.segments[0]!.callouts).toEqual([]);
    expect(tl.durationMs).toBe(DEFAULT_BASE_HOLD_MS);
  });

  it("empty spec yields no segments and zero duration", () => {
    const tl = buildTimeline(spec([], []));
    expect(tl.segments).toEqual([]);
    expect(tl.durationMs).toBe(0);
  });

  it("computes callout appear/dwell math with default dwell + gap", () => {
    const s = spec([frame("f1", 1)], [callout("c1", "f1")]);
    const tl = buildTimeline(s);
    const seg = tl.segments[0]!;
    expect(seg.startMs).toBe(0);
    expect(seg.callouts).toHaveLength(1);
    expect(seg.callouts[0]).toEqual({
      id: "c1",
      appearMs: DEFAULT_BASE_HOLD_MS,
      dwellMs: DEFAULT_DWELL_MS,
    });
    // endMs = baseHold + dwell + gap
    expect(seg.endMs).toBe(DEFAULT_BASE_HOLD_MS + DEFAULT_DWELL_MS + DEFAULT_GAP_MS);
    expect(tl.durationMs).toBe(seg.endMs);
  });

  it("honors per-callout dwellMs override", () => {
    const s = spec([frame("f1", 1)], [callout("c1", "f1", 1500)]);
    const tl = buildTimeline(s);
    const seg = tl.segments[0]!;
    expect(seg.callouts[0]!.dwellMs).toBe(1500);
    expect(seg.endMs).toBe(DEFAULT_BASE_HOLD_MS + 1500 + DEFAULT_GAP_MS);
  });

  it("queues multiple callouts on one frame in spec.callouts order", () => {
    const s = spec(
      [frame("f1", 1)],
      [callout("c1", "f1", 1000), callout("c2", "f1", 2000)],
    );
    const tl = buildTimeline(s);
    const seg = tl.segments[0]!;
    expect(seg.callouts.map((c) => c.id)).toEqual(["c1", "c2"]);
    // c1 appears after baseHold
    expect(seg.callouts[0]!.appearMs).toBe(DEFAULT_BASE_HOLD_MS);
    // c2 appears after c1's dwell + gap
    expect(seg.callouts[1]!.appearMs).toBe(DEFAULT_BASE_HOLD_MS + 1000 + DEFAULT_GAP_MS);
    expect(seg.endMs).toBe(DEFAULT_BASE_HOLD_MS + 1000 + DEFAULT_GAP_MS + 2000 + DEFAULT_GAP_MS);
  });

  it("chains segments so each starts where the previous ended", () => {
    const s = spec(
      [frame("f1", 1), frame("f2", 2)],
      [callout("c1", "f1", 1000)],
    );
    const tl = buildTimeline(s);
    const s0 = tl.segments[0]!;
    const s1 = tl.segments[1]!;
    expect(s1.startMs).toBe(s0.endMs);
    expect(s1.endMs).toBe(s1.startMs + DEFAULT_BASE_HOLD_MS);
    expect(tl.durationMs).toBe(s1.endMs);
  });

  it("respects custom baseHoldMs and gapMs options", () => {
    const s = spec([frame("f1", 1)], [callout("c1", "f1", 500)]);
    const tl = buildTimeline(s, { baseHoldMs: 300, gapMs: 50 });
    const seg = tl.segments[0]!;
    expect(seg.callouts[0]!.appearMs).toBe(300);
    expect(seg.endMs).toBe(300 + 500 + 50);
  });
});
