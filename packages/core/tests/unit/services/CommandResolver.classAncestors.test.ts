/**
 * Unit tests for {@link CommandResolver.getClassAncestors} — Issue #3295.
 *
 * Verifies that the new public method walks `exo__Class_superClass` chain
 * across a real triple store seeded with class TBox in production shape
 * (per `~/dotfiles/.claude/rules/test-fixture-realism.md`):
 *
 *   - Subject = file IRI (`obsidian://vault/.../<uid>.md`)
 *   - Predicate = `Namespace.EXO.term("Class_superClass")`
 *   - Object = namespace IRI for label-resolvable classes
 *     (`https://exocortex.my/ontology/<prefix>#<Local>`),
 *     matching `NoteToRDFConverter.valueToRDFObject` output (#2782 path).
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const MEETING_UID = "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca";
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const EFFORT_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const ASSET_UID = "493c2ae2-de56-47ec-954d-2eb8cb49bff7";

interface ClassFixture {
  uid: string;
  label: string;
  superClassLabel?: string;
}

/**
 * Seed a TBox class file mirroring real on-disk vault shape:
 *
 *   - `Asset_uid`, `Asset_label` triples
 *   - When `superClassLabel` is set, emit `Class_superClass` triple
 *     with the parent's namespace IRI (matching what
 *     `valueToRDFObject` emits for `"[[<parent-uid>]]"` after the #2782
 *     class-IRI substitution that round-trips through `Asset_label`).
 */
async function seedClass(
  store: InMemoryTripleStore,
  fixture: ClassFixture,
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/assetspaces/ems/${fixture.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(fixture.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(fixture.label)),
  ];

  if (fixture.superClassLabel) {
    const parentNamespaceIRI = expandClassLabel(fixture.superClassLabel);
    if (parentNamespaceIRI) {
      triples.push(
        new Triple(
          subject,
          Namespace.EXO.term("Class_superClass"),
          parentNamespaceIRI,
        ),
      );
    }
  }

  await store.addAll(triples);
  return subject;
}

function expandClassLabel(label: string): IRI | null {
  const parsed = Namespace.fromPropertyKey(label);
  if (!parsed) return null;
  return parsed.namespace.term(parsed.localName);
}

