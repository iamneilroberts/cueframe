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
