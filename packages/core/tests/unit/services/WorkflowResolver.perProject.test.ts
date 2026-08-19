import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";

// ─── Helpers (same pattern as WorkflowResolver.test.ts) ────────────

async function addWorkflowAsset(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    label: string;
    targetClass: string;
    initialState: string;
    terminalStates: string[];
    isDefault: boolean;
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);

  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EMS.term("Workflow")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(
      subject,
      Namespace.EMS.term("Workflow_targetClass"),
      Namespace.EMS.term(opts.targetClass.replace("ems__", "")),
    ),
    new Triple(
      subject,
      Namespace.EMS.term("Workflow_initialState"),
      new Literal(opts.initialState),
    ),
    new Triple(
      subject,
      Namespace.EMS.term("Workflow_isDefault"),
      new Literal(opts.isDefault ? "true" : "false"),
    ),
  ]);

  for (const ts of opts.terminalStates) {
    await store.add(
      new Triple(subject, Namespace.EMS.term("Workflow_terminalStates"), new Literal(ts)),
    );
  }

  return subject;
}

async function addWorkflowState(
  store: InMemoryTripleStore,
  opts: {
    workflowSubject: IRI;
    status: string;
    order: number;
    optional?: boolean;
    timestampOnEnter?: string[];
  },
): Promise<void> {
  const stateSubject = new IRI(
    `obsidian://vault/${opts.workflowSubject.value.split("/").pop()}-state-${opts.status.replace("ems__EffortStatus", "").toLowerCase()}.md`,
  );

  const triples: Triple[] = [
    new Triple(stateSubject, Namespace.RDF.term("type"), Namespace.EMS.term("WorkflowState")),
    new Triple(stateSubject, Namespace.EMS.term("WorkflowState_workflow"), opts.workflowSubject),
    new Triple(stateSubject, Namespace.EMS.term("WorkflowState_status"), new Literal(opts.status)),
    new Triple(
      stateSubject,
      Namespace.EMS.term("WorkflowState_order"),
      new Literal(opts.order.toString()),
    ),
  ];

  if (opts.optional) {
    triples.push(
      new Triple(stateSubject, Namespace.EMS.term("WorkflowState_optional"), new Literal("true")),
    );
  }

  for (const ts of opts.timestampOnEnter ?? []) {
    triples.push(
      new Triple(stateSubject, Namespace.EMS.term("WorkflowState_timestampOnEnter"), new Literal(ts)),
    );
  }

  await store.addAll(triples);
}

async function addWorkflowTransition(
  store: InMemoryTripleStore,
  opts: {
    workflowSubject: IRI;
    from: string;
    to: string;
    label: string;
  },
): Promise<void> {
  const transSubject = new IRI(
    `obsidian://vault/${opts.workflowSubject.value.split("/").pop()}-trans-${opts.from.replace("ems__EffortStatus", "").toLowerCase()}-to-${opts.to.replace("ems__EffortStatus", "").toLowerCase()}.md`,
  );

  await store.addAll([
    new Triple(transSubject, Namespace.RDF.term("type"), Namespace.EMS.term("WorkflowTransition")),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_workflow"), opts.workflowSubject),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_from"), new Literal(opts.from)),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_to"), new Literal(opts.to)),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_label"), new Literal(opts.label)),
  ]);
}

// ─── Helper to link asset to a custom workflow via ems__Effort_workflow ───

async function setAssetWorkflow(
  store: InMemoryTripleStore,
  assetSubject: IRI,
  workflowSubject: IRI,
): Promise<void> {
  await store.add(
    new Triple(assetSubject, Namespace.EMS.term("Effort_workflow"), workflowSubject),
  );
}

// ─── Helper to build a complete custom workflow (states + transitions) ───

