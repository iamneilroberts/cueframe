/**
 * Logged-in browser session for capturing an authenticated app (e.g. claude.ai).
 *
 * Uses a PERSISTENT Chrome profile dir: the operator logs into the site once in
 * that profile and cueframe reuses the cookies/session on every run. Headed + the
 * real Chrome channel (not bundled Chromium) keeps behavior close to normal use.
 * Separate from the default fresh-context capture path in capture.ts.
 */

import { chromium } from "playwright";
import type { BrowserContext } from "playwright";

export interface SessionOptions {
  /** Persistent Chrome user-data dir; operator logs in here once. */
  profileDir: string;
  /** Page viewport. */
  viewport: { w: number; h: number };
  /** Headless. Default false (login + claude.ai need a real window). */
  headless?: boolean;
  /** Browser channel. Default "chrome". */
  channel?: string;
}

/** Playwright launchPersistentContext options derived from SessionOptions (pure; testable). */
export function persistentContextOptions(opts: SessionOptions): {
  channel: string;
  headless: boolean;
  viewport: { width: number; height: number };
} {
  return {
    channel: opts.channel ?? "chrome",
    headless: opts.headless ?? false,
    viewport: { width: opts.viewport.w, height: opts.viewport.h },
  };
}

/** Launch (or attach to) the persistent context. Caller must close it. */
export async function launchSession(opts: SessionOptions): Promise<BrowserContext> {
  return chromium.launchPersistentContext(opts.profileDir, persistentContextOptions(opts));
}
