import { describe, it, expect } from "vitest";
import { parseScenario, asScenario, isGoldenStep } from "./scenario.js";

describe("parseScenario", () => {
  it("accepts a well-formed scenario", () => {
    const s = parseScenario({
      name: "ok",
      steps: [
        { action: "goto", caption: "Loads." },
        { action: "fill", selector: "[data-new-todo]", value: "Milk" },
        { action: "click", selector: "[data-add]", caption: "Added." },
        { action: "press", key: "Enter" },
        { action: "waitFor", selector: "[data-todo]", ms: 50 },
        { action: "snapshot", caption: "Done." },
      ],
    });
    expect(s.name).toBe("ok");
    expect(s.steps).toHaveLength(6);
  });

  it("rejects an unknown action with the step index and the bad value", () => {
    expect(() =>
      parseScenario({ steps: [{ action: "goto" }, { action: "clik", selector: "[data-add]", caption: "Clicked." }] }),
    ).toThrowError(/steps\[1\].*unknown action "clik"/);
  });

  it("rejects a click without a selector", () => {
    expect(() => parseScenario({ steps: [{ action: "click", caption: "Clicked." }] })).toThrowError(
      /steps\[0\].*selector/,
    );
  });

  it("rejects a fill without a string value", () => {
    expect(() => parseScenario({ steps: [{ action: "fill", selector: "#x" }] })).toThrowError(/steps\[0\].*value/);
  });

  it("rejects a snapshot without a caption", () => {
    expect(() => parseScenario({ steps: [{ action: "snapshot" }] })).toThrowError(/steps\[0\].*caption/);
  });

  it("rejects a non-object and an empty steps array", () => {
    expect(() => parseScenario(null)).toThrowError(/scenario/);
    expect(() => parseScenario({ steps: [] })).toThrowError(/steps/);
  });

  it("aggregates every malformed step into one error", () => {
    let message = "";
    try {
      parseScenario({ steps: [{ action: "click" }, { action: "clik" }] });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/steps\[0\].*selector/);
    expect(message).toMatch(/steps\[1\].*unknown action "clik"/);
  });

  it("rejects waitFor with a caption (it never produces a frame)", () => {
    expect(() => parseScenario({ steps: [{ action: "waitFor", selector: "#x", caption: "Loaded." }] })).toThrowError(
      /steps\[0\].*waitFor cannot have a "caption"/,
    );
  });
});

describe("asScenario (lenient form used for embedded scenarios)", () => {
  it("returns undefined instead of throwing on an invalid scenario", () => {
    expect(asScenario({ steps: [{ action: "clik", caption: "x" }] })).toBeUndefined();
    expect(asScenario(null)).toBeUndefined();
  });

  it("still narrows a valid embedded scenario", () => {
    const s = asScenario({ steps: [{ action: "snapshot", caption: "State." }] });
    expect(s?.steps).toHaveLength(1);
    expect(isGoldenStep(s!.steps[0]!)).toBe(true);
  });
});
