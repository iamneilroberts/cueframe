/** Spec file I/O helpers shared by the CLI and the acceptance/golden scripts. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { assertValidSpec, type Spec } from "./spec/index.js";

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
