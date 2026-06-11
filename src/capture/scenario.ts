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

/** Narrow an unknown value into a Scenario, or return undefined if it isn't one. */
export function asScenario(value: unknown): Scenario | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.steps)) return undefined;
  const steps: Step[] = [];
  for (const raw of obj.steps) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const s = raw as Record<string, unknown>;
    if (typeof s.action !== "string") return undefined;
    steps.push(s as unknown as Step);
  }
  const name = typeof obj.name === "string" ? obj.name : undefined;
  return name === undefined ? { steps } : { name, steps };
}
