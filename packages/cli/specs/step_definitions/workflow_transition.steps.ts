/**
 * RFC 36347daf Phase 3 — BDD scenarios exercising `applyCommand().parseAsync(...)`
 * end-to-end against an isolated temp vault hydrated with a Workflow ABox
 * (Workflow + WorkflowTransition + Task target + ems__EffortStatus stubs).
 *
 * The high-coverage integration tests for the same wiring live in
 * `packages/cli/tests/integration/apply-workflow-transition.integration.test.ts`.
 * The BDD layer protects the test-bdd CI gate against silent regressions in
 * vault triple-store hydration, WorkflowResolver DI, and GroundingLoader DI.
 */
import { Given, When, Then, After } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliBddWorld } from "../support/world.js";

// `applyCommand` is loaded lazily inside the step handler so this module stays
// CommonJS-compatible — tsx compiles step definitions to CJS, which forbids
// top-level await. `applyCommand()` returns a fresh commander program per call,
// so caching the symbol is safe across scenarios.
type ApplyCommandFactory = typeof import("../../src/commands/apply.js")["applyCommand"];
let cachedApplyCommand: ApplyCommandFactory | null = null;
async function getApplyCommand(): Promise<ApplyCommandFactory> {
  if (cachedApplyCommand) return cachedApplyCommand;
  const mod = await import("../../src/commands/apply.js");
  cachedApplyCommand = mod.applyCommand;
  return cachedApplyCommand;
}

// ─── Stable fixture UIDs (shared scenarios) ─────────────────────────────────
const COMMAND_FWD_UID = "ccccdddd-0001-0000-0000-000000000001";
const COMMAND_ROLLBACK_UID = "ccccdddd-0001-0000-0000-000000000002";
const COMMAND_FWD_FROM_DONE_UID = "ccccdddd-0001-0000-0000-000000000003";

const GROUNDING_FWD_UID = "ccccdddd-0002-0000-0000-000000000001";
const GROUNDING_ROLLBACK_UID = "ccccdddd-0002-0000-0000-000000000002";
const GROUNDING_FWD_FROM_DONE_UID = "ccccdddd-0002-0000-0000-000000000003";

const WORKFLOW_UID = "ccccdddd-0003-0000-0000-000000000001";
const TRANSITION_FWD_UID = "ccccdddd-0003-0000-0000-000000000002";
const TRANSITION_ROLLBACK_UID = "ccccdddd-0003-0000-0000-000000000003";
const POST_ACTION_UID = "ccccdddd-0003-0000-0000-000000000004";

const TASK_BACKLOG_UID = "ccccdddd-0004-0000-0000-000000000001";
const TASK_DONE_UID = "ccccdddd-0004-0000-0000-000000000002";

const CLASS_TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const CLASS_WORKFLOW_UID = "ccccdddd-0005-0000-0000-000000000001";
const CLASS_WORKFLOW_TRANSITION_UID = "8eef26d7-4692-4b84-8835-8a0277828b8c";

const STATUS_BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const STATUS_DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const STATUS_DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";

const TYPE_WORKFLOW_TRANSITION_UID = "5c1a2552-d576-496d-8823-563573dd1e2f";
const TYPE_PROPERTY_SET_UID = "cf3bb923-f1f1-40be-b728-782844402426";

const SEED = "99999999-7777-8888-6666-555555555555";
const FROZEN_CLOCK = "2026-02-01T12:00:00Z";

// ─── Asset templates ────────────────────────────────────────────────────────

function classTBox(uid: string, label: string): string {
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

function task(uid: string, label: string, statusUid: string, statusLabel: string): string {
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

function command(uid: string, label: string, groundingUid: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Command]]"`,
    `exocmd__Command_grounding: "[[${groundingUid}|grounding]]"`,
    "---",
    "",
  ].join("\n");
}

function workflowTransitionGrounding(uid: string, label: string, direction: "forward" | "rollback"): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_WORKFLOW_TRANSITION_UID}]]"`,
    `exocmd__Grounding_direction: ${direction}`,
    "---",
    "",
  ].join("\n");
}

function workflowAsset(): string {
  return [
    "---",
    `exo__Asset_uid: ${WORKFLOW_UID}`,
    `exo__Asset_label: "BDD default task workflow"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_WORKFLOW_UID}]]"`,
    `ems__Workflow_targetClass: "[[${CLASS_TASK_UID}|ems__Task]]"`,
    `ems__Workflow_isDefault: true`,
    "---",
    "",
  ].join("\n");
}

