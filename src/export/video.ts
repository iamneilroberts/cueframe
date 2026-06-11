/**
 * Cueframe video exporters (D6) — MP4 and GIF via headless recording + ffmpeg.
 *
 * Pipeline:
 *   1. Render the player HTML with inlined assets (autoplay:false) to a temp file.
 *   2. Launch Playwright chromium sized to spec.meta.viewport, load the file, and wait
 *      for `window.__CUEFRAME_READY__`.
 *   3. Step a virtual clock: for t = 0..durationMs step 1000/fps, call
 *      `__CUEFRAME_PLAYER__.renderAt(t)` then screenshot to frame-%04d.png.
 *   4. Encode with the system ffmpeg (child_process). MP4: libx264 / yuv420p, dims padded
 *      even, +faststart. GIF: two-pass palettegen/paletteuse for quality.
 *   5. Clean up temp frames.
 *
 * Determinism: renderAt is a pure function of time, so the recorded frames do not depend
 * on wall-clock timing.
 */

import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import type { Spec } from "../spec/index.js";
import { buildTimeline } from "../player/index.js";
import { buildInlinedAssets } from "./html.js";
import { renderPlayerHtml } from "../player/index.js";

export interface ExportVideoOptions {
  /** Directory that contains the `frames/` folder referenced by frame.img. */
  framesDir: string;
  /** Output path for the .mp4 / .gif. */
  outPath: string;
  /** Frames per second to sample/encode. Default 12. */
  fps?: number;
}

declare global {
  // Surface the player API to page.evaluate typing.
  interface Window {
    __CUEFRAME_READY__?: boolean;
    __CUEFRAME_PLAYER__?: {
      renderAt: (ms: number) => void;
      durationMs: number;
      totalFrames: number;
      segments: unknown[];
    };
  }
}

const DEFAULT_FPS = 12;

/** Locate a usable ffmpeg binary: prefer system /usr/bin/ffmpeg, else PATH `ffmpeg`. */
async function resolveFfmpeg(): Promise<string> {
  const candidates = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  for (const c of candidates) {
    try {
      await access(c, FS.X_OK);
      return c;
    } catch {
      /* keep looking */
    }
  }
  // Fall back to PATH resolution; spawn will error if missing, surfaced clearly below.
  return "ffmpeg";
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      reject(
        new Error(
          `ffmpeg could not be launched ("${bin}"). Install ffmpeg or ensure it is on PATH. Cause: ${err.message}`,
        ),
      );
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

/** Record the reel to a temp directory of PNG frames; returns {dir, frameCount, fps}. */
async function recordFrames(
  spec: Spec,
  framesDir: string,
  fps: number,
): Promise<{ dir: string; frameCount: number }> {
  const assets = await buildInlinedAssets(spec, framesDir);
  const html = renderPlayerHtml(spec, { assets, autoplay: false });

  const workDir = await mkdtemp(path.join(tmpdir(), "cueframe-rec-"));
  const htmlPath = path.join(workDir, "player.html");
  await writeFile(htmlPath, html, "utf8");

  const timeline = buildTimeline(spec);
  const durationMs = timeline.durationMs;
  const vw = spec.meta.viewport.w;
  const vh = spec.meta.viewport.h;

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  let frameCount = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: vw, height: vh },
      deviceScaleFactor: 1,
    });
    await page.goto("file://" + htmlPath);
    await page.waitForFunction(() => window.__CUEFRAME_READY__ === true, undefined, {
      timeout: 30_000,
    });

    const step = 1000 / fps;
    // At least one frame even for a zero-duration reel.
    const total = durationMs > 0 ? Math.max(1, Math.ceil(durationMs / step)) : 1;
    for (let i = 0; i < total; i++) {
      const t = i * step;
      await page.evaluate((ms) => {
        window.__CUEFRAME_PLAYER__?.renderAt(ms);
      }, t);
      const name = `frame-${String(i + 1).padStart(4, "0")}.png`;
      await page.screenshot({ path: path.join(workDir, name) });
      frameCount++;
    }
  } finally {
    await browser.close();
  }

  return { dir: workDir, frameCount };
}

export async function exportMp4(spec: Spec, opts: ExportVideoOptions): Promise<void> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const ffmpeg = await resolveFfmpeg();
  const { dir } = await recordFrames(spec, opts.framesDir, fps);
  try {
    const args = [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(dir, "frame-%04d.png"),
      "-vf",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      opts.outPath,
    ];
    await runFfmpeg(ffmpeg, args);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function exportGif(spec: Spec, opts: ExportVideoOptions): Promise<void> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const ffmpeg = await resolveFfmpeg();
  const { dir } = await recordFrames(spec, opts.framesDir, fps);
  try {
    const palette = path.join(dir, "palette.png");
    const input = path.join(dir, "frame-%04d.png");
    // Pass 1: build an optimal palette from the frames.
    await runFfmpeg(ffmpeg, [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      input,
      "-vf",
      "palettegen=stats_mode=diff",
      palette,
    ]);
    // Pass 2: apply the palette for a high-quality GIF.
    await runFfmpeg(ffmpeg, [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      input,
      "-i",
      palette,
      "-lavfi",
      "paletteuse=dither=bayer:bayer_scale=3",
      opts.outPath,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Exposed for tests: read the first bytes of a file. */
export async function magicBytes(filePath: string, n = 12): Promise<Buffer> {
  const buf = await readFile(filePath);
  return buf.subarray(0, n);
}
