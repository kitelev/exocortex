/**
 * Phase 1 exit-gate pilot — 5 starter-kit commands through the real
 * `GroundingExecutor` pipeline with synth fixtures + predictor cross-check.
 *
 * Wires the five Phase 1 helpers that landed in PRs #2886–#2889 end-to-end:
 *
 *   1. `command-catalog.loadCommandCatalog()` — 44 Commands, pinned submodule.
 *   2. `extract-target-class.loadStarterKitContext()` + the 5-strategy ladder —
 *      picks the host class a fixture should pose as.
 *   3. `fixture-factory.buildFixture()` — materialises a synth host `.md`.
 *   4. `user-input-factory.buildUserInputForGroundingFrontmatter()` —
 *      synthesises `--input` JSON for commands whose grounding schema declares
 *      one.
 *   5. `predict-mutation.predictMutationForGrounding()` — expected frontmatter
 *      diff; `execute-command.executeCommandHarness()` then dispatches the
 *      same grounding through the real `GroundingExecutor` and we compare.
 *
 * Pilot scope per RFC §8 Phase 0 Gate 0c benchmark list:
 *
 *   1. `e941b3bb` Set Status Doing            composite, property_set × 2
 *   2. `a3966e53` Convert to Task             service_call (updateProperty class-flip)
 *   3. `2adf3655` Create Child Task           service_call (createRelatedTask)
 *   4. `6bc86da6` Set Planned Start           service_call (updateProperty JSON)
 *   5. `923520d1` Set Status Done             composite, property_set × 3
 *
 * Predictor-predictable cases (`Set Status *`, `Convert to Task`) assert
 * `result.success === true` AND frontmatter-diff equivalence. Predictor
 * flags service_call w/ generic registry-backed dispatch as `unpredictable`
 * (RFC v4 §7.1 — predictor stays silent on dispatch-only services);
 * those cases assert the executor was at least invoked and surfaced a clean
 * boolean `result.success` (CLI has no registry-backed `updateProperty`
 * impl, by design — issues #2864/#2866 covered that gap).
 *
 * Frontmatter comparison is performed against the **raw file content** (not
 * a parsed YAML object) because `js-yaml` coerces ISO-8601 scalars into
 * `Date` instances, which then fail predictor's string-based
 * `TIMESTAMP_ANY_RE` matcher, and collapses quoted `"[[uuid]]"` wikilinks to
 * unquoted `[[uuid]]`, which disagrees with the predictor's
 * substitute-variables output. Line-oriented matching sidesteps both.
 *
 * Phase 0 coverage-delta projection (report `/tmp/phase0-coverage-delta-...`)
 * flagged a possible -3.5 pp stmt drop if Phase 1 helpers landed without
 * self-tests. c2e0c599 (PR #2889) shipped the helpers with 91.15% stmt
 * coverage and 5 unit suites, putting the empirical gate in reach. This
 * pilot is the final Phase 1 exit-gate artefact.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import * as fs from "fs";
import { ServiceRegistry } from "exocortex";
import {
  loadCommandCatalog,
  type CommandCatalogEntry,
} from "./test-helpers/command-catalog.js";
import {
  loadStarterKitContext,
  extractTargetClassFromCommand,
  type StarterKitContext,
  type GroundingData,
} from "./test-helpers/extract-target-class.js";
import {
  buildFixture,
  makeFixtureRoot,
  cleanupFixtureRoot,
} from "./test-helpers/fixture-factory.js";
import { buildUserInputForGroundingFrontmatter } from "./test-helpers/user-input-factory.js";
import {
  predictMutationForGrounding,
  type PredictedMutation,
} from "./test-helpers/predict-mutation.js";
import {
  executeCommandHarness,
  toGroundingDefinition,
} from "./test-helpers/execute-command.js";

// ---------------------------------------------------------------------------
// Pilot selection
// ---------------------------------------------------------------------------

interface PilotCommand {
  readonly uid: string;
  readonly label: string;
}

const PILOT_COMMANDS: readonly PilotCommand[] = [
  { uid: "e941b3bb-d375-40d2-b271-e1d71deb014c", label: "Set Status Doing" },
  { uid: "a3966e53-b819-42c9-aab2-ebd5512cf566", label: "Convert to Task" },
  { uid: "2adf3655-0ab9-4578-ad2e-223108729db8", label: "Create Child Task" },
  { uid: "6bc86da6-4e58-4441-bc9b-20d2097451df", label: "Set Planned Start" },
  { uid: "923520d1-1892-4a6c-88ea-9552250a7cbe", label: "Set Status Done" },
] as const;

// Fixed wall-clock for deterministic `$nowLocal` regex matching.
const PINNED_NOW = new Date(Date.UTC(2026, 3, 20, 7, 0, 0));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unwrap(raw: string): string {
  const m = raw.match(/^"?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"?$/);
  return m ? m[1] : raw;
}

function resolveGrounding(
  cmd: CommandCatalogEntry,
  ctx: StarterKitContext,
): GroundingData | undefined {
  if (!cmd.grounding) return undefined;
  return ctx.groundings.get(unwrap(cmd.grounding));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the raw frontmatter block between the opening and closing `---`
 * fences. Trailing newline stripped for stable line-splitting.
 */
