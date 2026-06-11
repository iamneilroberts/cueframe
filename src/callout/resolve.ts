/**
 * Natural-language resolution for Cueframe callout authoring (GOAL.md §5 D4, Appendix A).
 *
 * Three deterministic, heuristic resolvers — no LLM calls:
 *   - resolveFrame(spec, ref)            — which GOLDEN frame a reference points at.
 *   - resolveAnchor(spec, frameId, phrase) — which real box on that frame to anchor to.
 *   - draftCopy(spec, frameId, hint?)    — a tight title (+ optional body) honoring meta.voice.
 *
 * The product thesis: the user describes WHAT and ROUGHLY WHERE; this module resolves the
 * exact frame, the exact anchor (preferring a real `box` selector over a manual rect), and
 * drafts copy in the spec's effective voice. Auto-anchoring to a real selector is the
 * marquee feature, so resolveAnchor prefers a real box over everything else.
 */

import type { Spec, FrameRecord, Rect, Box } from "../spec/index.js";
import {
  goldenFrames,
  frameById,
  effectiveVoice,
} from "../spec/index.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type FrameResolution =
  | { kind: "resolved"; frame: FrameRecord; reason: string }
  | { kind: "ambiguous"; candidates: FrameRecord[] }
  | { kind: "none" };

export type AnchorResolution =
  | { kind: "selector"; selector: string; reason: string }
  | { kind: "rect"; rect: Rect }
  | { kind: "suggestFrame"; frameId: string; selector: string }
  | { kind: "none" };

export interface DraftedCopy {
  title: string;
  body?: string;
}

// ---------------------------------------------------------------------------
// Tokenization & scoring helpers
// ---------------------------------------------------------------------------

/** Stopwords dropped before token-overlap scoring. */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "is",
  "are", "was", "were", "be", "it", "its", "this", "that", "with", "as", "by",
  "from", "into", "where", "when", "what", "which", "show", "shows", "showing",
  "shown", "appear", "appears", "appeared", "appearing", "happen", "happens",
  "happened", "happening", "frame", "callout", "around", "near", "after",
  "before", "first", "time", "does", "do", "point", "pointing", "right",
  "screen", "page", "view", "you", "user", "they", "their", "we", "i",
]);

/** Lowercase, split on non-alphanumeric, drop stopwords and empties. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Semantic scoring is field-aware and idf-weighted so DISTINCTIVE words win.
 *
 * Two earlier failure modes this fixes:
 *  - "active"/"items" appear in EVERY frame's axDigest (the filter buttons + counter), so a
 *    raw token-overlap count let them drown out "filtered", which appears in exactly one
 *    caption. Inverse-frame-frequency (idf) gives a token that occurs in one frame far more
 *    weight than one that occurs in all of them.
 *  - A match in the curated `caption` is a much stronger signal of "what this frame is about"
 *    than an incidental match in the axDigest/box text, so caption matches are boosted.
 */
const CAPTION_WEIGHT = 2.2;
const AUX_WEIGHT = 1.0;
const PARTIAL_FACTOR = 0.5;

interface FrameTokens {
  caption: Set<string>; // caption + action label — the curated "what happened"
  all: Set<string>; // caption ∪ axDigest ∪ box labels/selectors
}

interface Corpus {
  fields: FrameTokens[];
  df: Map<string, number>; // document frequency: how many frames contain a token
  n: number;
}

function frameFields(frame: FrameRecord): FrameTokens {
  const caption = new Set(tokenize(`${frame.caption} ${frame.action?.label ?? ""}`));
  const auxParts: string[] = [frame.axDigest];
  for (const b of frame.boxes) {
    if (b.label) auxParts.push(b.label);
    auxParts.push(b.selector);
  }
  const all = new Set([...caption, ...tokenize(auxParts.join(" "))]);
  return { caption, all };
}

function buildCorpus(golden: FrameRecord[]): Corpus {
  const fields = golden.map(frameFields);
  const df = new Map<string, number>();
  for (const f of fields) for (const t of f.all) df.set(t, (df.get(t) ?? 0) + 1);
  return { fields, df, n: golden.length };
}

