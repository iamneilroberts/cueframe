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
