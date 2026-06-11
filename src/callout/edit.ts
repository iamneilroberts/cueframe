/**
 * Immutable spec-edit library for Cueframe callouts (GOAL.md §5 D4).
 *
 * Every operation returns a NEW Spec (the input is never mutated) and re-runs
 * `validateSpec` on the result, throwing a descriptive error if the edit would
 * introduce any schema error. Anchor selectors are only ever written when they
 * actually exist in the target frame's boxes, so the spec always stays valid:
 * zero schema errors after every operation.
 *
 * Callout authoring sits on top of the natural-language resolvers in `resolve.ts`.
 */

import type {
  Spec,
  Callout,
  CalloutAnchor,
  CalloutStyle,
  FrameRecord,
  Rect,
} from "../spec/index.js";
import {
  frameById,
  goldenFrames,
  validateSpec,
  formatValidation,
  DEFAULT_DWELL_MS,
} from "../spec/index.js";
import {
  resolveFrame,
  resolveAnchor,
  resolveRelativeToCallout,
  draftCopy,
  tokenize,
  type FrameResolution,
} from "./resolve.js";

// ---------------------------------------------------------------------------
// Callout identification
// ---------------------------------------------------------------------------

/** How a caller names an existing callout to edit/remove. */
export type CalloutRef =
  | { id: string }
  | { ordinal: number } // 1-based: "the third callout"
  | { frame: string } // bound to this frame id
  | { titleIncludes: string };

export interface FoundCallout {
  callout: Callout;
  index: number;
}

/** Locate a callout by id, 1-based ordinal, frame binding, or title substring. */
export function findCallout(spec: Spec, ref: CalloutRef): FoundCallout | undefined {
  const callouts = spec.callouts;
  if ("id" in ref) {
    const index = callouts.findIndex((c) => c.id === ref.id);
    return index >= 0 ? { callout: callouts[index]!, index } : undefined;
  }
  if ("ordinal" in ref) {
    const index = ref.ordinal - 1;
    if (index >= 0 && index < callouts.length) {
      return { callout: callouts[index]!, index };
    }
    return undefined;
  }
  if ("frame" in ref) {
    const index = callouts.findIndex((c) => c.frame === ref.frame);
    return index >= 0 ? { callout: callouts[index]!, index } : undefined;
  }
  // titleIncludes
  const needle = ref.titleIncludes.toLowerCase();
  const index = callouts.findIndex((c) => c.title.toLowerCase().includes(needle));
  return index >= 0 ? { callout: callouts[index]!, index } : undefined;
}

// ---------------------------------------------------------------------------
// Result type & internal helpers
// ---------------------------------------------------------------------------

export interface EditResult {
  spec: Spec;
  callout?: Callout;
}

/** Deep-ish clone the spec so edits never mutate the caller's object. */
function cloneSpec(spec: Spec): Spec {
  return {
    meta: { ...spec.meta, viewport: { ...spec.meta.viewport }, voice: spec.meta.voice ? { ...spec.meta.voice } : undefined },
    frames: spec.frames,
    callouts: spec.callouts.map((c) => ({
      ...c,
      anchor: c.anchor ? { ...c.anchor, rect: c.anchor.rect ? { ...c.anchor.rect } : undefined } : undefined,
    })),
  };
}

/** Re-validate; throw with a formatted report if the edit introduced a schema error. */
function assertValidAfter(spec: Spec, op: string): void {
  const r = validateSpec(spec);
  if (r.errors.length > 0) {
    throw new Error(`${op} would make the spec invalid:\n${formatValidation(r)}`);
  }
}

/** Next free callout id of the form `c{n}`, avoiding all existing ids. */
function nextCalloutId(spec: Spec): string {
  const used = new Set(spec.callouts.map((c) => c.id));
  let n = spec.callouts.length + 1;
  while (used.has(`c${n}`)) n += 1;
  return `c${n}`;
}

/** Resolve a frame reference (number/position/semantic/relative-to-callout) to a frame id. */
function resolveFrameRefToId(spec: Spec, frameRef: string): { frame: FrameRecord; reason: string } {
  // Try relative-to-callout first only when it clearly mentions a callout.
  const rel = resolveRelativeToCallout(spec, frameRef);
  let res: FrameResolution | undefined = rel && rel.kind === "resolved" ? rel : undefined;
  if (!res) res = resolveFrame(spec, frameRef);

  if (res.kind === "resolved") return { frame: res.frame, reason: res.reason };
  if (res.kind === "ambiguous") {
    const list = res.candidates.map((f) => `${f.id} (n=${f.n}): "${f.caption}"`).join("; ");
    throw new Error(`frame reference "${frameRef}" is ambiguous between: ${list}`);
  }
  throw new Error(`could not resolve frame reference "${frameRef}"`);
}

