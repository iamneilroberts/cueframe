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