describe("CommandResolver.getClassAncestors — Issue #3295", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
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
    resolver = new CommandResolver(store);
  });

  describe("symbolic input — ems__Meeting", () => {
    it("returns the full transitive ancestor chain in both symbolic and UID form", async () => {
      const ancestors = await resolver.getClassAncestors("ems__Meeting");

      expect(ancestors).toEqual(
        expect.arrayContaining([
          "ems__Task",
          TASK_UID,
          "ems__Effort",
          EFFORT_UID,
          "exo__Asset",
          ASSET_UID,
        ]),
      );
    });

    it("does NOT include the input class itself", async () => {
      const ancestors = await resolver.getClassAncestors("ems__Meeting");

      expect(ancestors).not.toContain("ems__Meeting");
      expect(ancestors).not.toContain(MEETING_UID);
    });

    it("deduplicates entries (no double-emission across diamond paths)", async () => {
      const ancestors = await resolver.getClassAncestors("ems__Meeting");
      const unique = new Set(ancestors);

      expect(ancestors.length).toBe(unique.size);
    });
  });

  describe("UID input — accepts UID-canon class refs identically", () => {
    it("returns the same ancestor chain whether input is symbolic or UID", async () => {
      const fromSymbolic = await resolver.getClassAncestors("ems__Meeting");
      const fromUid = await resolver.getClassAncestors(MEETING_UID);

      expect(new Set(fromUid)).toEqual(new Set(fromSymbolic));
    });
  });

  describe("graceful fallback", () => {
    it("returns [] when the class is unknown to the store", async () => {
      const ancestors = await resolver.getClassAncestors("nonexistent__Class");

      expect(ancestors).toEqual([]);
    });

    it("returns [] when called with an unknown UID", async () => {
      const ancestors = await resolver.getClassAncestors(
        "00000000-0000-0000-0000-000000000000",
      );

      expect(ancestors).toEqual([]);
    });
  });

  describe("file-IRI parent — Issue #3242 fallback path", () => {
    /**
     * When a class has no namespace-derivable label (e.g. UUID-named
     * class file with non-prefixed `exo__Asset_label`), `valueToRDFObject`
     * emits the file IRI as the `Class_superClass` object instead of a
     * namespace IRI. The BFS must accept this form, extract the UID,
     * and walk further. Production reference:
     * `NoteToRDFConverter.ts:1463-1483`.
     */
    it("walks through parents emitted as file IRI (label-less class)", async () => {
      const fileIriStore = new InMemoryTripleStore();
      const childUid = "11111111-2222-3333-4444-555555555555";
      const parentUid = "66666666-7777-8888-9999-aaaaaaaaaaaa";
      const grandparentUid = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

      const childIRI = new IRI(
        `obsidian://vault/assetspaces/custom/${childUid}.md`,
      );
      const parentIRI = new IRI(
        `obsidian://vault/assetspaces/custom/${parentUid}.md`,
      );
      const grandparentIRI = new IRI(
        `obsidian://vault/assetspaces/custom/${grandparentUid}.md`,
      );

      await fileIriStore.addAll([
        new Triple(childIRI, Namespace.EXO.term("Asset_uid"), new Literal(childUid)),
        new Triple(childIRI, Namespace.EXO.term("Asset_label"), new Literal("custom__Child")),
        new Triple(childIRI, Namespace.EXO.term("Class_superClass"), parentIRI),
        // Parent — non-prefix label, emitted as file IRI (#3242 path)
        new Triple(parentIRI, Namespace.EXO.term("Asset_uid"), new Literal(parentUid)),
        new Triple(parentIRI, Namespace.EXO.term("Asset_label"), new Literal("Some Unprefixed Label")),
        new Triple(parentIRI, Namespace.EXO.term("Class_superClass"), grandparentIRI),
        // Grandparent — same shape, terminal
        new Triple(grandparentIRI, Namespace.EXO.term("Asset_uid"), new Literal(grandparentUid)),
        new Triple(grandparentIRI, Namespace.EXO.term("Asset_label"), new Literal("Root Label")),
      ]);

      const fileIriResolver = new CommandResolver(fileIriStore);
      const ancestors = await fileIriResolver.getClassAncestors("custom__Child");

      // Both intermediate hops must surface in UID form so caller
      // arrays with UID-canon bindings still match transitively.
      expect(ancestors).toEqual(
        expect.arrayContaining([parentUid, grandparentUid]),
      );
    });
  });

  describe("memoization — Issue #3295 perf mitigation", () => {
    it("caches ancestor chain per classRef across repeat calls", async () => {
      const matchSpy = jest.spyOn(store, "match");
      const before = matchSpy.mock.calls.length;

      const first = await resolver.getClassAncestors("ems__Meeting");
      const callsAfterFirst = matchSpy.mock.calls.length;
      const second = await resolver.getClassAncestors("ems__Meeting");
      const callsAfterSecond = matchSpy.mock.calls.length;

      expect(second).toEqual(first);
      expect(callsAfterSecond).toBe(callsAfterFirst);
      expect(callsAfterFirst).toBeGreaterThan(before);

      matchSpy.mockRestore();
    });

    it("invalidateCache clears the ancestor cache", async () => {
      await resolver.getClassAncestors("ems__Meeting");

      const matchSpy = jest.spyOn(store, "match");
      resolver.invalidateCache();
      await resolver.getClassAncestors("ems__Meeting");

      expect(matchSpy.mock.calls.length).toBeGreaterThan(0);

      matchSpy.mockRestore();
    });

    /**
     * Cold-start lock-in regression — Issue #3295 advisor catch.
     *
     * If the negative result (`[]` from unresolvable classRef) were
     * cached, the very-first render during cold-start would lock in
     * the broken empty chain until `invalidateCache()` fires from the
     * eager-init reindex hook. We deliberately skip caching in that
     * branch so a subsequent call (after `LazyAssetGraphLoader` has
     * loaded the class file) recomputes the real chain.
     */
    it("does NOT cache the empty result when the class file is not yet in the store", async () => {
      const coldStartStore = new InMemoryTripleStore();
      const coldResolver = new CommandResolver(coldStartStore);

      const first = await coldResolver.getClassAncestors("ems__Meeting");
      expect(first).toEqual([]);

      // Simulate `LazyAssetGraphLoader` populating TBox AFTER the
      // first failed lookup but BEFORE `invalidateCache()` fires.
      await seedClass(coldStartStore, { uid: ASSET_UID, label: "exo__Asset" });
      await seedClass(coldStartStore, {
        uid: EFFORT_UID,
        label: "ems__Effort",
        superClassLabel: "exo__Asset",
      });
      await seedClass(coldStartStore, {
        uid: TASK_UID,
        label: "ems__Task",
        superClassLabel: "ems__Effort",
      });
      await seedClass(coldStartStore, {
        uid: MEETING_UID,
        label: "ems__Meeting",
        superClassLabel: "ems__Task",
      });

      const second = await coldResolver.getClassAncestors("ems__Meeting");
      expect(second).toEqual(
        expect.arrayContaining(["ems__Task", "ems__Effort", "exo__Asset"]),
      );
    });
  });

  describe("diamond inheritance — multi-parent leaves (e.g. ems__MeetingPrototype)", () => {
    /**
     * Real vault example: `ems__MeetingPrototype` (UID `7ab483c7-...`)
     * declares three direct superclasses simultaneously. The BFS must
     * walk each in turn and dedupe the shared root.
     */
    it("walks every direct parent and dedupes a shared grandparent", async () => {
      const diamondStore = new InMemoryTripleStore();
      const leafUid = "10000000-0000-0000-0000-000000000001";
      const parentAUid = "20000000-0000-0000-0000-000000000002";
      const parentBUid = "20000000-0000-0000-0000-000000000003";
      const sharedRootUid = "30000000-0000-0000-0000-000000000004";

      // Both parents share a grandparent — the dedup test.
      await seedClass(diamondStore, {
        uid: sharedRootUid,
        label: "ems__SharedRoot",
      });
      await seedClass(diamondStore, {
        uid: parentAUid,
        label: "ems__ParentA",
        superClassLabel: "ems__SharedRoot",
      });
      await seedClass(diamondStore, {
        uid: parentBUid,
        label: "ems__ParentB",
        superClassLabel: "ems__SharedRoot",
      });
      // Leaf declares both A and B as direct parents.
      const leafIRI = new IRI(`obsidian://vault/assetspaces/ems/${leafUid}.md`);
      await diamondStore.addAll([
        new Triple(leafIRI, Namespace.EXO.term("Asset_uid"), new Literal(leafUid)),
        new Triple(leafIRI, Namespace.EXO.term("Asset_label"), new Literal("ems__DiamondLeaf")),
        new Triple(
          leafIRI,
          Namespace.EXO.term("Class_superClass"),
          expandClassLabel("ems__ParentA")!,
        ),
        new Triple(
          leafIRI,
          Namespace.EXO.term("Class_superClass"),
          expandClassLabel("ems__ParentB")!,
        ),
      ]);

      const diamondResolver = new CommandResolver(diamondStore);
      const ancestors = await diamondResolver.getClassAncestors("ems__DiamondLeaf");

      expect(ancestors).toEqual(
        expect.arrayContaining([
          "ems__ParentA",
          parentAUid,
          "ems__ParentB",
          parentBUid,
          "ems__SharedRoot",
          sharedRootUid,
        ]),
      );
      // Dedup invariant: shared root surfaces exactly once.
      const sharedRootCount = ancestors.filter(
        (a) => a === "ems__SharedRoot",
      ).length;
      expect(sharedRootCount).toBe(1);
    });
  });

  describe("cycle safety — Issue #3295 risk mitigation", () => {
    it("terminates on a cyclic superClass chain (A ⊑ B ⊑ A)", async () => {
      const cycleStore = new InMemoryTripleStore();
      const aUid = "aaaaaaaa-0000-0000-0000-000000000000";
      const bUid = "bbbbbbbb-0000-0000-0000-000000000000";

      await seedClass(cycleStore, { uid: aUid, label: "ems__CycleA", superClassLabel: "ems__CycleB" });
      await seedClass(cycleStore, { uid: bUid, label: "ems__CycleB", superClassLabel: "ems__CycleA" });

      const cycleResolver = new CommandResolver(cycleStore);
      const ancestors = await cycleResolver.getClassAncestors("ems__CycleA");

      // BFS halts via the visited set; only ems__CycleB (and its UID) surface.
      expect(ancestors).toEqual(expect.arrayContaining(["ems__CycleB", bUid]));
      expect(ancestors).not.toContain("ems__CycleA");
    });
  });
});
