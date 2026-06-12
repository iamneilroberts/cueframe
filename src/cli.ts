#!/usr/bin/env node
/**
 * Cueframe CLI — `npx cueframe <verb>` (GOAL.md §4).
 *
 *   cueframe capture <url> [--out spec.json] [--scenario steps.json]
 *                          [--viewport WxH] [--title T] [--app A] [--headed]
 *   cueframe play <spec.json> [--port N] [--open]
 *   cueframe export <spec.json> --format html|mp4|gif [--out demo.html] [--fps N]
 *   cueframe validate <spec.json>
 *
 * The CLI is a thin wrapper over the same core libraries the Claude Code skills use.
 */
import { dirname, resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { capture, parseScenario } from "./capture/index.js";
import type { Scenario } from "./capture/index.js";
import { exportHtml, exportMp4, exportGif } from "./export/index.js";
import { servePlayer } from "./server.js";
import { loadSpec, readSpecJson, resolveSpecOut } from "./io.js";
import { validateSpec, formatValidation } from "./spec/index.js";

interface Parsed {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Parsed {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

function parseViewport(v: string | boolean | undefined): { w: number; h: number } | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^(\d+)x(\d+)$/i);
  if (!m) throw new Error(`--viewport must look like 1280x800 (got "${v}")`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

const USAGE = `cueframe — conversational demo creator

Usage:
  cueframe capture <url> [--out spec.json] [--scenario steps.json] [--viewport WxH] [--title T] [--app A] [--headed]
  cueframe play <spec.json> [--port N] [--open]
  cueframe export <spec.json> --format html|mp4|gif [--out demo.html] [--fps N]
  cueframe validate <spec.json>
`;

async function cmdCapture(p: Parsed): Promise<number> {
  const url = p._[0];
  if (!url) {
    console.error("capture: missing <url>\n" + USAGE);
    return 2;
  }
  const out = typeof p.flags.out === "string" ? p.flags.out : "spec.json";
  const { outDir, specFile } = await resolveSpecOut(out);
  let scenario: Scenario | undefined;
  if (typeof p.flags.scenario === "string") {
    let raw: string;
    try {
      raw = await readFile(p.flags.scenario, "utf8");
    } catch (err) {
      console.error(`capture: could not read --scenario ${p.flags.scenario}: ${(err as Error).message}`);
      return 2;
    }
    try {
      scenario = parseScenario(JSON.parse(raw));
    } catch (err) {
      console.error(`capture: invalid scenario file ${p.flags.scenario}: ${(err as Error).message}`);
      return 2;
    }
  }
  const result = await capture({
    url,
    outDir,
    specFile,
    scenario,
    viewport: parseViewport(p.flags.viewport),
    title: typeof p.flags.title === "string" ? p.flags.title : undefined,
    app: typeof p.flags.app === "string" ? p.flags.app : undefined,
    headless: p.flags.headed ? false : true,
  });
  const golden = result.spec.frames.filter((f) => f.kind === "golden").length;
  console.log(`Captured ${result.spec.frames.length} frame(s) (${golden} golden) → ${result.specPath}`);
  const v = validateSpec(result.spec);
  console.log(`Validation: ${v.errors.length} error(s), ${v.defects.length} capture defect(s), ${v.warnings.length} warning(s)`);
  return v.valid ? 0 : 1;
}

async function cmdPlay(p: Parsed): Promise<number> {
  const specPath = p._[0];
  if (!specPath) {
    console.error("play: missing <spec.json>\n" + USAGE);
    return 2;
  }
  const spec = await loadSpec(specPath);
  const baseDir = dirname(resolve(specPath));
  const port = typeof p.flags.port === "string" ? Number(p.flags.port) : 0;
  const handle = await servePlayer(spec, baseDir, port);
  console.log(`Playing "${spec.meta.title}" → ${handle.url}`);
  console.log("Press Ctrl+C to stop.");
  if (p.flags.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [handle.url], { stdio: "ignore", detached: true }).unref();
  }
  // Keep the process alive until interrupted.
  await new Promise<void>((res) => {
    process.on("SIGINT", () => {
      void handle.close().then(res);
    });
  });
  return 0;
}

async function cmdExport(p: Parsed): Promise<number> {
  const specPath = p._[0];
  const format = p.flags.format;
  if (!specPath || typeof format !== "string") {
    console.error("export: usage: cueframe export <spec.json> --format html|mp4|gif [--out file]\n");
    return 2;
  }
  const spec = await loadSpec(specPath);
  const framesDir = dirname(resolve(specPath));
  const fps = typeof p.flags.fps === "string" ? Number(p.flags.fps) : undefined;
  const defaultOut = `demo.${format}`;
  const outPath = resolve(typeof p.flags.out === "string" ? p.flags.out : defaultOut);

  switch (format) {
    case "html":
      await exportHtml(spec, { framesDir, outPath });
      break;
    case "mp4":
      await exportMp4(spec, { framesDir, outPath, fps });
      break;
    case "gif":
      await exportGif(spec, { framesDir, outPath, fps });
      break;
    default:
      console.error(`export: unknown --format "${format}" (use html|mp4|gif)`);
      return 2;
  }
  console.log(`Exported ${format} → ${outPath}`);
  return 0;
}

async function cmdValidate(p: Parsed): Promise<number> {
  const specPath = p._[0];
  if (!specPath) {
    console.error("validate: missing <spec.json>\n" + USAGE);
    return 2;
  }
  let data: unknown;
  try {
    data = await readSpecJson(specPath);
  } catch (err) {
    console.error(`validate: could not read/parse ${basename(specPath)}: ${(err as Error).message}`);
    return 1;
  }
  const r = validateSpec(data);
  console.log(formatValidation(r));
  return r.valid ? 0 : 1;
}

async function main(): Promise<number> {
  const [, , verb, ...rest] = process.argv;
  const p = parseArgs(rest);
  switch (verb) {
    case "capture":
      return cmdCapture(p);
    case "play":
      return cmdPlay(p);
    case "export":
      return cmdExport(p);
    case "validate":
      return cmdValidate(p);
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(USAGE);
      return verb === undefined ? 2 : 0;
    default:
      console.error(`Unknown command "${verb}"\n` + USAGE);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