// ---------------------------------------------------------------------------
// addCallout
// ---------------------------------------------------------------------------

/** Explicit add: caller supplies the frame id and copy directly. */
export interface AddExplicitArgs {
  frame: string;
  anchor?: CalloutAnchor;
  title: string;
  body?: string;
  eyebrow?: string;
  dwellMs?: number;
  style?: CalloutStyle;
}

/** NL-assisted add: caller describes the frame + target; resolvers fill the rest. */
export interface AddAssistedArgs {
  frameRef?: string;
  targetPhrase?: string;
  titleHint?: string;
  /** Optional explicit overrides layered on top of the drafted copy. */
  title?: string;
  body?: string;
  eyebrow?: string;
  dwellMs?: number;
  style?: CalloutStyle;
}

export type AddCalloutArgs = AddExplicitArgs | AddAssistedArgs;

function isExplicitAdd(args: AddCalloutArgs): args is AddExplicitArgs {
  return typeof (args as AddExplicitArgs).frame === "string"
    && typeof (args as AddExplicitArgs).title === "string";
}

/**
 * Add a callout. Two shapes:
 *  - Explicit: `{ frame, anchor?, title, body?, eyebrow?, dwellMs?, style? }`.
 *  - NL-assisted: `{ frameRef?, targetPhrase?, titleHint? }` — runs resolveFrame /
 *    resolveAnchor / draftCopy to fill the frame, a real-box anchor, and the copy.
 *
 * Generates the next free `c{n}` id, appends, and re-validates.
 */
export function addCallout(spec: Spec, args: AddCalloutArgs): EditResult {
  const next = cloneSpec(spec);
  const id = nextCalloutId(next);

  let callout: Callout;

  if (isExplicitAdd(args)) {
    const frame = frameById(next, args.frame);
    if (!frame) throw new Error(`addCallout: frame "${args.frame}" does not exist`);
    callout = {
      id,
      frame: args.frame,
      title: args.title,
    };
    if (args.anchor) callout.anchor = normalizeAnchor(args.anchor, frame);
    if (args.body !== undefined) callout.body = args.body;
    if (args.eyebrow !== undefined) callout.eyebrow = args.eyebrow;
    if (args.dwellMs !== undefined) callout.dwellMs = args.dwellMs;
    if (args.style !== undefined) callout.style = args.style;
  } else {
    // NL-assisted.
    const frameRef = args.frameRef ?? "";
    const { frame } = resolveFrameRefToId(spec, frameRef);

    // Copy: explicit title wins; else draft from the hint + frame.
    const drafted = draftCopy(spec, frame.id, args.titleHint ?? args.targetPhrase);
    const title = args.title ?? drafted.title;
    const body = args.body ?? drafted.body;

    callout = { id, frame: frame.id, title };
    if (body !== undefined) callout.body = body;
    if (args.eyebrow !== undefined) callout.eyebrow = args.eyebrow;
    if (args.dwellMs !== undefined) callout.dwellMs = args.dwellMs;
    if (args.style !== undefined) callout.style = args.style;

    // Anchor: auto-anchor to a real box selector if a target phrase resolves.
    if (args.targetPhrase && args.targetPhrase.trim().length > 0) {
      const a = resolveAnchor(spec, frame.id, args.targetPhrase);
      if (a.kind === "selector") {
        callout.anchor = { selector: a.selector };
      } else if (a.kind === "suggestFrame") {
        // The element lives on an adjacent frame — rebind there and anchor.
        callout.frame = a.frameId;
        callout.anchor = { selector: a.selector };
      }
      // kind "rect"/"none": leave anchorless (floating card) — still valid.
    }
  }

  next.callouts = [...next.callouts, callout];
  assertValidAfter(next, "addCallout");
  return { spec: next, callout };
}

