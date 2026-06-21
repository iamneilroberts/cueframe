# Phase 1: Live claude.ai Capture Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove cueframe can drive a logged-in claude.ai session and burst-capture real typing + real streaming to disk as JPEG stills, and pin the real selectors/timings — with no spec.json integration yet.

**Architecture:** Four small, independently testable capture units (`session`, `idle`, `burst`, `claude`) plus one top-level spike entry (`spike-claude.ts`) that wires them against the live site and writes frames to disk. Timing-dependent logic (idle detection, burst sampling) takes injected `now`/`sleep` so it is unit-tested with fakes; the selector-dependent `claude.ts` is the single place claude.ai selectors live and is validated by a manual smoke run that fills a findings doc.

**Tech Stack:** TypeScript (ESM, `node:` builtins, `.js` import specifiers), Playwright `^1.60` (chromium, persistent context), vitest `^2.1`. Build with `tsc`, run entries as `node dist/<name>.js`.

## Global Constraints

- **ESM imports use `.js` specifiers** even for `.ts` files (e.g. `import { burst } from "./burst.js"`). Match existing files.
- **No new dependencies.** Playwright is the only runtime dep; do not add others.
- **Timing-dependent code takes injected `now`/`sleep`** (default to `Date.now` / `setTimeout`) so loops are deterministic in tests.
- **All claude.ai selectors live in `src/capture/claude.ts` only.** No selector strings anywhere else.
- **This phase writes frames to disk only.** No changes to `spec/`, `player/`, `export/`, `cli.ts`, or `acceptance.ts`. The existing golden acceptance gate must stay untouched.
- **Test command (single file):** `npx vitest run <path>`. **All tests:** `npm test`. **Typecheck:** `npm run typecheck`. **Build:** `npm run build`.
- **Execute in an isolated worktree/branch** (this is the cueframe repo; the main clone is for coordination). Create it via superpowers:using-git-worktrees at execution time.

---

### Task 1: `session.ts` — logged-in persistent browser context

**Files:**
- Create: `src/capture/session.ts`
- Test: `src/capture/session.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionOptions { profileDir: string; viewport: { w: number; h: number }; headless?: boolean; channel?: string }`
  - `function persistentContextOptions(opts: SessionOptions): { channel: string; headless: boolean; viewport: { width: number; height: number } }`
  - `function launchSession(opts: SessionOptions): Promise<import("playwright").BrowserContext>`

- [ ] **Step 1: Write the failing test**

```ts
// src/capture/session.test.ts
import { describe, it, expect } from "vitest";
import { persistentContextOptions } from "./session.js";

describe("persistentContextOptions", () => {
  it("defaults to headed real Chrome and maps viewport w/h to width/height", () => {
    expect(
      persistentContextOptions({ profileDir: "/p", viewport: { w: 1280, h: 800 } }),
    ).toEqual({ channel: "chrome", headless: false, viewport: { width: 1280, height: 800 } });
  });

  it("honors explicit channel and headless", () => {
    expect(
      persistentContextOptions({
        profileDir: "/p",
        viewport: { w: 1, h: 2 },
        headless: true,
        channel: "msedge",
      }),
    ).toEqual({ channel: "msedge", headless: true, viewport: { width: 1, height: 2 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/capture/session.test.ts`
Expected: FAIL — cannot resolve `./session.js` / `persistentContextOptions is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/capture/session.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/capture/session.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/capture/session.ts src/capture/session.test.ts
git commit -m "feat(capture): persistent logged-in browser session for claude.ai spike"
```

---

### Task 2: `idle.ts` — streaming-idle detector

**Files:**
- Create: `src/capture/idle.ts`
- Test: `src/capture/idle.test.ts`

**Interfaces:**
- Produces:
  - `interface IdleProbe { isGenerating(): Promise<boolean>; lastMessageLength(): Promise<number> }`
  - `interface IdleDetectorOptions { stableMs?: number; now?: () => number }`
  - `const DEFAULT_STABLE_MS = 2500`
  - `class IdleDetector { constructor(probe: IdleProbe, opts?: IdleDetectorOptions); poll(): Promise<boolean> }`
- Consumed by: Task 3's `burst` (as the `stop` callback) and Task 4's `claudeIdleProbe` (implements `IdleProbe`).

Detection rule: idle is confirmed only when, for a continuous `stableMs` window, the model is NOT generating AND the last assistant message's length has not grown — and only after generation has been observed at least once (so the gap between send and first token never false-triggers idle). Poll-based (no internal loop/sleep); the caller owns timing.

