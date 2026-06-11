/**
 * Cueframe player (D5) — framework-light reel player.
 *
 * - `buildTimeline` / timeline types: pure, deterministic time model for a spec.
 * - `renderPlayerHtml`: node-side HTML generator (self-contained when given inlined assets).
 * - `RUNTIME_JS`: the vanilla browser runtime string inlined into the export.
 */
export {
  buildTimeline,
  DEFAULT_BASE_HOLD_MS,
  DEFAULT_GAP_MS,
  type Timeline,
  type TimelineSegment,
  type TimelineCallout,
  type TimelineOptions,
} from "./timeline.js";
export { renderPlayerHtml, type PlayerHtmlOptions } from "./template.js";
export { RUNTIME_JS } from "./runtime.js";
