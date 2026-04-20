/**
 * Phase 0 wall-time benchmark — 5 pilot commands × 3 scenarios.
 *
 * Measures per-scenario wall-time for the jest-suite amortized path (matches
 * RFC v3 §7.1 shape that Phase 1 will adopt — buildTripleStore once, then
 * loadCommand + PreconditionEvaluator + GroundingExecutor per scenario).
 *
 * Subprocess worst-case measurement is done separately via
 * scripts/phase0-benchmark-subprocess.sh (adds Node+module-load cost that
 * Phase 1 will NOT pay).
 *
 * Outputs timing JSON to /tmp/phase0-benchmark-jest.json for the workflow to
 * parse and surface in the step summary.
 *
 * Task dd3bdaaa — RFC v3 §8 Phase 0 Gate 0c.
 */
import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  CommandResolver,
  PreconditionEvaluator,
  GroundingExecutor,
  ServiceRegistry,
  InMemoryTripleStore,
  NoteToRDFConverter,
  GenericAssetCreationService,
  ArchiveAssetService,
  TaskStatusService,
  EffortStatusWorkflow,
  StatusTimestampService,
  PropertyCleanupService,
  FixMissingLabelService,
  RenameToUidService,
  FolderRepairService,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import { NodeFsAdapter } from "../../../src/adapters/NodeFsAdapter.js";
import { populateCliServiceRegistry } from "../../../src/services/CliServiceRegistryPopulator.js";

interface ScenarioTiming {
  commandUid: string;
  commandLabel: string;
  scenario: "met" | "unmet" | "edge";
  wallTimeMs: number;
  preconditionPassed: boolean;
  executed: boolean;
  outcome: "success" | "precondition_failed" | "error" | "skipped";
  errorMessage?: string;
}

interface BenchmarkReport {
  suite: "jest-amortized";
  buildTripleStoreMs: number;
  scenarios: ScenarioTiming[];
  totalWallTimeMs: number;
  avgPerScenarioMs: number;
  extrapolation: {
    totalCommands: number;
    scenariosPerCommand: number;
    totalScenarios: number;
    projectedSuiteWallTimeMs: number;
    gateThresholdMs: number;
    gateVerdict: "PASS" | "FAIL";
  };
  timestamp: string;
  node: string;
  platform: string;
}

const PILOT_COMMANDS: Array<{
  uid: string;
  label: string;
  hasPrecondition: boolean;
}> = [
  {
    uid: "e941b3bb-d375-40d2-b271-e1d71deb014c",
    label: "Set Status Doing",
    hasPrecondition: true,
  },
  {
    uid: "a3966e53-b819-42c9-aab2-ebd5512cf566",
    label: "Convert to Task",
    hasPrecondition: true,
  },
  {
    uid: "2adf3655-0ab9-4578-ad2e-223108729db8",
    label: "Create Child Task",
    hasPrecondition: false,
  },
  {
    uid: "6bc86da6-4e58-4441-bc9b-20d2097451df",
    label: "Set Planned Start",
    hasPrecondition: false,
  },
  {
    uid: "923520d1-1892-4a6c-88ea-9552250a7cbe",
    label: "Set Status Done",
    hasPrecondition: true,
  },
];

const GATE_THRESHOLD_MS = 180_000; // 3 min test-unit increment
const AUTHORITATIVE_COMMAND_COUNT = 44; // RFC v3 §4.0
const SCENARIOS_PER_COMMAND = 3;

const STARTER_KIT_PATH =
  process.env.PHASE0_STARTER_KIT_PATH ??
  path.resolve(
    process.cwd(),
    "..",
    "..",
    "..",
    "exocortex-starter-kit",
  );

function hasStarterKit(): boolean {
  return (
    fs.existsSync(STARTER_KIT_PATH) &&
    fs.existsSync(path.join(STARTER_KIT_PATH, "exocmd"))
  );
}

const describeOrSkip = hasStarterKit() ? describe : describe.skip;

