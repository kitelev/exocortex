import { PrototypeChainMaterializer, INFERRED_GRAPH, MAX_PROTOTYPE_DEPTH } from "../../../src/services/PrototypeChainMaterializer";
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

    it("should handle A → B → A cycle (BFS visited set stops traversal)", async () => {
      // A → B, B → A
      await store.add(new Triple(cycleA, prototype, cycleB));
      await store.add(new Triple(cycleB, prototype, cycleA));

      // B has an inheritable property
      await store.add(new Triple(cycleB, effortArea, healthArea));
      // A has an inheritable property
      await store.add(new Triple(cycleA, effortTimeEstimate, new Literal("30")));

      const count = await materializer.materialize(store);

      // Multi-hop with cycle detection: A inherits area from B, B inherits timeEstimate from A
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

  describe("multi-hop prototype chain", () => {
    const metaProto = new IRI("obsidian://vault/MetaPrototype.md");
    const effortParent = Namespace.EMS.term("Effort_parent");
    const effortPriority = Namespace.EMS.term("Effort_priority");

    it("should inherit from depth-2 chain (instance → proto → meta-proto)", async () => {
      // Chain: breakfastInstance → breakfastProto → morningProto
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastProto, prototype, morningProto));

      // breakfastProto has area (inheritable)
      await store.add(new Triple(breakfastProto, effortArea, healthArea));

      // morningProto has parent (inheritable) — only reachable via multi-hop
      const routineArea = new IRI("obsidian://vault/Routine.md");
      await store.add(new Triple(morningProto, effortParent, routineArea));

      const count = await materializer.materialize(store);

      // Instance gets: area from proto (depth 1) + parent from meta-proto (depth 2)
      expect(count).toBeGreaterThanOrEqual(2);

      const areaTriples = await store.match(breakfastInstance, effortArea, undefined);
      expect(areaTriples.length).toBe(1);
      expect(areaTriples[0].object).toEqual(healthArea);

      const parentTriples = await store.match(breakfastInstance, effortParent, undefined);
      expect(parentTriples.length).toBe(1);
      expect(parentTriples[0].object).toEqual(routineArea);
    });

    it("should inherit from depth-3 chain", async () => {
      // Chain: breakfastInstance → breakfastProto → morningProto → metaProto
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastProto, prototype, morningProto));
      await store.add(new Triple(morningProto, prototype, metaProto));

      // Each level has a unique inheritable property
      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      const routineParent = new IRI("obsidian://vault/Routine.md");
      await store.add(new Triple(morningProto, effortParent, routineParent));
      await store.add(new Triple(metaProto, effortPriority, new Literal("high")));

      const count = await materializer.materialize(store);

      // Instance gets all 3 properties from chain
      const areaTriples = await store.match(breakfastInstance, effortArea, undefined);
      expect(areaTriples.length).toBe(1);

      const parentTriples = await store.match(breakfastInstance, effortParent, undefined);
      expect(parentTriples.length).toBe(1);

      const priorityTriples = await store.match(breakfastInstance, effortPriority, undefined);
      expect(priorityTriples.length).toBe(1);
      expect((priorityTriples[0].object as Literal).value).toBe("high");
    });

    it("should apply closest-wins: nearer prototype property takes priority", async () => {
      // Chain: breakfastInstance → breakfastProto → morningProto
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastProto, prototype, morningProto));

      // Both prototypes define area — closest (breakfastProto) should win
      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      const fitnessArea = new IRI("obsidian://vault/Fitness.md");
      await store.add(new Triple(morningProto, effortArea, fitnessArea));

      // morningProto also has parent (unique to depth 2)
      const routineParent = new IRI("obsidian://vault/Routine.md");
      await store.add(new Triple(morningProto, effortParent, routineParent));

      const count = await materializer.materialize(store);

      // area = Health (from breakfastProto, closer), NOT Fitness (from morningProto)
      const areaTriples = await store.match(breakfastInstance, effortArea, undefined);
      expect(areaTriples.length).toBe(1);
      expect(areaTriples[0].object).toEqual(healthArea);

      // parent = Routine (only from morningProto)
      const parentTriples = await store.match(breakfastInstance, effortParent, undefined);
      expect(parentTriples.length).toBe(1);
      expect(parentTriples[0].object).toEqual(routineParent);
    });

    it("should detect cycle at depth-2 and stop traversal", async () => {
      // Chain: breakfastInstance → breakfastProto → morningProto → breakfastProto (cycle!)
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastProto, prototype, morningProto));
      await store.add(new Triple(morningProto, prototype, breakfastProto)); // cycle

      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      const routineParent = new IRI("obsidian://vault/Routine.md");
      await store.add(new Triple(morningProto, effortParent, routineParent));

      const count = await materializer.materialize(store);

      // Instance should still get area (depth 1) and parent (depth 2)
      // Cycle at depth 3 is detected and traversal stops
      const areaTriples = await store.match(breakfastInstance, effortArea, undefined);
      expect(areaTriples.length).toBe(1);

      const parentTriples = await store.match(breakfastInstance, effortParent, undefined);
      expect(parentTriples.length).toBe(1);
    });

    it("should stop at MAX_PROTOTYPE_DEPTH", async () => {
      // Build a chain of MAX_PROTOTYPE_DEPTH + 2 prototypes
      const chainLength = MAX_PROTOTYPE_DEPTH + 2;
      const protos: IRI[] = [];
      for (let i = 0; i < chainLength; i++) {
        protos.push(new IRI(`obsidian://vault/Proto${i}.md`));
      }

      const instance = new IRI("obsidian://vault/DeepInstance.md");

      // instance → proto0 → proto1 → ... → protoN
      await store.add(new Triple(instance, prototype, protos[0]));
      for (let i = 0; i < chainLength - 1; i++) {
        await store.add(new Triple(protos[i], prototype, protos[i + 1]));
      }

      // Each proto has a unique inheritable property
      for (let i = 0; i < chainLength; i++) {
        const propIRI = new IRI(`obsidian://vault/Value${i}.md`);
        await store.add(new Triple(protos[i], effortArea, propIRI));
      }

      // Only proto0's area should be inherited (closest wins for same predicate)
      // But let's give each proto a unique predicate to test depth limit
      for (let i = 0; i < chainLength; i++) {
        await store.add(
          new Triple(protos[i], effortTimeEstimate, new Literal(`${(i + 1) * 10}`)),
        );
      }

      const count = await materializer.materialize(store);

      // For the deep instance:
      // - effortArea: only proto0's value (closest wins, all protos have it)
      // - effortTimeEstimate: only proto0's value (closest wins, all protos have it)
      // So instance gets 2 properties, but from depth 1 only (closest wins)
      // The depth limit applies to chain resolution, not property count
      const areaTriples = await store.match(instance, effortArea, undefined);
      expect(areaTriples.length).toBe(1);
      expect(areaTriples[0].object).toEqual(new IRI("obsidian://vault/Value0.md"));

      // Verify chain was capped: proto at depth MAX_PROTOTYPE_DEPTH+1 should NOT be reachable
      // To test this, let's add a unique property ONLY at the beyond-depth proto
      const beyondPredicate = Namespace.EMS.term("Effort_parent");
      const beyondValue = new IRI("obsidian://vault/BeyondDepth.md");
      await store.add(new Triple(protos[chainLength - 1], beyondPredicate, beyondValue));

      // Re-run on fresh store to test depth limit with unique property at max+1
      const store2 = new InMemoryTripleStore();

      // Rebuild chain in fresh store
      const instance2 = new IRI("obsidian://vault/DeepInstance2.md");
      const freshProtos: IRI[] = [];
      for (let i = 0; i <= MAX_PROTOTYPE_DEPTH + 1; i++) {
        freshProtos.push(new IRI(`obsidian://vault/FreshProto${i}.md`));
      }

      await store2.add(new Triple(instance2, prototype, freshProtos[0]));
      for (let i = 0; i < freshProtos.length - 1; i++) {
        await store2.add(new Triple(freshProtos[i], prototype, freshProtos[i + 1]));
      }

      // Only the proto beyond MAX_DEPTH has the unique property
      await store2.add(
        new Triple(freshProtos[MAX_PROTOTYPE_DEPTH + 1], effortParent, beyondValue),
      );
      // Give protos within depth a different property
      await store2.add(new Triple(freshProtos[0], effortArea, healthArea));

      const materializer2 = new PrototypeChainMaterializer(registry);
      await materializer2.materialize(store2);

      // Instance should have area from proto0 (within depth)
      const areaResult = await store2.match(instance2, effortArea, undefined);
      expect(areaResult.length).toBe(1);

      // Instance should NOT have parent from beyond-depth proto
      const parentResult = await store2.match(instance2, effortParent, undefined);
      expect(parentResult.length).toBe(0);
    });

    it("should add multi-hop materialized triples to named graph", async () => {
      // Chain: breakfastInstance → breakfastProto → morningProto
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastProto, prototype, morningProto));

      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      const routineParent = new IRI("obsidian://vault/Routine.md");
      await store.add(new Triple(morningProto, effortParent, routineParent));

      await materializer.materialize(store);

      // Both depth-1 and depth-2 triples should be in named graph
      const namedArea = await store.matchInGraph!(
        breakfastInstance,
        effortArea,
        undefined,
        INFERRED_GRAPH,
      );
      expect(namedArea.length).toBe(1);

      const namedParent = await store.matchInGraph!(
        breakfastInstance,
        effortParent,
        undefined,
        INFERRED_GRAPH,
      );
      expect(namedParent.length).toBe(1);
    });
  });

  describe("MAX_PROTOTYPE_DEPTH constant", () => {
    it("should be exported and equal to 10", () => {
      expect(MAX_PROTOTYPE_DEPTH).toBe(10);
    });
  });
});
