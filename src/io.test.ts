import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { resolveSpecOut } from "./io.js";

let existingDir: string;

beforeAll(async () => {
  existingDir = await mkdtemp(join(tmpdir(), "cueframe-out-"));
});

afterAll(async () => {
  await rm(existingDir, { recursive: true, force: true });
});

describe("resolveSpecOut", () => {
  it("treats a plain file path as dir + filename", async () => {
    const r = await resolveSpecOut(join(existingDir, "myspec.json"));
    expect(r).toEqual({ outDir: existingDir, specFile: "myspec.json" });
  });

  it("treats a trailing-separator path as a directory (even when it does not exist yet)", async () => {
    const missing = join(existingDir, "newdir") + sep;
    const r = await resolveSpecOut(missing);
    expect(r).toEqual({ outDir: join(existingDir, "newdir"), specFile: "spec.json" });
  });

  it("treats an existing directory as a directory even without a trailing separator", async () => {
    const r = await resolveSpecOut(existingDir);
    expect(r).toEqual({ outDir: existingDir, specFile: "spec.json" });
  });

  it("treats a nonexistent path without a separator as a file", async () => {
    const missing = join(existingDir, "not-yet-there.json");
    const r = await resolveSpecOut(missing);
    expect(r).toEqual({ outDir: existingDir, specFile: "not-yet-there.json" });
  });

  it("resolves relative paths against the cwd", async () => {
    const r = await resolveSpecOut("demo/spec.json");
    expect(r.outDir).toBe(resolve("demo"));
    expect(r.specFile).toBe("spec.json");
  });
});
