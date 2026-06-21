// src/capture/idle.ts
/**
 * Streaming-idle detection for a live chat UI (e.g. claude.ai).
 *
 * Selectors are obfuscated and streaming pauses mid-flight, so a single signal is
 * unreliable. IdleDetector confirms "idle" only when, for a continuous `stableMs`
 * window, the model is NOT generating (no stop button) AND the last assistant
 * message's visible length has stopped growing — and only after generation has
 * been seen at least once (the send->first-token gap must not false-trigger).
 * Poll-based (no internal loop/sleep) so the caller — the burst sampler — owns
 * timing and the loop is testable with a fake clock.
 */

/** Per-poll signals read from the live page. */
export interface IdleProbe {
  /** True while the model is generating (e.g. the stop button is visible). */
  isGenerating(): Promise<boolean>;
  /** Visible text length of the last assistant message (0 when none yet). */
  lastMessageLength(): Promise<number>;
}

export interface IdleDetectorOptions {
  /** Continuous quiet time required before idle is confirmed. Default 2500ms. */
  stableMs?: number;
  /** Monotonic clock, injectable for tests. Default Date.now. */
  now?: () => number;
}

/** Default continuous quiet window before idle is confirmed. */
export const DEFAULT_STABLE_MS = 2500;

export class IdleDetector {
  private readonly probe: IdleProbe;
  private readonly stableMs: number;
  private readonly now: () => number;
  private lastLen = -1;
  private quietSince: number | null = null;
  private seenGenerating = false;

  constructor(probe: IdleProbe, opts: IdleDetectorOptions = {}) {
    this.probe = probe;
    this.stableMs = opts.stableMs ?? DEFAULT_STABLE_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Poll once. Returns true once streaming has been quiet for `stableMs`. */
  async poll(): Promise<boolean> {
    const t = this.now();
    const generating = await this.probe.isGenerating();
    const len = await this.probe.lastMessageLength();
    const grew = len !== this.lastLen;
    this.lastLen = len;

    if (generating) this.seenGenerating = true;
    if (generating || grew) {
      this.quietSince = null;
      return false;
    }
    if (!this.seenGenerating) return false;
    if (this.quietSince === null) this.quietSince = t;
    return t - this.quietSince >= this.stableMs;
  }
}
