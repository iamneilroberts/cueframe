/** Spec file I/O helpers shared by the CLI and the acceptance/golden scripts. */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { assertValidSpec, type Spec } from "./spec/index.js";

/**
 * Resolve a `--out` value to where the spec file goes. A value ending in a path
 * separator, or naming an existing directory, means "write spec.json into that
 * directory"; anything else is dir + spec filename. This keeps `--out demo/` from
 * trying to write a FILE named `demo` (an EISDIR only after the whole capture ran).
 */
export async function resolveSpecOut(out: string): Promise<{ outDir: string; specFile: string }> {
  const abs = resolve(out);
  const isDir =
    /[\\/]$/.test(out) ||
    (await stat(abs).then((s) => s.isDirectory()).catch(() => false));
  if (isDir) return { outDir: abs, specFile: "spec.json" };
  return { outDir: dirname(abs), specFile: basename(abs) };
}

/** Read + JSON.parse a spec file without validating (for the `validate` verb). */
export async function readSpecJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

/** Read, parse, and assert a spec file is valid. Throws on any error/defect. */
export async function loadSpec(path: string): Promise<Spec> {
  const data = await readSpecJson(path);
  assertValidSpec(data);
  return data;
}

/** Write a spec as pretty JSON (creating parent dirs). */
export async function writeSpec(path: string, spec: Spec): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(spec, null, 2) + "\n", "utf8");
}
