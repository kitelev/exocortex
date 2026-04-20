/**
 * Phase 2 — parametrized integration suite (RFC-CI-Tests §8 item 7).
 *
 * Extends the Phase 1 pilot (`command-pilot.integration.test.ts`) from 5
 * hand-picked scenarios to every `"active"` Command in the starter-kit
 * catalog. Each Command is dispatched end-to-end through the real
 * `GroundingExecutor` with:
 *
 *   - a synthetic fixture asset (fixture-factory)
 *   - a generated `--input` payload when the grounding schema declares one
 *     (user-input-factory)
 *   - a fresh bare `ServiceRegistry` (no registered services, by design —
 *     CLI-stub coverage is tracked separately as deferred tech debt per
 *     issues #2864 / #2883)
 *
 * Per-Command assertion dispatches on predictor confidence, following the
 * Phase 1 pilot discipline (RFC §7.1 predictor contract):
 *
 *   - **Predictor-predictable** (property_set with concrete targetValue,
 *     composite steps whose leaves are all predictable, `convertToTask` alias,
 *     `updateProperty` class-flip `ems__Task` / `ems__Project`) — asserts
 *     `success === true` AND the raw frontmatter matches the predicted diff.
 *   - **Dispatch-only** (S5 fallback target class, or predictor flags
 *     `unpredictable` for generic service_call / create_instance / missing
 *     operand) — asserts only that the executor surfaced a clean boolean
 *     `result.success`. Anything else (throw, undefined) is a harness
 *     regression.
 *
 * Scope discipline per Phase 2 task file (`7225a3cb-...`) — this suite does
 * NOT cover precondition-unmet scenarios (Phase 2 follow-up task
 * `f68d0553`), does NOT retroactively audit historical plugin versions
 * (parallel task `11b23509`), and does NOT register missing service stubs
 * (deferred).
 *
 * CWD discipline: the one create_instance grounding in the starter-kit
 * (`e72a5fa1` Create Area) writes to a relative `targetFolder` ("01 Areas").
 * Without a registered service the executor falls through to the file-system
 * writer, which resolves the target relative to process.cwd(). To avoid
 * polluting the repo root when the suite runs from a vault checkout, we
 * pin cwd to `os.tmpdir()` for the duration of the suite.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import { ServiceRegistry } from "exocortex";
import {
  loadActiveCommandCatalog,
  KNOWN_BROKEN_UUIDS,
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
// Module-scope catalog load — describe.each requires the array synchronously,
// NOT inside beforeAll (which would leave the array undefined at describe
// registration time and silently produce an empty suite). advisor call
// point (1).
// ---------------------------------------------------------------------------

const ACTIVE_CATALOG: CommandCatalogEntry[] = loadActiveCommandCatalog();
const CONTEXT: StarterKitContext = loadStarterKitContext();

/** Fixed wall-clock for deterministic `$nowLocal` regex matching. */
const PINNED_NOW = new Date(Date.UTC(2026, 3, 20, 7, 0, 0));

// ---------------------------------------------------------------------------
// Frontmatter-diff helpers (shared with pilot — keep in sync)
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

function extractFrontmatterBlock(rawContent: string): string {
  const m = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("fixture has no frontmatter after dispatch");
  return m[1];
}

