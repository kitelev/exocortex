import { PrototypeChainMaterializer, INFERRED_GRAPH } from "../../../src/services/PrototypeChainMaterializer";
import { NonInheritablePropertyRegistry } from "../../../src/services/NonInheritablePropertyRegistry";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("PrototypeChainMaterializer", () => {
  let materializer: PrototypeChainMaterializer;
  let registry: NonInheritablePropertyRegistry;
  let store: InMemoryTripleStore;

  // Predicates
  const prototype = Namespace.EXO.term("Asset_prototype");
  const instanceClass = Namespace.EXO.term("Instance_class");
  const assetLabel = Namespace.EXO.term("Asset_label");
  const assetUid = Namespace.EXO.term("Asset_uid");
  const effortArea = Namespace.EMS.term("Effort_area");
  const effortTimeEstimate = Namespace.EMS.term("Effort_timeEstimateMinutes");
  const effortStatus = Namespace.EMS.term("Effort_status");
  const effortStartTimestamp = Namespace.EMS.term("Effort_startTimestamp");

  // Subjects
  const breakfastProto = new IRI("obsidian://vault/Breakfast.md");
  const breakfastInstance = new IRI("obsidian://vault/Breakfast-2026-04-05.md");
  const morningProto = new IRI("obsidian://vault/MorningRoutine.md");
  const cycleA = new IRI("obsidian://vault/CycleA.md");
  const cycleB = new IRI("obsidian://vault/CycleB.md");

  // NonInheritableProperty class (for registry setup)
  const nonInheritableClassIRI = new IRI(
    "obsidian://vault/exo__NonInheritableProperty.md",
  );

  // Values
  const healthArea = new IRI("obsidian://vault/Health.md");
  const backlogStatus = new IRI("obsidian://vault/Backlog.md");
  const taskClass = new IRI("https://exocortex.my/ontology/ems#Task");

  async function setupRegistry(nonInheritableProps: string[]): Promise<void> {
    const registryStore = new InMemoryTripleStore();

    // Add NonInheritableProperty class label
    await registryStore.add(
      new Triple(nonInheritableClassIRI, assetLabel, new Literal("exo__NonInheritableProperty")),
    );

    for (const propLabel of nonInheritableProps) {
      const defIRI = new IRI(`obsidian://vault/${propLabel}.md`);
      await registryStore.add(new Triple(defIRI, instanceClass, nonInheritableClassIRI));
      await registryStore.add(new Triple(defIRI, assetLabel, new Literal(propLabel)));
    }

    await registry.initialize(registryStore);
  }

  beforeEach(async () => {
    registry = new NonInheritablePropertyRegistry();
    store = new InMemoryTripleStore();

    // Setup registry with standard non-inheritable properties
    await setupRegistry([
      "exo__Asset_uid",
      "exo__Asset_label",
      "exo__Asset_prototype",
      "ems__Effort_status",
      "ems__Effort_startTimestamp",
    ]);

    materializer = new PrototypeChainMaterializer(registry);
  });

  describe("no prototype", () => {
    it("should return 0 for empty store", async () => {
      const count = await materializer.materialize(store);
      expect(count).toBe(0);
    });

    it("should return 0 when no Asset_prototype triples exist", async () => {
      await store.add(new Triple(breakfastInstance, assetLabel, new Literal("Breakfast")));

      const count = await materializer.materialize(store);
      expect(count).toBe(0);
    });
  });

  describe("single prototype", () => {
    it("should materialize inheritable properties from prototype", async () => {
      // Prototype has: area (inheritable), timeEstimate (inheritable), label (non-inheritable)
      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      await store.add(new Triple(breakfastProto, effortTimeEstimate, new Literal("15")));
      await store.add(new Triple(breakfastProto, assetLabel, new Literal("Breakfast")));
      await store.add(new Triple(breakfastProto, assetUid, new Literal("proto-uid")));

      // Instance links to prototype, has its own label
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastInstance, assetLabel, new Literal("Breakfast 2026-04-05")));
      await store.add(new Triple(breakfastInstance, assetUid, new Literal("instance-uid")));

      const count = await materializer.materialize(store);

      // Should materialize: area + timeEstimate (2 inheritable props)
      // Should NOT materialize: label, uid (non-inheritable)
      expect(count).toBe(2);

      // Verify materialized triples in default graph
      const areaTriples = await store.match(breakfastInstance, effortArea, undefined);
      expect(areaTriples.length).toBe(1);
      expect(areaTriples[0].object).toEqual(healthArea);

      const timeTriples = await store.match(breakfastInstance, effortTimeEstimate, undefined);
      expect(timeTriples.length).toBe(1);
      expect((timeTriples[0].object as Literal).value).toBe("15");

      // Verify non-inheritable label stays original
      const labelTriples = await store.match(breakfastInstance, assetLabel, undefined);
      expect(labelTriples.length).toBe(1);
      expect((labelTriples[0].object as Literal).value).toBe("Breakfast 2026-04-05");
    });

    it("should not overwrite existing own properties", async () => {
      // Prototype has area = Health
      await store.add(new Triple(breakfastProto, effortArea, healthArea));

      // Instance has its own area override
      const vacationArea = new IRI("obsidian://vault/Vacation.md");
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastInstance, effortArea, vacationArea));

      const count = await materializer.materialize(store);

      // Nothing materialized — instance already has area
      expect(count).toBe(0);

      // Own value preserved
      const areaTriples = await store.match(breakfastInstance, effortArea, undefined);
      expect(areaTriples.length).toBe(1);
      expect(areaTriples[0].object).toEqual(vacationArea);
    });

    it("should add materialized triples to named graph", async () => {
      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));

      await materializer.materialize(store);

      // Verify in named graph
      const namedGraphTriples = await store.matchInGraph!(
        breakfastInstance,
        effortArea,
        undefined,
        INFERRED_GRAPH,
      );
      expect(namedGraphTriples.length).toBe(1);
      expect(namedGraphTriples[0].object).toEqual(healthArea);
    });
  });

  describe("non-inheritable properties", () => {
    it("should skip all non-inheritable properties", async () => {
      // Prototype has mix of inheritable and non-inheritable
      await store.add(new Triple(breakfastProto, assetLabel, new Literal("Breakfast")));
      await store.add(new Triple(breakfastProto, assetUid, new Literal("proto-uid")));
      await store.add(new Triple(breakfastProto, effortStatus, backlogStatus));
      await store.add(new Triple(breakfastProto, effortStartTimestamp, new Literal("2026-04-01")));
      await store.add(new Triple(breakfastProto, prototype, morningProto));

      // Instance with only prototype link
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));

      const count = await materializer.materialize(store);

      // All 5 prototype properties are non-inheritable → 0 materialized
      expect(count).toBe(0);
    });
  });

  describe("cycle detection", () => {
    it("should handle self-referencing prototype", async () => {
      // A has prototype → A (self-cycle)
      await store.add(new Triple(cycleA, prototype, cycleA));
      await store.add(new Triple(cycleA, effortArea, healthArea));

      const count = await materializer.materialize(store);

      // Self-cycle is skipped
      expect(count).toBe(0);
    });

    it("should handle A → B → A cycle (single-hop only processes A→B)", async () => {
      // A → B, B → A
      await store.add(new Triple(cycleA, prototype, cycleB));
      await store.add(new Triple(cycleB, prototype, cycleA));

      // B has an inheritable property
      await store.add(new Triple(cycleB, effortArea, healthArea));
      // A has an inheritable property
      await store.add(new Triple(cycleA, effortTimeEstimate, new Literal("30")));

      const count = await materializer.materialize(store);

      // Single-hop: A inherits area from B, B inherits timeEstimate from A
      expect(count).toBe(2);
    });
  });

  describe("multiple instances sharing prototype", () => {
    it("should materialize for each instance independently", async () => {
      const instance2 = new IRI("obsidian://vault/Breakfast-2026-04-06.md");

      // Prototype has area
      await store.add(new Triple(breakfastProto, effortArea, healthArea));

      // Two instances link to same prototype
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(instance2, prototype, breakfastProto));

      const count = await materializer.materialize(store);

      // 1 property × 2 instances = 2
      expect(count).toBe(2);

      const area1 = await store.match(breakfastInstance, effortArea, undefined);
      expect(area1.length).toBe(1);

      const area2 = await store.match(instance2, effortArea, undefined);
      expect(area2.length).toBe(1);
    });
  });
});
