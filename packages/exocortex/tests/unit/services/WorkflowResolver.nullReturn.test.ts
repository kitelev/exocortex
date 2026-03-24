import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";

describe("WorkflowResolver - null return for empty workflow data", () => {
  let store: InMemoryTripleStore;
  let resolver: WorkflowResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
  });

  describe("loadWorkflowBySubject returns null", () => {
    it("should return null when workflow IRI has no states and no transitions", async () => {
      const workflowIRI = new IRI("obsidian://vault/empty-workflow.md");

      await store.addAll([
        new Triple(workflowIRI, Namespace.RDF.term("type"), Namespace.EMS.term("Workflow")),
        new Triple(workflowIRI, Namespace.EXO.term("Asset_uid"), new Literal("empty-workflow")),
        new Triple(workflowIRI, Namespace.EXO.term("Asset_label"), new Literal("Empty Workflow")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_targetClass"), Namespace.EMS.term("Task")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_isDefault"), new Literal("true")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_initialState"), new Literal(EffortStatus.DRAFT)),
      ]);

      const result = await resolver.resolveForClass(AssetClass.TASK);

      expect(result.id).toBe("hardcoded-task-default");
      expect(result.name).toContain("hardcoded");
    });
  });

  describe("resolveForAsset falls back to class default", () => {
    it("should fall back to hardcoded when asset-specific workflow has no states/transitions", async () => {
      const assetIRI = new IRI("obsidian://vault/my-task.md");
      const workflowIRI = new IRI("obsidian://vault/empty-workflow.md");

      await store.addAll([
        new Triple(assetIRI, Namespace.EMS.term("Effort_workflow"), workflowIRI),
        new Triple(workflowIRI, Namespace.RDF.term("type"), Namespace.EMS.term("Workflow")),
        new Triple(workflowIRI, Namespace.EXO.term("Asset_uid"), new Literal("empty-workflow")),
        new Triple(workflowIRI, Namespace.EXO.term("Asset_label"), new Literal("Empty Workflow")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_targetClass"), Namespace.EMS.term("Task")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_isDefault"), new Literal("false")),
      ]);

      const result = await resolver.resolveForAsset(assetIRI, AssetClass.TASK);

      expect(result.id).toBe("hardcoded-task-default");
    });
  });

  describe("resolveForClass with populated workflow", () => {
    it("should return vault workflow when states and transitions exist", async () => {
      const workflowIRI = new IRI("obsidian://vault/real-workflow.md");

      await store.addAll([
        new Triple(workflowIRI, Namespace.RDF.term("type"), Namespace.EMS.term("Workflow")),
        new Triple(workflowIRI, Namespace.EXO.term("Asset_uid"), new Literal("real-workflow")),
        new Triple(workflowIRI, Namespace.EXO.term("Asset_label"), new Literal("Real Workflow")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_targetClass"), Namespace.EMS.term("Task")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_isDefault"), new Literal("true")),
        new Triple(workflowIRI, Namespace.EMS.term("Workflow_initialState"), new Literal(EffortStatus.DRAFT)),
      ]);

      const stateIRI = new IRI("obsidian://vault/state-draft.md");
      await store.addAll([
        new Triple(stateIRI, Namespace.RDF.term("type"), Namespace.EMS.term("WorkflowState")),
        new Triple(stateIRI, Namespace.EMS.term("WorkflowState_workflow"), workflowIRI),
        new Triple(stateIRI, Namespace.EMS.term("WorkflowState_status"), new Literal(EffortStatus.DRAFT)),
        new Triple(stateIRI, Namespace.EMS.term("WorkflowState_order"), new Literal("1")),
      ]);

      const transIRI = new IRI("obsidian://vault/trans-draft-backlog.md");
      await store.addAll([
        new Triple(transIRI, Namespace.RDF.term("type"), Namespace.EMS.term("WorkflowTransition")),
        new Triple(transIRI, Namespace.EMS.term("WorkflowTransition_workflow"), workflowIRI),
        new Triple(transIRI, Namespace.EMS.term("WorkflowTransition_from"), new Literal(EffortStatus.DRAFT)),
        new Triple(transIRI, Namespace.EMS.term("WorkflowTransition_to"), new Literal(EffortStatus.BACKLOG)),
        new Triple(transIRI, Namespace.EMS.term("WorkflowTransition_label"), new Literal("Move to Backlog")),
      ]);

      const result = await resolver.resolveForClass(AssetClass.TASK);

      expect(result.id).toBe("real-workflow");
      expect(result.name).toBe("Real Workflow");
      expect(result.states).toHaveLength(1);
      expect(result.transitions).toHaveLength(1);
    });
  });
});
