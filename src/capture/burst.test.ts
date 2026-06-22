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
