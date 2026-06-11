/**
 * Cueframe `spec.json` — the canonical contract that flows through all three acts
 * (Capture → Author → Play & Export). See GOAL.md §3.
 *
 * These types are the single source of truth. The runtime validator in `validate.ts`
 * enforces them (including the capture-quality contract in §3.1). Every downstream
 * library imports from here; nothing redefines the shape.
 */

/** Pixel rectangle measured at capture time, in viewport coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A meaningful element on a frame, with its selector and measured pixel rect. */
export interface Box {
  /** A real CSS/attribute selector that resolves to this element in the frame. */
  selector: string;
  /** Pixel rect of the element, measured at capture time. */
  rect: Rect;
  /** Optional human label / action label for the element. */
  label?: string;
}

/** What the user did on a frame to reach the next one. */
export interface FrameAction {
  label: string;
  selector: string;
}

/**
 * FrameRecord — the load-bearing part of the spec (§3.1).
 *
 * `caption`, `axDigest`, and `boxes` are what semantic frame resolution and
 * auto-anchoring stand on. For `kind: "golden"` frames they are a hard contract,
 * not best-effort — the validator flags violations as capture defects.
 */
export interface FrameRecord {
  /** Stable, unique within the spec (e.g. "f186"). */
  id: string;
  /** Order index. */
  n: number;
  /** Only "golden" frames appear in exports. "raw" frames are intermediate captures. */
  kind: "golden" | "raw";
  /** Relative path to the captured screenshot (e.g. "frames/f186.png"). */
  img: string;
  /** ONE line: what happened on this frame. Required & non-empty for golden frames. */
  caption: string;
  /** Searchable DOM/accessibility summary. Required & non-empty for golden frames. */
  axDigest: string;
  /** Meaningful elements on the frame, with selectors + pixel rects. */
  boxes: Box[];
  /** Optional: what the user did to reach the next frame. */
  action?: FrameAction;
}

/** Where on a frame a callout points. Prefer `selector` over `rect`. */
export interface CalloutAnchor {
  /** MUST exist in the target frame's `boxes` if set. The player resolves its rect. */
  selector?: string;
  /** Manual fallback rect, in viewport pixels. */
  rect?: Rect;
}

export type CalloutStyle = "card" | "spotlight" | "arrow";

/** A single narrated annotation bound to a frame. */
export interface Callout {
  id: string;
  /** MUST reference an existing FrameRecord.id. */
  frame: string;
  /** Optional; prefer selector over rect. */
  anchor?: CalloutAnchor;
  eyebrow?: string;
  /** Required. */
  title: string;
  body?: string;
  /** Optional; player default ~4000ms. */
  dwellMs?: number;
  /** Default "card". */
  style?: CalloutStyle;
}

/** Optional tone hints for callout copy (§3.3). */
export interface Voice {
  /** Default "plain". */
  style?: string;
  /** Default false. */
  allowEmDash?: boolean;
  /** Freeform house-voice guidance. */
  notes?: string;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface Meta {
  /** Demo title. */
  title: string;
  /** What was demoed (name / url). */
  app: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  viewport: Viewport;
  /** Optional tone hints; absent means the plain default applies. */
  voice?: Voice;
}

/** The whole artifact. */
export interface Spec {
  meta: Meta;
  frames: FrameRecord[];
  callouts: Callout[];
}

/** The plain default voice, applied when `meta.voice` is absent (§3.3). */
export const DEFAULT_VOICE: Required<Pick<Voice, "style" | "allowEmDash">> = {
  style: "plain",
  allowEmDash: false,
};

/** Player default dwell time in milliseconds. */
export const DEFAULT_DWELL_MS = 4000;

/** Resolve the effective voice for a spec, applying the plain default. */
export function effectiveVoice(spec: Spec): Voice {
  const v = spec.meta.voice ?? {};
  return {
    style: v.style ?? DEFAULT_VOICE.style,
    allowEmDash: v.allowEmDash ?? DEFAULT_VOICE.allowEmDash,
    notes: v.notes,
  };
}

/** Golden frames only, in order — the frames that appear in exports. */
export function goldenFrames(spec: Spec): FrameRecord[] {
  return spec.frames
    .filter((f) => f.kind === "golden")
    .slice()
    .sort((a, b) => a.n - b.n);
}

/** Look up a frame by id. */
export function frameById(spec: Spec, id: string): FrameRecord | undefined {
  return spec.frames.find((f) => f.id === id);
}
