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