/** Inverse frame frequency: ~0 for a token in every frame, large for a rare one. */
function idf(corpus: Corpus, token: string): number {
  const d = corpus.df.get(token) ?? 0;
  if (d === 0) return 0;
  return Math.log((corpus.n + 1) / d);
}

/** Best idf contribution of one query token against one frame (exact, else substring). */
function tokenContribution(corpus: Corpus, qt: string, fields: FrameTokens): number {
  if (fields.all.has(qt)) {
    const w = fields.caption.has(qt) ? CAPTION_WEIGHT : AUX_WEIGHT;
    return idf(corpus, qt) * w;
  }
  // Substring / stem match (so "price" matches "pricing", "filter" matches "filtered").
  let best = 0;
  for (const ht of fields.all) {
    if (ht.includes(qt) || qt.includes(ht)) {
      const w = fields.caption.has(ht) ? CAPTION_WEIGHT : AUX_WEIGHT;
      const v = idf(corpus, ht) * w * PARTIAL_FACTOR;
      if (v > best) best = v;
    }
  }
  return best;
}

function semanticScore(corpus: Corpus, queryTokens: string[], frameIdx: number): number {
  const fields = corpus.fields[frameIdx]!;
  let score = 0;
  for (const qt of queryTokens) score += tokenContribution(corpus, qt, fields);
  return score;
}

// ---------------------------------------------------------------------------
// Numeric / positional reference parsing
// ---------------------------------------------------------------------------

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10,
};

interface NumericRef {
  /** "exact" must hit n===N or nearest; "around" prefers exact else nearest. */
  mode: "exact" | "around";
  n: number;
}