- [ ] **Step 1: Write the failing test**

```ts
// src/capture/idle.test.ts
import { describe, it, expect } from "vitest";
import { IdleDetector, type IdleProbe } from "./idle.js";

/** A probe that returns one scripted state per poll (a poll reads isGenerating then length). */
function scriptedProbe(states: Array<{ generating: boolean; len: number }>): IdleProbe {
  let i = 0;
  const at = () => states[Math.min(i, states.length - 1)];
  return {
    async isGenerating() {
      return at().generating;
    },
    async lastMessageLength() {
      const s = at();
      i++; // advance once per poll, after both reads
      return s.len;
    },
  };
}

describe("IdleDetector", () => {
  it("confirms idle only after stableMs of no generating and no growth", async () => {
    let clock = 0;
    const det = new IdleDetector(
      scriptedProbe([
        { generating: true, len: 0 }, // poll0: generating
        { generating: true, len: 10 }, // poll1: generating + grew
        { generating: false, len: 20 }, // poll2: stopped but grew -> reset
        { generating: false, len: 20 }, // poll3: quiet starts
        { generating: false, len: 20 }, // poll4
        { generating: false, len: 20 }, // poll5
      ]),
      { stableMs: 500, now: () => clock },
    );

    clock = 0; expect(await det.poll()).toBe(false);
    clock = 100; expect(await det.poll()).toBe(false);
    clock = 200; expect(await det.poll()).toBe(false);
    clock = 300; expect(await det.poll()).toBe(false); // quietSince = 300
    clock = 700; expect(await det.poll()).toBe(false); // 400 < 500
    clock = 900; expect(await det.poll()).toBe(true); // 600 >= 500
  });

  it("resets the quiet window when the message grows again", async () => {
    let clock = 0;
    const det = new IdleDetector(
      scriptedProbe([
        { generating: true, len: 0 }, // poll0: marks seenGenerating
        { generating: false, len: 10 }, // poll1: grew
        { generating: false, len: 10 }, // poll2: quiet start
        { generating: false, len: 15 }, // poll3: grew -> reset
        { generating: false, len: 15 }, // poll4: quiet start again
        { generating: false, len: 15 }, // poll5
      ]),
      { stableMs: 300, now: () => clock },
    );

    clock = 0; expect(await det.poll()).toBe(false);
    clock = 100; expect(await det.poll()).toBe(false);
    clock = 200; expect(await det.poll()).toBe(false); // quietSince = 200
    clock = 300; expect(await det.poll()).toBe(false); // grew -> reset
    clock = 400; expect(await det.poll()).toBe(false); // quietSince = 400
    clock = 750; expect(await det.poll()).toBe(true); // 350 >= 300
  });

  it("never confirms idle if generation was never observed", async () => {
    let clock = 0;
    const det = new IdleDetector(
      scriptedProbe([
        { generating: false, len: 0 },
        { generating: false, len: 0 },
        { generating: false, len: 0 },
      ]),
      { stableMs: 100, now: () => clock },
    );
    clock = 0; expect(await det.poll()).toBe(false);
    clock = 500; expect(await det.poll()).toBe(false);
    clock = 1000; expect(await det.poll()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/capture/idle.test.ts`
Expected: FAIL — cannot resolve `./idle.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/capture/idle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/capture/idle.ts src/capture/idle.test.ts
git commit -m "feat(capture): streaming-idle detector (stop-button + text-stability)"
```

---

### Task 3: `burst.ts` — interval screenshot sampler

**Files:**
- Create: `src/capture/burst.ts`
- Test: `src/capture/burst.test.ts`

**Interfaces:**
- Consumes: a `stop` callback (e.g. `() => detector.poll()` from Task 2).
- Produces:
  - `interface BurstFrame { i: number; atMs: number; bytes: Uint8Array }`
  - `interface BurstResult { frames: BurstFrame[]; stopped: "condition" | "maxFrames" | "maxMs" }`
  - `interface BurstOptions { intervalMs?: number; maxFrames?: number; maxMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> }`
  - `const DEFAULT_BURST_INTERVAL_MS = 150`, `DEFAULT_BURST_MAX_FRAMES = 60`, `DEFAULT_BURST_MAX_MS = 120000`
  - `function burst(screenshot: () => Promise<Uint8Array>, stop: () => Promise<boolean>, opts?: BurstOptions): Promise<BurstResult>`