function extractFrontmatterBlock(rawContent: string): string {
  const m = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("fixture has no frontmatter after dispatch");
  return m[1];
}

/**
 * Find the value text of a scalar frontmatter line `<key>: <value>`. Returns
 * undefined when the key is missing, and `"__ARRAY__"` when the key has a
 * block-array form (`<key>:\n  - ...`) — the pilot's predictor only emits
 * scalar values, so hitting the array branch surfaces a real mismatch.
 */
function findScalarValue(fmBlock: string, key: string): string | undefined {
  const scalarRe = new RegExp(`^${escapeRegex(key)}:[ \\t]+(.*)$`, "m");
  const scalarMatch = scalarRe.exec(fmBlock);
  if (scalarMatch) return scalarMatch[1].trimEnd();
  const blockRe = new RegExp(`^${escapeRegex(key)}:\\s*$[\\s\\S]*?^[ \\t]+-`, "m");
  if (blockRe.test(fmBlock)) return "__ARRAY__";
  return undefined;
}

/**
 * Compare a `PredictedMutation` against the raw post-dispatch file content.
 * Throws an Error with a compact diff report when the mutation disagrees.
 */
function assertMutationMatchesRaw(
  predicted: PredictedMutation,
  rawContentAfter: string,
): void {
  const fmBlock = extractFrontmatterBlock(rawContentAfter);
  const failures: string[] = [];

  for (const [key, expected] of Object.entries(predicted.frontmatterDiff)) {
    const actual = findScalarValue(fmBlock, key);
    const regex = predicted.timestampRegexes?.[key];

    if (regex) {
      if (actual === undefined) {
        failures.push(`${key}: missing from frontmatter`);
        continue;
      }
      if (actual === "__ARRAY__") {
        failures.push(`${key}: expected scalar timestamp, got block-array`);
        continue;
      }
      if (!regex.test(actual)) {
        failures.push(`${key}: actual="${actual}" does not match ${regex}`);
      }
      continue;
    }

    if (expected === "__DELETE__") {
      if (actual !== undefined) {
        failures.push(`${key}: expected to be deleted but present as "${actual}"`);
      }
      continue;
    }

    if (actual === undefined) {
      failures.push(`${key}: missing from frontmatter (expected "${expected}")`);
      continue;
    }
    if (actual !== expected) {
      failures.push(`${key}: expected="${expected}" actual="${actual}"`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Predictor-vs-executor frontmatter mismatch:\n  ` + failures.join("\n  "),
    );
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Phase 1 pilot — 5-command end-to-end through GroundingExecutor", () => {
  let catalog: CommandCatalogEntry[];
  let context: StarterKitContext;

  beforeAll(() => {
    catalog = loadCommandCatalog();
    context = loadStarterKitContext();
  });

  it("loads the full Command catalog (44 entries)", () => {
    expect(catalog.length).toBe(44);
  });

  it("every pilot command is present in the catalog + has a grounding", () => {
    for (const pc of PILOT_COMMANDS) {
      const hit = catalog.find((c) => c.uid === pc.uid);
      expect(hit).toBeDefined();
      expect(hit?.grounding).toBeDefined();
    }
  });

  for (const pc of PILOT_COMMANDS) {
    describe(`${pc.label} (${pc.uid.slice(0, 8)})`, () => {
      it("dispatches through GroundingExecutor + matches predictor (or is dispatch-only)", async () => {
        const cmd = catalog.find((c) => c.uid === pc.uid);
        if (!cmd) throw new Error(`pilot command ${pc.uid} not in catalog`);

        const resolution = extractTargetClassFromCommand(cmd, context);
        const grounding = resolveGrounding(cmd, context);
        if (!grounding) {
          throw new Error(`pilot command ${pc.uid} has no grounding`);
        }

        const root = makeFixtureRoot(`pilot-${pc.uid.slice(0, 8)}-`);
        try {
          const fixture = buildFixture({
            className: resolution.targetClass,
            seed: `pilot-${pc.uid}`,
            root,
            label: `Pilot fixture for ${pc.label}`,
          });

          const userInputResult = buildUserInputForGroundingFrontmatter(
            grounding.raw,
            {
              seed: `pilot-${pc.uid}`,
              assetRefSeedUuid: fixture.uid,
            },
          );

          // Predictor — substitute-variables + grounding shape
          const definition = toGroundingDefinition(grounding);
          const predicted = predictMutationForGrounding(
            definition,
            fixture.targetIRI,
            userInputResult?.payload as { value?: unknown } | undefined,
            { now: PINNED_NOW },
          );

          // Fresh bare ServiceRegistry — no stubs. Dispatch-only groundings
          // (createRelatedTask / generic updateProperty) will surface
          // `Service not found` via the executor's clean `{success:false}`
          // path; predictor-predictable groundings (property_set,
          // class-flip) hit executor shortcuts and short-circuit the
          // registry lookup entirely.
          const registry = new ServiceRegistry();
          const execResult = await executeCommandHarness({
            grounding,
            filePath: fixture.path,
            targetIRI: fixture.targetIRI,
            userInput: userInputResult?.payload,
            serviceRegistry: registry,
          });

          // eslint-disable-next-line no-console
          console.log(
            `[pilot:${pc.uid.slice(0, 8)}] ` +
              `class=${resolution.targetClass} strategy=${resolution.strategy} ` +
              `unpredictable=${predicted.unpredictable ?? false} ` +
              `success=${execResult.success}` +
              (execResult.error ? ` error="${execResult.error}"` : ""),
          );

          if (predicted.unpredictable) {
            // Dispatch-only: executor must produce a clean boolean outcome.
            // Either shortcut succeeds (unlikely for these cases) or registry
            // miss surfaces as `Service not found: ...`. Anything else
            // (throw, undefined) is a harness regression.
            expect(typeof execResult.success).toBe("boolean");
            if (!execResult.success) {
              expect(execResult.error).toMatch(
                /Service not found|updateProperty|createRelatedTask/,
              );
            }
            return;
          }

          // Predictor-predictable: dispatch must succeed and mutation must match.
          expect(execResult.success).toBe(true);
          const after = fs.readFileSync(fixture.path, "utf8");
          assertMutationMatchesRaw(predicted, after);
        } finally {
          cleanupFixtureRoot(root);
        }
      });
    });
  }
});