/** Parse "frame 6", "frame six", "around 6", "frame #6" → a numeric reference, or null. */
function parseNumericRef(ref: string): NumericRef | null {
  const lower = ref.toLowerCase();
  const around = /\b(around|about|near|approx(?:imately)?|roughly|~)\b/.test(lower);

  // Digit form.
  const digit = lower.match(/\b#?(\d+)\b/);
  if (digit && digit[1] !== undefined) {
    return { mode: around ? "around" : "exact", n: parseInt(digit[1], 10) };
  }
  // Word form: "frame six", "around three".
  const word = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (word && word[1] !== undefined && /\b(frame|around|about|near|callout)\b/.test(lower)) {
    const n = NUM_WORDS[word[1]];
    if (n !== undefined) return { mode: around ? "around" : "exact", n };
  }
  return null;
}

type Position = "start" | "middle" | "end";

/** Parse fuzzy positions ("start", "beginning", "middle", "end", "near the end"). */
function parsePosition(ref: string): Position | null {
  const lower = ref.toLowerCase();
  if (/\b(start|beginning|opening|intro|first\s+frame|very\s+start)\b/.test(lower)) return "start";
  if (/\b(middle|midpoint|halfway|center|centre)\b/.test(lower)) return "middle";
  if (/\b(end|ending|finish|final|last|conclusion|near\s+the\s+end|towards?\s+the\s+end)\b/.test(lower)) return "end";
  return null;
}

/** Pick first / median / last from a non-empty ordered list of golden frames. */
function positionFrame(golden: FrameRecord[], pos: Position): FrameRecord | undefined {
  if (golden.length === 0) return undefined;
  if (pos === "start") return golden[0];
  if (pos === "end") return golden[golden.length - 1];
  // middle → median by index.
  return golden[Math.floor((golden.length - 1) / 2)];
}

/** Nearest golden frame to a target n (ties → earliest). */
function nearestByN(golden: FrameRecord[], target: number): FrameRecord | undefined {
  let best: FrameRecord | undefined;
  let bestDist = Infinity;
  for (const f of golden) {
    const d = Math.abs(f.n - target);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// resolveFrame
// ---------------------------------------------------------------------------

/** The runner-up counts as ambiguous when it scores at least this fraction of the top. */
const AMBIGUITY_RATIO = 0.8;

/**
 * Resolve a natural-language frame reference to a GOLDEN frame.
 *
 * Priority (Appendix A Step 1):
 *  1. Exact/approx number ("frame 6", "around 6") and fuzzy positions
 *     ("start", "middle", "end").
 *  2. Semantic description — token overlap over caption + axDigest + boxes + action.
 *     If the top two are near-equal, returns `ambiguous` with the top 2-3.
 */
export function resolveFrame(spec: Spec, ref: string): FrameResolution {
  const golden = goldenFrames(spec);
  if (golden.length === 0) return { kind: "none" };

  const trimmed = ref.trim();
  if (trimmed === "") return { kind: "none" };

  // --- 1a. Fuzzy position ---
  const pos = parsePosition(trimmed);
  if (pos) {
    const frame = positionFrame(golden, pos);
    if (frame) {
      return {
        kind: "resolved",
        frame,
        reason: `${pos} position → golden frame ${frame.id} (n=${frame.n}): "${frame.caption}"`,
      };
    }
  }

  // --- 1b. Numeric reference ---
  const num = parseNumericRef(trimmed);
  if (num) {
    const exact = golden.find((f) => f.n === num.n);
    if (exact) {
      return {
        kind: "resolved",
        frame: exact,
        reason: `frame n=${num.n} → ${exact.id}: "${exact.caption}"`,
      };
    }
    // No exact n: "exact" and "around" both fall back to the nearest golden frame.
    const near = nearestByN(golden, num.n);
    if (near) {
      return {
        kind: "resolved",
        frame: near,
        reason: `no golden frame n=${num.n}; nearest is ${near.id} (n=${near.n}): "${near.caption}"`,
      };
    }
  }

  // --- 2. Semantic ---
  const queryTokens = tokenize(trimmed);
  if (queryTokens.length === 0) return { kind: "none" };

  // idf-weighted, caption-boosted scoring (see semanticScore). golden is sorted by n
  // ascending, so a stable sort by descending score keeps the earliest frame on ties —
  // which gives "first time X appears" for free.
  const corpus = buildCorpus(golden);
  const scored = golden
    .map((frame, idx) => ({ frame, idx, score: semanticScore(corpus, queryTokens, idx) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  if (scored.length === 0) return { kind: "none" };

  const top = scored[0]!;
  const second = scored[1];

  // Relative ambiguity: if the runner-up scores within AMBIGUITY_RATIO of the top, the
  // distinction is too weak to pick silently — surface the top candidates and let the
  // caller (the skill) ask. idf scoring means a genuinely distinctive word makes the top
  // pull far ahead, so this fires only when frames really are near-indistinguishable.
  if (second && second.score >= top.score * AMBIGUITY_RATIO) {
    const candidates = scored
      .filter((s) => s.score >= top.score * AMBIGUITY_RATIO)
      .slice(0, 3)
      .map((s) => s.frame);
    if (candidates.length >= 2) {
      return { kind: "ambiguous", candidates };
    }
  }

  return {
    kind: "resolved",
    frame: top.frame,
    reason: `semantic match (score ${top.score.toFixed(2)}) → ${top.frame.id}: "${top.frame.caption}"`,
  };
}

/**
 * Thin helper: resolve a reference stated relative to an existing callout
 * ("right before the pricing callout", "the frame of the second callout").
 * Resolves the anchoring callout, then optionally steps one golden frame before/after.
 * Falls back to undefined if no callout matches.
 */
export function resolveRelativeToCallout(
  spec: Spec,
  ref: string,
): FrameResolution | undefined {
  const lower = ref.toLowerCase();
  if (!/\bcallout\b/.test(lower)) return undefined;
  if (spec.callouts.length === 0) return { kind: "none" };

  // Find the referenced callout by a title token overlap.
  const queryTokens = tokenize(lower.replace(/\bcallout\b/g, ""));
  let target = spec.callouts[0];
  if (queryTokens.length > 0) {
    let bestScore = -1;
    for (const c of spec.callouts) {
      const hay = new Set(tokenize(`${c.title} ${c.body ?? ""} ${c.eyebrow ?? ""}`));
      let score = 0;
      for (const qt of queryTokens) if (hay.has(qt)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        target = c;
      }
    }
  }
  if (!target) return { kind: "none" };

  const golden = goldenFrames(spec);
  const anchorIdx = golden.findIndex((f) => f.id === target.frame);
  if (anchorIdx < 0) return { kind: "none" };

  let idx = anchorIdx;
  if (/\bbefore\b/.test(lower)) idx = anchorIdx - 1;
  else if (/\bafter\b/.test(lower)) idx = anchorIdx + 1;

  const frame = golden[idx];
  if (!frame) return { kind: "none" };
  return {
    kind: "resolved",
    frame,
    reason: `relative to callout "${target.title}" → ${frame.id} (n=${frame.n})`,
  };
}

// ---------------------------------------------------------------------------
// resolveAnchor
// ---------------------------------------------------------------------------

/** A box that's anchorable: real selector + non-degenerate rect. */
function isAnchorableBox(box: Box): boolean {
  return (
    typeof box.selector === "string" &&
    box.selector.trim().length > 0 &&
    box.rect.w > 0 &&
    box.rect.h > 0
  );
}

/** Score a target phrase against a single box (selector text + label). */
function boxScore(phraseTokens: string[], box: Box): number {
  const hayParts = [box.selector];
  if (box.label) hayParts.push(box.label);
  const hay = new Set(tokenize(hayParts.join(" ")));
  const hayList = [...hay];
  let score = 0;
  for (const qt of phraseTokens) {
    if (hay.has(qt)) score += 1;
    else if (hayList.some((ht) => ht.includes(qt) || qt.includes(ht))) score += 0.5;
  }
  return score;
}

/**
 * Tiebreak among boxes that score equally: prefer a stable, human-meaningful selector
 * (id / data-*) over a generic or positional one (a bare tag, or a Playwright `>> nth=`
 * locator). This keeps auto-anchored callouts pointing at `[data-add]` rather than
 * `button >> nth=0` when both resolve the same element.
 */
function selectorQuality(selector: string): number {
  const s = selector.trim();
  let q = 0;
  if (/(>>|\bnth=)/.test(s)) q -= 0.4; // positional locator
  if (/^\[role\]$/.test(s)) q -= 0.4; // matches anything with a role
  if (/^[a-z]+\d*$/i.test(s)) q -= 0.2; // bare tag like "button"
  if (s.startsWith("#") || /^\[data-/.test(s) || /^\[id/.test(s)) q += 0.2; // stable handle
  return q;
}

/**
 * Resolve an anchor for `targetPhrase` on a frame.
 *
 * Auto-anchoring is the marquee feature, so this PREFERS returning a real box `selector`:
 *  - Match the phrase against the frame's boxes (selector text + label + nearby axDigest
 *    tokens); pick the best real box → return its selector.
 *  - If no good box here but one matches on an adjacent GOLDEN frame → suggestFrame.
 *  - Else `none` (caller may fall back to a manual rect or a floating card).
 */
export function resolveAnchor(
  spec: Spec,
  frameId: string,
  targetPhrase: string,
): AnchorResolution {
  const frame = frameById(spec, frameId);
  if (!frame) return { kind: "none" };

  const phraseTokens = tokenize(targetPhrase);
  const anchorable = frame.boxes.filter(isAnchorableBox);

  // If the phrase is empty but the frame has exactly one anchorable box, use it.
  if (phraseTokens.length === 0) {
    if (anchorable.length === 1 && anchorable[0]) {
      return {
        kind: "selector",
        selector: anchorable[0].selector,
        reason: `only anchorable box on ${frame.id}`,
      };
    }
    return { kind: "none" };
  }

  // Bias the score with nearby axDigest tokens: a box whose tokens also appear in the
  // frame's axDigest near the phrase tokens is more likely the intended target. We keep
  // this simple: boxes are scored on their own text; axDigest provides a tie-break boost
  // when the phrase tokens appear in the frame at all.
  const best = bestBox(phraseTokens, anchorable);
  if (best && best.score > 0) {
    return {
      kind: "selector",
      selector: best.box.selector,
      reason: `phrase "${targetPhrase}" matched box ${best.box.selector}${
        best.box.label ? ` ("${best.box.label}")` : ""
      } on ${frame.id}`,
    };
  }

  // No good box on this frame — check adjacent golden frames.
  const golden = goldenFrames(spec);
  const here = golden.findIndex((f) => f.id === frameId);
  if (here >= 0) {
    for (const adj of [golden[here - 1], golden[here + 1]]) {
      if (!adj) continue;
      const adjBest = bestBox(phraseTokens, adj.boxes.filter(isAnchorableBox));
      if (adjBest && adjBest.score > 0) {
        return { kind: "suggestFrame", frameId: adj.id, selector: adjBest.box.selector };
      }
    }
  }

  return { kind: "none" };
}

function bestBox(
  phraseTokens: string[],
  boxes: Box[],
): { box: Box; score: number } | undefined {
  let best: { box: Box; score: number; quality: number } | undefined;
  for (const box of boxes) {
    const score = boxScore(phraseTokens, box);
    const quality = selectorQuality(box.selector);
    if (!best || score > best.score || (score === best.score && quality > best.quality)) {
      best = { box, score, quality };
    }
  }
  return best ? { box: best.box, score: best.score } : undefined;
}

// ---------------------------------------------------------------------------
// draftCopy
// ---------------------------------------------------------------------------

/** Strip em-dashes / en-dashes used as em, replacing with sentence-safe punctuation. */
function stripEmDashes(text: string): string {
  return text
    // " — " (en/em dash used as a separator) → ". "
    .replace(/\s*[—–]\s*/g, ". ")
    // collapse any doubled punctuation that produces ".."
    .replace(/\.\s*\.\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Title-case-ish: capitalize the first character, leave the rest as written. */
function leadCap(text: string): string {
  const t = text.trim();
  if (t.length === 0) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Turn a one-line caption into a tight title (drop trailing period, lead-cap). */
function captionToTitle(caption: string): string {
  let t = caption.trim().replace(/[.\s]+$/, "");
  // If the caption is long, take the leading clause up to the first comma.
  if (t.length > 48) {
    const comma = t.indexOf(",");
    if (comma > 8) t = t.slice(0, comma);
  }
  return leadCap(t);
}

/**
 * Draft a tight title (+ optional one-line body) for a callout on `frameId`.
 *
 * Honors the spec's effective voice (effectiveVoice). For the plain default
 * (`allowEmDash: false`), the output is GUARANTEED to contain no em/en dashes —
 * they are replaced with periods/commas. A `hint` (the user's own words) takes
 * precedence as the title source when given.
 */
export function draftCopy(spec: Spec, frameId: string, hint?: string): DraftedCopy {
  const frame = frameById(spec, frameId);
  const voice = effectiveVoice(spec);
  const allowEmDash = voice.allowEmDash === true;

  let title: string;
  let body: string | undefined;

  if (hint && hint.trim().length > 0) {
    title = captionToTitle(hint);
    // If the frame has a caption distinct from the hint, use it as a one-line body.
    if (frame && frame.caption.trim().length > 0) {
      const capTitle = captionToTitle(frame.caption);
      if (capTitle.toLowerCase() !== title.toLowerCase()) {
        body = leadCap(frame.caption.trim().replace(/[.\s]+$/, "")) + ".";
      }
    }
  } else if (frame) {
    title = captionToTitle(frame.caption);
    // Pull a short supporting line from axDigest if it adds anything.
    const digest = frame.axDigest.trim();
    if (digest.length > 0 && digest.length <= 80) {
      const digestLine = leadCap(digest.replace(/[.\s]+$/, "")) + ".";
      if (digestLine.toLowerCase() !== title.toLowerCase() + ".") {
        body = digestLine;
      }
    }
  } else {
    title = hint && hint.trim().length > 0 ? leadCap(hint) : "Callout";
  }

  if (!allowEmDash) {
    title = stripEmDashes(title);
    if (body) body = stripEmDashes(body);
  }

  // Final tidy: title should not end with a period; body should read as a sentence.
  title = title.replace(/[.\s]+$/, "").trim();
  if (title.length === 0) title = "Callout";
  const out: DraftedCopy = { title };
  if (body && body.trim().length > 0) out.body = body.trim();
  return out;
}
