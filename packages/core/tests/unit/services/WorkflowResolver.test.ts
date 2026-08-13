import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";

/**
 * Helper to build workflow assets in the triple store.
 */
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
    // rdf:type ems:Workflow
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EMS.term("Workflow")),
    // exo:Asset_uid
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    // exo:Asset_label
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    // ems:Workflow_targetClass
    new Triple(
      subject,
      Namespace.EMS.term("Workflow_targetClass"),
      Namespace.EMS.term(opts.targetClass.replace("ems__", "")),
    ),
    // ems:Workflow_initialState
    new Triple(
      subject,
      Namespace.EMS.term("Workflow_initialState"),
      new Literal(opts.initialState),
    ),
    // ems:Workflow_isDefault
    new Triple(
      subject,
      Namespace.EMS.term("Workflow_isDefault"),
      new Literal(opts.isDefault ? "true" : "false"),
    ),
  ]);

  // Add terminal states
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
    badgeColor?: string;
  },
): Promise<void> {
  const stateSubject = new IRI(
    `obsidian://vault/state-${opts.status.replace("ems__EffortStatus", "").toLowerCase()}.md`,
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

  if (opts.badgeColor) {
    triples.push(
      new Triple(
        stateSubject,
        Namespace.EMS.term("WorkflowState_badgeColor"),
        new Literal(opts.badgeColor),
      ),
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
    icon?: string;
    isRollback?: boolean;
  },
): Promise<void> {
  const transSubject = new IRI(
    `obsidian://vault/transition-${opts.from.replace("ems__EffortStatus", "").toLowerCase()}-to-${opts.to.replace("ems__EffortStatus", "").toLowerCase()}.md`,
  );

  const triples: Triple[] = [
    new Triple(transSubject, Namespace.RDF.term("type"), Namespace.EMS.term("WorkflowTransition")),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_workflow"), opts.workflowSubject),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_from"), new Literal(opts.from)),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_to"), new Literal(opts.to)),
    new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_label"), new Literal(opts.label)),
  ];

  if (opts.icon) {
    triples.push(
      new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_icon"), new Literal(opts.icon)),
    );
  }

  if (opts.isRollback) {
    triples.push(
      new Triple(transSubject, Namespace.EMS.term("WorkflowTransition_isRollback"), new Literal("true")),
    );
  }

  await store.addAll(triples);
}

