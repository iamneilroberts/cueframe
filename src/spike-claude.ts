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
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1] as string;
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