function transitionAsset(uid: string, label: string, fromUid: string, fromLabel: string, toUid: string, toLabel: string, isRollback: boolean, postActions: string[] = []): string {
  const lines = [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_WORKFLOW_TRANSITION_UID}]]"`,
    `ems__WorkflowTransition_workflow: "[[${WORKFLOW_UID}]]"`,
    `ems__WorkflowTransition_from: "[[${fromUid}|${fromLabel}]]"`,
    `ems__WorkflowTransition_to: "[[${toUid}|${toLabel}]]"`,
    `ems__WorkflowTransition_label: "${label}"`,
    `ems__WorkflowTransition_isRollback: ${isRollback}`,
  ];
  if (postActions.length > 0) {
    lines.push(`ems__WorkflowTransition_postActions:`);
    for (const pa of postActions) {
      lines.push(`  - "[[${pa}]]"`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function postActionGrounding(): string {
  return [
    "---",
    `exo__Asset_uid: ${POST_ACTION_UID}`,
    `exo__Asset_label: "bdd post-action sentinel"`,
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

// ─── Vault builder ──────────────────────────────────────────────────────────

function buildWfVault(): string {
  const root = mkdtempSync(join(tmpdir(), "exo-bdd-wf-"));

  // Class TBox + status TBox.
  writeFileSync(join(root, `${CLASS_TASK_UID}.md`), classTBox(CLASS_TASK_UID, "ems__Task"));
  writeFileSync(join(root, `${CLASS_WORKFLOW_UID}.md`), classTBox(CLASS_WORKFLOW_UID, "ems__Workflow"));
  writeFileSync(join(root, `${CLASS_WORKFLOW_TRANSITION_UID}.md`), classTBox(CLASS_WORKFLOW_TRANSITION_UID, "ems__WorkflowTransition"));
  writeFileSync(join(root, `${STATUS_BACKLOG_UID}.md`), classTBox(STATUS_BACKLOG_UID, "ems__EffortStatusBacklog"));
  writeFileSync(join(root, `${STATUS_DOING_UID}.md`), classTBox(STATUS_DOING_UID, "ems__EffortStatusDoing"));
  writeFileSync(join(root, `${STATUS_DONE_UID}.md`), classTBox(STATUS_DONE_UID, "ems__EffortStatusDone"));

  // Workflow ABox.
  writeFileSync(join(root, `${WORKFLOW_UID}.md`), workflowAsset());
  writeFileSync(
    join(root, `${TRANSITION_FWD_UID}.md`),
    transitionAsset(TRANSITION_FWD_UID, "Backlog → Doing", STATUS_BACKLOG_UID, "ems__EffortStatusBacklog", STATUS_DOING_UID, "ems__EffortStatusDoing", false, [POST_ACTION_UID]),
  );
  writeFileSync(
    join(root, `${TRANSITION_ROLLBACK_UID}.md`),
    transitionAsset(TRANSITION_ROLLBACK_UID, "Done → Doing (rollback)", STATUS_DONE_UID, "ems__EffortStatusDone", STATUS_DOING_UID, "ems__EffortStatusDoing", true),
  );

  // postAction Grounding.
  writeFileSync(join(root, `${POST_ACTION_UID}.md`), postActionGrounding());

  // Commands + groundings.
  writeFileSync(join(root, `${COMMAND_FWD_UID}.md`), command(COMMAND_FWD_UID, "Forward transition", GROUNDING_FWD_UID));
  writeFileSync(join(root, `${COMMAND_ROLLBACK_UID}.md`), command(COMMAND_ROLLBACK_UID, "Rollback transition", GROUNDING_ROLLBACK_UID));
  writeFileSync(join(root, `${COMMAND_FWD_FROM_DONE_UID}.md`), command(COMMAND_FWD_FROM_DONE_UID, "Forward from Done", GROUNDING_FWD_FROM_DONE_UID));
  writeFileSync(join(root, `${GROUNDING_FWD_UID}.md`), workflowTransitionGrounding(GROUNDING_FWD_UID, "forward grounding", "forward"));
  writeFileSync(join(root, `${GROUNDING_ROLLBACK_UID}.md`), workflowTransitionGrounding(GROUNDING_ROLLBACK_UID, "rollback grounding", "rollback"));
  writeFileSync(join(root, `${GROUNDING_FWD_FROM_DONE_UID}.md`), workflowTransitionGrounding(GROUNDING_FWD_FROM_DONE_UID, "forward from Done", "forward"));

  // Targets.
  writeFileSync(join(root, `${TASK_BACKLOG_UID}.md`), task(TASK_BACKLOG_UID, "Backlog task", STATUS_BACKLOG_UID, "ems__EffortStatusBacklog"));
  writeFileSync(join(root, `${TASK_DONE_UID}.md`), task(TASK_DONE_UID, "Done task", STATUS_DONE_UID, "ems__EffortStatusDone"));

  return root;
}

async function runApplyInVault(vaultRoot: string, commandUid: string, targetRel: string, errBuffer: string[]): Promise<void> {
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  // Intercept process.exit so a non-zero CLI exit (terminal-status case) does
  // not abort the cucumber runner. The buffer captures any error messages
  // emitted along the failure path.
  (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    throw new Error(`__process_exit_${code ?? 0}__`);
  }) as never;
  console.log = () => {};
  console.error = (msg?: unknown) => {
    if (typeof msg === "string") errBuffer.push(msg);
  };
  try {
    const applyCommand = await getApplyCommand();
    await applyCommand().parseAsync([
      "node",
      "apply",
      commandUid,
      targetRel,
      "--vault",
      vaultRoot,
      "--seed",
      SEED,
      "--frozen-clock",
      FROZEN_CLOCK,
    ]);
  } catch (err) {
    if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }
}

// ─── Step definitions ───────────────────────────────────────────────────────

Given("the CLI apply workflow_transition fixture vault", function (this: CliBddWorld) {
  this.wfVaultPath = buildWfVault();
  this.wfErrors = [];
});

When(
  "I run apply with the forward workflow_transition command on the Backlog task",
  async function (this: CliBddWorld) {
    assert.ok(this.wfVaultPath, "wf vault not initialized");
    await runApplyInVault(this.wfVaultPath!, COMMAND_FWD_UID, `${TASK_BACKLOG_UID}.md`, this.wfErrors);
  },
);

When(
  "I run apply with the rollback workflow_transition command on the Done task",
  async function (this: CliBddWorld) {
    assert.ok(this.wfVaultPath, "wf vault not initialized");
    await runApplyInVault(this.wfVaultPath!, COMMAND_ROLLBACK_UID, `${TASK_DONE_UID}.md`, this.wfErrors);
  },
);

When(
  "I run apply with the forward-from-done workflow_transition command on the Done task",
  async function (this: CliBddWorld) {
    assert.ok(this.wfVaultPath, "wf vault not initialized");
    await runApplyInVault(this.wfVaultPath!, COMMAND_FWD_FROM_DONE_UID, `${TASK_DONE_UID}.md`, this.wfErrors);
  },
);

Then(
  "the target task status becomes {string}",
  function (this: CliBddWorld, expectedStatusLabel: string) {
    assert.ok(this.wfVaultPath, "wf vault missing");
    // Pick whichever target was used in this scenario by looking at the
    // command emitted; both task files exist but only one gets mutated, so
    // we accept either file showing the expected status.
    const candidates = [
      join(this.wfVaultPath!, `${TASK_BACKLOG_UID}.md`),
      join(this.wfVaultPath!, `${TASK_DONE_UID}.md`),
    ];
    const expectedUid =
      expectedStatusLabel === "ems__EffortStatusDoing"
        ? STATUS_DOING_UID
        : expectedStatusLabel === "ems__EffortStatusDone"
          ? STATUS_DONE_UID
          : null;
    assert.ok(expectedUid, `unknown expected status label: ${expectedStatusLabel}`);
    const found = candidates.some((p) => {
      const c = readFileSync(p, "utf-8");
      return c.includes(`ems__Effort_status: "[[${expectedUid}]]"`) ||
        c.includes(`ems__Effort_status: "[[${expectedUid}|`);
    });
    assert.ok(
      found,
      `Expected ems__Effort_status with UID ${expectedUid} (${expectedStatusLabel}) on at least one BDD target task`,
    );
  },
);

Then("the postAction sentinel marker is present", function (this: CliBddWorld) {
  assert.ok(this.wfVaultPath, "wf vault missing");
  const content = readFileSync(join(this.wfVaultPath!, `${TASK_BACKLOG_UID}.md`), "utf-8");
  assert.ok(
    content.includes("ems__Effort_postActionMarker: ran"),
    `Expected postAction marker. Task content:\n${content}`,
  );
});

Then(
  "the CLI reports the missing forward transition for {string}",
  function (this: CliBddWorld, statusEnum: string) {
    const combined = this.wfErrors.join("\n");
    const pattern = new RegExp(`no forward transition from "${statusEnum}"`);
    assert.ok(
      pattern.test(combined),
      `Expected fail-loud "no forward transition from ${statusEnum}" in errors. Got:\n${combined}`,
    );
  },
);

Then(
  "the target task status remains {string}",
  function (this: CliBddWorld, statusEnum: string) {
    assert.ok(this.wfVaultPath, "wf vault missing");
    const statusUid =
      statusEnum === "ems__EffortStatusDone"
        ? STATUS_DONE_UID
        : statusEnum === "ems__EffortStatusBacklog"
          ? STATUS_BACKLOG_UID
          : null;
    assert.ok(statusUid, `unknown status enum: ${statusEnum}`);
    // The target for the fail-loud scenario is the Done task.
    const content = readFileSync(join(this.wfVaultPath!, `${TASK_DONE_UID}.md`), "utf-8");
    assert.ok(
      content.includes(`ems__Effort_status: "[[${statusUid}`),
      `Expected ems__Effort_status to still reference ${statusEnum} (${statusUid}); got:\n${content}`,
    );
  },
);

After(function (this: CliBddWorld) {
  if (this.wfVaultPath && existsSync(this.wfVaultPath)) {
    try {
      rmSync(this.wfVaultPath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
    this.wfVaultPath = null;
  }
});
