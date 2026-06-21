/**
 * C3 capability-inheritance (RFC 78c2b7d0, the ХРЕБЕТ child RFC).
 *
 * Verifies the resolver-side consolidation of class-capability inheritance:
 *
 *   1. `resolveForAssetMulti` itself walks `exo__Class_superClass` and merges
 *      ancestor `targetClass` bindings — so EVERY consumer inherits (CLI
 *      `apply`, CommandRegistry, plugin-UI), not only the plugin caller that
 *      historically pre-expanded the class array in `extractAssetClasses`.
 *   2. A depth-aware `(priority, depth, order)` sort-key implements nearest-
 *      wins ("nearer class higher" in the UI).
 *   3. An explicit `overrides` edge removes the targeted binding from the
 *      merged set absolutely (post-BFS, distance-independent); dangling
 *      `overrides` refs are fail-open.
 *   4. A resolver-side universal-root guard keeps `exo__Asset` bindings
 *      matching even when the class chain omits the root.
 *
 * Production-shape fixtures (`~/dotfiles/.claude/rules/test-fixture-realism.md`):
 *   - Class subjects are file IRIs (`obsidian://vault/.../<uid>.md`).
 *   - `Class_superClass` objects are namespace IRIs
 *     (`https://exocortex.my/ontology/<prefix>#<Local>`), matching
 *     `NoteToRDFConverter.valueToRDFObject` output.
 *   - Bindings carry `targetClass` symbolic literals (e.g. `"ems__Task"`).
 *
 * Parity proof (revert→fail / restore→pass): the «inherits when given ONLY
 * the leaf class» tests FAIL when the resolver-side BFS consolidation is
 * reverted (the resolver then sees only the leaf and never matches an
 * ancestor-targeted binding) and PASS once it is restored.
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// TBox: exo__Asset ⊐ ems__Effort ⊐ ems__Task ⊐ ems__Meeting
const ASSET_UID = "493c2ae2-de56-47ec-954d-2eb8cb49bff7";
const EFFORT_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const MEETING_UID = "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca";

const MEETING_ASSET_IRI = "obsidian://vault/03 Knowledge/meeting-instance.md";

interface ClassFixture {
  uid: string;
  label: string;
  superClassLabel?: string;
}

function classFileIRI(uid: string): IRI {
  return new IRI(`obsidian://vault/assetspaces/ems/${uid}.md`);
}

function expandClassLabel(label: string): IRI | null {
  const parsed = Namespace.fromPropertyKey(label);
  if (!parsed) return null;
  return parsed.namespace.term(parsed.localName);
}

async function seedClass(
  store: InMemoryTripleStore,
  fixture: ClassFixture,
): Promise<IRI> {
  const subject = classFileIRI(fixture.uid);
  const triples: Triple[] = [
    new Triple(
      subject,
      Namespace.EXO.term("Asset_uid"),
      new Literal(fixture.uid),
    ),
    new Triple(
      subject,
      Namespace.EXO.term("Asset_label"),
      new Literal(fixture.label),
    ),
  ];
  if (fixture.superClassLabel) {
    const parent = expandClassLabel(fixture.superClassLabel);
    if (parent) {
      triples.push(
        new Triple(subject, Namespace.EXO.term("Class_superClass"), parent),
      );
    }
  }
  await store.addAll(triples);
  return subject;
}

async function seedTBox(store: InMemoryTripleStore): Promise<void> {
  await seedClass(store, { uid: ASSET_UID, label: "exo__Asset" });
  await seedClass(store, {
    uid: EFFORT_UID,
    label: "ems__Effort",
    superClassLabel: "exo__Asset",
  });
  await seedClass(store, {
    uid: TASK_UID,
    label: "ems__Task",
    superClassLabel: "ems__Effort",
  });
  await seedClass(store, {
    uid: MEETING_UID,
    label: "ems__Meeting",
    superClassLabel: "ems__Task",
  });
}

async function addGrounding(
  store: InMemoryTripleStore,
  uid: string,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Grounding"),
    ),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(
      subject,
      Namespace.EXO.term("Asset_label"),
      new Literal(`G ${uid}`),
    ),
    // property_set grounding-type UID (mirror of GroundingTypeUIDs.ts)
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal("[[cf3bb923-f1f1-40be-b728-782844402426]]"),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
      new Literal("ems__Effort_status"),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_targetValue"),
      new Literal("done"),
    ),
  ]);
}

async function addCommand(
  store: InMemoryTripleStore,
  uid: string,
  name: string,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  const groundingRef = `gnd-${uid}`;
  await addGrounding(store, groundingRef);
  await store.addAll([
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    ),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(name)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Command_grounding"),
      new IRI(`obsidian://vault/${groundingRef}.md`),
    ),
  ]);
}

async function addBinding(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    commandRef: string;
    targetClass?: string;
    targetPrototype?: string;
    targetAsset?: string;
    order?: number;
    overrides?: string[];
  },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("CommandBinding"),
    ),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      subject,
      Namespace.EXO.term("Asset_label"),
      new Literal(`B ${opts.uid}`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("CommandBinding_command"),
      new IRI(`obsidian://vault/${opts.commandRef}.md`),
    ),
  ];
  if (opts.targetClass) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_targetClass"),
        new Literal(opts.targetClass),
      ),
    );
  }
  if (opts.targetPrototype) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_targetPrototype"),
        new Literal(opts.targetPrototype),
      ),
    );
  }
  if (opts.targetAsset) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_targetAsset"),
        new Literal(opts.targetAsset),
      ),
    );
  }
  if (opts.order !== undefined) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_order"),
        new Literal(String(opts.order)),
      ),
    );
  }
  if (opts.overrides) {
    for (const ov of opts.overrides) {
      triples.push(
        new Triple(
          subject,
          Namespace.EXOCMD.term("CommandBinding_overrides"),
          new Literal(`[[${ov}]]`),
        ),
      );
    }
  }
  await store.addAll(triples);
}

describe("CommandResolver — C3 capability-inheritance (RFC 78c2b7d0)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    await seedTBox(store);
    resolver = new CommandResolver(store);
  });

  describe("resolver-side BFS consolidation — inheritance for ALL consumers", () => {
    beforeEach(async () => {
      await addCommand(store, "cmd-task", "Task Command");
      await addBinding(store, {
        uid: "bind-task",
        commandRef: "cmd-task",
        targetClass: "ems__Task",
      });
    });

    // PARITY proof — given ONLY the declared leaf class (no caller-side
    // pre-expansion, as CLI `apply` would supply), the resolver itself must
    // walk the superClass chain and surface the Task-targeted binding.
    it("inherits a superclass-targeted binding when given ONLY the leaf class (symbolic)", async () => {
      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toContain("bind-task");
    });

    it("inherits when given ONLY the leaf class in UID-canon form (UUID-ref case)", async () => {
      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        MEETING_UID,
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toContain("bind-task");
    });

    it("does NOT inherit targetPrototype bindings via the class chain", async () => {
      // targetPrototype is NOT a class capability — it matches by prototype
      // IRI, so an ancestor's prototype binding must not leak onto a subclass
      // instance that does not declare that prototype.
      await addCommand(store, "cmd-proto", "Proto Command");
      await addBinding(store, {
        uid: "bind-proto",
        commandRef: "cmd-proto",
        targetPrototype: "ems__TaskPrototype",
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toContain("bind-task");
      expect(ids).not.toContain("bind-proto");
    });
  });

  describe("nearest-wins depth ordering (priority, depth, order)", () => {
    beforeEach(async () => {
      await addCommand(store, "cmd-meeting", "Meeting Command");
      await addCommand(store, "cmd-task", "Task Command");
      await addCommand(store, "cmd-univ", "Universal Command");
      // All same order so depth alone decides ordering.
      await addBinding(store, {
        uid: "bind-meeting",
        commandRef: "cmd-meeting",
        targetClass: "ems__Meeting",
        order: 100,
      });
      await addBinding(store, {
        uid: "bind-task",
        commandRef: "cmd-task",
        targetClass: "ems__Task",
        order: 100,
      });
      await addBinding(store, {
        uid: "bind-univ",
        commandRef: "cmd-univ",
        targetClass: "exo__Asset",
        order: 100,
      });
    });

    it("orders nearer ancestor before farther ancestor (nearer class higher)", async () => {
      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toEqual(["bind-meeting", "bind-task", "bind-univ"]);
    });

    it("is robust to caller pre-expansion (depth derived from hierarchy, not input position)", async () => {
      // The plugin caller historically pre-expands the class array. Passing
      // the fully-expanded chain must still yield the SAME nearest-wins order —
      // depth is computed from the class hierarchy via true-leaf detection,
      // not from the input array position.
      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        MEETING_UID,
        "ems__Meeting",
        "ems__Task",
        "ems__Effort",
        "exo__Asset",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toEqual(["bind-meeting", "bind-task", "bind-univ"]);
    });

    it("breaks ties between same-depth class bindings by order", async () => {
      await addCommand(store, "cmd-meeting-2", "Meeting Command 2");
      await addBinding(store, {
        uid: "bind-meeting-2",
        commandRef: "cmd-meeting-2",
        targetClass: "ems__Meeting",
        order: 5,
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      // Both Meeting bindings (depth 0); order 5 precedes order 100.
      expect(ids.indexOf("bind-meeting-2")).toBeLessThan(
        ids.indexOf("bind-meeting"),
      );
      // Then Task (depth 1), then Universal (depth ≥3).
      expect(ids.indexOf("bind-meeting")).toBeLessThan(
        ids.indexOf("bind-task"),
      );
      expect(ids.indexOf("bind-task")).toBeLessThan(ids.indexOf("bind-univ"));
    });

    it("keeps targetAsset/targetPrototype priority ahead of class depth", async () => {
      await addCommand(store, "cmd-asset", "Asset-specific Command");
      await addBinding(store, {
        uid: "bind-asset",
        commandRef: "cmd-asset",
        targetAsset: MEETING_ASSET_IRI,
        order: 999,
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      // targetAsset (priority 0) wins regardless of its high order / class depth.
      expect(resolved[0].binding.id).toBe("bind-asset");
    });
  });

  describe("overrides — absolute, post-BFS, fail-open", () => {
    beforeEach(async () => {
      await addCommand(store, "cmd-task", "Task Command");
      await addCommand(store, "cmd-univ", "Universal Command");
      await addBinding(store, {
        uid: "bind-task",
        commandRef: "cmd-task",
        targetClass: "ems__Task",
      });
      await addBinding(store, {
        uid: "bind-univ",
        commandRef: "cmd-univ",
        targetClass: "exo__Asset",
      });
    });

    it("removes an inherited binding when a subclass binding overrides it (absolute)", async () => {
      // A Meeting-level binding overrides the inherited Task binding.
      await addCommand(store, "cmd-meeting", "Meeting Command");
      await addBinding(store, {
        uid: "bind-meeting",
        commandRef: "cmd-meeting",
        targetClass: "ems__Meeting",
        overrides: ["bind-task"],
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toContain("bind-meeting");
      expect(ids).not.toContain("bind-task"); // overridden absolutely
      expect(ids).toContain("bind-univ"); // unrelated binding survives
    });

    it("override is absolute regardless of ancestor distance (overrides a universal-root binding)", async () => {
      await addCommand(store, "cmd-meeting", "Meeting Command");
      await addBinding(store, {
        uid: "bind-meeting",
        commandRef: "cmd-meeting",
        targetClass: "ems__Meeting",
        overrides: ["bind-univ"], // the most-distant (universal) binding
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).not.toContain("bind-univ");
      expect(ids).toContain("bind-task");
      expect(ids).toContain("bind-meeting");
    });

    it("resolves transitive override chains (A overrides B overrides C → B and C removed)", async () => {
      await addCommand(store, "cmd-meeting", "Meeting Command");
      // bind-meeting (A) overrides bind-task (B); bind-task (B) overrides bind-univ (C).
      // Edges are collected across the whole expanded set before removal, so
      // both B and C are removed; A survives.
      await addBinding(store, {
        uid: "bind-meeting",
        commandRef: "cmd-meeting",
        targetClass: "ems__Meeting",
        overrides: ["bind-task"],
      });
      await addBinding(store, {
        uid: "bind-task",
        commandRef: "cmd-task",
        targetClass: "ems__Task",
        overrides: ["bind-univ"],
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toEqual(["bind-meeting"]);
    });

    it("is fail-open on a dangling overrides ref (ignored, no crash, siblings intact)", async () => {
      await addCommand(store, "cmd-meeting", "Meeting Command");
      await addBinding(store, {
        uid: "bind-meeting",
        commandRef: "cmd-meeting",
        targetClass: "ems__Meeting",
        overrides: ["00000000-0000-0000-0000-000000000000"], // no such binding
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      // Dangling ref is a no-op — every legitimate binding survives.
      expect(ids).toEqual(
        expect.arrayContaining(["bind-meeting", "bind-task", "bind-univ"]),
      );
    });

    it("dedupes override across multi-class ancestor sets (override target removed once)", async () => {
      // Asset declares two classes; the override edge appears via one class
      // path but must remove the target from the merged set regardless.
      await addCommand(store, "cmd-meeting", "Meeting Command");
      await addBinding(store, {
        uid: "bind-meeting",
        commandRef: "cmd-meeting",
        targetClass: "ems__Meeting",
        overrides: ["bind-univ"],
      });

      const resolved = await resolver.resolveForAssetMulti(MEETING_ASSET_IRI, [
        "ems__Meeting",
        "ems__Task",
      ]);

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids.filter((id) => id === "bind-univ")).toHaveLength(0);
      expect(ids.filter((id) => id === "bind-task")).toHaveLength(1); // deduped, surviving
    });
  });

  describe("universal-root guard", () => {
    it("matches an exo__Asset-targeted binding for a root-concept leaf whose chain omits exo__Asset", async () => {
      // A root concept class with NO superClass to exo__Asset.
      const rootStore = new InMemoryTripleStore();
      const rootUid = "c0ffee00-0000-0000-0000-000000000001";
      await rootStore.addAll([
        new Triple(
          classFileIRI(rootUid),
          Namespace.EXO.term("Asset_uid"),
          new Literal(rootUid),
        ),
        new Triple(
          classFileIRI(rootUid),
          Namespace.EXO.term("Asset_label"),
          new Literal("ims__Concept"),
        ),
        // intentionally no Class_superClass — chain does NOT reach exo__Asset
      ]);
      const rootResolver = new CommandResolver(rootStore);
      await addCommand(rootStore, "cmd-univ", "Universal Command");
      await addBinding(rootStore, {
        uid: "bind-univ",
        commandRef: "cmd-univ",
        targetClass: "exo__Asset",
      });

      const resolved = await rootResolver.resolveForAssetMulti(
        "obsidian://vault/03 Knowledge/concept-instance.md",
        ["ims__Concept"],
      );

      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids).toContain("bind-univ"); // universal guard kept it matching
    });
  });

  describe("cycle safety at resolveForAssetMulti level", () => {
    it("terminates on a cyclic superClass chain", async () => {
      const cycleStore = new InMemoryTripleStore();
      const aUid = "aaaaaaaa-0000-0000-0000-000000000000";
      const bUid = "bbbbbbbb-0000-0000-0000-000000000000";
      await seedClass(cycleStore, {
        uid: aUid,
        label: "ems__CycleA",
        superClassLabel: "ems__CycleB",
      });
      await seedClass(cycleStore, {
        uid: bUid,
        label: "ems__CycleB",
        superClassLabel: "ems__CycleA",
      });
      const cycleResolver = new CommandResolver(cycleStore);
      await addCommand(cycleStore, "cmd-b", "B Command");
      await addBinding(cycleStore, {
        uid: "bind-b",
        commandRef: "cmd-b",
        targetClass: "ems__CycleB",
      });

      const resolved = await cycleResolver.resolveForAssetMulti(
        "obsidian://vault/03 Knowledge/cycle-instance.md",
        ["ems__CycleA"],
      );

      // No infinite loop; the CycleB binding is inherited exactly once.
      const ids = resolved.map((rc) => rc.binding.id);
      expect(ids.filter((id) => id === "bind-b")).toHaveLength(1);
    });

    it("keeps cyclic-chain class bindings on the PLUGIN pre-expanded shape (advisor round-2)", async () => {
      // Advisor round-2 regression: under a malformed cycle (A ⊑ B ⊑ A) the
      // plugin caller pre-expands to BOTH classes (each is the other's
      // ancestor). A naive true-leaf detection demotes both → nothing is
      // seeded → all class bindings silently vanish (only the universal-root
      // binding survives). The cycle-aware guard keeps both as leaves so the
      // bare-leaf ↔ pre-expanded invariant holds.
      const cycleStore = new InMemoryTripleStore();
      const aUid = "aaaaaaaa-0000-0000-0000-000000000000";
      const bUid = "bbbbbbbb-0000-0000-0000-000000000000";
      await seedClass(cycleStore, {
        uid: aUid,
        label: "ems__CycleA",
        superClassLabel: "ems__CycleB",
      });
      await seedClass(cycleStore, {
        uid: bUid,
        label: "ems__CycleB",
        superClassLabel: "ems__CycleA",
      });
      const cycleResolver = new CommandResolver(cycleStore);
      await addCommand(cycleStore, "cmd-a", "A Command");
      await addCommand(cycleStore, "cmd-b", "B Command");
      await addCommand(cycleStore, "cmd-univ", "Universal Command");
      await addBinding(cycleStore, {
        uid: "bind-a",
        commandRef: "cmd-a",
        targetClass: "ems__CycleA",
      });
      await addBinding(cycleStore, {
        uid: "bind-b",
        commandRef: "cmd-b",
        targetClass: "ems__CycleB",
      });
      await addBinding(cycleStore, {
        uid: "bind-univ",
        commandRef: "cmd-univ",
        targetClass: "exo__Asset",
      });

      // Plugin-shape: both cyclic classes (+ UID forms) + universal root.
      const resolved = await cycleResolver.resolveForAssetMulti(
        "obsidian://vault/03 Knowledge/cycle-instance.md",
        ["ems__CycleA", "ems__CycleB", aUid, bUid, "exo__Asset"],
      );

      const ids = resolved.map((rc) => rc.binding.id);
      // All class bindings present (not just the universal-root rescue).
      expect(ids).toEqual(
        expect.arrayContaining(["bind-a", "bind-b", "bind-univ"]),
      );
    });
  });
});