describeOrSkip("Phase 0 wall-time benchmark (jest-amortized)", () => {
  let vaultPath: string;
  let tripleStore: InMemoryTripleStore;
  let buildTripleStoreMs = 0;
  const timings: ScenarioTiming[] = [];

  beforeAll(async () => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "phase0-benchmark-"));

    // Copy the starter-kit tree (exocmd/, ems/, exo/, assets/, ims/, invariants/,
    // pn/, 01 Inbox/) verbatim — matches what a submodule would give Phase 1.
    for (const entry of fs.readdirSync(STARTER_KIT_PATH, {
      withFileTypes: true,
    })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const src = path.join(STARTER_KIT_PATH, entry.name);
      const dst = path.join(vaultPath, entry.name);
      if (entry.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true });
      } else {
        fs.copyFileSync(src, dst);
      }
    }

    // Scenario fixtures — 15 host asset files (5 cmds × 3 scenarios).
    const assetsDir = path.join(vaultPath, "phase0-benchmark-assets");
    fs.mkdirSync(assetsDir, { recursive: true });

    for (const cmd of PILOT_COMMANDS) {
      writeScenarioAsset(assetsDir, cmd.uid, "met");
      writeScenarioAsset(assetsDir, cmd.uid, "unmet");
      writeScenarioAsset(assetsDir, cmd.uid, "edge");
    }

    // Build the triple store once — this is the "amortized" part.
    const buildStart = performance.now();
    const adapter = new FileSystemVaultAdapter(vaultPath);
    const converter = new NoteToRDFConverter(adapter);
    const triples = await converter.convertVault();
    tripleStore = new InMemoryTripleStore();
    await tripleStore.addAll(triples);
    buildTripleStoreMs = performance.now() - buildStart;

    // eslint-disable-next-line no-console
    console.log(
      `[phase0-benchmark] buildTripleStore: ${buildTripleStoreMs.toFixed(0)} ms (vault ${vaultPath})`,
    );
  }, 120_000);

  afterAll(() => {
    const totalWallTimeMs = timings.reduce((s, t) => s + t.wallTimeMs, 0);
    const avgPerScenarioMs = timings.length ? totalWallTimeMs / timings.length : 0;
    const projectedSuiteWallTimeMs =
      buildTripleStoreMs +
      avgPerScenarioMs * AUTHORITATIVE_COMMAND_COUNT * SCENARIOS_PER_COMMAND;
    const report: BenchmarkReport = {
      suite: "jest-amortized",
      buildTripleStoreMs,
      scenarios: timings,
      totalWallTimeMs,
      avgPerScenarioMs,
      extrapolation: {
        totalCommands: AUTHORITATIVE_COMMAND_COUNT,
        scenariosPerCommand: SCENARIOS_PER_COMMAND,
        totalScenarios: AUTHORITATIVE_COMMAND_COUNT * SCENARIOS_PER_COMMAND,
        projectedSuiteWallTimeMs,
        gateThresholdMs: GATE_THRESHOLD_MS,
        gateVerdict:
          projectedSuiteWallTimeMs <= GATE_THRESHOLD_MS ? "PASS" : "FAIL",
      },
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    };

    const outPath =
      process.env.PHASE0_BENCHMARK_OUT ?? "/tmp/phase0-benchmark-jest.json";
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[phase0-benchmark] report → ${outPath}`);
    // eslint-disable-next-line no-console
    console.log(
      `[phase0-benchmark] avg/scenario: ${avgPerScenarioMs.toFixed(1)} ms — projected Phase 1 suite (${AUTHORITATIVE_COMMAND_COUNT}×${SCENARIOS_PER_COMMAND}): ${projectedSuiteWallTimeMs.toFixed(0)} ms — gate ${projectedSuiteWallTimeMs <= GATE_THRESHOLD_MS ? "PASS" : "FAIL"} (≤ ${GATE_THRESHOLD_MS} ms)`,
    );

    // Vault cleanup (best-effort).
    try {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // Parametrized tests — each scenario runs sequentially so timings
  // reflect real one-after-another cost (matches Phase 1 suite shape).
  for (const cmd of PILOT_COMMANDS) {
    describe(`${cmd.label} (${cmd.uid.slice(0, 8)})`, () => {
      for (const scenario of ["met", "unmet", "edge"] as const) {
        it(`scenario:${scenario}`, async () => {
          const resolver = new CommandResolver(tripleStore);
          const evaluator = new PreconditionEvaluator(tripleStore);
          const adapter = new FileSystemVaultAdapter(vaultPath);
          const nodeFs = new NodeFsAdapter(vaultPath);
          const serviceRegistry = new ServiceRegistry();
          populateCliServiceRegistry(serviceRegistry, {
            vaultAdapter: adapter,
            genericAssetCreationService: new GenericAssetCreationService(adapter),
            archiveAssetService: new ArchiveAssetService(adapter),
            taskStatusService: new TaskStatusService(
              adapter,
              new EffortStatusWorkflow(),
              new StatusTimestampService(adapter),
            ),
            propertyCleanupService: new PropertyCleanupService(adapter),
            fixMissingLabelService: new FixMissingLabelService(adapter),
            renameToUidService: new RenameToUidService(adapter),
            folderRepairService: new FolderRepairService(adapter),
          });
          const executor = new GroundingExecutor(nodeFs, nodeFs, serviceRegistry);

          const assetPath = `phase0-benchmark-assets/${cmd.uid}.${scenario}.md`;
          const absAssetPath = path.join(vaultPath, assetPath);
          // Use the same IRI format NoteToRDFConverter produces so precondition
          // SPARQL can bind $target (CLI has bug #2883 that normalizes to path —
          // we bypass that here to measure the real grounding path).
          const targetIRI = `obsidian://vault/${encodeURI(assetPath)}`;

          const timing: ScenarioTiming = {
            commandUid: cmd.uid,
            commandLabel: cmd.label,
            scenario,
            wallTimeMs: 0,
            preconditionPassed: false,
            executed: false,
            outcome: "skipped",
          };

          const scenarioStart = performance.now();
          try {
            if (scenario === "edge" && !fs.existsSync(absAssetPath)) {
              // edge = non-existent target → measure precondition-only fast-exit
              // (CommandResolver still loads the command, but we skip execution).
              const command = await resolver.loadCommand(cmd.uid);
              if (!command) {
                timing.outcome = "error";
                timing.errorMessage = "command not loaded";
                return;
              }
              timing.outcome = "error";
              timing.errorMessage = "target missing (edge path)";
              return;
            }

            const command = await resolver.loadCommand(cmd.uid);
            if (!command) {
              timing.outcome = "error";
              timing.errorMessage = `command ${cmd.uid} not resolved`;
              return;
            }

            let preconditionPassed = true;
            if (command.precondition) {
              preconditionPassed = await evaluator.evaluate(
                command.precondition,
                targetIRI,
              );
            }
            timing.preconditionPassed = preconditionPassed;

            if (!preconditionPassed) {
              timing.outcome = "precondition_failed";
              return;
            }

            if (scenario === "edge") {
              // Host exists but edge scenario writes broken frontmatter — run
              // the executor and record whatever failure surfaces.
              const result = await executor.execute(
                command.grounding,
                targetIRI,
                absAssetPath,
                undefined,
              );
              timing.executed = true;
              timing.outcome = result.success ? "success" : "error";
              if (!result.success) {
                timing.errorMessage = result.error ?? "unknown executor error";
              }
              return;
            }

            const result = await executor.execute(
              command.grounding,
              targetIRI,
              absAssetPath,
              buildUserInputFor(cmd.uid),
            );
            timing.executed = true;
            timing.outcome = result.success ? "success" : "error";
            if (!result.success) {
              timing.errorMessage = result.error ?? "unknown executor error";
            }
          } catch (err) {
            timing.outcome = "error";
            timing.errorMessage =
              err instanceof Error ? err.message : String(err);
          } finally {
            timing.wallTimeMs = performance.now() - scenarioStart;
            timings.push(timing);
          }

          // Benchmark test — always pass; we only care about timing.
          expect(timing.wallTimeMs).toBeGreaterThanOrEqual(0);
        }, 30_000);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Scenario asset builder — generates fixtures matching the precondition outcome.
