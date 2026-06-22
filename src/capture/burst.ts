/**
 * Burst sampler — take a screenshot every `intervalMs` until a stop condition
 * fires or a cap is hit. Used to capture real streaming (and, in the spike, real
 * typing) as a flipbook of stills. Timing is injectable (now/sleep) so the loop
 * is testable with no real clock or browser. Always captures at least one frame.
 */

export interface BurstFrame {
  /** 0-based index within the burst. */
  i: number;
  /** Clock time (from injected `now`) at capture. */
  atMs: number;
  /** Encoded screenshot bytes. */
  bytes: Uint8Array;
}

export interface BurstResult {
  frames: BurstFrame[];
  /** Why sampling stopped. */
  stopped: "condition" | "maxFrames" | "maxMs";
}

export interface BurstOptions {
  /** Sample interval. Default 150ms. */
  intervalMs?: number;
  /** Hard frame cap (bounds output size). Default 60. */
  maxFrames?: number;
  /** Hard time cap. Default 120000ms. */
  maxMs?: number;
  /** Monotonic clock, injectable. Default Date.now. */
  now?: () => number;
  /** Sleep, injectable. Default setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_BURST_INTERVAL_MS = 150;
export const DEFAULT_BURST_MAX_FRAMES = 60;
export const DEFAULT_BURST_MAX_MS = 120000;

export async function burst(
  screenshot: () => Promise<Uint8Array>,
  stop: () => Promise<boolean>,
  opts: BurstOptions = {},
): Promise<BurstResult> {
  const intervalMs = opts.intervalMs ?? DEFAULT_BURST_INTERVAL_MS;
  const maxFrames = opts.maxFrames ?? DEFAULT_BURST_MAX_FRAMES;
  const maxMs = opts.maxMs ?? DEFAULT_BURST_MAX_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const start = now();
  const frames: BurstFrame[] = [];

  for (;;) {
    const atMs = now();
    const bytes = await screenshot();
    frames.push({ i: frames.length, atMs, bytes });

    if (frames.length >= maxFrames) return { frames, stopped: "maxFrames" };
    if (await stop()) return { frames, stopped: "condition" };
    if (now() - start >= maxMs) return { frames, stopped: "maxMs" };

    await sleep(intervalMs);
  }
}
