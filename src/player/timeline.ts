/**
 * Cueframe player timeline (D5) — a pure, deterministic time model for a spec.
 *
 * No browser, no wall clock: `buildTimeline` maps a spec to a sequence of segments
 * (one per golden frame, in order) and the callouts that appear within each segment.
 * The runtime and the headless recorder both drive playback from this model, so the
 * frames a recorder produces are a pure function of time.
 *
 * Model (see GOAL.md §5 / D5):
 *   - Iterate `goldenFrames(spec)` in order. Each becomes a segment.
 *   - A segment first HOLDS for `baseHoldMs` so the frame is readable.
 *   - Then, for each callout bound to that frame (in `spec.callouts` order), the
 *     callout appears and stays for its `dwellMs` (`callout.dwellMs ?? DEFAULT_DWELL_MS`),
 *     with a small `gapMs` between successive callouts.
 *   - Segment endMs = start + baseHold + Σ(dwell + gap) over its callouts.
 *   - durationMs = last segment endMs. A frame with no callouts just holds baseHold.
 */

import type { Spec } from "../spec/index.js";
import { goldenFrames, DEFAULT_DWELL_MS } from "../spec/index.js";

/** A callout's appearance window within the overall timeline (absolute ms). */
export interface TimelineCallout {
  id: string;
  /** Absolute ms at which the callout becomes visible. */
  appearMs: number;
  /** How long it stays visible. */
  dwellMs: number;
}

/** One golden frame's slice of the timeline. */
export interface TimelineSegment {
  frameId: string;
  /** Absolute ms at which this segment (and its frame) becomes active. */
  startMs: number;
  /** Absolute ms at which this segment ends (== next segment's startMs). */
  endMs: number;
  callouts: TimelineCallout[];
}

export interface Timeline {
  segments: TimelineSegment[];
  durationMs: number;
}

export interface TimelineOptions {
  /** Hold time before any callouts on a segment (default 1200ms). */
  baseHoldMs?: number;
  /** Gap inserted after each callout before the next one / segment end (default 200ms). */
  gapMs?: number;
}

/** Default hold before callouts appear on a segment, in ms. */
export const DEFAULT_BASE_HOLD_MS = 1200;
/** Default gap after each callout, in ms. */
export const DEFAULT_GAP_MS = 200;

export function buildTimeline(spec: Spec, opts?: TimelineOptions): Timeline {
  const baseHoldMs = opts?.baseHoldMs ?? DEFAULT_BASE_HOLD_MS;
  const gapMs = opts?.gapMs ?? DEFAULT_GAP_MS;

  const frames = goldenFrames(spec);
  const segments: TimelineSegment[] = [];
  let cursor = 0;

  for (const frame of frames) {
    const startMs = cursor;
    // Callouts bound to this frame, preserving spec.callouts order.
    const frameCallouts = spec.callouts.filter((c) => c.frame === frame.id);

    let t = startMs + baseHoldMs;
    const callouts: TimelineCallout[] = [];
    for (const c of frameCallouts) {
      const dwellMs = typeof c.dwellMs === "number" ? c.dwellMs : DEFAULT_DWELL_MS;
      callouts.push({ id: c.id, appearMs: t, dwellMs });
      t += dwellMs + gapMs;
    }

    const endMs = t;
    segments.push({ frameId: frame.id, startMs, endMs, callouts });
    cursor = endMs;
  }

  return { segments, durationMs: cursor };
}
