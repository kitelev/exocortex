/**
 * RFC 36347daf Phase 3 — CLI `apply` integration tests for the
 * `workflow_transition` grounding type.
 *
 * Phase 2 shipped the executor implementation
 * (`GroundingExecutor.executeWorkflowTransition`) + plugin wiring only. Phase 3
 * wires the same dependencies (`WorkflowResolver` + `GroundingLoader`) into the
 * CLI `apply` command so a CLI invocation against a real vault can resolve the
 * active Workflow ABox and dispatch postActions.
 *
 * Verification strategy: run the actual `applyCommand().parseAsync(...)` entry
 * point against a temp vault — mirrors `apply-class-resolver.integration.test.ts`
 * (Issue #3258). Without the Phase 3 DI wiring this test fails with the
 * fail-loud message `"workflow_transition requires WorkflowResolver injection"`
 * from `GroundingExecutor.ts:1740`.
 *
 * Scenarios:
 *   1. Forward Backlog → Doing — status mutated, postAction executed.
 *   2. Rollback Done → Doing — direction respected, status moved backward.
 *   3. Terminal-status error — no forward transition exists, executor returns
 *      `{success:false}` with explanatory message.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");

// ─── Stable fixture UIDs ────────────────────────────────────────────────────
const COMMAND_UID = "ddddeeee-0001-0000-0000-000000000001";
const GROUNDING_FWD_UID = "ddddeeee-0001-0000-0000-000000000002";
const GROUNDING_ROLLBACK_UID = "ddddeeee-0001-0000-0000-000000000003";
const COMMAND_TERMINAL_UID = "ddddeeee-0001-0000-0000-000000000004";
const GROUNDING_FWD_FROM_DONE_UID = "ddddeeee-0001-0000-0000-000000000005";
const COMMAND_ROLLBACK_UID = "ddddeeee-0001-0000-0000-000000000006";

const WORKFLOW_UID = "ddddeeee-0002-0000-0000-000000000001";
const TRANSITION_FWD_BACKLOG_DOING_UID = "ddddeeee-0002-0000-0000-000000000002";
const TRANSITION_ROLLBACK_DONE_DOING_UID = "ddddeeee-0002-0000-0000-000000000003";
const POST_ACTION_UID = "ddddeeee-0002-0000-0000-000000000004";

const TASK_UID = "ddddeeee-0003-0000-0000-000000000001";
const TASK_DONE_UID = "ddddeeee-0003-0000-0000-000000000002";
const TASK_TERMINAL_UID = "ddddeeee-0003-0000-0000-000000000003";

// ─── Canonical class + status UIDs (production constants) ──────────────────
const CLASS_TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const CLASS_WORKFLOW_UID = "f4bf6c5a-d39c-4f72-9d2f-1c1b1fa2cd95"; // ems__Workflow (any UUID — only label matters for converter)
const CLASS_WORKFLOW_TRANSITION_UID = "8eef26d7-4692-4b84-8835-8a0277828b8c"; // ems__WorkflowTransition (actual vault UID)
const STATUS_BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const STATUS_DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const STATUS_DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";

// ─── Grounding type UIDs — must match `GROUNDING_TYPE_UIDS` reverse map.
const TYPE_WORKFLOW_TRANSITION_UID = "5c1a2552-d576-496d-8823-563573dd1e2f";
const TYPE_PROPERTY_SET_UID = "cf3bb923-f1f1-40be-b728-782844402426";
const PROP_END_TS_UID = "ddddeeee-0004-0000-0000-000000000001"; // any UID — only label matters

const SEED = "99999999-7777-8888-6666-444444444444";
const FROZEN_CLOCK = "2026-02-01T12:00:00Z";

// ─── Asset content templates ────────────────────────────────────────────────

function buildClassTBox(uid: string, label: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exo__Class]]"`,
    "---",
    "",
  ].join("\n");
}

function buildGroundingTypeTBox(uid: string, label: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__GroundingType]]"`,
    "---",
    "",
  ].join("\n");
}

function buildPropertyTBox(uid: string, label: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exo__DatatypeProperty]]"`,
    "---",
    "",
  ].join("\n");
}

function buildWorkflowAsset(): string {
  return [
    "---",
    `exo__Asset_uid: ${WORKFLOW_UID}`,
    `exo__Asset_label: "Task default workflow"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_WORKFLOW_UID}]]"`,
    `ems__Workflow_targetClass: "[[${CLASS_TASK_UID}|ems__Task]]"`,
    `ems__Workflow_isDefault: true`,
    "---",
    "",
  ].join("\n");
}

function buildForwardTransitionAsset(): string {
  return [
    "---",
    `exo__Asset_uid: ${TRANSITION_FWD_BACKLOG_DOING_UID}`,
    `exo__Asset_label: "Backlog → Doing"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_WORKFLOW_TRANSITION_UID}]]"`,
    `ems__WorkflowTransition_workflow: "[[${WORKFLOW_UID}]]"`,
    `ems__WorkflowTransition_from: "[[${STATUS_BACKLOG_UID}|ems__EffortStatusBacklog]]"`,
    `ems__WorkflowTransition_to: "[[${STATUS_DOING_UID}|ems__EffortStatusDoing]]"`,
    `ems__WorkflowTransition_label: "Start work"`,
    `ems__WorkflowTransition_isRollback: false`,
    `ems__WorkflowTransition_postActions:`,
    `  - "[[${POST_ACTION_UID}]]"`,
    "---",
    "",
  ].join("\n");
}

function buildRollbackTransitionAsset(): string {
  return [
    "---",
    `exo__Asset_uid: ${TRANSITION_ROLLBACK_DONE_DOING_UID}`,
    `exo__Asset_label: "Done → Doing (rollback)"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_WORKFLOW_TRANSITION_UID}]]"`,
    `ems__WorkflowTransition_workflow: "[[${WORKFLOW_UID}]]"`,
    `ems__WorkflowTransition_from: "[[${STATUS_DONE_UID}|ems__EffortStatusDone]]"`,
    `ems__WorkflowTransition_to: "[[${STATUS_DOING_UID}|ems__EffortStatusDoing]]"`,
    `ems__WorkflowTransition_label: "Reopen"`,
    `ems__WorkflowTransition_isRollback: true`,
    "---",
    "",
  ].join("\n");
}

function buildPostActionGrounding(): string {
  // A simple property_set grounding that writes a sentinel marker so we can
  // assert the postAction actually ran. We use property_set with a literal
  // value (avoids inheriting more wiring complexity than needed).
  return [
    "---",
    `exo__Asset_uid: ${POST_ACTION_UID}`,
    `exo__Asset_label: "post-action sentinel"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_PROPERTY_SET_UID}]]"`,
    `exocmd__Grounding_targetProperty: "ems__Effort_postActionMarker"`,
    `exocmd__Grounding_targetValueLiteral: "ran"`,
    "---",
    "",
  ].join("\n");
}

function buildForwardCommand(): string {
  return [
    "---",
    `exo__Asset_uid: ${COMMAND_UID}`,
    `exo__Asset_label: "Forward transition"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Command]]"`,
    `exocmd__Command_grounding: "[[${GROUNDING_FWD_UID}|forward grounding]]"`,
    `exocmd__Command_successMessage: "Workflow advanced"`,
    "---",
    "",
  ].join("\n");
}

function buildRollbackCommand(): string {
  return [
    "---",
    `exo__Asset_uid: ${COMMAND_ROLLBACK_UID}`,
    `exo__Asset_label: "Rollback transition"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Command]]"`,
    `exocmd__Command_grounding: "[[${GROUNDING_ROLLBACK_UID}|rollback grounding]]"`,
    "---",
    "",
  ].join("\n");
}

function buildTerminalCommand(): string {
  return [
    "---",
    `exo__Asset_uid: ${COMMAND_TERMINAL_UID}`,
    `exo__Asset_label: "Forward transition from terminal"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Command]]"`,
    `exocmd__Command_grounding: "[[${GROUNDING_FWD_FROM_DONE_UID}|forward grounding from done]]"`,
    "---",
    "",
  ].join("\n");
}

function buildForwardGrounding(): string {
  return [
    "---",
    `exo__Asset_uid: ${GROUNDING_FWD_UID}`,
    `exo__Asset_label: "forward grounding"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_WORKFLOW_TRANSITION_UID}]]"`,
    `exocmd__Grounding_direction: forward`,
    "---",
    "",
  ].join("\n");
}

function buildRollbackGrounding(): string {
  return [
    "---",
    `exo__Asset_uid: ${GROUNDING_ROLLBACK_UID}`,
    `exo__Asset_label: "rollback grounding"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_WORKFLOW_TRANSITION_UID}]]"`,
    `exocmd__Grounding_direction: rollback`,
    "---",
    "",
  ].join("\n");
}

function buildForwardFromDoneGrounding(): string {
  // direction=forward — but vault has no forward transition out of Done so
  // the executor reports "no forward transition from Done".
  return [
    "---",
    `exo__Asset_uid: ${GROUNDING_FWD_FROM_DONE_UID}`,
    `exo__Asset_label: "forward grounding from done"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_WORKFLOW_TRANSITION_UID}]]"`,
    `exocmd__Grounding_direction: forward`,
    "---",
    "",
  ].join("\n");
}

function buildTaskAsset(uid: string, label: string, statusUid: string, statusLabel: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_TASK_UID}|ems__Task]]"`,
    `ems__Effort_status: "[[${statusUid}|${statusLabel}]]"`,
    "---",
    "",
  ].join("\n");
}

// ─── Status TBox files needed for property_set to resolve the destination
//     status wikilink correctly. Each one is a stub matching real UIDs.
function buildStatusTBox(uid: string, label: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exo__Class]]"`,
    "---",
    "",
  ].join("\n");
}

// ─── Vault layout ───────────────────────────────────────────────────────────

interface VaultLayout {
  root: string;
}

function buildVault(): VaultLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-apply-wftrans-"));

  // Class TBox
  fs.writeFileSync(path.join(root, `${CLASS_TASK_UID}.md`), buildClassTBox(CLASS_TASK_UID, "ems__Task"));
  fs.writeFileSync(path.join(root, `${CLASS_WORKFLOW_UID}.md`), buildClassTBox(CLASS_WORKFLOW_UID, "ems__Workflow"));
  fs.writeFileSync(path.join(root, `${CLASS_WORKFLOW_TRANSITION_UID}.md`), buildClassTBox(CLASS_WORKFLOW_TRANSITION_UID, "ems__WorkflowTransition"));

  // Status TBox stubs
  fs.writeFileSync(path.join(root, `${STATUS_BACKLOG_UID}.md`), buildStatusTBox(STATUS_BACKLOG_UID, "ems__EffortStatusBacklog"));
  fs.writeFileSync(path.join(root, `${STATUS_DOING_UID}.md`), buildStatusTBox(STATUS_DOING_UID, "ems__EffortStatusDoing"));
  fs.writeFileSync(path.join(root, `${STATUS_DONE_UID}.md`), buildStatusTBox(STATUS_DONE_UID, "ems__EffortStatusDone"));

  // GroundingType + property TBox
  fs.writeFileSync(
    path.join(root, `${TYPE_WORKFLOW_TRANSITION_UID}.md`),
    buildGroundingTypeTBox(TYPE_WORKFLOW_TRANSITION_UID, "workflow_transition"),
  );
  fs.writeFileSync(
    path.join(root, `${TYPE_PROPERTY_SET_UID}.md`),
    buildGroundingTypeTBox(TYPE_PROPERTY_SET_UID, "property_set"),
  );
  fs.writeFileSync(path.join(root, `${PROP_END_TS_UID}.md`), buildPropertyTBox(PROP_END_TS_UID, "ems__Effort_postActionMarker"));

  // Workflow ABox
  fs.writeFileSync(path.join(root, `${WORKFLOW_UID}.md`), buildWorkflowAsset());
  fs.writeFileSync(path.join(root, `${TRANSITION_FWD_BACKLOG_DOING_UID}.md`), buildForwardTransitionAsset());
  fs.writeFileSync(path.join(root, `${TRANSITION_ROLLBACK_DONE_DOING_UID}.md`), buildRollbackTransitionAsset());
  fs.writeFileSync(path.join(root, `${POST_ACTION_UID}.md`), buildPostActionGrounding());

  // Commands + groundings
  fs.writeFileSync(path.join(root, `${COMMAND_UID}.md`), buildForwardCommand());
  fs.writeFileSync(path.join(root, `${COMMAND_ROLLBACK_UID}.md`), buildRollbackCommand());
  fs.writeFileSync(path.join(root, `${COMMAND_TERMINAL_UID}.md`), buildTerminalCommand());
  fs.writeFileSync(path.join(root, `${GROUNDING_FWD_UID}.md`), buildForwardGrounding());
  fs.writeFileSync(path.join(root, `${GROUNDING_ROLLBACK_UID}.md`), buildRollbackGrounding());
  fs.writeFileSync(path.join(root, `${GROUNDING_FWD_FROM_DONE_UID}.md`), buildForwardFromDoneGrounding());

  // Targets
  fs.writeFileSync(path.join(root, `${TASK_UID}.md`), buildTaskAsset(TASK_UID, "BDD target task", STATUS_BACKLOG_UID, "ems__EffortStatusBacklog"));
  fs.writeFileSync(path.join(root, `${TASK_DONE_UID}.md`), buildTaskAsset(TASK_DONE_UID, "Done target task", STATUS_DONE_UID, "ems__EffortStatusDone"));
  fs.writeFileSync(path.join(root, `${TASK_TERMINAL_UID}.md`), buildTaskAsset(TASK_TERMINAL_UID, "Terminal target task", STATUS_DONE_UID, "ems__EffortStatusDone"));

  return { root };
}

// ─── Test runner ────────────────────────────────────────────────────────────

describe("RFC 36347daf Phase 3: CLI apply workflow_transition", () => {
  let vault: VaultLayout;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleErrorBuffer: string[];

  beforeEach(() => {
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorBuffer = [];
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      if (typeof msg === "string") consoleErrorBuffer.push(msg);
    });
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (vault) fs.rmSync(vault.root, { recursive: true, force: true });
  });

  async function runApply(vaultRoot: string, commandUid: string, taskRelPath: string): Promise<void> {
    const cmd = applyCommand();
    const args = [
      "node",
      "apply",
      commandUid,
      taskRelPath,
      "--vault",
      vaultRoot,
      "--seed",
      SEED,
      "--frozen-clock",
      FROZEN_CLOCK,
    ];
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  it("forward Backlog → Doing — status mutated, postAction marker written", async () => {
    vault = buildVault();

    await runApply(vault.root, COMMAND_UID, `${TASK_UID}.md`);

    const content = fs.readFileSync(path.join(vault.root, `${TASK_UID}.md`), "utf-8");

    // Status mutated to Doing (UID-form).
    expect(content).toContain(`ems__Effort_status: "[[${STATUS_DOING_UID}]]"`);
    expect(content).not.toContain(`ems__Effort_status: "[[${STATUS_BACKLOG_UID}`);
    // postAction sentinel applied — proves GroundingLoader DI works.
    expect(content).toContain(`ems__Effort_postActionMarker: ran`);
  });

  it("rollback Done → Doing — direction respected, status moved backward", async () => {
    vault = buildVault();

    await runApply(vault.root, COMMAND_ROLLBACK_UID, `${TASK_DONE_UID}.md`);

    const content = fs.readFileSync(path.join(vault.root, `${TASK_DONE_UID}.md`), "utf-8");

    expect(content).toContain(`ems__Effort_status: "[[${STATUS_DOING_UID}]]"`);
    expect(content).not.toContain(`ems__Effort_status: "[[${STATUS_DONE_UID}`);
  });

  it("forward from Done — no forward transition exists → fail-loud", async () => {
    vault = buildVault();

    await runApply(vault.root, COMMAND_TERMINAL_UID, `${TASK_TERMINAL_UID}.md`);

    // Task untouched (still Done).
    const content = fs.readFileSync(path.join(vault.root, `${TASK_TERMINAL_UID}.md`), "utf-8");
    expect(content).toContain(`ems__Effort_status: "[[${STATUS_DONE_UID}`);

    // Executor reported the no-transition error path.
    const combinedErr = consoleErrorBuffer.join("\n");
    expect(combinedErr).toMatch(/no forward transition from "ems__EffortStatusDone"/);
  });
});