// ---------------------------------------------------------------------------

function writeScenarioAsset(
  assetsDir: string,
  cmdUid: string,
  scenario: "met" | "unmet" | "edge",
): void {
  const filename = `${cmdUid}.${scenario}.md`;
  const fullPath = path.join(assetsDir, filename);
  if (scenario === "edge") {
    // Malformed frontmatter (missing closing ---) — triggers executor error path.
    fs.writeFileSync(fullPath, "---\nexo__Asset_uid: edge\nexo__Instance_class:\n  - \"[[ems__Task]]\"\n\n(missing closing ---, broken YAML)\n");
    return;
  }
  const frontmatter = buildFrontmatterForScenario(cmdUid, scenario);
  fs.writeFileSync(fullPath, frontmatter);
}

function buildFrontmatterForScenario(
  cmdUid: string,
  scenario: "met" | "unmet",
): string {
  const uidPart = cmdUid.slice(0, 8);
  const assetUid = `${uidPart}-fixture-${scenario}-0000-000000000000`;
  const now = "2026-04-20T12:00:00+0500";

  switch (cmdUid) {
    case "e941b3bb-d375-40d2-b271-e1d71deb014c": {
      // Set Status Doing: met = status NOT Doing, unmet = status Doing
      const status =
        scenario === "met"
          ? "[[ems__EffortStatusBacklog]]"
          : "[[ems__EffortStatusDoing]]";
      return taskFrontmatter(assetUid, now, status);
    }
    case "a3966e53-b819-42c9-aab2-ebd5512cf566": {
      // Convert to Task: met = instance_class is Project (not Task),
      // unmet = instance_class is already Task
      const cls = scenario === "met" ? "ems__Project" : "ems__Task";
      return projectOrTaskFrontmatter(assetUid, now, cls);
    }
    case "2adf3655-0ab9-4578-ad2e-223108729db8": {
      // Create Child Task: no precondition. met = Project parent (happy path),
      // unmet analog = Task (no precondition blocks it, but service_call may
      // emit default behavior). We emit the same Project shape for both and
      // document this divergence in the report.
      return projectOrTaskFrontmatter(assetUid, now, "ems__Project");
    }
    case "6bc86da6-4e58-4441-bc9b-20d2097451df": {
      // Set Planned Start: no precondition. met/unmet both use an effort-like
      // asset; the grounding writes ems__Effort_plannedStartTimestamp.
      return taskFrontmatter(assetUid, now, "[[ems__EffortStatusBacklog]]");
    }
    case "923520d1-1892-4a6c-88ea-9552250a7cbe": {
      // Set Status Done: met = status NOT Done, unmet = status Done
      const status =
        scenario === "met"
          ? "[[ems__EffortStatusDoing]]"
          : "[[ems__EffortStatusDone]]";
      return taskFrontmatter(assetUid, now, status);
    }
    default:
      throw new Error(`Unknown pilot command ${cmdUid}`);
  }
}

