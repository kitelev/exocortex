/**
 * Unit tests for the `workflow_transition` grounding type — RFC 36347daf
 * Phase 2. Verifies runtime resolution of:
 *
 *  1. Target asset class (from `exo__Instance_class` frontmatter, UID or
 *     symbolic form).
 *  2. Current status (from `ems__Effort_status` wikilink).
 *  3. WorkflowResolver lookup (mocked) → matching transition by from + isRollback.
 *  4. Status mutation via the existing property_set pipeline (UID-canon
 *     wikilink to the destination status TBox file).
 *  5. Sequential execution of `WorkflowTransition_postActions` via injected
 *     GroundingLoader (one postAction per atomic Phase 1 grounding).
 *
 * Failure modes:
 *  - workflowResolver missing
 *  - asset class unparseable
 *  - current status unparseable
 *  - no matching transition for (from, direction)
 *  - postAction grounding fails to load
 *  - postAction execution returns success:false
 */

import {
  GroundingExecutor,
  ServiceRegistry,
  type WorkflowResolverPort,
  type GroundingLoaderPort,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";
import type {
  GroundingDefinition,
} from "../../../src/domain/models/CommandDefinition";
import type {
  WorkflowDefinition,
  WorkflowTransitionDefinition,
} from "../../../src/domain/models/WorkflowDefinition";

const TARGET_IRI = "obsidian://vault/03%20Knowledge/inbox/abc.md";
const FILE_PATH = "/vault/03 Knowledge/inbox/abc.md";

const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

function createMockReader(content: string) {
  return {
    readFile: jest.fn().mockResolvedValue(content),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
}

function createMockWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    updateFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeTaskWorkflow(
  transitions: WorkflowTransitionDefinition[],
): WorkflowDefinition {
  return {
    id: "wf-task",
    name: "Task Default Workflow",
    targetClass: AssetClass.TASK,
    states: [],
    transitions,
    initialState: EffortStatus.DRAFT,
    terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
    isDefault: true,
  };
}

function makeGrounding(direction?: "forward" | "rollback"): GroundingDefinition {
  return {
    id: "gnd-wf-transition",
    label: "Apply workflow transition",
    type: GroundingType.WORKFLOW_TRANSITION,
    direction,
  };
}

function makeExecutor(opts: {
  content: string;
  workflowResolver?: WorkflowResolverPort;
  groundingLoader?: GroundingLoaderPort;
}) {
  const reader = createMockReader(opts.content);
  const writer = createMockWriter();
  const registry = new ServiceRegistry();
  const executor = new GroundingExecutor(reader, writer, registry, undefined, {
    workflowResolver: opts.workflowResolver,
    groundingLoader: opts.groundingLoader,
  });
  return { executor, reader, writer };
}

describe("GroundingExecutor.workflow_transition (RFC 36347daf Phase 2)", () => {
  // ───── Happy paths ─────

  it("forward Doing→Done — writes Done status UID + runs 2 postActions sequentially", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.DOING,
        to: EffortStatus.DONE,
        label: "✓ Done",
        isRollback: false,
        postActions: ["pa-set-end", "pa-set-resolution"],
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };

    const loadedActions: string[] = [];
    const groundingLoader: GroundingLoaderPort = async (uid) => {
      loadedActions.push(uid);
      return {
        id: uid,
        label: `Atomic action ${uid}`,
        type: GroundingType.PROPERTY_SET,
        targetProperty: uid === "pa-set-end"
          ? "ems__Effort_endTimestamp"
          : "ems__Effort_resolutionTimestamp",
        targetValueLiteral: "2026-05-30T22:55:00",
      };
    };

    const { executor, writer } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}|ems__Task]]"\nems__Effort_status: "[[${DOING_UID}]]"\n---\nBody`,
      workflowResolver,
      groundingLoader,
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    // 1 status mutation + 2 postActions = 3 file writes.
    expect(writer.updateFile).toHaveBeenCalledTimes(3);
    const statusWrite = writer.updateFile.mock.calls[0][1] as string;
    expect(statusWrite).toMatch(
      new RegExp(`ems__Effort_status:\\s*"\\[\\[${DONE_UID}\\]\\]"`),
    );
    expect(loadedActions).toEqual(["pa-set-end", "pa-set-resolution"]);
  });

  it("rollback Done→Doing — selects isRollback=true transition + runs delete postActions", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.DOING,
        to: EffortStatus.DONE,
        label: "✓ Done",
        isRollback: false,
        postActions: ["pa-set-end"],
      },
      {
        from: EffortStatus.DONE,
        to: EffortStatus.DOING,
        label: "← Doing",
        isRollback: true,
        postActions: ["pa-del-end", "pa-del-resolution"],
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };
    const groundingLoader: GroundingLoaderPort = async (uid) => ({
      id: uid,
      label: uid,
      type: GroundingType.PROPERTY_DELETE,
      targetProperty: uid === "pa-del-end"
        ? "ems__Effort_endTimestamp"
        : "ems__Effort_resolutionTimestamp",
    });

    const { executor, writer } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[${DONE_UID}]]"\n---\n`,
      workflowResolver,
      groundingLoader,
    });

    const result = await executor.execute(
      makeGrounding("rollback"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    // Status mutation writes Doing UID.
    const statusWrite = writer.updateFile.mock.calls[0][1] as string;
    expect(statusWrite).toMatch(
      new RegExp(`ems__Effort_status:\\s*"\\[\\[${DOING_UID}\\]\\]"`),
    );
  });

  it("direction defaults to 'forward' when undefined", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.BACKLOG,
        to: EffortStatus.DOING,
        label: "▶ Start",
        isRollback: false,
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };

    const { executor, writer } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[${BACKLOG_UID}]]"\n---\n`,
      workflowResolver,
    });

    const result = await executor.execute(
      makeGrounding(), // no direction
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
  });

  it("transition without postActions succeeds with status mutation only (no loader required)", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.DRAFT,
        to: EffortStatus.BACKLOG,
        label: "→ Backlog",
        isRollback: false,
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };

    const { executor, writer } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[c42245d0-01de-4c35-bfcf-d910445ea28e]]"\n---\n`,
      workflowResolver,
      // groundingLoader intentionally omitted
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
  });

  // ───── Failure modes ─────

  it("fails loud when workflowResolver is not injected", async () => {
    const { executor } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[${DOING_UID}]]"\n---\n`,
      // workflowResolver omitted
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/WorkflowResolver injection/i);
  });

  // ───── Crash fix: non-built-in effort classes degrade gracefully ─────
  // @req:7489624f-c17f-47dd-8108-3571a5809f61 — a generic status-transition
  // button rendered on an effort-status-bearing asset whose class is NOT one of
  // Task/Project/Meeting (UID-canon `"[[<uid>]]"`, no alias) must NOT crash with
  // "no recognised ems__* class". When the class has no applicable workflow the
  // dispatch is a graceful no-op (notApplicable), and when the class DOES have a
  // workflow (per-asset override / per-class ABox) the transition works.

  it("@req:7489624f-c17f-47dd-8108-3571a5809f61 graceful no-op (notApplicable) when class has no applicable workflow — no crash", async () => {
    // resolveForAssetOrNull returns null → the class (e.g. ems__Action, ems__Idea,
    // exo__Asset) has no status workflow. Must NOT surface the old fail-loud
    // "no recognised ems__* class" error.
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest.fn().mockResolvedValue(null),
    };
    const { executor } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[some-random-uid]]"\nems__Effort_status: "[[${DOING_UID}]]"\n---\n`,
      workflowResolver,
    });

    const result = await executor.execute(
      makeGrounding("rollback"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.notApplicable).toBe(true);
    expect(result.error).not.toMatch(/no recognised ems__\* class/i);
    expect(result.error).toMatch(/no status workflow/i);
    // The resolver IS consulted (data-driven), not short-circuited.
    expect(workflowResolver.resolveForAssetOrNull).toHaveBeenCalledTimes(1);
  });

  it("@req:7489624f-c17f-47dd-8108-3571a5809f61 data-driven transition works for a NON-built-in class with a workflow", async () => {
    // A class outside Task/Project/Meeting (UID-canon form) whose asset has a
    // declared workflow (e.g. via ems__Effort_workflow) resolves and transitions
    // Doing→Backlog — proving the dispatch is no longer gated by a hardcoded
    // 3-class map.
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.DOING,
        to: EffortStatus.BACKLOG,
        label: "← Backlog",
        isRollback: true,
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };
    const { executor, writer } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[d4f1c0a2-0000-4000-a000-00000000bbbb]]"\nems__Effort_status: "[[${DOING_UID}]]"\n---\n`,
      workflowResolver,
    });

    const result = await executor.execute(
      makeGrounding("rollback"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(result.notApplicable).toBeFalsy();
    // Status mutated to Backlog (UID-canon wikilink) on disk.
    expect(writer.updateFile).toHaveBeenCalled();
    const written = (writer.updateFile as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain(BACKLOG_UID);
  });

  it("fails loud when current status cannot be parsed", async () => {
    // Workflow resolves (built-in Task) but the asset has no parseable status —
    // this remains a hard, informative error (distinct from notApplicable).
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow([])),
    };
    const { executor } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\n# no status\n---\n`,
      workflowResolver,
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.notApplicable).toBeFalsy();
    expect(result.error).toMatch(/no parseable ems__Effort_status/i);
  });

  it("fails loud when no transition matches (from, direction)", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.BACKLOG,
        to: EffortStatus.DOING,
        label: "▶ Start",
        isRollback: false,
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };
    const { executor } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[${DONE_UID}]]"\n---\n`,
      workflowResolver,
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no forward transition from "ems__EffortStatusDone"/i);
  });

  it("fails loud when postActions present but no groundingLoader injected", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.DOING,
        to: EffortStatus.DONE,
        label: "✓ Done",
        isRollback: false,
        postActions: ["pa-set-end"],
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };
    const { executor } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[${DOING_UID}]]"\n---\n`,
      workflowResolver,
      // groundingLoader omitted
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no GroundingLoader injected/i);
  });

  it("fails loud when a postAction grounding cannot be loaded", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.DOING,
        to: EffortStatus.DONE,
        label: "✓ Done",
        isRollback: false,
        postActions: ["pa-missing"],
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };
    const groundingLoader: GroundingLoaderPort = async () => null;

    const { executor } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[${DOING_UID}]]"\n---\n`,
      workflowResolver,
      groundingLoader,
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/postAction grounding UID "pa-missing" could not be loaded/i);
  });

  it("halts chain when a postAction execution returns success:false", async () => {
    const transitions: WorkflowTransitionDefinition[] = [
      {
        from: EffortStatus.DOING,
        to: EffortStatus.DONE,
        label: "✓ Done",
        isRollback: false,
        postActions: ["pa-bad"],
      },
    ];
    const workflowResolver: WorkflowResolverPort = {
      resolveForAssetOrNull: jest
        .fn()
        .mockResolvedValue(makeTaskWorkflow(transitions)),
    };
    const groundingLoader: GroundingLoaderPort = async () => ({
      id: "pa-bad",
      label: "Bad action",
      type: GroundingType.PROPERTY_SET,
      // No targetProperty → property_set will reject
    });

    const { executor } = makeExecutor({
      content: `---\nexo__Instance_class:\n  - "[[${TASK_UID}]]"\nems__Effort_status: "[[${DOING_UID}]]"\n---\n`,
      workflowResolver,
      groundingLoader,
    });

    const result = await executor.execute(
      makeGrounding("forward"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/postAction.*failed/i);
  });
});
