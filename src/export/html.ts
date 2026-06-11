/**
 * Cueframe HTML exporter (D6) — one self-contained .html file.
 *
 * Reads each GOLDEN frame's PNG from disk, base64-encodes it into a data URI, and
 * inlines all of them as `assets` into the player HTML. The result references zero
 * external http(s):// or relative asset URLs — everything (frames + runtime) is inline.
 *
 * Path resolution: `framesDir` is the directory that CONTAINS the `frames/` folder.
 * Each frame's `img` is a relative path like "frames/f3.png", so the PNG is read from
 * `path.join(framesDir, frame.img)`.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Spec } from "../spec/index.js";
import { goldenFrames } from "../spec/index.js";
import { renderPlayerHtml } from "../player/index.js";

export interface ExportHtmlOptions {
  /** Directory that contains the `frames/` folder referenced by frame.img. */
  framesDir: string;
  /** Output path for the self-contained .html file. */
  outPath: string;
  /** Autoplay on open. Default true (the HTML export is meant to just play). */
  autoplay?: boolean;
}

/** Build the `assets` map of frame.img -> data:image/png;base64,... for golden frames. */
export async function buildInlinedAssets(
  spec: Spec,
  framesDir: string,
): Promise<Record<string, string>> {
  const frames = goldenFrames(spec);
  const assets: Record<string, string> = {};
  for (const frame of frames) {
    const abs = path.join(framesDir, frame.img);
    const buf = await readFile(abs);
    assets[frame.img] = `data:image/png;base64,${buf.toString("base64")}`;
  }
  return assets;
}

export async function exportHtml(spec: Spec, opts: ExportHtmlOptions): Promise<void> {
  const autoplay = opts.autoplay !== false;
  const assets = await buildInlinedAssets(spec, opts.framesDir);
  const html = renderPlayerHtml(spec, { assets, autoplay });
  await writeFile(opts.outPath, html, "utf8");
}
