/**
 * RFC § Phase 4 (T4.3) — `dyncommand show` ≡ `dyncommand exec` precondition
 * parity, end-to-end across all valid grounding types.
 *
 * T4.1 (PR #3033) pinned the intra-process invariant against a hand-built
 * `InMemoryTripleStore` with a single `property_set` grounding. T4.2
 * (PR #3035) shipped the duplicate-UID detector that surfaces H1 in
 * `dyncommand validate`. This test (T4.3) closes Phase 4 by raising the
 * coverage to the **full vault → triple-store → CommandResolver →
 * PreconditionEvaluator** pipeline, on real on-disk fixtures, for every
 * grounding type the RFC § Контекст marks ✅ working in CLI:
 *
 *   - `property_set`     (#2996 fix in v15.145.1)
 *   - `composite`        (sequential children)
 *   - `create_instance`  (verified C.1.5 «Lunch → Create Instance» 2026-05-02)
 *
 * Each grounding type spins up an isolated tmp vault containing a Command
 * + Precondition + Grounding (+ child groundings for composite) + a
 * candidate target asset. The test then mirrors the exact prologue both
 * `dyncommand show` (dynamic-command.ts:185) and `dyncommand exec`
 * (dynamic-command.ts:287) execute — `buildTripleStore(vaultPath) →
 * new CommandResolver(store).loadCommand(uid)` — twice, simulating two
 * adjacent CLI invocations on the unchanged vault, and asserts:
 *
 *   1. The full `CommandDefinition` is byte-identical between the two
 *      load passes (JSON-deep-equal).
 *   2. The `precondition.sparqlAsk` string that `show` would print is the
 *      exact same string `exec` would feed `PreconditionEvaluator.evaluate`.
 *   3. `PreconditionEvaluator.evaluate(precondition, targetIRI)` returns
 *      the same boolean across the two passes.
 *
 * **Fail-loud:** all three assertions throw with a JSON diff payload
 * (not a generic `expect()` mismatch) so that any future regression
 * surfaces the divergent fields directly in the CI log without requiring
 * the engineer to re-run with --verbose. A negative-control test
 * (`detects synthetic divergence`) deliberately corrupts the second
 * snapshot and asserts the harness throws — proving the assertion is
 * not a tautology.
 *
 * Scope:
 *   - In-process. Subprocess CLI tests in this package are
 *     `describe.skip`'d under CI (see `convert.integration.test.ts:24`)
 *     because they depend on a built `dist/index.js`. Running this test
 *     in-process means it goes green in CI as required by Phase 4 AC.
 *   - Real on-disk vault. Going through `NoteToRDFConverter` is
 *     intentionally broader than T4.1's hand-built triples — it pins the
 *     parity at the layer where #2996 ($target IRI canonicalization) and
 *     #2864 (service_call stubs) actually live.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  NoteToRDFConverter,
  InMemoryTripleStore,
  CommandResolver,
  PreconditionEvaluator,
  vaultPathToIRI,
  type CommandDefinition,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

// ---------------------------------------------------------------------------
// Test prologue — mirror of dynamic-command.ts:717 `buildTripleStore` + the
// `show`/`exec` prefix at lines 185-187 / 287-289. Inlined here because the
// CLI helper is not exported.
// ---------------------------------------------------------------------------

async function buildStoreFromVault(
  vaultPath: string,
): Promise<InMemoryTripleStore> {
  const adapter = new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(adapter);
  const triples = await converter.convertVault();
  const store = new InMemoryTripleStore();
  await store.addAll(triples);
  return store;
}

async function loadCommandLikeCli(
  vaultPath: string,
  uid: string,
): Promise<CommandDefinition | null> {
  const store = await buildStoreFromVault(vaultPath);
  const resolver = new CommandResolver(store);
  return resolver.loadCommand(uid);
}

interface ShowExecSnapshot {
  command: CommandDefinition;
  preconditionPassed: boolean;
}

async function snapshotShowOrExec(
  vaultPath: string,
  uid: string,
  targetRelPath: string,
): Promise<ShowExecSnapshot> {
  const store = await buildStoreFromVault(vaultPath);
  const resolver = new CommandResolver(store);
  const command = await resolver.loadCommand(uid);
  if (!command) {
    throw new Error(
      `Test setup error: command ${uid} not loadable from ${vaultPath}`,
    );
  }
  const targetIRI = vaultPathToIRI(targetRelPath);
  const evaluator = new PreconditionEvaluator(store);
  const preconditionPassed = await evaluator.evaluate(
    command.precondition,
    targetIRI,
  );
  return { command, preconditionPassed };
}

/**
 * Fail-loud divergence assertion. Throws an Error whose message embeds the
 * JSON diff so CI logs surface the regression without needing --verbose.
 */
