/**
 * Runtime validator for Cueframe `spec.json` (GOAL.md §3 + §3.1).
 *
 * Two failure classes are reported separately because the Definition of Done (§6.3)
 * checks them independently:
 *   - `errors`   — structural / schema violations.
 *   - `defects`  — capture-quality violations on GOLDEN frames (the §3.1 hard contract:
 *                  every golden frame needs a real caption, a real axDigest, and at least
 *                  one real box). Thin frames silently kill the callout experience, so the
 *                  validator treats them as first-class failures.
 *   - `warnings` — non-fatal advisories (e.g. a callout bound to a raw frame).
 *
 * `valid` is true iff there are zero errors AND zero defects.
 */

import type {
  Spec,
  FrameRecord,
  Box,
  Rect,
  Callout,
  CalloutStyle,
} from "./types.js";

export interface ValidationIssue {
  /** Stable machine code, e.g. "no_real_box". */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** JSON-ish path to the offending value, e.g. "frames[3].caption". */
  path: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  defects: ValidationIssue[];
  warnings: ValidationIssue[];
}

const CALLOUT_STYLES: readonly CalloutStyle[] = ["card", "spotlight", "arrow"];
const FRAME_KINDS = ["golden", "raw"] as const;

/** Caption text that is a placeholder rather than a real description (§3.1). */
const PLACEHOLDER_CAPTION = /^\s*frame\s*#?\s*\d+\s*$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  // Require a date-ish shape (year-month-day), not just any Date.parse-able string.
  return /^\d{4}-\d{2}-\d{2}/.test(v);
}

function validateRect(rect: unknown, path: string, errors: ValidationIssue[]): rect is Rect {
  if (!isObject(rect)) {
    errors.push({ code: "rect_invalid", message: "rect must be an object", path });
    return false;
  }
  let ok = true;
  for (const k of ["x", "y", "w", "h"] as const) {
    if (!isFiniteNumber(rect[k])) {
      errors.push({
        code: "rect_invalid",
        message: `rect.${k} must be a finite number`,
        path: `${path}.${k}`,
      });
      ok = false;
    }
  }
  return ok;
}

function validateBox(box: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isObject(box)) {
    errors.push({ code: "box_invalid", message: "box must be an object", path });
    return;
  }
  if (typeof box.selector !== "string") {
    errors.push({
      code: "box_invalid",
      message: "box.selector must be a string",
      path: `${path}.selector`,
    });
  }
  validateRect(box.rect, `${path}.rect`, errors);
  if (box.label !== undefined && typeof box.label !== "string") {
    errors.push({
      code: "box_invalid",
      message: "box.label must be a string when present",
      path: `${path}.label`,
    });
  }
}

/** A box that satisfies the §3.1 "real box" bar: real selector + non-degenerate rect. */
function isRealBox(box: Box): boolean {
  return (
    isNonEmptyString(box.selector) &&
    isObject(box.rect) &&
    isFiniteNumber(box.rect.w) &&
    isFiniteNumber(box.rect.h) &&
    box.rect.w > 0 &&
    box.rect.h > 0
  );
}

