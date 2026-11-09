/**
 * Bug 0018b193 — a built-in class without its OWN vault workflow inherits the
 * workflow of its nearest built-in ancestor (`ems__Meeting ⊑ ems__Task`) before
 * falling back to the hardcoded template. Specification axes (edition 4): A1–A21
 * from planning, A22–A29 from the independent spec review (each locks a wrong
 * implementation that passed A1–A21). A synthetic InMemoryTripleStore; the
 * production-shape (converter-built) counterpart is the CLI `apply` suite
 * `apply-workflow-transition-meeting-0018b193.integration.test.ts` (I1a–I3b).
 *
 * A1  meeting takes the vault Task workflow (Done→Doing rollback carries postActions)
 * A2  a meeting-specific vault workflow wins over the inherited Task one
 * A3  no vault workflow at all ⇒ hardcoded fallback
 * A4  meeting class file not resolvable ⇒ hardcoded fallback, not null
 * A5  cyclic superClass (Task ⊑ Meeting ⊑ Task) terminates
 * A6  canary: a Task resolves its own vault workflow
 * A7  OfflineMeeting ⊑ Meeting ⊑ Task reaches the vault Task workflow
 * A8  Project without own workflow does NOT take the Task one (P2)
 * A9  Task subclass with no workflow anywhere ⇒ hardcoded Task (P9)
 * A10 nearest built-in decides the family: X ⊑ Project, X ⊑ Y ⊑ Task ⇒ Project (P20)
 * A11 Sub ⊑ OfflineMeeting ⊑ Meeting ⊑ Task ⇒ vault Task workflow (P21)
 * A12 one resolver, project → meeting → task: each its own (cache per class, P22)
 * A13 meeting WITHOUT superClass in data does not inherit (P23)
 * A14 inheritance matches the class exactly: a WaitingCheckTask workflow is not Task's (P4)
 * A15 a foreign-namespace *Task workflow is not Task's (P4b)
 * A16 X ⊑ [Meeting, Project] (Meeting first), workflows on Project and Task ⇒ Task family (P1b)
 * A17 cost: a 12-level diamond stays linear in match() calls (P24)
 * A18 cost: 30 Task subclasses do not re-scan workflows per subclass (P25)
 * A19 the result does not depend on the ref form (label then UID vs UID then label)
 * A20 five concurrent resolutions of a meeting agree
 * A21 a built-in chain recurses: Meeting ⊑ Project ⊑ Task, only Task has a workflow ⇒ Task's
 * A22 Task and Project unchanged vs the legacy resolveForClass on six targetClass forms (rule 1)
 * A23 a foreign-namespace class with the SAME local name (exodev#Task) is not Task
 * A24 a store failure during inheritance degrades to the hardcoded fallback (catch branch)
 * A25 invalidateCache(): a meeting-specific workflow added later is picked up
 * A26 invalidateCache(): a Task workflow added later is inherited (no stale chain state)
 * A27 the NEAREST built-in wins even when declared second: X ⊑ [Y, Project], Y ⊑ Task ⇒ Project
 * A28 a stray asset labelled ems__Meeting does not hijack the seed (canonical UID first)
 * A29 built-in chain with workflows on BOTH Project and Task ⇒ the nearest (Project)
 * A30 rule 1 with FIXED expectations characterised on origin/main (A22's oracle shares
 *     findDefaultWorkflow with the subject and drifts with it)
 * A31 concurrent cold resolutions of a meeting AND a task do not see each other's chain
 * A32 a cycle between two built-ins off the start class (Project ⊑ Task ⊑ Project) terminates
 * A33 invalidateCache(): an OfflineMeeting (subclass walk) picks up a Task workflow added later
 */
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import type { WorkflowDefinition } from "../../../src/domain/models/WorkflowDefinition";

const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const PROJECT_CLASS_UID = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
const MEETING_CLASS_UID = "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca";
const OFFLINE_CLASS_UID = "07121818-d966-406b-be92-93b25142046c";
const U = (n: number) => `0018b193-0000-4000-a000-${String(n).padStart(12, "0")}`;
const TASK_WF = U(1);
const MEETING_WF = U(2);
const PROJECT_WF = U(3);
const WCT_WF = U(4);
const DEVTASK_WF = U(5);
const OTHER_WF = U(6);
const POST_END = U(900);