Behavior: always captures at least one frame. Each iteration: screenshot, then (in order) check `maxFrames`, then `stop()`, then `maxMs`, then sleep `intervalMs`.

- [ ] **Step 1: Write the failing test**

```ts
// src/capture/burst.test.ts
import { describe, it, expect } from "vitest";
import { burst } from "./burst.js";

/** Fake clock whose sleep advances the clock (no real timers). */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("burst", () => {
  it("stops on the condition, including the frame where it fired", async () => {
    const clk = fakeClock();
    let shots = 0;
    const screenshot = async () => new Uint8Array([++shots]);
    let checks = 0;
    const stop = async () => ++checks >= 3; // true on the 3rd check

    const res = await burst(screenshot, stop, { intervalMs: 150, now: clk.now, sleep: clk.sleep });

    expect(res.stopped).toBe("condition");
    expect(res.frames.map((f) => f.i)).toEqual([0, 1, 2]);
    expect(res.frames.map((f) => f.atMs)).toEqual([0, 150, 300]);
  });

  it("caps at maxFrames before checking the condition", async () => {
    const clk = fakeClock();
    const screenshot = async () => new Uint8Array([1]);
    const stop = async () => false;

    const res = await burst(screenshot, stop, {
      maxFrames: 4,
      intervalMs: 10,
      now: clk.now,
      sleep: clk.sleep,
    });

    expect(res.stopped).toBe("maxFrames");
    expect(res.frames.length).toBe(4);
  });

  it("caps at maxMs", async () => {
    const clk = fakeClock();
    const screenshot = async () => new Uint8Array([1]);
    const stop = async () => false;

    const res = await burst(screenshot, stop, {
      maxMs: 250,
      intervalMs: 100,
      maxFrames: 999,
      now: clk.now,
      sleep: clk.sleep,
    });

    expect(res.stopped).toBe("maxMs");
    expect(res.frames.length).toBe(4); // shots at 0,100,200,300; 300 >= 250
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/capture/burst.test.ts`
Expected: FAIL — cannot resolve `./burst.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/capture/burst.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/capture/burst.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/capture/burst.ts src/capture/burst.test.ts
git commit -m "feat(capture): interval burst screenshot sampler with frame/time caps"
```

---

### Task 4: `claude.ts` — claude.ai selectors + page glue

**Files:**
- Create: `src/capture/claude.ts`
- Test: `src/capture/claude.test.ts`

**Interfaces:**
- Consumes: `IdleProbe` from Task 2; Playwright `Page`.
- Produces:
  - `interface ClaudeSelectors { composer: string; sendButton: string; stopButton: string; lastAssistantMessage: string }`
  - `const DEFAULT_CLAUDE_SELECTORS: ClaudeSelectors`
  - `function claudeIdleProbe(page: Page, sel?: ClaudeSelectors): IdleProbe`
  - `function composerLocator(page: Page, sel?: ClaudeSelectors): import("playwright").Locator`
  - `function sendPrompt(page: Page, sel?: ClaudeSelectors): Promise<void>`

This is the ONLY place selectors live. Defaults are UNVERIFIED best guesses; Task 5's smoke confirms/corrects them and records the result in the findings doc.

- [ ] **Step 1: Write the failing test**

