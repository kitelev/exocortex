/**
 * Grounding → expected frontmatter-diff predictor (RFC v4 §7.1 contract).
 *
 * Port of the Phase 0 prototype `/tmp/phase0-predictor-test/predictor.mjs` with
 * TypeScript types layered on. Pure function: no file I/O, no mutation. Given a
 * parsed `GroundingDefinition`, the host's `targetIRI`, and the optional
 * `userInput`, it returns the frontmatter delta the real `GroundingExecutor`
 * would write — so the integration harness can compare `before` vs `after`
 * without coupling to dispatch mechanics.
 *
 * Per-command special-case branch count (RFC §7.1b gate ≤5):
 *   1. `service_call.serviceId === "convertToTask"`              → executor:344
 *   2. `service_call.serviceId === "updateProperty"` + targetCls `ems__Task`
 *                                                                 → executor:370
 *   3. `service_call.serviceId === "updateProperty"` + targetCls `ems__Project`
 *                                                                 → executor:373
 *
 * Total: **3 / 5** — 2 branches of headroom preserved for future class-flip
 * shortcuts (e.g. `ems__Area` if the ontology ever grows another pivot class).
 *
 * RFC v4 §12 gate: matching unit test lives at
 * `packages/cli/tests/unit/test-helpers/predict-mutation.test.ts`.
 */
import type { GroundingDefinition } from "exocortex";
import { GroundingType } from "exocortex";

export interface PredictedMutation {
  /**
   * Expected frontmatter diff: `{ [property]: expected-string-value }`.
   * A sentinel `"__DELETE__"` value marks property_delete semantics — callers
   * strip such keys from the "after" snapshot before comparing.
   */
  readonly frontmatterDiff: Readonly<Record<string, string>>;
  /**
   * Regex matchers for nondeterministic fields (`$nowLocal` substitutions).
   * Callers should prefer these over literal equality on the corresponding
   * property key.
   */
  readonly timestampRegexes?: Readonly<Record<string, RegExp>>;
  /**
   * File-creation side effect (`create_instance` grounding). Present instead
   * of — not in addition to — a frontmatter diff on the host asset.
   */
  readonly fileCreation?: {
    readonly targetFolder: string;
    readonly targetClass?: string;
    readonly targetPrototype?: string;
  };
  /**
   * True when the grounding is dispatch-only (generic `service_call`). The
   * caller should assert dispatch success without attempting to match a
   * mutation diff.
   */
  readonly unpredictable?: true;
  /** Human-readable reason when `unpredictable === true`. */
  readonly reason?: string;
}

export interface PredictorUserInput {
  readonly value?: unknown;
}

export interface PredictorContext {
  /**
   * Injection hook for the `$nowLocal` timestamp format. Tests pin a fixed
   * date to make regex matchers stable; production callers let this default
   * to the real clock.
   */
  readonly now?: Date;
}

const TIMESTAMP_ANY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/**
 * Match `GroundingExecutor.substituteVariables` verbatim (executor.ts:527-549).
 * Kept as a local function so predictor/executor drift surfaces as a one-line
 * diff during review.
 */
export function substituteVariables(
  value: string,
  targetIRI: string,
  userInput: PredictorUserInput | undefined,
  now: Date,
): string {
  const nowIso = now.toISOString();
  const nowLocal = toLocalTimestamp(now);
  const today = nowIso.slice(0, 10);

  let result = value
    .replace(/\$target/g, targetIRI)
    .replace(/\$nowLocal/g, nowLocal)
    .replace(/\$now/g, nowIso)
    .replace(/\$today/g, today);

  if (userInput?.value !== undefined && userInput.value !== null) {
    const inputStr = String(userInput.value);
    result = result
      .replace(/\$input\b/g, inputStr)
      .replace(/\$value\b/g, inputStr);
  }
  return result;
}

/** Mirrors `DateFormatter.toLocalTimestamp` (YYYY-MM-DDTHH:mm:ss, no ms, no tz). */
function toLocalTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Extract a class token (e.g. `ems__Task`) from a `Grounding_targetValue`.
 * Accepts both the wrapped wikilink form (`"[[ems__Task]]"`) that the vault
 * RDF pipeline emits AND the plain literal form (`ems__Task`) that some CLI
 * fixtures use. Mirrors executor:30-37.
 */
export function extractClassFromTargetValue(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const wrapped = value.match(/^"?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"?$/);
  if (wrapped) return wrapped[1];
  return value;
}

const containsInputPlaceholder = (value: string): boolean =>
  /\$(input|value)\b/.test(value);

/**
 * Predict the frontmatter mutation for a single grounding dispatch.
 *
 * The caller is expected to pre-parse the grounding tree (via
 * `loadResolutionContext` / the command-catalog helpers) so this function is
 * deterministic and side-effect free.
 */
export function predictMutationForGrounding(
  grounding: GroundingDefinition,
  targetIRI: string,
  userInput?: PredictorUserInput,
  context: PredictorContext = {},
): PredictedMutation {
  const now = context.now ?? new Date();
  return predictGrounding(grounding, targetIRI, userInput, now);
}

function predictGrounding(
  g: GroundingDefinition,
  targetIRI: string,
  userInput: PredictorUserInput | undefined,
  now: Date,
): PredictedMutation {
  switch (g.type) {
    case GroundingType.PROPERTY_SET:
      return predictPropertySet(g, targetIRI, userInput, now);
    case GroundingType.PROPERTY_DELETE:
      return predictPropertyDelete(g);
    case GroundingType.COMPOSITE:
      return predictComposite(g, targetIRI, userInput, now);
    case GroundingType.SERVICE_CALL:
      return predictServiceCall(g);
    case GroundingType.CREATE_INSTANCE:
      return predictCreateInstance(g);
    case GroundingType.SPARQL_UPDATE:
      return {
        frontmatterDiff: {},
        unpredictable: true,
        reason: "sparql_update is not implemented in GroundingExecutor",
      };
    default:
      return {
        frontmatterDiff: {},
        unpredictable: true,
        reason: `Unknown grounding type: ${String(g.type)}`,
      };
  }
}

