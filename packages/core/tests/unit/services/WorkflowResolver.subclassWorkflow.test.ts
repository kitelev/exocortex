/**
 * Subclass workflow inheritance (req 915b20b2 — ems__WaitingCheckTask).
 *
 * A class that is a transitive subClass (via `exo__Class_superClass`) of a
 * built-in Task/Project/Meeting inherits that built-in's workflow, so the
 * standard status buttons (start-effort / mark-done / move-to-backlog
 * `workflow_transition` groundings) WORK on any Task subclass — not just the
 * exact built-in three. Before this, a subclass resolved `null` (silent no-op).
 *
 * Production-shape: a real {@link WorkflowResolver} over an
 * {@link InMemoryTripleStore}, seeded with the REAL store IRI shape — the class
 * FILE IRI is the subject of `exo__Class_superClass`, whose OBJECT is the
 * symbolic parent-class IRI (`https://exocortex.my/ontology/ems#Task`), exactly
 * as `NoteToRDFConverter` emits (dual-IRI). No mocks of the resolver logic.
 *
 * Revert-verify ([[integration-test-revert-verify]]): with the ancestry walk
 * (`findBuiltInWorkflowByAncestry`) neutralised, the "subclass inherits Task
 * workflow" assertions go RED (resolver returns null); restored → GREEN. The
 * "non-Task subclass with no built-in ancestor → null" case stays GREEN both
 * ways (intended no-op guard against over-eager resolution).
 *
 * @req:915b20b2-e0d7-4198-80c0-5561293149f0
 */
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { AssetClass } from "../../../src/domain/constants/AssetClass";

const WCT_UID = "915bc0de-0000-4000-a000-00000000c0de"; // ems__WaitingCheckTask
const WCT2_UID = "915bc0de-0000-4000-a000-00000000cafe"; // sub-sub-class
const BASE_UID = "b00e0000-0000-4000-a000-0000000000ba"; // ems__SomeBase (no wf)
const BUG_UID = "b00e0000-0000-4000-a000-00000000b060"; // ems__Bug (⊑ SomeBase)

/**
 * Seed a class FILE (subject = `obsidian://vault/<uid>.md`) with its uid, label,
 * and — when `superClassLocal` is given — an `exo__Class_superClass` triple whose
 * OBJECT is the SYMBOLIC parent IRI `ems#<superClassLocal>` (production shape).
 */
async function seedClass(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
  superClassLocal?: string,
): Promise<void> {
  const file = new IRI(`obsidian://vault/${uid}.md`);
  const triples = [
    new Triple(file, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(file, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ];
  if (superClassLocal) {
    triples.push(
      new Triple(
        file,
        Namespace.EXO.term("Class_superClass"),
        Namespace.EMS.term(superClassLocal),
      ),
    );
  }
  await store.addAll(triples);
}

describe("WorkflowResolver — subclass workflow inheritance (req 915b20b2)", () => {
  let store: InMemoryTripleStore;
  let resolver: WorkflowResolver;
  const asset = new IRI("obsidian://vault/some-wct-instance.md");

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
    // ems__WaitingCheckTask ⊑ ems__Task (direct subclass — the primary case).
    await seedClass(store, WCT_UID, "ems__WaitingCheckTask", "Task");
  });

  it("resolves the built-in Task workflow for a direct Task subclass (UID-canon ref)", async () => {
    const result = await resolver.resolveForAssetOrNull(asset, [`[[${WCT_UID}]]`]);
    expect(result).not.toBeNull();
    expect(result?.targetClass).toBe(AssetClass.TASK);
  });

  it("resolves the built-in Task workflow for a bare-label Task subclass ref", async () => {
    const result = await resolver.resolveForAssetOrNull(asset, [
      "ems__WaitingCheckTask",
    ]);
    expect(result).not.toBeNull();
    expect(result?.targetClass).toBe(AssetClass.TASK);
  });

  it("walks a MULTI-hop chain (sub-sub-class ⊑ subclass ⊑ Task) to the built-in workflow", async () => {
    // WCT2 ⊑ WaitingCheckTask (symbolic parent) ⊑ Task. The walk maps the
    // symbolic intermediate back to its file IRI (label→uid) to recurse.
    await seedClass(store, WCT2_UID, "ems__WaitingCheckTask2", "WaitingCheckTask");
    const result = await resolver.resolveForAssetOrNull(asset, [`[[${WCT2_UID}]]`]);
    expect(result).not.toBeNull();
    expect(result?.targetClass).toBe(AssetClass.TASK);
  });

  it("returns null for a non-Task subclass with NO built-in ancestor (no over-eager resolution)", async () => {
    // ems__Bug ⊑ ems__SomeBase, neither of which is Task/Project/Meeting and
    // neither carries a workflow → benign null. (GREEN both ways under revert.)
    await seedClass(store, BASE_UID, "ems__SomeBase");
    await seedClass(store, BUG_UID, "ems__Bug", "SomeBase");
    const result = await resolver.resolveForAssetOrNull(asset, [`[[${BUG_UID}]]`]);
    expect(result).toBeNull();
  });

  it("resolves the built-in even when the Task subclass is NOT first in a multi-valued instance_class", async () => {
    await seedClass(store, BASE_UID, "ems__SomeBase");
    const result = await resolver.resolveForAssetOrNull(asset, [
      `[[${BASE_UID}]]`,
      `[[${WCT_UID}]]`,
    ]);
    expect(result).not.toBeNull();
    expect(result?.targetClass).toBe(AssetClass.TASK);
  });
});