```ts
// src/capture/claude.test.ts
import { describe, it, expect } from "vitest";
import type { Page } from "playwright";
import { claudeIdleProbe, composerLocator, sendPrompt, type ClaudeSelectors } from "./claude.js";

const SEL: ClaudeSelectors = {
  composer: "C",
  sendButton: "S",
  stopButton: "STOP",
  lastAssistantMessage: "MSG",
};

/** Minimal fake Page: records locator() selectors and returns a configurable locator. */
function fakePage(opts: { stopCount?: number; msgCount?: number; msgText?: string }) {
  const calls: string[] = [];
  let clicked = false;
  const page = {
    locator(selector: string) {
      calls.push(selector);
      const isStop = selector === SEL.stopButton;
      const loc = {
        first() {
          return loc;
        },
        last() {
          return loc;
        },
        async count() {
          return isStop ? (opts.stopCount ?? 0) : (opts.msgCount ?? 0);
        },
        async textContent() {
          return opts.msgText ?? "";
        },
        async click() {
          clicked = true;
        },
      };
      return loc;
    },
  };
  return { page: page as unknown as Page, calls, wasClicked: () => clicked };
}

describe("claudeIdleProbe", () => {
  it("isGenerating reflects stop-button presence", async () => {
    expect(await claudeIdleProbe(fakePage({ stopCount: 1 }).page, SEL).isGenerating()).toBe(true);
    expect(await claudeIdleProbe(fakePage({ stopCount: 0 }).page, SEL).isGenerating()).toBe(false);
  });

  it("lastMessageLength returns visible text length, 0 when no message", async () => {
    expect(
      await claudeIdleProbe(fakePage({ msgCount: 1, msgText: "hello" }).page, SEL).lastMessageLength(),
    ).toBe(5);
    expect(
      await claudeIdleProbe(fakePage({ msgCount: 0, msgText: "" }).page, SEL).lastMessageLength(),
    ).toBe(0);
  });
});

describe("composerLocator / sendPrompt", () => {
  it("composerLocator uses the composer selector", () => {
    const fp = fakePage({});
    composerLocator(fp.page, SEL);
    expect(fp.calls).toContain("C");
  });

  it("sendPrompt clicks the send selector", async () => {
    const fp = fakePage({});
    await sendPrompt(fp.page, SEL);
    expect(fp.calls).toContain("S");
    expect(fp.wasClicked()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/capture/claude.test.ts`
Expected: FAIL — cannot resolve `./claude.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/capture/claude.ts
/**
 * claude.ai-specific glue: the ONE place selectors live (the spec's primary
 * fragility). The spike validates/pins these against the live site; later phases
 * import the same constants. Everything selector-dependent is isolated here so a
 * UI change is a one-file fix.
 */

import type { Page, Locator } from "playwright";
import type { IdleProbe } from "./idle.js";

export interface ClaudeSelectors {
  /** The prompt composer (contenteditable / textarea). */
  composer: string;
  /** Send button. */
  sendButton: string;
  /** Stop/abort button shown while generating. */
  stopButton: string;
  /** Container of the latest assistant message (for visible-text length). */
  lastAssistantMessage: string;
}

/**
 * Best-guess selectors as of 2026-06. UNVERIFIED — the spike's job is to confirm
 * or correct these against the live site and record the result in the findings
 * doc. Prefer role/name signals if the smoke shows CSS is brittle.
 */
export const DEFAULT_CLAUDE_SELECTORS: ClaudeSelectors = {
  composer: 'div[contenteditable="true"]',
  sendButton: 'button[aria-label="Send message"]',
  stopButton: 'button[aria-label="Stop response"]',
  lastAssistantMessage: '[data-testid="assistant-message"]',
};

/** An IdleProbe backed by a live Playwright page using the configured selectors. */
export function claudeIdleProbe(page: Page, sel: ClaudeSelectors = DEFAULT_CLAUDE_SELECTORS): IdleProbe {
  return {
    async isGenerating() {
      return (await page.locator(sel.stopButton).count()) > 0;
    },
    async lastMessageLength() {
      const loc = page.locator(sel.lastAssistantMessage);
      if ((await loc.count()) === 0) return 0;
      const text = (await loc.last().textContent()) ?? "";
      return text.length;
    },
  };
}

/** Locator for the prompt composer. */
export function composerLocator(page: Page, sel: ClaudeSelectors = DEFAULT_CLAUDE_SELECTORS): Locator {
  return page.locator(sel.composer).first();
}

/** Submit the composed prompt. */
export async function sendPrompt(page: Page, sel: ClaudeSelectors = DEFAULT_CLAUDE_SELECTORS): Promise<void> {
  await page.locator(sel.sendButton).first().click();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/capture/claude.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/capture/claude.ts src/capture/claude.test.ts
git commit -m "feat(capture): claude.ai selector glue (idle probe, composer, send)"
```

---

### Task 5: `spike-claude.ts` entry + findings doc — the live smoke

**Files:**
- Create: `src/spike-claude.ts`
- Create: `docs/superpowers/findings/2026-06-21-claude-capture-spike.md`

**Interfaces:**
- Consumes: `launchSession` (T1), `IdleDetector` (T2), `burst`/`BurstFrame` (T3), `claudeIdleProbe`/`composerLocator`/`sendPrompt`/`DEFAULT_CLAUDE_SELECTORS` (T4).
- Produces: an executable entry (`node dist/spike-claude.js`) that writes JPEG frames to `--out/{typing,stream}/` and prints a summary. No exported API.