async function buildCustomWorkflow(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    label: string;
    targetClass: string;
    isDefault: boolean;
    states: Array<{ status: string; order: number; optional?: boolean; timestampOnEnter?: string[] }>;
    transitions: Array<{ from: string; to: string; label: string }>;
  },
): Promise<IRI> {
  const workflowSubject = await addWorkflowAsset(store, {
    uid: opts.uid,
    label: opts.label,
    targetClass: opts.targetClass,
    initialState: opts.states[0]?.status ?? EffortStatus.DRAFT,
    terminalStates: [EffortStatus.DONE],
    isDefault: opts.isDefault,
  });

  for (const state of opts.states) {
    await addWorkflowState(store, { workflowSubject, ...state });
  }

  for (const transition of opts.transitions) {
    await addWorkflowTransition(store, { workflowSubject, ...transition });
  }

  return workflowSubject;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("WorkflowResolver — per-project workflow override (ems__Effort_workflow)", () => {
  let store: InMemoryTripleStore;
  let resolver: WorkflowResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
  });

  it("should use custom workflow when asset has ems__Effort_workflow pointing to a valid workflow", async () => {
    const customWorkflow = await buildCustomWorkflow(store, {
      uid: "wf-kanban",
      label: "Kanban Board",
      targetClass: "ems__Project",
      isDefault: false,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.DOING, order: 2 },
        { status: EffortStatus.DONE, order: 3 },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.DOING, label: "Start" },
        { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "Complete" },
      ],
    });

    const assetSubject = new IRI("obsidian://vault/my-project.md");
    await setAssetWorkflow(store, assetSubject, customWorkflow);

    const workflow = await resolver.resolveForAsset(assetSubject, AssetClass.PROJECT);

    expect(workflow.id).toBe("wf-kanban");
    expect(workflow.name).toBe("Kanban Board");
    expect(workflow.states).toHaveLength(3);
    expect(workflow.transitions).toHaveLength(2);
    expect(workflow.isDefault).toBe(false);
  });

  it("should fall back to class default when ems__Effort_workflow points to non-existent workflow subject", async () => {
    // When the workflow IRI exists as a reference but has no states/transitions in the store,
    // loadWorkflowBySubject returns null, causing resolveForAsset to fall back to
    // the class default (hardcoded fallback).
    const assetSubject = new IRI("obsidian://vault/my-project.md");
    const nonExistentWorkflow = new IRI("obsidian://vault/does-not-exist.md");
    await setAssetWorkflow(store, assetSubject, nonExistentWorkflow);

    const workflow = await resolver.resolveForAsset(assetSubject, AssetClass.PROJECT);

    expect(workflow.id).toBe("a1b2c3d4-1111-4000-a000-000000000001");
    expect(workflow.name).toContain("Project Default");
    expect(workflow.states.length).toBeGreaterThan(0);
    expect(workflow.transitions.length).toBeGreaterThan(0);
    expect(workflow.terminalStates).toContain(EffortStatus.DONE);
    expect(workflow.terminalStates).toContain(EffortStatus.TRASHED);
  });

  it("should fall back to class default when asset has no ems__Effort_workflow", async () => {
    const assetSubject = new IRI("obsidian://vault/plain-project.md");

    const workflow = await resolver.resolveForAsset(assetSubject, AssetClass.PROJECT);

    expect(workflow.id).toBe("a1b2c3d4-1111-4000-a000-000000000001");
  });

  it("should fall back to class default workflow from store (not hardcoded) when available", async () => {
    // Create a class default workflow in the store
    await buildCustomWorkflow(store, {
      uid: "wf-project-default",
      label: "Project Default",
      targetClass: "ems__Project",
      isDefault: true,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.DONE, order: 2 },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "Done" },
      ],
    });

    // Asset without ems__Effort_workflow
    const assetSubject = new IRI("obsidian://vault/some-project.md");
    const workflow = await resolver.resolveForAsset(assetSubject, AssetClass.PROJECT);

    expect(workflow.id).toBe("wf-project-default");
    expect(workflow.name).toBe("Project Default");
    expect(workflow.isDefault).toBe(true);
  });

  it("should not cache asset-specific workflow under class cache key", async () => {
    const customWorkflow = await buildCustomWorkflow(store, {
      uid: "wf-special",
      label: "Special Workflow",
      targetClass: "ems__Task",
      isDefault: false,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.DONE, order: 2 },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "Complete" },
      ],
    });

    const assetWithOverride = new IRI("obsidian://vault/special-task.md");
    await setAssetWorkflow(store, assetWithOverride, customWorkflow);

    // Resolve for asset with override
    const overrideWorkflow = await resolver.resolveForAsset(assetWithOverride, AssetClass.TASK);
    expect(overrideWorkflow.id).toBe("wf-special");

    // Resolve for another asset without override — should get class default, not the cached override
    const plainAsset = new IRI("obsidian://vault/plain-task.md");
    const defaultWorkflow = await resolver.resolveForAsset(plainAsset, AssetClass.TASK);
    expect(defaultWorkflow.id).toBe("a1b2c3d4-2222-4000-a000-000000000002");
  });

  it("should resolve different workflows for multiple assets with different overrides", async () => {
    const kanbanWorkflow = await buildCustomWorkflow(store, {
      uid: "wf-kanban",
      label: "Kanban",
      targetClass: "ems__Project",
      isDefault: false,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.DOING, order: 2 },
        { status: EffortStatus.DONE, order: 3 },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.DOING, label: "Start" },
        { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "Done" },
      ],
    });

    const scrumWorkflow = await buildCustomWorkflow(store, {
      uid: "wf-scrum",
      label: "Scrum",
      targetClass: "ems__Project",
      isDefault: false,
      states: [
        { status: EffortStatus.BACKLOG, order: 1 },
        { status: EffortStatus.WAITING, order: 2 },
        { status: EffortStatus.DOING, order: 3 },
        { status: EffortStatus.DONE, order: 4 },
      ],
      transitions: [
        { from: EffortStatus.BACKLOG, to: EffortStatus.WAITING, label: "Refine" },
        { from: EffortStatus.WAITING, to: EffortStatus.DOING, label: "Start" },
        { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "Complete" },
      ],
    });

    const projectA = new IRI("obsidian://vault/project-a.md");
    const projectB = new IRI("obsidian://vault/project-b.md");
    await setAssetWorkflow(store, projectA, kanbanWorkflow);
    await setAssetWorkflow(store, projectB, scrumWorkflow);

    const workflowA = await resolver.resolveForAsset(projectA, AssetClass.PROJECT);
    const workflowB = await resolver.resolveForAsset(projectB, AssetClass.PROJECT);

    expect(workflowA.id).toBe("wf-kanban");
    expect(workflowA.name).toBe("Kanban");
    expect(workflowA.states).toHaveLength(3);

    expect(workflowB.id).toBe("wf-scrum");
    expect(workflowB.name).toBe("Scrum");
    expect(workflowB.states).toHaveLength(4);
  });

  it("should work with a minimal Draft→Done workflow override", async () => {
    const minimalWorkflow = await buildCustomWorkflow(store, {
      uid: "wf-minimal",
      label: "Minimal Draft→Done",
      targetClass: "ems__Task",
      isDefault: false,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.DONE, order: 2, timestampOnEnter: ["ems__Effort_endTimestamp"] },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "✓ Done" },
      ],
    });

    const taskSubject = new IRI("obsidian://vault/simple-task.md");
    await setAssetWorkflow(store, taskSubject, minimalWorkflow);

    const workflow = await resolver.resolveForAsset(taskSubject, AssetClass.TASK);

    expect(workflow.id).toBe("wf-minimal");
    expect(workflow.states).toHaveLength(2);
    expect(workflow.states[0].status).toBe(EffortStatus.DRAFT);
    expect(workflow.states[1].status).toBe(EffortStatus.DONE);
    expect(workflow.transitions).toHaveLength(1);
    expect(workflow.transitions[0].label).toBe("✓ Done");
    // Verify timestampOnEnter propagates
    expect(workflow.states[1].timestampOnEnter).toContain("ems__Effort_endTimestamp");
  });

  it("should resolve same result when same asset is resolved twice (consistency)", async () => {
    const customWorkflow = await buildCustomWorkflow(store, {
      uid: "wf-consistent",
      label: "Consistent Workflow",
      targetClass: "ems__Project",
      isDefault: false,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.DONE, order: 2 },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "Done" },
      ],
    });

    const assetSubject = new IRI("obsidian://vault/repeat-project.md");
    await setAssetWorkflow(store, assetSubject, customWorkflow);

    const first = await resolver.resolveForAsset(assetSubject, AssetClass.PROJECT);
    const second = await resolver.resolveForAsset(assetSubject, AssetClass.PROJECT);

    expect(first.id).toBe(second.id);
    expect(first.name).toBe(second.name);
    expect(first.states).toHaveLength(second.states.length);
    expect(first.transitions).toHaveLength(second.transitions.length);
  });

  it("should ignore ems__Effort_workflow when value is a Literal (not IRI)", async () => {
    const assetSubject = new IRI("obsidian://vault/literal-workflow-task.md");

    // Add ems__Effort_workflow as a Literal (not an IRI reference)
    await store.add(
      new Triple(
        assetSubject,
        Namespace.EMS.term("Effort_workflow"),
        new Literal("some-string-value"),
      ),
    );

    const workflow = await resolver.resolveForAsset(assetSubject, AssetClass.TASK);

    // Should fall back to hardcoded default since Literal values are not valid workflow refs
    expect(workflow.id).toBe("a1b2c3d4-2222-4000-a000-000000000002");
  });

  it("should use asset override even when a class default exists in the store", async () => {
    // Create class default workflow
    await buildCustomWorkflow(store, {
      uid: "wf-default-task",
      label: "Default Task Workflow",
      targetClass: "ems__Task",
      isDefault: true,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.BACKLOG, order: 2 },
        { status: EffortStatus.DOING, order: 3 },
        { status: EffortStatus.DONE, order: 4 },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.BACKLOG, label: "→ Backlog" },
        { from: EffortStatus.BACKLOG, to: EffortStatus.DOING, label: "▶ Start" },
        { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "✓ Done" },
      ],
    });

    // Create asset-specific override workflow
    const overrideWorkflow = await buildCustomWorkflow(store, {
      uid: "wf-override",
      label: "Quick Workflow",
      targetClass: "ems__Task",
      isDefault: false,
      states: [
        { status: EffortStatus.DRAFT, order: 1 },
        { status: EffortStatus.DONE, order: 2 },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "Quick Done" },
      ],
    });

    const assetSubject = new IRI("obsidian://vault/overridden-task.md");
    await setAssetWorkflow(store, assetSubject, overrideWorkflow);

    const workflow = await resolver.resolveForAsset(assetSubject, AssetClass.TASK);

    // Should use the asset-specific override, NOT the class default
    expect(workflow.id).toBe("wf-override");
    expect(workflow.name).toBe("Quick Workflow");
    expect(workflow.states).toHaveLength(2);
  });
});
