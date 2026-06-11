/**
 * Cueframe player HTML template (D5) — node-side, builds a complete HTML document.
 *
 * The document embeds the spec + a pre-built timeline as `window.__CUEFRAME__`, then
 * the self-contained RUNTIME_JS. When `assets` is supplied (data URIs) and there are no
 * external refs, the output is a single fully self-contained file (used by the HTML
 * exporter).
 */

import type { Spec } from "../spec/index.js";
import { buildTimeline, type TimelineOptions } from "./timeline.js";
import { RUNTIME_JS } from "./runtime.js";

export interface PlayerHtmlOptions {
  /** Map of frame.img -> data URI. When set, frames inline; output is self-contained. */
  assets?: Record<string, string>;
  /** Prefix for non-inlined frame img paths (when assets is absent). */
  baseHref?: string;
  /** Start the virtual-clock loop on load. Default true. */
  autoplay?: boolean;
  /** Document <title>. Defaults to spec.meta.title. */
  title?: string;
  /** Timeline tuning passed through to buildTimeline. */
  timeline?: TimelineOptions;
}

/** Escape text for safe placement inside an HTML element (title). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Built via RegExp constructor (not a literal) so the U+2028/U+2029 escapes never appear
// as raw line terminators in this source file — esbuild rejects those inside regex literals.
const UNSAFE_JSON_CHARS = new RegExp("[<>\\u2028\\u2029]", "g");

/**
 * Serialize a value to JSON safe to embed inside a <script> tag. Escaping `<` and `>`
 * prevents `</script>` injection; escaping U+2028/U+2029 prevents inline-script parse
 * breakage (they are valid JSON but illegal as raw JS string content).
 */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE_JSON_CHARS, (c) => {
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

export function renderPlayerHtml(spec: Spec, opts: PlayerHtmlOptions = {}): string {
  const autoplay = opts.autoplay !== false;
  const title = opts.title ?? spec.meta.title ?? "Cueframe demo";
  const timeline = buildTimeline(spec, opts.timeline);

  const data = {
    spec,
    timeline,
    assets: opts.assets ?? {},
    baseHref: opts.baseHref ?? "",
    autoplay,
  };

  const dataJson = safeJson(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;}
html,body{margin:0;padding:0;height:100%;background:#0b0d10;color:#f4f6fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
#cueframe-stage{position:fixed;inset:0;width:100%;height:100%;}
</style>
</head>
<body>
<div id="cueframe-stage"></div>
<script>window.__CUEFRAME__ = ${dataJson};</script>
<script>${RUNTIME_JS}</script>
</body>
</html>`;
}