This task has no unit test — it drives a live, authenticated, interactive site. The deliverable is a working run plus a filled-in findings doc. Typing is captured with a **chunked sequential type-and-shoot loop** (we control cadence; avoids concurrent screenshot+keystroke hazards on one page); streaming is captured with `burst` + `IdleDetector`.

- [ ] **Step 1: Write the spike entry**

```ts
// src/spike-claude.ts
/**
 * Phase-1 spike: drive a logged-in claude.ai session and burst-capture real
 * typing + real streaming to disk as JPEG stills. NO spec.json integration — the
 * goal is to prove authenticated capture works and to PIN the real selectors and
 * timings (recorded in docs/superpowers/findings/). Build first, then run:
 *
 *   npm run build
 *   node dist/spike-claude.js --profile ~/.cueframe-claude --out /tmp/claude-spike --prompt "Plan a 5-day trip to Dublin"
 *
 * First run: a headed Chrome opens. Log into claude.ai in that window; the
 * persistent profile keeps you logged in for later runs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { launchSession } from "./capture/session.js";
import { burst, type BurstFrame } from "./capture/burst.js";
import { IdleDetector } from "./capture/idle.js";
import {
  claudeIdleProbe,
  composerLocator,
  sendPrompt,
  DEFAULT_CLAUDE_SELECTORS,
} from "./capture/claude.js";

interface Args {
  profileDir: string;
  outDir: string;
  prompt: string;
  url: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, def?: string): string => {
    const i = argv.indexOf(flag);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    if (def !== undefined) return def;
    throw new Error(`missing required ${flag}`);
  };
  return {
    profileDir: get("--profile"),
    outDir: get("--out"),
    prompt: get("--prompt", "Plan a 5-day trip to Dublin"),
    url: get("--url", "https://claude.ai/new"),
  };
}

async function shoot(page: Page): Promise<Uint8Array> {
  return page.screenshot({ type: "jpeg", quality: 80 });
}

async function writeFrames(dir: string, label: string, frames: BurstFrame[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const f of frames) {
    await writeFile(join(dir, `${label}-${String(f.i).padStart(3, "0")}.jpg`), f.bytes);
  }
}

/** Type the prompt in chunks, screenshotting after each chunk (we control cadence). */
async function typeAndShoot(page: Page, text: string, charsPerFrame: number): Promise<BurstFrame[]> {
  const composer = composerLocator(page, DEFAULT_CLAUDE_SELECTORS);
  await composer.click();
  const frames: BurstFrame[] = [];
  frames.push({ i: 0, atMs: 0, bytes: await shoot(page) }); // empty composer
  for (let pos = 0; pos < text.length; pos += charsPerFrame) {
    await composer.pressSequentially(text.slice(pos, pos + charsPerFrame), { delay: 0 });
    frames.push({ i: frames.length, atMs: frames.length, bytes: await shoot(page) });
  }
  return frames;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const context = await launchSession({ profileDir: args.profileDir, viewport: { w: 1280, h: 800 } });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.url, { waitUntil: "load" });

    // Confirm we're logged in: the composer must appear.
    try {
      await composerLocator(page, DEFAULT_CLAUDE_SELECTORS).waitFor({ state: "visible", timeout: 30000 });
    } catch {
      console.error(
        "Composer not found. If you see a login screen, log in to claude.ai in the open window, then re-run.",
      );
      return;
    }

    // 1) Real typing as a chunked flipbook.
    const typingFrames = await typeAndShoot(page, args.prompt, 3);
    await writeFrames(join(args.outDir, "typing"), "type", typingFrames);

    // 2) Send, then burst-sample streaming until idle.
    await sendPrompt(page, DEFAULT_CLAUDE_SELECTORS);
    const detector = new IdleDetector(claudeIdleProbe(page, DEFAULT_CLAUDE_SELECTORS), { stableMs: 2500 });
    const streamBurst = await burst(() => shoot(page), () => detector.poll(), {
      intervalMs: 150,
      maxFrames: 60,
      maxMs: 120000,
    });
    await writeFrames(join(args.outDir, "stream"), "frame", streamBurst.frames);

    console.log(
      [
        `typing frames: ${typingFrames.length}`,
        `stream frames: ${streamBurst.frames.length} (stopped: ${streamBurst.stopped})`,
        `out: ${args.outDir}`,
      ].join("\n"),
    );
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Build and typecheck**

Run: `npm run build && npm run typecheck`
Expected: no errors; `dist/spike-claude.js` exists.

- [ ] **Step 3: Create the findings doc (template to fill during the smoke)**

```markdown
# Findings — live claude.ai capture spike (2026-06-21)

