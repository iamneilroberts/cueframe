/**
 * Cueframe exporters (D6).
 *
 * - `exportHtml`: one self-contained .html file (assets inlined as data URIs).
 * - `exportMp4` / `exportGif`: headless-record the player with Playwright, then encode
 *   with ffmpeg.
 */
export { exportHtml, buildInlinedAssets, type ExportHtmlOptions } from "./html.js";
export { exportMp4, exportGif, type ExportVideoOptions } from "./video.js";