async function seedClass(
  store: InMemoryTripleStore,
  uid: string,
  label: string | null,
  ...superLocals: string[]
): Promise<void> {
  const file = new IRI(`obsidian://vault/${uid}.md`);
  const triples = [new Triple(file, Namespace.EXO.term("Asset_uid"), new Literal(uid))];
  if (label) triples.push(new Triple(file, Namespace.EXO.term("Asset_label"), new Literal(label)));
  for (const s of superLocals) {
    triples.push(new Triple(file, Namespace.EXO.term("Class_superClass"), Namespace.EMS.term(s)));
  }
  await store.addAll(triples);
}

async function seedWorkflow(
  store: InMemoryTripleStore,
  uid: string,
  target: IRI | Literal,
  withPostAction = true,
): Promise<void> {
  const wf = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(wf, Namespace.RDF.term("type"), Namespace.EMS.term("Workflow")),
    new Triple(wf, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(wf, Namespace.EXO.term("Asset_label"), new Literal(`WF ${uid}`)),
    new Triple(wf, Namespace.EMS.term("Workflow_targetClass"), target),
    new Triple(wf, Namespace.EMS.term("Workflow_isDefault"), new Literal("true")),
  ]);
  const tr = new IRI(`obsidian://vault/${uid}-done-doing.md`);
  const triples = [
    new Triple(tr, Namespace.RDF.term("type"), Namespace.EMS.term("WorkflowTransition")),
    new Triple(tr, Namespace.EMS.term("WorkflowTransition_workflow"), wf),
    new Triple(tr, Namespace.EMS.term("WorkflowTransition_from"), new Literal("ems__EffortStatusDone")),
    new Triple(tr, Namespace.EMS.term("WorkflowTransition_to"), new Literal("ems__EffortStatusDoing")),
    new Triple(tr, Namespace.EMS.term("WorkflowTransition_label"), new Literal("← Doing")),
    new Triple(tr, Namespace.EMS.term("WorkflowTransition_isRollback"), new Literal("true")),
  ];
  if (withPostAction) {
    triples.push(
      new Triple(tr, Namespace.EMS.term("WorkflowTransition_postActions"), new Literal(POST_END)),
    );
  }
  await store.addAll(triples);
}

const ems = (local: string) => Namespace.EMS.term(local);
const asset = new IRI("obsidian://vault/some-effort.md");
const ref = (uid: string) => [`"${uid}"`];
const rollbackDoneDoing = (wf: WorkflowDefinition | null) =>
  wf?.transitions.find((t) => t.from === "ems__EffortStatusDone" && t.isRollback);