_Fill this in while running the spike. These results drive Phase 2 selectors/timings._

## Run
- Command: `node dist/spike-claude.js --profile <dir> --out <dir> --prompt "<text>"`
- Date / claude.ai URL:
- Playwright / Chrome channel version:

## Login & session reuse
- First-run login flow worked? (log in once, reused after?):
- Any bot-detection / challenge prompts?:

## Selectors (VERIFIED values — correct DEFAULT_CLAUDE_SELECTORS to match)
- composer:
- sendButton:
- stopButton:
- lastAssistantMessage:
- Did any need a role/name selector instead of CSS?:

## Idle detection
- Did stop-button presence track generation correctly?:
- Did text-length growth track streaming?:
- Chosen stableMs (did 2500 work, or pauses longer?):
- Any false idle before/after streaming?:

## Typing burst
- charsPerFrame used / frame count / looked smooth?:
- Any composer focus/timing issues?:

## Streaming burst
- intervalMs / frame count / stopped reason / maxFrames hit?:
- Total JPEG bytes (size concern for inlined HTML later?):

## Determinism freeze
- Did the native caret / CSS animations show up and look bad?:
- Recommend applying the capture-time freeze (caret/animation:none) in Phase 2?:

## folio MCP widget (if tested)
- Did the cross-origin iframe render in screenshots?:

## Surprises / blockers

## Recommended Phase 2 settings
- selectors:
- stableMs:
- typing charsPerFrame:
- streaming intervalMs:
```

- [ ] **Step 4: Run the live smoke**

Run (first time, to log in):
`node dist/spike-claude.js --profile ~/.cueframe-claude --out /tmp/claude-spike --prompt "Plan a 5-day trip to Dublin"`

Log into claude.ai in the opened window if prompted, then re-run the same command. Inspect `/tmp/claude-spike/typing/*.jpg` and `/tmp/claude-spike/stream/*.jpg`.

Expected: typing frames show the prompt appearing progressively; stream frames show the answer growing; the console prints non-zero frame counts and `stopped: condition` (not `maxMs`/`maxFrames`). If selectors were wrong, the run logs "Composer not found" or captures empty frames — correct `DEFAULT_CLAUDE_SELECTORS` and re-run.

- [ ] **Step 5: Fill in the findings doc and commit**

```bash
git add src/spike-claude.ts docs/superpowers/findings/2026-06-21-claude-capture-spike.md
git commit -m "feat(spike): live claude.ai capture entry + findings doc"
```

---

## Self-Review

**Spec coverage (Phase 1 scope only):**
- Persistent profile / logged-in session → Task 1 (`session.ts`). ✓
- Type prompt → Task 5 `typeAndShoot` via Task 4 `composerLocator`. ✓
- Burst screenshots of typing + streaming → Task 5 (typing chunked; streaming via Task 3 `burst`). ✓
- `waitForIdle` detection → Task 2 `IdleDetector` (the standalone `waitForIdle` scenario *step* is Phase 2; the detector logic it needs is built and tested here). ✓
- Output PNGs/JPEGs to disk only, no spec integration → Task 5 writes JPEG; no `spec/`/`player/`/`export/` touched. ✓
- Pin selectors / record findings → Task 4 (single selector home) + Task 5 findings doc. ✓
- Highest-risk-first → this whole plan is the spike, ahead of Phases 2-5. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The findings doc contains blank fields by design — it is a template the operator fills during the smoke, not plan code. ✓

**Type consistency:** `IdleProbe` defined in Task 2, implemented in Task 4, consumed in Task 5. `BurstFrame`/`burst` defined in Task 3, used in Task 5. `composerLocator`/`sendPrompt`/`claudeIdleProbe`/`DEFAULT_CLAUDE_SELECTORS` defined in Task 4, used in Task 5. `launchSession` defined in Task 1, used in Task 5. Names match across tasks. ✓

**Known spike risk (documented, not a plan defect):** concurrent screenshot + keystroke on one Playwright page is avoided by the chunked sequential `typeAndShoot`. If the live composer needs Enter-to-send rather than a button, the smoke will show it — correct `sendPrompt` (or add a `press("Enter")`) and re-run. Both are captured in the findings doc's "Surprises / blockers".