function validateMeta(meta: unknown, errors: ValidationIssue[]): void {
  if (!isObject(meta)) {
    errors.push({ code: "meta_invalid", message: "meta must be an object", path: "meta" });
    return;
  }
  if (!isNonEmptyString(meta.title)) {
    errors.push({ code: "meta_invalid", message: "meta.title must be a non-empty string", path: "meta.title" });
  }
  if (typeof meta.app !== "string") {
    errors.push({ code: "meta_invalid", message: "meta.app must be a string", path: "meta.app" });
  }
  if (!isIsoDate(meta.createdAt)) {
    errors.push({
      code: "meta_invalid",
      message: "meta.createdAt must be an ISO-8601 date string",
      path: "meta.createdAt",
    });
  }
  if (!isObject(meta.viewport) || !isFiniteNumber(meta.viewport.w) || !isFiniteNumber(meta.viewport.h)) {
    errors.push({
      code: "meta_invalid",
      message: "meta.viewport must be { w: number, h: number }",
      path: "meta.viewport",
    });
  }
  if (meta.voice !== undefined) {
    if (!isObject(meta.voice)) {
      errors.push({ code: "meta_invalid", message: "meta.voice must be an object when present", path: "meta.voice" });
    } else {
      const v = meta.voice;
      if (v.style !== undefined && typeof v.style !== "string") {
        errors.push({ code: "meta_invalid", message: "meta.voice.style must be a string", path: "meta.voice.style" });
      }
      if (v.allowEmDash !== undefined && typeof v.allowEmDash !== "boolean") {
        errors.push({ code: "meta_invalid", message: "meta.voice.allowEmDash must be a boolean", path: "meta.voice.allowEmDash" });
      }
      if (v.notes !== undefined && typeof v.notes !== "string") {
        errors.push({ code: "meta_invalid", message: "meta.voice.notes must be a string", path: "meta.voice.notes" });
      }
    }
  }
}

function validateFrame(
  frame: unknown,
  index: number,
  errors: ValidationIssue[],
  defects: ValidationIssue[],
): void {
  const path = `frames[${index}]`;
  if (!isObject(frame)) {
    errors.push({ code: "frame_invalid", message: "frame must be an object", path });
    return;
  }
  if (!isNonEmptyString(frame.id)) {
    errors.push({ code: "frame_invalid", message: "frame.id must be a non-empty string", path: `${path}.id` });
  }
  if (!isFiniteNumber(frame.n)) {
    errors.push({ code: "frame_invalid", message: "frame.n must be a finite number", path: `${path}.n` });
  }
  if (frame.kind !== "golden" && frame.kind !== "raw") {
    errors.push({
      code: "frame_invalid",
      message: `frame.kind must be one of ${FRAME_KINDS.join(" | ")}`,
      path: `${path}.kind`,
    });
  }
  if (!isNonEmptyString(frame.img)) {
    errors.push({ code: "frame_invalid", message: "frame.img must be a non-empty string", path: `${path}.img` });
  }
  if (typeof frame.caption !== "string") {
    errors.push({ code: "frame_invalid", message: "frame.caption must be a string", path: `${path}.caption` });
  }
  if (typeof frame.axDigest !== "string") {
    errors.push({ code: "frame_invalid", message: "frame.axDigest must be a string", path: `${path}.axDigest` });
  }
  if (!Array.isArray(frame.boxes)) {
    errors.push({ code: "frame_invalid", message: "frame.boxes must be an array", path: `${path}.boxes` });
  } else {
    frame.boxes.forEach((b, i) => validateBox(b, `${path}.boxes[${i}]`, errors));
  }
  if (frame.action !== undefined) {
    if (!isObject(frame.action) || typeof frame.action.label !== "string" || typeof frame.action.selector !== "string") {
      errors.push({
        code: "frame_invalid",
        message: "frame.action must be { label: string, selector: string } when present",
        path: `${path}.action`,
      });
    }
  }

  // --- §3.1 capture-quality contract — golden frames only ---
  if (frame.kind === "golden") {
    if (typeof frame.caption === "string" && !isNonEmptyString(frame.caption)) {
      defects.push({
        code: "empty_caption",
        message: "golden frame must have a non-empty caption (§3.1)",
        path: `${path}.caption`,
      });
    } else if (typeof frame.caption === "string" && PLACEHOLDER_CAPTION.test(frame.caption)) {
      defects.push({
        code: "placeholder_caption",
        message: `golden frame caption "${frame.caption}" is a placeholder, not a real description (§3.1)`,
        path: `${path}.caption`,
      });
    }
    if (typeof frame.axDigest === "string" && !isNonEmptyString(frame.axDigest)) {
      defects.push({
        code: "empty_ax_digest",
        message: "golden frame must have a non-empty axDigest (§3.1)",
        path: `${path}.axDigest`,
      });
    }
    if (Array.isArray(frame.boxes)) {
      const hasReal = (frame.boxes as Box[]).some((b) => isObject(b) && isRealBox(b));
      if (!hasReal) {
        defects.push({
          code: "no_real_box",
          message:
            "golden frame must have at least one real box (non-empty selector + non-degenerate pixel rect) (§3.1)",
          path: `${path}.boxes`,
        });
      }
    }
  }
}