describe("WorkflowResolver — built-in class inherits its ancestor's vault workflow (0018b193)", () => {
  let store: InMemoryTripleStore;
  let resolver: WorkflowResolver;
  const fallback = (c: AssetClass) => resolver.getHardcodedFallback(c).id;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
    await seedClass(store, TASK_CLASS_UID, "ems__Task");
    await seedClass(store, PROJECT_CLASS_UID, "ems__Project");
    await seedClass(store, MEETING_CLASS_UID, "ems__Meeting", "Task");
  });

  it("A1 a meeting takes the vault Task workflow, postActions included", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(TASK_WF);
    expect(rollbackDoneDoing(wf)?.postActions).toEqual([POST_END]);
  });

  it("A2 a meeting-specific vault workflow wins over the inherited Task one", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    await seedWorkflow(store, MEETING_WF, ems("Meeting"), false);
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(MEETING_WF);
  });

  it("A3 no vault workflow at all ⇒ hardcoded fallback", async () => {
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(fallback(AssetClass.MEETING));
  });

  it("A4 meeting class file not resolvable ⇒ hardcoded fallback, not null", async () => {
    const bare = new WorkflowResolver(new InMemoryTripleStore());
    const wf = await bare.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(bare.getHardcodedFallback(AssetClass.MEETING).id);
  });

  it("A5 a cyclic superClass chain (Task ⊑ Meeting ⊑ Task) terminates", async () => {
    await store.add(
      new Triple(new IRI(`obsidian://vault/${TASK_CLASS_UID}.md`), Namespace.EXO.term("Class_superClass"), ems("Meeting")),
    );
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(fallback(AssetClass.MEETING));
  });

  it("A6 canary: a Task resolves its own vault workflow", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(TASK_CLASS_UID));
    expect(wf?.id).toBe(TASK_WF);
  });

  it("A7 OfflineMeeting ⊑ Meeting ⊑ Task reaches the vault Task workflow", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    await seedClass(store, OFFLINE_CLASS_UID, "ems__OfflineMeeting", "Meeting");
    const wf = await resolver.resolveForAssetOrNull(asset, ref(OFFLINE_CLASS_UID));
    expect(wf?.id).toBe(TASK_WF);
    expect(rollbackDoneDoing(wf)?.postActions).toEqual([POST_END]);
  });

  it("A8 a Project without its own workflow does NOT take the Task one", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(PROJECT_CLASS_UID));
    expect(wf?.id).toBe(fallback(AssetClass.PROJECT));
    expect(wf?.targetClass).toBe(AssetClass.PROJECT);
  });

  it("A9 a Task subclass with no workflow anywhere ⇒ hardcoded Task, not null", async () => {
    await seedClass(store, U(101), "ems__WaitingCheckTask", "Task");
    const wf = await resolver.resolveForAssetOrNull(asset, ref(U(101)));
    expect(wf?.id).toBe(fallback(AssetClass.TASK));
  });

  it("A10 the nearest built-in decides the family: X ⊑ Project, X ⊑ Y ⊑ Task ⇒ Project", async () => {
    await seedClass(store, U(102), "ems__Y", "Task");
    await seedClass(store, U(103), "ems__X", "Project", "Y");
    const wf = await resolver.resolveForAssetOrNull(asset, ref(U(103)));
    expect(wf?.targetClass).toBe(AssetClass.PROJECT);
  });

  it("A11 Sub ⊑ OfflineMeeting ⊑ Meeting ⊑ Task ⇒ vault Task workflow", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    await seedClass(store, OFFLINE_CLASS_UID, "ems__OfflineMeeting", "Meeting");
    await seedClass(store, U(104), "ems__SubOffline", "OfflineMeeting");
    const wf = await resolver.resolveForAssetOrNull(asset, ref(U(104)));
    expect(wf?.id).toBe(TASK_WF);
  });

  it("A12 one resolver, project → meeting → task: each gets its own", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    await seedWorkflow(store, PROJECT_WF, ems("Project"));
    expect((await resolver.resolveForAssetOrNull(asset, ref(PROJECT_CLASS_UID)))?.id).toBe(PROJECT_WF);
    expect((await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)))?.id).toBe(TASK_WF);
    expect((await resolver.resolveForAssetOrNull(asset, ref(TASK_CLASS_UID)))?.id).toBe(TASK_WF);
  });

  it("A13 a meeting WITHOUT superClass in data does not inherit", async () => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
    await seedClass(store, TASK_CLASS_UID, "ems__Task");
    await seedClass(store, MEETING_CLASS_UID, "ems__Meeting");
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(fallback(AssetClass.MEETING));
  });

  it("A14 inheritance matches the class exactly: a WaitingCheckTask workflow is not Task's", async () => {
    await seedWorkflow(store, WCT_WF, ems("WaitingCheckTask"));
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(TASK_WF);
  });

  it("A15 a foreign-namespace *Task workflow is not Task's", async () => {
    await seedWorkflow(store, DEVTASK_WF, new IRI("https://exocortex.my/ontology/exodev#DevTask"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(fallback(AssetClass.MEETING));
  });

  it("A16 X ⊑ [Meeting, Project] (Meeting first), workflows on Project and Task ⇒ Task family", async () => {
    await seedWorkflow(store, PROJECT_WF, ems("Project"));
    await seedWorkflow(store, TASK_WF, ems("Task"));
    await seedClass(store, U(105), "ems__MeetingLike", "Meeting", "Project");
    const wf = await resolver.resolveForAssetOrNull(asset, ref(U(105)));
    expect(wf?.id).toBe(TASK_WF);
  });

  it("A17 cost: a 12-level diamond stays linear in match() calls", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    // level L has classes D<L>a and D<L>b, both ⊑ D<L+1>a and D<L+1>b; top ⊑ Task.
    for (let l = 0; l < 12; l++) {
      for (const side of ["a", "b"]) {
        const supers = l === 11 ? ["Task"] : [`D${l + 1}a`, `D${l + 1}b`];
        await seedClass(store, U(200 + l * 2 + (side === "a" ? 0 : 1)), `ems__D${l}${side}`, ...supers);
      }
    }
    const spy = jest.spyOn(store, "match");
    const wf = await resolver.resolveForAssetOrNull(asset, ref(U(200)));
    expect(wf?.id).toBe(TASK_WF);
    expect(spy.mock.calls.length).toBeLessThan(400);
  });

  it("A18 cost: 30 Task subclasses do not re-scan workflows per subclass", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    for (let i = 0; i < 30; i++) await seedClass(store, U(300 + i), `ems__Sub${i}`, "Task");
    const spy = jest.spyOn(store, "match");
    for (let i = 0; i < 30; i++) {
      expect((await resolver.resolveForAssetOrNull(asset, ref(U(300 + i))))?.id).toBe(TASK_WF);
    }
    expect(spy.mock.calls.length).toBeLessThan(200);
  });

  it("A19 the result does not depend on the ref form it came by", async () => {
    store = new InMemoryTripleStore();
    await seedClass(store, TASK_CLASS_UID, "ems__Task");
    await seedClass(store, MEETING_CLASS_UID, null, "Task"); // class file without a label
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const a = new WorkflowResolver(store);
    const b = new WorkflowResolver(store);
    const aLabel = (await a.resolveForAssetOrNull(asset, ["ems__Meeting"]))?.id;
    const aUid = (await a.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)))?.id;
    const bUid = (await b.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)))?.id;
    const bLabel = (await b.resolveForAssetOrNull(asset, ["ems__Meeting"]))?.id;
    expect([aLabel, aUid, bUid, bLabel]).toEqual([TASK_WF, TASK_WF, TASK_WF, TASK_WF]);
  });

  it("A21 a built-in chain recurses: Meeting ⊑ Project ⊑ Task, only Task has a workflow ⇒ Task's", async () => {
    store = new InMemoryTripleStore();
    resolver = new WorkflowResolver(store);
    await seedClass(store, TASK_CLASS_UID, "ems__Task");
    await seedClass(store, PROJECT_CLASS_UID, "ems__Project", "Task");
    await seedClass(store, MEETING_CLASS_UID, "ems__Meeting", "Project");
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(TASK_WF);
  });

  it("A20 five concurrent resolutions of a meeting agree", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID))),
    );
    expect(ids.map((w) => w?.id)).toEqual(Array(5).fill(TASK_WF));
  });

  // A22 — rule 1: for Task and Project the new path equals the UNCHANGED legacy
  // path (`resolveForClass`, the base behaviour) on every targetClass form,
  // including the suffix collisions ticket 97ee1608 is about.
  const shapes: Array<[string, () => IRI | Literal]> = [
    ["ems#WaitingCheckTask (97ee1608 collision)", () => ems("WaitingCheckTask")],
    ["exodev#DevTask", () => new IRI("https://exocortex.my/ontology/exodev#DevTask")],
    ["UID literal of the Task class", () => new Literal(`[[${TASK_CLASS_UID}]]`)],
    ["UID literal of the Project class", () => new Literal(`[[${PROJECT_CLASS_UID}]]`)],
    ["label literal ems__Task", () => new Literal("ems__Task")],
    ["file IRI of the Task class", () => new IRI(`obsidian://vault/${TASK_CLASS_UID}.md`)],
  ];
  for (const [name, target] of shapes) {
    for (const [cls, uid] of [
      [AssetClass.TASK, TASK_CLASS_UID],
      [AssetClass.PROJECT, PROJECT_CLASS_UID],
    ] as const) {
      it(`A22 ${cls} unchanged vs legacy resolveForClass — targetClass ${name}`, async () => {
        await seedWorkflow(store, OTHER_WF, target());
        const now = (await new WorkflowResolver(store).resolveForAssetOrNull(asset, ref(uid)))?.id;
        const legacy = (await new WorkflowResolver(store).resolveForClass(cls)).id;
        expect(now).toBe(legacy);
      });
    }
  }

  it("A23 a foreign-namespace class with the SAME local name (exodev#Task) is not Task", async () => {
    await seedWorkflow(store, OTHER_WF, new IRI("https://exocortex.my/ontology/exodev#Task"));
    const wf = await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(fallback(AssetClass.MEETING));
  });

  it("A24 a store failure during inheritance degrades to the hardcoded fallback (catch branch)", async () => {
    const superClass = Namespace.EXO.term("Class_superClass").value;
    const realMatch = store.match.bind(store);
    jest.spyOn(store, "match").mockImplementation(async (s, p, o) => {
      if (p && (p as IRI).value === superClass) throw new Error("boom: superClass index unavailable");
      return realMatch(s, p, o);
    });
    await expect(resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID))).resolves.toMatchObject({
      id: fallback(AssetClass.MEETING),
    });
    await expect(resolver.resolveForAssetOrNull(asset, ref(TASK_CLASS_UID))).resolves.toMatchObject({
      id: fallback(AssetClass.TASK),
    });
  });

  it("A25 invalidateCache(): a meeting-specific workflow added later is picked up", async () => {
    expect((await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)))?.id).toBe(
      fallback(AssetClass.MEETING),
    );
    await seedWorkflow(store, MEETING_WF, ems("Meeting"));
    resolver.invalidateCache();
    expect((await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)))?.id).toBe(MEETING_WF);
  });

  it("A26 invalidateCache(): a Task workflow added later is inherited (no stale chain state)", async () => {
    expect((await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)))?.id).toBe(
      fallback(AssetClass.MEETING),
    );
    await seedWorkflow(store, TASK_WF, ems("Task"));
    resolver.invalidateCache();
    expect((await resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)))?.id).toBe(TASK_WF);
  });

  it("A27 the NEAREST built-in wins even when declared second: X ⊑ [Y, Project], Y ⊑ Task ⇒ Project", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    await seedWorkflow(store, PROJECT_WF, ems("Project"));
    await seedClass(store, U(102), "ems__Y", "Task");
    await seedClass(store, U(103), "ems__X", "Y", "Project");
    const wf = await resolver.resolveForAssetOrNull(asset, ref(U(103)));
    expect(wf?.id).toBe(PROJECT_WF);
  });

  it("A28 a stray asset labelled ems__Meeting does not hijack the seed (canonical UID first)", async () => {
    store = new InMemoryTripleStore();
    await seedClass(store, U(500), "ems__Meeting"); // broken-ref stub / legacy copy, no superClass
    await seedClass(store, TASK_CLASS_UID, "ems__Task");
    await seedClass(store, MEETING_CLASS_UID, "ems__Meeting", "Task");
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const wf = await new WorkflowResolver(store).resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(TASK_WF);
  });

  it("A29 built-in chain with workflows on BOTH Project and Task ⇒ the nearest (Project)", async () => {
    store = new InMemoryTripleStore();
    await seedClass(store, TASK_CLASS_UID, "ems__Task");
    await seedClass(store, PROJECT_CLASS_UID, "ems__Project", "Task");
    await seedClass(store, MEETING_CLASS_UID, "ems__Meeting", "Project");
    await seedWorkflow(store, TASK_WF, ems("Task"));
    await seedWorkflow(store, PROJECT_WF, ems("Project"));
    const wf = await new WorkflowResolver(store).resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(wf?.id).toBe(PROJECT_WF);
  });

  // A30 — rule 1 against FIXED expectations (characterised on origin/main 136a071d), not the
  // resolveForClass oracle of A22. ⛔ When ticket 97ee1608 (suffix matching) is fixed, the
  // WaitingCheckTask / DevTask / label-literal rows change ON PURPOSE — update them there.
  const fixedBase: Array<[string, () => IRI | Literal, "other" | "fallback", "other" | "fallback"]> = [
    ["ems#WaitingCheckTask", () => ems("WaitingCheckTask"), "other", "fallback"],
    ["exodev#DevTask", () => new IRI("https://exocortex.my/ontology/exodev#DevTask"), "other", "fallback"],
    ["UID literal of the Task class", () => new Literal(`[[${TASK_CLASS_UID}]]`), "fallback", "fallback"],
    ["UID literal of the Project class", () => new Literal(`[[${PROJECT_CLASS_UID}]]`), "fallback", "fallback"],
    ["label literal ems__Task", () => new Literal("ems__Task"), "other", "fallback"],
    ["file IRI of the Task class", () => new IRI(`obsidian://vault/${TASK_CLASS_UID}.md`), "fallback", "fallback"],
  ];
  for (const [name, target, taskExp, projExp] of fixedBase) {
    it(`A30 Task and Project match the base behaviour — targetClass ${name}`, async () => {
      await seedWorkflow(store, OTHER_WF, target());
      const t = (await resolver.resolveForAssetOrNull(asset, ref(TASK_CLASS_UID)))?.id;
      const p = (await resolver.resolveForAssetOrNull(asset, ref(PROJECT_CLASS_UID)))?.id;
      expect([t, p]).toEqual([
        taskExp === "other" ? OTHER_WF : fallback(AssetClass.TASK),
        projExp === "other" ? OTHER_WF : fallback(AssetClass.PROJECT),
      ]);
    });
  }

  it("A31 concurrent cold resolutions of a meeting AND a task do not see each other's chain", async () => {
    await seedWorkflow(store, TASK_WF, ems("Task"));
    const [m, t] = await Promise.all([
      resolver.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID)),
      resolver.resolveForAssetOrNull(asset, ref(TASK_CLASS_UID)),
    ]);
    expect([m?.id, t?.id]).toEqual([TASK_WF, TASK_WF]);
  });

  it("A32 a cycle between two built-ins off the start class (Project ⊑ Task ⊑ Project) terminates", async () => {
    store = new InMemoryTripleStore();
    await seedClass(store, TASK_CLASS_UID, "ems__Task", "Project");
    await seedClass(store, PROJECT_CLASS_UID, "ems__Project", "Task");
    await seedClass(store, MEETING_CLASS_UID, "ems__Meeting", "Project");
    // An unbounded recursion spins in microtasks (no jest timeout fires, node dies of OOM),
    // so the store throws past a budget — and the axis asserts the COUNT, because the
    // inheritance catch would swallow the throw and still return the fallback.
    const BUDGET = 500;
    let calls = 0;
    const realMatch = store.match.bind(store);
    jest.spyOn(store, "match").mockImplementation(async (s, p, o) => {
      if (++calls > BUDGET) throw new Error("match() budget exceeded — unbounded inheritance recursion");
      return realMatch(s, p, o);
    });
    const r = new WorkflowResolver(store);
    const wf = await r.resolveForAssetOrNull(asset, ref(MEETING_CLASS_UID));
    expect(calls).toBeLessThanOrEqual(BUDGET);
    expect(wf?.id).toBe(r.getHardcodedFallback(AssetClass.MEETING).id);
  });

  it("A33 invalidateCache(): an OfflineMeeting (subclass walk) picks up a Task workflow added later", async () => {
    await seedClass(store, OFFLINE_CLASS_UID, "ems__OfflineMeeting", "Meeting");
    expect((await resolver.resolveForAssetOrNull(asset, ref(OFFLINE_CLASS_UID)))?.id).toBe(
      fallback(AssetClass.MEETING),
    );
    await seedWorkflow(store, TASK_WF, ems("Task"));
    resolver.invalidateCache();
    expect((await resolver.resolveForAssetOrNull(asset, ref(OFFLINE_CLASS_UID)))?.id).toBe(TASK_WF);
  });
});