/** Keep an anchor only if its selector truly exists on the frame; else fall back to rect. */
function normalizeAnchor(anchor: CalloutAnchor, frame: FrameRecord): CalloutAnchor | undefined {
  const out: CalloutAnchor = {};
  if (anchor.selector !== undefined) {
    if (frame.boxes.some((b) => b.selector === anchor.selector)) {
      out.selector = anchor.selector;
    } else if (anchor.rect === undefined) {
      throw new Error(
        `anchor.selector "${anchor.selector}" is not a box on frame "${frame.id}"`,
      );
    }
  }
  if (anchor.rect !== undefined) out.rect = anchor.rect;
  if (out.selector === undefined && out.rect === undefined) return undefined;
  return out;
}

// ---------------------------------------------------------------------------
// editCallout
// ---------------------------------------------------------------------------

export interface CalloutPatch {
  title?: string;
  body?: string | null; // null clears
  eyebrow?: string | null;
  dwellMs?: number;
  style?: CalloutStyle;
}

/** Reword / restyle / retime / re-eyebrow / body an existing callout. */
export function editCallout(spec: Spec, ref: CalloutRef, patch: CalloutPatch): EditResult {
  const found = findCallout(spec, ref);
  if (!found) throw new Error(`editCallout: no callout matched ${JSON.stringify(ref)}`);

  const next = cloneSpec(spec);
  const target = next.callouts[found.index]!;

  if (patch.title !== undefined) target.title = patch.title;
  if (patch.body !== undefined) {
    if (patch.body === null) delete target.body;
    else target.body = patch.body;
  }
  if (patch.eyebrow !== undefined) {
    if (patch.eyebrow === null) delete target.eyebrow;
    else target.eyebrow = patch.eyebrow;
  }
  if (patch.dwellMs !== undefined) target.dwellMs = patch.dwellMs;
  if (patch.style !== undefined) target.style = patch.style;

  assertValidAfter(next, "editCallout");
  return { spec: next, callout: target };
}

// ---------------------------------------------------------------------------
// removeCallout
// ---------------------------------------------------------------------------

/** Remove a callout identified by ref. */
export function removeCallout(spec: Spec, ref: CalloutRef): EditResult {
  const found = findCallout(spec, ref);
  if (!found) throw new Error(`removeCallout: no callout matched ${JSON.stringify(ref)}`);

  const next = cloneSpec(spec);
  const [removed] = next.callouts.splice(found.index, 1);
  assertValidAfter(next, "removeCallout");
  return { spec: next, callout: removed };
}

// ---------------------------------------------------------------------------
// retimeCallout
// ---------------------------------------------------------------------------

/** A dwell time stated as a number (ms) or a phrase ("longer", "brief", "much longer"). */
export type TimeArg = number | string;

export interface RetimeResult extends EditResult {
  /** The dwell value (ms) that was chosen. */
  dwellMs: number;
}

/**
 * Resolve a time phrase to a concrete dwell (ms), relative to a base dwell.
 *  - number → that number.
 *  - "brief" / "quick" / "flash" → ~1500.
 *  - "much longer" → +100% of base.
 *  - "longer" / "slower" → +50% of base.
 *  - "shorter" / "faster" → -33% of base (floored at 1000).
 */
export function resolveDwell(arg: TimeArg, base: number = DEFAULT_DWELL_MS): number {
  if (typeof arg === "number") return Math.round(arg);
  const lower = arg.toLowerCase();

  // An explicit number inside the phrase ("pause for 6000", "6 seconds").
  const secMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  if (secMatch && secMatch[1] !== undefined) return Math.round(parseFloat(secMatch[1]) * 1000);
  const msMatch = lower.match(/\b(\d+)\s*(?:ms|milliseconds?)\b/);
  if (msMatch && msMatch[1] !== undefined) return parseInt(msMatch[1], 10);

  if (/\b(brief|quick|flash|short(?:er)?|snappy)\b/.test(lower)) {
    if (/\b(shorter|faster)\b/.test(lower)) return Math.max(1000, Math.round(base * 0.67));
    return 1500;
  }
  if (/\bmuch\s+longer\b/.test(lower) || /\b(double|twice)\b/.test(lower)) {
    return Math.round(base * 2);
  }
  if (/\b(longer|slower|more)\b/.test(lower)) return Math.round(base * 1.5);

  // Unrecognized phrase → leave base unchanged.
  return Math.round(base);
}

/** Retime a callout. The time arg accepts a number (ms) or a phrase. */
export function retimeCallout(spec: Spec, ref: CalloutRef, time: TimeArg): RetimeResult {
  const found = findCallout(spec, ref);
  if (!found) throw new Error(`retimeCallout: no callout matched ${JSON.stringify(ref)}`);

  const base = found.callout.dwellMs ?? DEFAULT_DWELL_MS;
  const dwellMs = resolveDwell(time, base);

  const next = cloneSpec(spec);
  const target = next.callouts[found.index]!;
  target.dwellMs = dwellMs;

  assertValidAfter(next, "retimeCallout");
  return { spec: next, callout: target, dwellMs };
}