describe("WorkflowResolver", () => {
  let store: InMemoryTripleStore;
  let resolver: WorkflowResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
  });

  describe("getHardcodedFallback", () => {
    it("should return Project fallback with the ontology-backed states only", () => {
      const workflow = resolver.getHardcodedFallback(AssetClass.PROJECT);

      expect(workflow.targetClass).toBe(AssetClass.PROJECT);
      expect(workflow.initialState).toBe(EffortStatus.DRAFT);
      expect(workflow.terminalStates).toContain(EffortStatus.DONE);
      expect(workflow.terminalStates).toContain(EffortStatus.TRASHED);
      expect(workflow.states.map((s) => s.status)).toEqual([
        EffortStatus.DRAFT,
        EffortStatus.BACKLOG,
        EffortStatus.DOING,
        EffortStatus.DONE,
        EffortStatus.TRASHED,
      ]);
    });

    it("should return the same state set for the Task fallback", () => {
      const workflow = resolver.getHardcodedFallback(AssetClass.TASK);

      expect(workflow.targetClass).toBe(AssetClass.TASK);
      expect(workflow.states.map((s) => s.status)).toEqual([
        EffortStatus.DRAFT,
        EffortStatus.BACKLOG,
        EffortStatus.DOING,
        EffortStatus.DONE,
        EffortStatus.TRASHED,
      ]);
    });

    it("should include timestamp properties on Doing and Done states", () => {
      const workflow = resolver.getHardcodedFallback(AssetClass.TASK);

      const doingState = workflow.states.find((s) => s.status === EffortStatus.DOING);
      expect(doingState?.timestampOnEnter).toContain("ems__Effort_startTimestamp");

      const doneState = workflow.states.find((s) => s.status === EffortStatus.DONE);
      expect(doneState?.timestampOnEnter).toContain("ems__Effort_endTimestamp");
      expect(doneState?.timestampOnEnter).toContain("ems__Effort_resolutionTimestamp");
    });

    it("should include rollback transitions", () => {
      const workflow = resolver.getHardcodedFallback(AssetClass.PROJECT);
      const rollbacks = workflow.transitions.filter((t) => t.isRollback);
      expect(rollbacks.length).toBeGreaterThan(0);
    });

    it("should have Project DOING rollback to Backlog", () => {
      const workflow = resolver.getHardcodedFallback(AssetClass.PROJECT);
      const doingRollback = workflow.transitions.find(
        (t) => t.from === EffortStatus.DOING && t.isRollback,
      );
      expect(doingRollback?.to).toBe(EffortStatus.BACKLOG);
    });

    it("should have Task DOING rollback to Backlog", () => {
      const workflow = resolver.getHardcodedFallback(AssetClass.TASK);
      const doingRollback = workflow.transitions.find(
        (t) => t.from === EffortStatus.DOING && t.isRollback,
      );
      expect(doingRollback?.to).toBe(EffortStatus.BACKLOG);
    });
  });

  describe("resolveForClass", () => {
    it("should return hardcoded fallback when no workflow assets exist", async () => {
      const workflow = await resolver.resolveForClass(AssetClass.PROJECT);

      expect(workflow.id).toBe("a1b2c3d4-1111-4000-a000-000000000001");
      expect(workflow.targetClass).toBe(AssetClass.PROJECT);
    });

    it("should load workflow from triple store when assets exist", async () => {
      const workflowSubject = await addWorkflowAsset(store, {
        uid: "wf-001",
        label: "Custom Project Workflow",
        targetClass: "ems__Project",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
        isDefault: true,
      });

      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DRAFT,
        order: 1,
      });

      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DOING,
        order: 2,
        timestampOnEnter: ["ems__Effort_startTimestamp"],
      });

      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DONE,
        order: 3,
      });

      await addWorkflowTransition(store, {
        workflowSubject,
        from: EffortStatus.DRAFT,
        to: EffortStatus.DOING,
        label: "▶ Start",
      });

      await addWorkflowTransition(store, {
        workflowSubject,
        from: EffortStatus.DOING,
        to: EffortStatus.DONE,
        label: "✓ Done",
      });

      const workflow = await resolver.resolveForClass(AssetClass.PROJECT);

      expect(workflow.id).toBe("wf-001");
      expect(workflow.name).toBe("Custom Project Workflow");
      expect(workflow.states).toHaveLength(3);
      expect(workflow.transitions).toHaveLength(2);
      expect(workflow.isDefault).toBe(true);
    });

    it("should cache resolved workflows", async () => {
      const w1 = await resolver.resolveForClass(AssetClass.TASK);
      const w2 = await resolver.resolveForClass(AssetClass.TASK);
      expect(w1).toBe(w2); // Same reference
    });

    it("should invalidate cache", async () => {
      const w1 = await resolver.resolveForClass(AssetClass.TASK);
      resolver.invalidateCache();
      const w2 = await resolver.resolveForClass(AssetClass.TASK);
      expect(w1).not.toBe(w2); // Different reference (reloaded)
      expect(w1.id).toBe(w2.id); // But same content
    });

    it("should skip non-default workflows", async () => {
      await addWorkflowAsset(store, {
        uid: "wf-non-default",
        label: "Non-Default Workflow",
        targetClass: "ems__Project",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: false,
      });

      const workflow = await resolver.resolveForClass(AssetClass.PROJECT);
      expect(workflow.id).toBe("a1b2c3d4-1111-4000-a000-000000000001"); // Falls back
    });
  });

  describe("resolveForAsset", () => {
    it("should use asset-specific workflow when ems__Effort_workflow is set", async () => {
      // Create a custom workflow
      const customWorkflowSubject = await addWorkflowAsset(store, {
        uid: "wf-custom",
        label: "Kanban Workflow",
        targetClass: "ems__Project",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: false,
      });

      await addWorkflowState(store, {
        workflowSubject: customWorkflowSubject,
        status: EffortStatus.DRAFT,
        order: 1,
      });

      await addWorkflowState(store, {
        workflowSubject: customWorkflowSubject,
        status: EffortStatus.DONE,
        order: 2,
      });

      // Create an asset that references this workflow
      const assetSubject = new IRI("obsidian://vault/my-project.md");
      await store.add(
        new Triple(
          assetSubject,
          Namespace.EMS.term("Effort_workflow"),
          customWorkflowSubject,
        ),
      );

      const workflow = await resolver.resolveForAsset(
        assetSubject,
        AssetClass.PROJECT,
      );

      expect(workflow.id).toBe("wf-custom");
      expect(workflow.name).toBe("Kanban Workflow");
    });

    it("should fall back to class default when no asset workflow set", async () => {
      const assetSubject = new IRI("obsidian://vault/my-project.md");

      const workflow = await resolver.resolveForAsset(
        assetSubject,
        AssetClass.PROJECT,
      );

      expect(workflow.id).toBe("a1b2c3d4-1111-4000-a000-000000000001");
    });
  });

  describe("state loading", () => {
    it("should sort states by order", async () => {
      const workflowSubject = await addWorkflowAsset(store, {
        uid: "wf-ordered",
        label: "Ordered Workflow",
        targetClass: "ems__Task",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: true,
      });

      // Add states in reverse order
      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DONE,
        order: 3,
      });
      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DRAFT,
        order: 1,
      });
      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DOING,
        order: 2,
      });

      const workflow = await resolver.resolveForClass(AssetClass.TASK);

      expect(workflow.states[0].status).toBe(EffortStatus.DRAFT);
      expect(workflow.states[1].status).toBe(EffortStatus.DOING);
      expect(workflow.states[2].status).toBe(EffortStatus.DONE);
    });

    it("should load optional flag", async () => {
      const workflowSubject = await addWorkflowAsset(store, {
        uid: "wf-optional",
        label: "Optional States Workflow",
        targetClass: "ems__Project",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: true,
      });

      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.WAITING,
        order: 2,
        optional: true,
      });

      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DRAFT,
        order: 1,
        optional: false,
      });

      const workflow = await resolver.resolveForClass(AssetClass.PROJECT);

      const analysisState = workflow.states.find((s) => s.status === EffortStatus.WAITING);
      expect(analysisState?.optional).toBe(true);

      const draftState = workflow.states.find((s) => s.status === EffortStatus.DRAFT);
      expect(draftState?.optional).toBe(false);
    });

    it("should load badge color", async () => {
      const workflowSubject = await addWorkflowAsset(store, {
        uid: "wf-colors",
        label: "Colored Workflow",
        targetClass: "ems__Task",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: true,
      });

      await addWorkflowState(store, {
        workflowSubject,
        status: EffortStatus.DOING,
        order: 1,
        badgeColor: "#4caf50",
      });

      const workflow = await resolver.resolveForClass(AssetClass.TASK);
      const doingState = workflow.states.find((s) => s.status === EffortStatus.DOING);
      expect(doingState?.badgeColor).toBe("#4caf50");
    });
  });

  describe("transition loading", () => {
    it("should load rollback transitions", async () => {
      const workflowSubject = await addWorkflowAsset(store, {
        uid: "wf-rollback",
        label: "Rollback Workflow",
        targetClass: "ems__Task",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: true,
      });

      await addWorkflowTransition(store, {
        workflowSubject,
        from: EffortStatus.DOING,
        to: EffortStatus.BACKLOG,
        label: "← Back",
        isRollback: true,
      });

      const workflow = await resolver.resolveForClass(AssetClass.TASK);
      const rollback = workflow.transitions.find((t) => t.isRollback);
      expect(rollback).toBeDefined();
      expect(rollback?.from).toBe(EffortStatus.DOING);
      expect(rollback?.to).toBe(EffortStatus.BACKLOG);
    });

    it("should load icon on transitions", async () => {
      const workflowSubject = await addWorkflowAsset(store, {
        uid: "wf-icons",
        label: "Icon Workflow",
        targetClass: "ems__Task",
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: true,
      });

      await addWorkflowTransition(store, {
        workflowSubject,
        from: EffortStatus.DRAFT,
        to: EffortStatus.DOING,
        label: "Start",
        icon: "play",
      });

      const workflow = await resolver.resolveForClass(AssetClass.TASK);
      expect(workflow.transitions[0].icon).toBe("play");
    });
  });
});