function validateCallout(
  callout: unknown,
  index: number,
  frames: FrameRecord[],
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const path = `callouts[${index}]`;
  if (!isObject(callout)) {
    errors.push({ code: "callout_invalid", message: "callout must be an object", path });
    return;
  }
  if (!isNonEmptyString(callout.id)) {
    errors.push({ code: "callout_invalid", message: "callout.id must be a non-empty string", path: `${path}.id` });
  }
  if (!isNonEmptyString(callout.title)) {
    errors.push({ code: "callout_invalid", message: "callout.title must be a non-empty string", path: `${path}.title` });
  }
  if (callout.eyebrow !== undefined && typeof callout.eyebrow !== "string") {
    errors.push({ code: "callout_invalid", message: "callout.eyebrow must be a string", path: `${path}.eyebrow` });
  }
  if (callout.body !== undefined && typeof callout.body !== "string") {
    errors.push({ code: "callout_invalid", message: "callout.body must be a string", path: `${path}.body` });
  }
  if (callout.dwellMs !== undefined && !isFiniteNumber(callout.dwellMs)) {
    errors.push({ code: "callout_invalid", message: "callout.dwellMs must be a finite number", path: `${path}.dwellMs` });
  }
  if (callout.style !== undefined && !CALLOUT_STYLES.includes(callout.style as CalloutStyle)) {
    errors.push({
      code: "callout_invalid",
      message: `callout.style must be one of ${CALLOUT_STYLES.join(" | ")}`,
      path: `${path}.style`,
    });
  }

  // Frame reference (§3.2).
  const frame = typeof callout.frame === "string" ? frames.find((f) => f.id === callout.frame) : undefined;
  if (typeof callout.frame !== "string") {
    errors.push({ code: "callout_invalid", message: "callout.frame must be a string", path: `${path}.frame` });
  } else if (!frame) {
    errors.push({
      code: "callout_frame_missing",
      message: `callout.frame "${callout.frame}" does not reference an existing frame`,
      path: `${path}.frame`,
    });
  } else if (frame.kind === "raw") {
    warnings.push({
      code: "callout_on_raw_frame",
      message: `callout binds to raw frame "${frame.id}" — it will not appear in exports`,
      path: `${path}.frame`,
    });
  }

  // Anchor (§3.2): if a selector is set it MUST exist in the target frame's boxes.
  if (callout.anchor !== undefined) {
    if (!isObject(callout.anchor)) {
      errors.push({ code: "callout_invalid", message: "callout.anchor must be an object when present", path: `${path}.anchor` });
    } else {
      const anchor = callout.anchor;
      if (anchor.selector !== undefined) {
        if (typeof anchor.selector !== "string") {
          errors.push({ code: "callout_invalid", message: "anchor.selector must be a string", path: `${path}.anchor.selector` });
        } else if (frame && !frame.boxes.some((b) => b.selector === anchor.selector)) {
          errors.push({
            code: "anchor_selector_missing",
            message: `anchor.selector "${anchor.selector}" is not present in frame "${frame.id}" boxes`,
            path: `${path}.anchor.selector`,
          });
        }
      }
      if (anchor.rect !== undefined) {
        validateRect(anchor.rect, `${path}.anchor.rect`, errors);
      }
    }
  }
}