function assertSnapshotsAgree(
  showSnap: ShowExecSnapshot,
  execSnap: ShowExecSnapshot,
  context: string,
): void {
  const showJson = JSON.stringify(showSnap.command);
  const execJson = JSON.stringify(execSnap.command);
  if (showJson !== execJson) {
    throw new Error(
      `[T4.3 fail-loud] ${context}: dyncommand show ≢ exec on CommandDefinition.\n` +
        `  show: ${showJson}\n` +
        `  exec: ${execJson}`,
    );
  }
  if (showSnap.preconditionPassed !== execSnap.preconditionPassed) {
    throw new Error(
      `[T4.3 fail-loud] ${context}: PreconditionEvaluator divergence.\n` +
        `  show.preconditionPassed=${showSnap.preconditionPassed}\n` +
        `  exec.preconditionPassed=${execSnap.preconditionPassed}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Vault fixture builders. Each grounding type writes a self-contained vault
// — Command + Precondition + Grounding(+children) + target asset.
// ---------------------------------------------------------------------------

interface VaultFixture {
  vaultPath: string;
  commandUid: string;
  targetRelPath: string;
  expectedPreconditionPassed: boolean;
}

/**
 * `NoteToRDFConverter.validateExocortexAsset` (NoteToRDFConverter.ts:660)
 * requires `exo__Asset_uid`, `exo__Asset_isDefinedBy`, `exo__Asset_label`,
 * and `exo__Instance_class` on any frontmatter that looks like an asset.
 * Each fixture asset gets `isDefinedBy` injected automatically here.
 */
const FIXTURE_ONTOLOGY_REF = '"[[t43-fixture-ontology]]"';

function writeAsset(
  vaultPath: string,
  relPath: string,
  frontmatter: string,
): void {
  const full = path.join(vaultPath, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const trimmed = frontmatter.trim();
  const withIsDefinedBy = trimmed.includes("exo__Asset_isDefinedBy")
    ? trimmed
    : `exo__Asset_isDefinedBy: ${FIXTURE_ONTOLOGY_REF}\n${trimmed}`;
  fs.writeFileSync(full, `---\n${withIsDefinedBy}\n---\n`);
}

const CMD_UID_PROPERTY_SET = "aaaa1111-3333-4111-8111-111111111111";
const PRE_UID_PROPERTY_SET = "aaaa1111-3333-4111-8111-222222222222";
const GRD_UID_PROPERTY_SET = "aaaa1111-3333-4111-8111-333333333333";

function buildPropertySetVault(root: string): VaultFixture {
  const vaultPath = path.join(root, "property-set");
  fs.mkdirSync(vaultPath, { recursive: true });

  // Command — `Mark task done`. Precondition: target has no end timestamp.
  writeAsset(
    vaultPath,
    `commands/${CMD_UID_PROPERTY_SET}.md`,
    `
exo__Asset_uid: ${CMD_UID_PROPERTY_SET}
exo__Asset_label: "Mark task done"
exo__Instance_class:
  - "[[exocmd__Command]]"
exocmd__Command_precondition: "[[${PRE_UID_PROPERTY_SET}]]"
exocmd__Command_grounding: "[[${GRD_UID_PROPERTY_SET}]]"
`,
  );
  writeAsset(
    vaultPath,
    `preconditions/${PRE_UID_PROPERTY_SET}.md`,
    `
exo__Asset_uid: ${PRE_UID_PROPERTY_SET}
exo__Asset_label: "Has no end timestamp"
exo__Instance_class:
  - "[[exocmd__Precondition]]"
exocmd__Precondition_sparqlAsk: "PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { FILTER NOT EXISTS { $target ems:Effort_endTimestamp ?ts } }"
`,
  );
  writeAsset(
    vaultPath,
    `groundings/${GRD_UID_PROPERTY_SET}.md`,
    `
exo__Asset_uid: ${GRD_UID_PROPERTY_SET}
exo__Asset_label: "Set end timestamp"
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exocmd__Grounding_type: "property_set"
exocmd__Grounding_targetProperty: "ems__Effort_endTimestamp"
exocmd__Grounding_targetValue: "$now"
`,
  );

  // Target — a Task without endTimestamp → precondition passes.
  const targetUid = "11111111-2222-4111-8111-aaaaaaaaaaaa";
  const targetRelPath = `tasks/${targetUid}.md`;
  writeAsset(
    vaultPath,
    targetRelPath,
    `
exo__Asset_uid: ${targetUid}
exo__Asset_label: "Open task"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_startTimestamp: "2026-05-02T10:00:00+0500"
`,
  );

  return {
    vaultPath,
    commandUid: CMD_UID_PROPERTY_SET,
    targetRelPath,
    expectedPreconditionPassed: true,
  };
}

const CMD_UID_COMPOSITE = "bbbb1111-3333-4111-8111-111111111111";
const PRE_UID_COMPOSITE = "bbbb1111-3333-4111-8111-222222222222";
const GRD_UID_COMPOSITE_ROOT = "bbbb1111-3333-4111-8111-333333333333";
const GRD_UID_COMPOSITE_STEP1 = "bbbb1111-3333-4111-8111-444444444444";
const GRD_UID_COMPOSITE_STEP2 = "bbbb1111-3333-4111-8111-555555555555";

function buildCompositeVault(root: string): VaultFixture {
  const vaultPath = path.join(root, "composite");
  fs.mkdirSync(vaultPath, { recursive: true });

  writeAsset(
    vaultPath,
    `commands/${CMD_UID_COMPOSITE}.md`,
    `
exo__Asset_uid: ${CMD_UID_COMPOSITE}
exo__Asset_label: "Reset task to backlog"
exo__Instance_class:
  - "[[exocmd__Command]]"
exocmd__Command_precondition: "[[${PRE_UID_COMPOSITE}]]"
exocmd__Command_grounding: "[[${GRD_UID_COMPOSITE_ROOT}]]"
`,
  );
  writeAsset(
    vaultPath,
    `preconditions/${PRE_UID_COMPOSITE}.md`,
    `
exo__Asset_uid: ${PRE_UID_COMPOSITE}
exo__Asset_label: "Target is a Task"
exo__Instance_class:
  - "[[exocmd__Precondition]]"
exocmd__Precondition_sparqlAsk: "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { $target rdf:type ems:Task }"
`,
  );
  // Composite root — references two ordered child groundings.
  writeAsset(
    vaultPath,
    `groundings/${GRD_UID_COMPOSITE_ROOT}.md`,
    `
exo__Asset_uid: ${GRD_UID_COMPOSITE_ROOT}
exo__Asset_label: "Backlog reset (composite)"
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exocmd__Grounding_type: "composite"
exocmd__Grounding_steps:
  - "[[${GRD_UID_COMPOSITE_STEP1}]]"
  - "[[${GRD_UID_COMPOSITE_STEP2}]]"
`,
  );
  writeAsset(
    vaultPath,
    `groundings/${GRD_UID_COMPOSITE_STEP1}.md`,
    `
exo__Asset_uid: ${GRD_UID_COMPOSITE_STEP1}
exo__Asset_label: "Clear startTimestamp"
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exocmd__Grounding_type: "property_delete"
exocmd__Grounding_targetProperty: "ems__Effort_startTimestamp"
`,
  );
  writeAsset(
    vaultPath,
    `groundings/${GRD_UID_COMPOSITE_STEP2}.md`,
    `
exo__Asset_uid: ${GRD_UID_COMPOSITE_STEP2}
exo__Asset_label: "Set status Backlog"
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exocmd__Grounding_type: "property_set"
exocmd__Grounding_targetProperty: "ems__Effort_status"
exocmd__Grounding_targetValue: "[[ems__EffortStatusBacklog]]"
`,
  );

  const targetUid = "22222222-2222-4111-8111-aaaaaaaaaaaa";
  const targetRelPath = `tasks/${targetUid}.md`;
  writeAsset(
    vaultPath,
    targetRelPath,
    `
exo__Asset_uid: ${targetUid}
exo__Asset_label: "Doing task"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_startTimestamp: "2026-05-02T10:00:00+0500"
`,
  );

  return {
    vaultPath,
    commandUid: CMD_UID_COMPOSITE,
    targetRelPath,
    expectedPreconditionPassed: true,
  };
}

const CMD_UID_CREATE_INSTANCE = "cccc1111-3333-4111-8111-111111111111";
const PRE_UID_CREATE_INSTANCE = "cccc1111-3333-4111-8111-222222222222";
const GRD_UID_CREATE_INSTANCE = "cccc1111-3333-4111-8111-333333333333";

function buildCreateInstanceVault(root: string): VaultFixture {
  const vaultPath = path.join(root, "create-instance");
  fs.mkdirSync(vaultPath, { recursive: true });

  // Mirror the C.1.5 «Lunch → Create Instance» flow — Command bound to a
  // prototype, grounding spawns a new instance.
  writeAsset(
    vaultPath,
    `commands/${CMD_UID_CREATE_INSTANCE}.md`,
    `
exo__Asset_uid: ${CMD_UID_CREATE_INSTANCE}
exo__Asset_label: "Create instance"
exo__Instance_class:
  - "[[exocmd__Command]]"
exocmd__Command_precondition: "[[${PRE_UID_CREATE_INSTANCE}]]"
exocmd__Command_grounding: "[[${GRD_UID_CREATE_INSTANCE}]]"
`,
  );
  writeAsset(
    vaultPath,
    `preconditions/${PRE_UID_CREATE_INSTANCE}.md`,
    `
exo__Asset_uid: ${PRE_UID_CREATE_INSTANCE}
exo__Asset_label: "Target has a label"
exo__Instance_class:
  - "[[exocmd__Precondition]]"
exocmd__Precondition_sparqlAsk: "PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target exo:Asset_label ?label }"
`,
  );
  writeAsset(
    vaultPath,
    `groundings/${GRD_UID_CREATE_INSTANCE}.md`,
    `
exo__Asset_uid: ${GRD_UID_CREATE_INSTANCE}
exo__Asset_label: "Spawn instance from prototype"
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exocmd__Grounding_type: "create_instance"
exocmd__Grounding_targetClass: "[[ems__Task]]"
`,
  );

  const targetUid = "33333333-2222-4111-8111-aaaaaaaaaaaa";
  const targetRelPath = `prototypes/${targetUid}.md`;
  writeAsset(
    vaultPath,
    targetRelPath,
    `
exo__Asset_uid: ${targetUid}
exo__Asset_label: "Lunch prototype"
exo__Instance_class:
  - "[[ems__Task]]"
`,
  );

  return {
    vaultPath,
    commandUid: CMD_UID_CREATE_INSTANCE,
    targetRelPath,
    expectedPreconditionPassed: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RFC § Phase 4 (T4.3) — show ≡ exec across all valid grounding types", () => {
  let tmpRoot: string;
  let propertySet: VaultFixture;
  let composite: VaultFixture;
  let createInstance: VaultFixture;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t43-show-exec-"));
    propertySet = buildPropertySetVault(tmpRoot);
    composite = buildCompositeVault(tmpRoot);
    createInstance = buildCreateInstanceVault(tmpRoot);
  });

  afterAll(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe("property_set grounding", () => {
    it("show and exec snapshots agree on CommandDefinition + precondition outcome", async () => {
      const showSnap = await snapshotShowOrExec(
        propertySet.vaultPath,
        propertySet.commandUid,
        propertySet.targetRelPath,
      );
      const execSnap = await snapshotShowOrExec(
        propertySet.vaultPath,
        propertySet.commandUid,
        propertySet.targetRelPath,
      );

      // Sanity — the precondition is loaded and matches what `show` would print.
      expect(showSnap.command.precondition?.id).toBe(PRE_UID_PROPERTY_SET);
      expect(showSnap.command.precondition?.sparqlAsk).toMatch(
        /Effort_endTimestamp/,
      );
      expect(showSnap.command.grounding.type).toBe("property_set");
      expect(showSnap.preconditionPassed).toBe(
        propertySet.expectedPreconditionPassed,
      );

      // Fail-loud parity gate.
      assertSnapshotsAgree(showSnap, execSnap, "property_set");
    });
  });

  describe("composite grounding", () => {
    it("show and exec snapshots agree on CommandDefinition + precondition outcome", async () => {
      const showSnap = await snapshotShowOrExec(
        composite.vaultPath,
        composite.commandUid,
        composite.targetRelPath,
      );
      const execSnap = await snapshotShowOrExec(
        composite.vaultPath,
        composite.commandUid,
        composite.targetRelPath,
      );

      expect(showSnap.command.grounding.type).toBe("composite");
      // Composite root references two ordered children. The exact count
      // surfaced by `loadCommand` may include a dual-storage duplicate
      // (Issue #2102) — what matters for show ≡ exec parity is determinism,
      // not the cardinality, so we just pin "≥ 2 deterministic steps".
      expect(showSnap.command.grounding.steps?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(showSnap.command.precondition?.sparqlAsk).toMatch(/ems:Task/);
      expect(showSnap.preconditionPassed).toBe(
        composite.expectedPreconditionPassed,
      );

      assertSnapshotsAgree(showSnap, execSnap, "composite");
    });
  });

  describe("create_instance grounding", () => {
    it("show and exec snapshots agree on CommandDefinition + precondition outcome", async () => {
      const showSnap = await snapshotShowOrExec(
        createInstance.vaultPath,
        createInstance.commandUid,
        createInstance.targetRelPath,
      );
      const execSnap = await snapshotShowOrExec(
        createInstance.vaultPath,
        createInstance.commandUid,
        createInstance.targetRelPath,
      );

      expect(showSnap.command.grounding.type).toBe("create_instance");
      expect(showSnap.preconditionPassed).toBe(
        createInstance.expectedPreconditionPassed,
      );

      assertSnapshotsAgree(showSnap, execSnap, "create_instance");
    });
  });

  describe("fail-loud sentinel", () => {
    /**
     * Negative control: prove the assertion is not a tautology by feeding
     * `assertSnapshotsAgree` a synthetically-corrupted second snapshot and
     * checking that it throws with the expected diff payload.
     */
    it("throws with JSON diff when CommandDefinitions diverge", async () => {
      const baseline = await snapshotShowOrExec(
        propertySet.vaultPath,
        propertySet.commandUid,
        propertySet.targetRelPath,
      );
      const corrupted: ShowExecSnapshot = {
        ...baseline,
        command: {
          ...baseline.command,
          precondition: baseline.command.precondition && {
            ...baseline.command.precondition,
            sparqlAsk: "ASK { $target a <urn:divergent> }",
          },
        },
      };

      expect(() =>
        assertSnapshotsAgree(baseline, corrupted, "synthetic"),
      ).toThrow(/T4.3 fail-loud.*synthetic.*show ≢ exec/s);
    });

    it("throws when PreconditionEvaluator outcomes diverge", async () => {
      const baseline = await snapshotShowOrExec(
        propertySet.vaultPath,
        propertySet.commandUid,
        propertySet.targetRelPath,
      );
      const flipped: ShowExecSnapshot = {
        command: baseline.command,
        preconditionPassed: !baseline.preconditionPassed,
      };

      expect(() =>
        assertSnapshotsAgree(baseline, flipped, "synthetic"),
      ).toThrow(/T4.3 fail-loud.*synthetic.*PreconditionEvaluator divergence/s);
    });
  });
});