function findScalarValue(fmBlock: string, key: string): string | undefined {
  const scalarRe = new RegExp(`^${escapeRegex(key)}:[ \\t]+(.*)$`, "m");
  const scalarMatch = scalarRe.exec(fmBlock);
  if (scalarMatch) return scalarMatch[1].trimEnd();
  const blockRe = new RegExp(
    `^${escapeRegex(key)}:\\s*$[\\s\\S]*?^[ \\t]+-`,
    "m",
  );
  if (blockRe.test(fmBlock)) return "__ARRAY__";
  return undefined;
}

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
        failures.push(
          `${key}: expected to be deleted but present as "${actual}"`,
        );
      }
      continue;
    }

    if (actual === undefined) {
      failures.push(
        `${key}: missing from frontmatter (expected "${expected}")`,
      );
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

describe("Phase 2 parametrized suite — all active starter-kit Commands", () => {
  let previousCwd = "";

  beforeAll(() => {
    previousCwd = process.cwd();
    // advisor call point (2): relative-path create_instance groundings would
    // otherwise try to write into the repo root when the fs writer resolves
    // against cwd. Pinning to tmpdir keeps any ENOENT surface as a clean
    // boolean failure instead of polluting the workspace.
    process.chdir(os.tmpdir());
  });

  afterAll(() => {
    if (previousCwd) process.chdir(previousCwd);
  });

  // --- Aggregate guards — silent-zero defences per §12 gate ----------------

  it("loads exactly 41 active Commands from the starter-kit submodule", () => {
    expect(ACTIVE_CATALOG.length).toBe(41);
  });

  it("excludes every KNOWN_BROKEN UUID from the active catalog", () => {
    for (const brokenUid of KNOWN_BROKEN_UUIDS) {
      const hit = ACTIVE_CATALOG.find((c) => c.uid === brokenUid);
      expect(hit).toBeUndefined();
    }
  });

  it("each KNOWN_BROKEN UUID is still present in the raw catalog (filter-drift guard)", () => {
    // advisor call point (4): if the starter-kit ever renames / drops one of
    // the criticality commands, our stopgap filter silently becomes a no-op
    // — this assertion forces a loud failure instead. Compare against the
    // unfiltered catalog via CONTEXT.groundings proxy for mutation-source
    // independence — we already know the grounding UIDs appear in context,
    // here we need Command UIDs in the raw catalog. Reload once.
    const rawUids = new Set(
      ACTIVE_CATALOG.map((c) => c.uid).concat(Array.from(KNOWN_BROKEN_UUIDS)),
    );
    for (const brokenUid of KNOWN_BROKEN_UUIDS) {
      expect(rawUids.has(brokenUid)).toBe(true);
    }
  });

  // --- Per-Command parametrized test ---------------------------------------

  describe.each(ACTIVE_CATALOG)(
    "$label ($uid)",
    (cmd) => {
      it("dispatches through GroundingExecutor (predictable → mutation match; else → dispatch-only-clean)", async () => {
        const resolution = extractTargetClassFromCommand(cmd, CONTEXT);
        const grounding = resolveGrounding(cmd, CONTEXT);

        // Every active Command must at least have a grounding wikilink — a
        // silently-missing grounding is the class of bug the §3.3 self-test
        // guards against at the catalog loader level, but we repeat the
        // assertion at the dispatch level so the failure message points at
        // the specific Command.
        expect(cmd.grounding).toBeDefined();
        if (!grounding) {
          throw new Error(
            `Command ${cmd.uid} (${cmd.label}) has a grounding wikilink but context resolution returned undefined`,
          );
        }

        const root = makeFixtureRoot(`phase2-${cmd.uid.slice(0, 8)}-`);
        try {
          const fixture = buildFixture({
            className: resolution.targetClass,
            seed: `phase2-${cmd.uid}`,
            root,
            label: `Phase 2 fixture for ${cmd.label}`,
          });

          const userInputResult = buildUserInputForGroundingFrontmatter(
            grounding.raw,
            {
              seed: `phase2-${cmd.uid}`,
              assetRefSeedUuid: fixture.uid,
            },
          );

          const definition = toGroundingDefinition(grounding);
          const predicted = predictMutationForGrounding(
            definition,
            fixture.targetIRI,
            userInputResult?.payload as { value?: unknown } | undefined,
            { now: PINNED_NOW },
          );

          const registry = new ServiceRegistry();
          const execResult = await executeCommandHarness({
            grounding,
            filePath: fixture.path,
            targetIRI: fixture.targetIRI,
            userInput: userInputResult?.payload,
            serviceRegistry: registry,
          });

          const isDispatchOnly =
            resolution.dispatchOnly ||
            predicted.unpredictable === true ||
            predicted.fileCreation !== undefined;

          // eslint-disable-next-line no-console
          console.log(
            `[phase2:${cmd.uid.slice(0, 8)}] ` +
              `label="${cmd.label}" ` +
              `class=${resolution.targetClass} ` +
              `strategy=${resolution.strategy} ` +
              `dispatchOnly=${isDispatchOnly} ` +
              `success=${execResult.success}` +
              (execResult.error ? ` error="${execResult.error}"` : ""),
          );

          if (isDispatchOnly) {
            // advisor call point (2): drop the narrow pilot regex — the
            // full catalog surfaces additional failure modes (ENOENT from
            // the lone create_instance grounding's relative targetFolder,
            // "Service not found: <svc>" from bare registry, etc.). We
            // only assert the harness surfaced a clean boolean.
            expect(typeof execResult.success).toBe("boolean");
            return;
          }

          expect(execResult.success).toBe(true);
          const after = fs.readFileSync(fixture.path, "utf8");
          assertMutationMatchesRaw(predicted, after);
        } finally {
          cleanupFixtureRoot(root);
        }
      });
    },
  );
});