function predictPropertySet(
  g: GroundingDefinition,
  targetIRI: string,
  userInput: PredictorUserInput | undefined,
  now: Date,
): PredictedMutation {
  if (!g.targetProperty || g.targetValue === undefined) {
    return {
      frontmatterDiff: {},
      unpredictable: true,
      reason: "property_set grounding missing targetProperty or targetValue",
    };
  }
  if (
    containsInputPlaceholder(g.targetValue) &&
    (userInput === undefined ||
      userInput.value === undefined ||
      userInput.value === null)
  ) {
    return {
      frontmatterDiff: {},
      unpredictable: true,
      reason:
        "property_set targetValue contains $input/$value but userInput.value is missing",
    };
  }
  const hasNowLocal = /\$nowLocal/.test(g.targetValue);
  const substituted = substituteVariables(g.targetValue, targetIRI, userInput, now);
  const diff: Record<string, string> = { [g.targetProperty]: substituted };
  if (hasNowLocal) {
    return {
      frontmatterDiff: diff,
      timestampRegexes: { [g.targetProperty]: TIMESTAMP_ANY_RE },
    };
  }
  return { frontmatterDiff: diff };
}

function predictPropertyDelete(g: GroundingDefinition): PredictedMutation {
  if (!g.targetProperty) {
    return {
      frontmatterDiff: {},
      unpredictable: true,
      reason: "property_delete grounding missing targetProperty",
    };
  }
  return { frontmatterDiff: { [g.targetProperty]: "__DELETE__" } };
}

function predictComposite(
  g: GroundingDefinition,
  targetIRI: string,
  userInput: PredictorUserInput | undefined,
  now: Date,
): PredictedMutation {
  const steps = g.steps ?? [];
  const merged: Record<string, string> = {};
  const regexes: Record<string, RegExp> = {};
  for (const step of steps) {
    const stepResult = predictGrounding(step, targetIRI, userInput, now);
    if (stepResult.unpredictable) return stepResult;
    Object.assign(merged, stepResult.frontmatterDiff);
    if (stepResult.timestampRegexes) {
      Object.assign(regexes, stepResult.timestampRegexes);
    }
  }
  return Object.keys(regexes).length === 0
    ? { frontmatterDiff: merged }
    : { frontmatterDiff: merged, timestampRegexes: regexes };
}

function predictServiceCall(g: GroundingDefinition): PredictedMutation {
  // For service_call, executor:331 repurposes `targetProperty` as `serviceId`.
  const serviceId = g.targetProperty;
  if (!serviceId) {
    return {
      frontmatterDiff: {},
      unpredictable: true,
      reason: "service_call grounding missing serviceId (targetProperty)",
    };
  }
  // Branch 1 — convertToTask direct alias.
  if (serviceId === "convertToTask") {
    return {
      frontmatterDiff: { exo__Instance_class: `["[[ems__Task]]"]` },
    };
  }
  if (serviceId === "updateProperty") {
    const cls = extractClassFromTargetValue(g.targetValue);
    // Branch 2 — updateProperty + ems__Task class-flip.
    if (cls === "ems__Task") {
      return {
        frontmatterDiff: { exo__Instance_class: `["[[ems__Task]]"]` },
      };
    }
    // Branch 3 — updateProperty + ems__Project class-flip.
    if (cls === "ems__Project") {
      return {
        frontmatterDiff: { exo__Instance_class: `["[[ems__Project]]"]` },
      };
    }
  }
  return {
    frontmatterDiff: {},
    unpredictable: true,
    reason: `service_call "${serviceId}" is dispatch-only; predictor is silent by design`,
  };
}

function predictCreateInstance(g: GroundingDefinition): PredictedMutation {
  if (!g.targetFolder) {
    return {
      frontmatterDiff: {},
      unpredictable: true,
      reason: "create_instance grounding missing targetFolder",
    };
  }
  return {
    frontmatterDiff: {},
    fileCreation: {
      targetFolder: g.targetFolder,
      targetClass: g.targetClass,
      targetPrototype: g.targetPrototype,
    },
  };
}

/**
 * Convenience assertion helper — flattens a `PredictedMutation` + a raw
 * `after` frontmatter into a `{ matches: boolean; failures: string[] }` for
 * parametrized test output. Not a jest matcher (kept stdout-friendly).
 */
export function matchMutation(
  predicted: PredictedMutation,
  afterFrontmatter: Record<string, unknown>,
): { matches: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const [key, expected] of Object.entries(predicted.frontmatterDiff)) {
    const actual = afterFrontmatter[key];
    const regex = predicted.timestampRegexes?.[key];
    if (regex) {
      if (typeof actual !== "string" || !regex.test(actual)) {
        failures.push(`${key}: actual=${JSON.stringify(actual)} does not match ${regex}`);
      }
    } else if (expected === "__DELETE__") {
      if (key in afterFrontmatter) {
        failures.push(`${key}: expected to be deleted but present as ${JSON.stringify(actual)}`);
      }
    } else if (actual !== expected) {
      failures.push(`${key}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    }
  }
  return { matches: failures.length === 0, failures };
}
