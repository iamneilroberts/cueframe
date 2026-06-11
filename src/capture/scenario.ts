/**
 * Capture scenario — the script the Showrunner executes to drive an app (GOAL.md §3, §8).
 *
 * A scenario is a flat list of steps. The capture engine runs them in order. A step that
 * carries a `caption` (and every `snapshot`) produces a GOLDEN frame, captured AFTER the
 * step's effect has applied. Steps without a caption just act. `waitFor` never produces a
 * frame.
 *
 * Scenarios reach the engine three ways, in priority order (see capture.ts):
 *   1. an explicit `scenario` passed to `capture()`,
 *   2. one embedded in the page as `window.__CUEFRAME_SCENARIO__` (or a
 *      `<script id="cueframe-scenario" type="application/json">` tag),
 *   3. a generic auto-explore fallback synthesised from the live DOM.
 */

/** One action in a scenario. A `caption` (or a `snapshot`) marks a golden frame. */
export type Step =
  | { action: "goto"; url?: string; caption?: string }
  | { action: "fill"; selector: string; value: string; caption?: string; label?: string }
  | { action: "click"; selector: string; caption?: string; label?: string }
  | { action: "press"; selector?: string; key: string; caption?: string }
  | { action: "waitFor"; selector?: string; ms?: number }
  | { action: "snapshot"; caption: string };

/** A capture scenario: an optional name plus an ordered list of steps. */
export interface Scenario {
  name?: string;
  steps: Step[];
}

/** True iff this step yields a golden frame (captured after its effect). */
export function isGoldenStep(step: Step): boolean {
  if (step.action === "snapshot") return true;
  if (step.action === "waitFor") return false;
  return typeof (step as { caption?: string }).caption === "string"
    && (step as { caption?: string }).caption!.trim().length > 0;
}

/** The caption a golden step contributes (snapshots always have one). */
export function stepCaption(step: Step): string | undefined {
  if (step.action === "waitFor") return undefined;
  const c = (step as { caption?: string }).caption;
  return typeof c === "string" && c.trim().length > 0 ? c : undefined;
}

/** Selectors a step references, for box collection (union with the generic set). */
export function stepSelectors(step: Step): string[] {
  switch (step.action) {
    case "fill":
    case "click":
      return [step.selector];
    case "press":
      return step.selector ? [step.selector] : [];
    case "waitFor":
      return step.selector ? [step.selector] : [];
    default:
      return [];
  }
}

/** The action label a step contributes to a frame's `action` field, if interactive. */
export function stepActionLabel(step: Step): { label: string; selector: string } | undefined {
  if (step.action === "fill" || step.action === "click") {
    return { label: step.label ?? step.action, selector: step.selector };
  }
  return undefined;
}

const STEP_ACTIONS = ["goto", "fill", "click", "press", "waitFor", "snapshot"] as const;

/** Validate one raw step. Returns an error message, or null when the step is well-formed. */
function checkStep(raw: unknown, i: number): string | null {
  const at = (msg: string): string => `steps[${i}]: ${msg}`;
  if (typeof raw !== "object" || raw === null) return at("must be an object");
  const s = raw as Record<string, unknown>;
  if (typeof s.action !== "string") return at('missing a string "action"');
  switch (s.action) {
    case "goto":
      if (s.url !== undefined && typeof s.url !== "string") return at('goto "url" must be a string');
      break;
    case "fill":
      if (typeof s.selector !== "string" || s.selector.trim() === "") return at('fill needs a non-empty "selector"');
      if (typeof s.value !== "string") return at('fill needs a string "value"');
      break;
    case "click":
      if (typeof s.selector !== "string" || s.selector.trim() === "") return at('click needs a non-empty "selector"');
      break;
    case "press":
      if (typeof s.key !== "string" || s.key.trim() === "") return at('press needs a non-empty "key"');
      if (s.selector !== undefined && typeof s.selector !== "string") return at('press "selector" must be a string');
      break;
    case "waitFor":
      if (s.selector !== undefined && typeof s.selector !== "string") return at('waitFor "selector" must be a string');
      if (s.ms !== undefined && typeof s.ms !== "number") return at('waitFor "ms" must be a number');
      break;
    case "snapshot":
      if (typeof s.caption !== "string" || s.caption.trim() === "") return at('snapshot needs a non-empty "caption"');
      break;
    default:
      return at(`unknown action "${s.action}" (valid actions: ${STEP_ACTIONS.join(", ")})`);
  }
  if (s.caption !== undefined && typeof s.caption !== "string") return at('"caption" must be a string');
  if (s.label !== undefined && typeof s.label !== "string") return at('"label" must be a string');
  return null;
}

/**
 * Strictly narrow an unknown value into a Scenario. Throws a descriptive Error listing
 * every malformed step (with its index) — used by the CLI for `--scenario` files, so a
 * typo'd action fails loudly instead of silently capturing a frame for a step that never ran.
 */
export function parseScenario(value: unknown): Scenario {
  if (typeof value !== "object" || value === null) {
    throw new Error('scenario must be an object with a "steps" array');
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error('scenario needs a non-empty "steps" array');
  }
  const problems: string[] = [];
  obj.steps.forEach((raw, i) => {
    const e = checkStep(raw, i);
    if (e) problems.push(e);
  });
  if (problems.length > 0) {
    throw new Error(`invalid scenario:\n  - ${problems.join("\n  - ")}`);
  }
  const name = typeof obj.name === "string" ? obj.name : undefined;
  const steps = obj.steps as unknown as Step[];
  return name === undefined ? { steps } : { name, steps };
}

/** Narrow an unknown value into a Scenario, or return undefined if it isn't one. */
export function asScenario(value: unknown): Scenario | undefined {
  try {
    return parseScenario(value);
  } catch {
    return undefined;
  }
}