// ---------------------------------------------------------------------------
// reanchorCallout
// ---------------------------------------------------------------------------

export interface ReanchorResult extends EditResult {
  /** Set when the matched element lives on a different golden frame. */
  suggestion?: { frameId: string; selector: string };
}

/**
 * Re-resolve the anchor for a callout against a new target phrase, on the callout's
 * current frame. If the element is found there → set the selector. If it's only on an
 * adjacent golden frame → leave the callout untouched and return a `suggestion`.
 */
export function reanchorCallout(spec: Spec, ref: CalloutRef, targetPhrase: string): ReanchorResult {
  const found = findCallout(spec, ref);
  if (!found) throw new Error(`reanchorCallout: no callout matched ${JSON.stringify(ref)}`);

  const a = resolveAnchor(spec, found.callout.frame, targetPhrase);

  const next = cloneSpec(spec);
  const target = next.callouts[found.index]!;

  if (a.kind === "selector") {
    target.anchor = { selector: a.selector };
    assertValidAfter(next, "reanchorCallout");
    return { spec: next, callout: target };
  }
  if (a.kind === "suggestFrame") {
    // Don't silently move the callout; surface the better frame to the caller.
    return { spec, callout: found.callout, suggestion: { frameId: a.frameId, selector: a.selector } };
  }
  if (a.kind === "rect") {
    target.anchor = { rect: a.rect };
    assertValidAfter(next, "reanchorCallout");
    return { spec: next, callout: target };
  }
  // none — clear any selector anchor so we don't leave a stale one (a manual rect stays).
  if (target.anchor?.selector !== undefined) {
    delete target.anchor.selector;
    if (target.anchor.rect === undefined) delete target.anchor;
  }
  assertValidAfter(next, "reanchorCallout");
  return { spec: next, callout: target };
}

// ---------------------------------------------------------------------------
// moveCallout
// ---------------------------------------------------------------------------

/**
 * Rebind a callout to another frame (resolved from a natural-language frameRef).
 * The anchor is re-validated against the new frame: if the existing selector isn't a box
 * there, it is cleared (the player will park the card) rather than left dangling.
 */
export function moveCallout(spec: Spec, ref: CalloutRef, frameRef: string): EditResult {
  const found = findCallout(spec, ref);
  if (!found) throw new Error(`moveCallout: no callout matched ${JSON.stringify(ref)}`);

  const { frame } = resolveFrameRefToId(spec, frameRef);

  const next = cloneSpec(spec);
  const target = next.callouts[found.index]!;
  target.frame = frame.id;

  // Re-validate the anchor against the new frame.
  if (target.anchor?.selector !== undefined) {
    const stillValid = frame.boxes.some((b) => b.selector === target.anchor!.selector);
    if (!stillValid) {
      delete target.anchor.selector;
      if (target.anchor.rect === undefined) delete target.anchor;
    }
  }

  assertValidAfter(next, "moveCallout");
  return { spec: next, callout: target };
}

// ---------------------------------------------------------------------------
// queryFrames
// ---------------------------------------------------------------------------

export interface FrameQueryHit {
  frame: FrameRecord;
  reason: string;
}

/**
 * "Where does X happen?" — rank GOLDEN frames by token overlap against the query and
 * return them with their captions. No edit. Returns at most the matching frames, best
 * first; ties broken by earliest n.
 */
export function queryFrames(spec: Spec, query: string): FrameQueryHit[] {
  const golden = goldenFrames(spec);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = golden
    .map((frame, idx) => {
      const hay = new Set(tokenize(`${frame.caption} ${frame.axDigest} ${frame.boxes.map((b) => `${b.label ?? ""} ${b.selector}`).join(" ")} ${frame.action?.label ?? ""}`));
      const hayList = [...hay];
      let score = 0;
      for (const qt of queryTokens) {
        if (hay.has(qt)) score += 1;
        else if (hayList.some((ht) => ht.includes(qt) || qt.includes(ht))) score += 0.5;
      }
      return { frame, idx, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  return scored.map((s) => ({
    frame: s.frame,
    reason: `frame ${s.frame.id} (n=${s.frame.n}): "${s.frame.caption}"`,
  }));
}