export function validateSpec(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const defects: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!isObject(input)) {
    errors.push({ code: "not_an_object", message: "spec must be an object", path: "" });
    return { valid: false, errors, defects, warnings };
  }

  validateMeta(input.meta, errors);

  const framesRaw = input.frames;
  if (!Array.isArray(framesRaw)) {
    errors.push({ code: "frames_invalid", message: "spec.frames must be an array", path: "frames" });
  } else {
    framesRaw.forEach((f, i) => validateFrame(f, i, errors, defects));
    // Duplicate frame ids.
    const seen = new Map<string, number>();
    framesRaw.forEach((f, i) => {
      if (isObject(f) && typeof f.id === "string") {
        if (seen.has(f.id)) {
          errors.push({
            code: "duplicate_frame_id",
            message: `duplicate frame id "${f.id}"`,
            path: `frames[${i}].id`,
          });
        } else {
          seen.set(f.id, i);
        }
      }
    });
  }

  const calloutsRaw = input.callouts;
  // Frames known well-formed enough to look up by id (best-effort for callout checks).
  const frames: FrameRecord[] = Array.isArray(framesRaw)
    ? (framesRaw.filter((f) => isObject(f) && typeof f.id === "string") as FrameRecord[])
    : [];

  if (!Array.isArray(calloutsRaw)) {
    errors.push({ code: "callouts_invalid", message: "spec.callouts must be an array", path: "callouts" });
  } else {
    calloutsRaw.forEach((c, i) => validateCallout(c, i, frames, errors, warnings));
    // Duplicate callout ids.
    const seenC = new Map<string, number>();
    calloutsRaw.forEach((c, i) => {
      if (isObject(c) && typeof c.id === "string") {
        if (seenC.has(c.id)) {
          errors.push({ code: "duplicate_callout_id", message: `duplicate callout id "${c.id}"`, path: `callouts[${i}].id` });
        } else {
          seenC.set(c.id, i);
        }
      }
    });
    // Two callouts sharing a frame (they queue).
    const byFrame = new Map<string, number>();
    (calloutsRaw as Callout[]).forEach((c) => {
      if (isObject(c) && typeof c.frame === "string") {
        byFrame.set(c.frame, (byFrame.get(c.frame) ?? 0) + 1);
      }
    });
    for (const [frameId, count] of byFrame) {
      if (count > 1) {
        warnings.push({
          code: "callouts_share_frame",
          message: `${count} callouts bind to frame "${frameId}" — they will queue`,
          path: "callouts",
        });
      }
    }
  }

  const valid = errors.length === 0 && defects.length === 0;
  return { valid, errors, defects, warnings };
}

/** Type guard: true iff the input validates with zero errors and zero defects. */
export function isSpec(input: unknown): input is Spec {
  return validateSpec(input).valid;
}

/** Throws a descriptive Error if the input is not a valid spec. */
export function assertValidSpec(input: unknown): asserts input is Spec {
  const r = validateSpec(input);
  if (!r.valid) {
    const lines = [...r.errors, ...r.defects].map((i) => `  - [${i.code}] ${i.path}: ${i.message}`);
    throw new Error(`Invalid Cueframe spec:\n${lines.join("\n")}`);
  }
}

/** Format a validation result for human/CLI output. */
export function formatValidation(r: ValidationResult): string {
  const lines: string[] = [];
  for (const e of r.errors) lines.push(`  ERROR   [${e.code}] ${e.path || "<root>"}: ${e.message}`);
  for (const d of r.defects) lines.push(`  DEFECT  [${d.code}] ${d.path}: ${d.message}`);
  for (const w of r.warnings) lines.push(`  warn    [${w.code}] ${w.path}: ${w.message}`);
  if (lines.length === 0) lines.push("  (no issues)");
  const summary = `${r.errors.length} error(s), ${r.defects.length} capture defect(s), ${r.warnings.length} warning(s)`;
  return `${lines.join("\n")}\n${summary}`;
}
