import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Spec } from "../spec/index.js";
import { exportMp4, exportGif } from "./video.js";
import { fixtureSpec, writeFixtureFrames } from "./_fixture.js";

const cleanups: string[] = [];
afterAll(async () => {
  for (const d of cleanups) await rm(d, { recursive: true, force: true });
});

/** Trim the reel so the integration test is fast: fewer frames, tiny dwell. */
function shortSpec(): Spec {
  const s = fixtureSpec();
  // keep only two golden frames, single short callout
  s.frames = s.frames.filter((f) => f.id === "f1" || f.id === "f2");
  s.callouts = [{ id: "c1", frame: "f2", title: "Results", dwellMs: 200, style: "card" }];
  return s;
}

describe("video exporters", () => {
  it("exportMp4 produces a non-empty mp4 starting with an ISO-BMFF ftyp box", async () => {
    const spec = shortSpec();
    const framesDir = await writeFixtureFrames(spec);
    cleanups.push(framesDir);
    const outDir = await mkdtemp(path.join(tmpdir(), "cueframe-mp4-"));
    cleanups.push(outDir);
    const outPath = path.join(outDir, "demo.mp4");

    await exportMp4(spec, { framesDir, outPath, fps: 8 });

    const st = await stat(outPath);
    expect(st.size).toBeGreaterThan(0);
    const buf = await readFile(outPath);
    // ISO Base Media File Format: bytes 4..8 spell "ftyp"
    expect(buf.subarray(4, 8).toString("latin1")).toBe("ftyp");
  });

  it("exportGif produces a non-empty gif starting with GIF8", async () => {
    const spec = shortSpec();
    const framesDir = await writeFixtureFrames(spec);
    cleanups.push(framesDir);
    const outDir = await mkdtemp(path.join(tmpdir(), "cueframe-gif-"));
    cleanups.push(outDir);
    const outPath = path.join(outDir, "demo.gif");

    await exportGif(spec, { framesDir, outPath, fps: 8 });

    const st = await stat(outPath);
    expect(st.size).toBeGreaterThan(0);
    const buf = await readFile(outPath);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("GIF8");
  });
});
