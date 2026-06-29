/**
 * Data-driven workflow resolution for the `workflow_transition` grounding —
 * fix for the "Rollback to Backlog crashes on non-Task/Project/Meeting effort
 * classes" bug. Production-shape: a real {@link WorkflowResolver} over an
 * {@link InMemoryTripleStore}, exercising the FULL `resolveForAssetOrNull`
 * path (no mocks).
 *
 * @req:7489624f-c17f-47dd-8108-3571a5809f61
 */
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";

const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const BUG_UID = "d4f1c0a2-0000-4000-a000-00000000bbbb";
const ACTION_UID = "a11c0000-0000-4000-a000-00000000aaaa";

async function seedWorkflow(
  store: InMemoryTripleStore,
  wfUid: string,
  targetClassLabel: string,
): Promise<IRI> {
  const wf = new IRI(`obsidian://vault/${wfUid}.md`);
  const trans = new IRI(`obsidian://vault/${wfUid}-t1.md`);
  await store.addAll([
    new Triple(wf, Namespace.RDF.term("type"), Namespace.EMS.term("Workflow")),
    new Triple(wf, Namespace.EXO.term("Asset_uid"), new Literal(wfUid)),
    new Triple(wf, Namespace.EXO.term("Asset_label"), new Literal("Bug Workflow")),
    new Triple(
      wf,
      Namespace.EMS.term("Workflow_targetClass"),
      Namespace.EMS.term(targetClassLabel.replace("ems__", "")),
    ),
    new Triple(wf, Namespace.EMS.term("Workflow_isDefault"), new Literal("true")),
    // one transition so loadWorkflowBySubject yields a non-null definition
    new Triple(
      trans,
      Namespace.RDF.term("type"),
      Namespace.EMS.term("WorkflowTransition"),
    ),
    new Triple(trans, Namespace.EMS.term("WorkflowTransition_workflow"), wf),
    new Triple(
      trans,
      Namespace.EMS.term("WorkflowTransition_from"),
      new Literal(EffortStatus.DOING),
    ),
    new Triple(
      trans,
      Namespace.EMS.term("WorkflowTransition_to"),
      new Literal(EffortStatus.BACKLOG),
    ),
    new Triple(
      trans,
      Namespace.EMS.term("WorkflowTransition_isRollback"),
      new Literal("true"),
    ),
  ]);
  return wf;
}

describe("WorkflowResolver.resolveForAssetOrNull (data-driven, crash fix)", () => {
  let store: InMemoryTripleStore;
  let resolver: WorkflowResolver;
  const asset = new IRI("obsidian://vault/some-asset.md");

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
  });

  it("returns the per-asset ems__Effort_workflow override for a NON-built-in class", async () => {
    // A Bug asset (UID-canon class ref, NOT Task/Project/Meeting) with its own
    // declared workflow resolves it — Homoiconicity: new class managed by vault
    // data, no code change.
    const wf = await seedWorkflow(store, "bug-wf-uid", "ems__Bug");
    await store.add(
      new Triple(asset, Namespace.EMS.term("Effort_workflow"), wf),
    );

    const result = await resolver.resolveForAssetOrNull(asset, `[[${BUG_UID}]]`);

    expect(result).not.toBeNull();
    expect(result?.transitions.some((t) => t.isRollback)).toBe(true);
  });

  it("returns null for a non-built-in class with NO workflow (e.g. ems__Action — own lifecycle)", async () => {
    const result = await resolver.resolveForAssetOrNull(
      asset,
      `[[${ACTION_UID}|ems__Action]]`,
    );
    expect(result).toBeNull();
  });

  it("returns null for a bare unknown class ref with no workflow", async () => {
    const result = await resolver.resolveForAssetOrNull(asset, "some-random-uid");
    expect(result).toBeNull();
  });

  it("resolves the built-in Task default for a UID-canon Task class ref", async () => {
    const result = await resolver.resolveForAssetOrNull(asset, `[[${TASK_UID}]]`);
    expect(result).not.toBeNull();
    expect(result?.targetClass).toBe(AssetClass.TASK);
  });

  it("resolves the built-in default for an alias-form Task class ref", async () => {
    const result = await resolver.resolveForAssetOrNull(
      asset,
      `${TASK_UID}|ems__Task`,
    );
    expect(result).not.toBeNull();
    expect(result?.targetClass).toBe(AssetClass.TASK);
  });

  it("resolves the built-in default for a bare-label Project class ref", async () => {
    const result = await resolver.resolveForAssetOrNull(asset, "ems__Project");
    expect(result).not.toBeNull();
    expect(result?.targetClass).toBe(AssetClass.PROJECT);
  });
});