function taskFrontmatter(uid: string, timestamp: string, status: string): string {
  return `---
exo__Asset_uid: ${uid}
exo__Asset_label: "Phase 0 benchmark fixture ${uid}"
exo__Asset_createdAt: "${timestamp}"
exo__Asset_updatedAt: "${timestamp}"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "${status}"
ems__Effort_parent: "[[${uid}-parent]]"
aliases:
  - "Phase 0 benchmark fixture"
---
`;
}

function projectOrTaskFrontmatter(
  uid: string,
  timestamp: string,
  cls: string,
): string {
  return `---
exo__Asset_uid: ${uid}
exo__Asset_label: "Phase 0 benchmark fixture ${uid}"
exo__Asset_createdAt: "${timestamp}"
exo__Asset_updatedAt: "${timestamp}"
exo__Instance_class:
  - "[[${cls}]]"
aliases:
  - "Phase 0 benchmark fixture"
---
`;
}

function buildUserInputFor(
  cmdUid: string,
): Record<string, unknown> | undefined {
  switch (cmdUid) {
    case "2adf3655-0ab9-4578-ad2e-223108729db8":
      return { label: "Phase 0 benchmark child", value: "Phase 0 benchmark child" };
    case "6bc86da6-4e58-4441-bc9b-20d2097451df":
      return { value: "2026-04-20" };
    default:
      return undefined;
  }
}
