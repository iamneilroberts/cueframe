/**
 * Integration test for the Showrunner: serve the bundled sample app on an ephemeral port,
 * run `capture()` against its embedded scenario, and assert the §6.3 acceptance contract —
 * ≥6 golden frames, a clean valid spec (zero defects), and rich per-frame fields.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, stat, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AddressInfo } from "node:net";

import { capture } from "./capture.js";
import { validateSpec, goldenFrames } from "../spec/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE_DIR = resolve(HERE, "../../examples/todo-app");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

let server: Server;
let baseUrl: string;
let outDir: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
      let filePath = normalize(join(SAMPLE_DIR, urlPath));
      if (!filePath.startsWith(SAMPLE_DIR)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      let info;
      try {
        info = await stat(filePath);
      } catch {
        res.writeHead(404).end("Not found");
        return;
      }
      if (info.isDirectory()) filePath = join(filePath, "index.html");
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
      res.end(data);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}/`;

  outDir = await mkdtemp(join(tmpdir(), "cueframe-capture-"));
}, 120_000);

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe("capture (integration, sample app)", () => {
  it("produces a clean, rich, schema-valid spec with >= 6 golden frames", async () => {
    const result = await capture({ url: baseUrl, outDir, headless: true });
    const { spec, specPath, framesDir } = result;

    // Spec validates with zero errors and zero capture defects.
    const validation = validateSpec(spec);
    expect(validation.defects).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);

    // >= 6 golden frames.
    const golden = goldenFrames(spec);
    expect(golden.length).toBeGreaterThanOrEqual(6);

    // Each golden frame: non-empty caption, non-empty axDigest, >= 1 real box.
    for (const f of golden) {
      expect(f.caption.trim().length).toBeGreaterThan(0);
      expect(f.axDigest.trim().length).toBeGreaterThan(0);
      const realBoxes = f.boxes.filter((b) => b.selector.trim().length > 0 && b.rect.w > 0 && b.rect.h > 0);
      expect(realBoxes.length).toBeGreaterThanOrEqual(1);
    }

    // The semantic fields are genuinely searchable — a todo text appears in some digest.
    const allDigests = golden.map((f) => f.axDigest).join(" || ");
    expect(allDigests).toContain("Buy groceries");

    // The screenshot files exist on disk and are non-empty.
    for (const f of golden) {
      const p = join(outDir, f.img);
      const info = await stat(p);
      expect(info.size).toBeGreaterThan(0);
    }
    expect(framesDir).toContain("frames");

    // spec.json was written to disk and matches.
    const onDisk = JSON.parse(await readFile(specPath, "utf8"));
    expect(validateSpec(onDisk).valid).toBe(true);
    expect(goldenFrames(onDisk).length).toBe(golden.length);
  }, 120_000);

  it("honors specFile so `--out dir/name.json` writes that filename", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "cueframe-capture-out-"));
    try {
      const result = await capture({ url: baseUrl, outDir: dir2, specFile: "myspec.json", headless: true });
      expect(result.specPath.endsWith("myspec.json")).toBe(true);
      const onDisk = JSON.parse(await readFile(result.specPath, "utf8"));
      expect(validateSpec(onDisk).valid).toBe(true);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  }, 120_000);
});
