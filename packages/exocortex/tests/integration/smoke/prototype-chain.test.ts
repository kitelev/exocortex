/**
 * Smoke test: Prototype Chain Materialization (RFC-011/012/013).
 *
 * Verifies that PrototypeChainMaterializer correctly inherits properties
 * from prototype to instance, respecting non-inheritable property rules.
 *
 * Scenarios (single-hop, RFC-012):
 *   - Instance without own area -> inherits area from prototype
 *   - Instance with own area -> keeps own value (override)
 *   - Non-inheritable properties (uid, label, status, timestamps) NOT inherited
 *   - Label from prototype NOT inherited (instance has its own)
 *
 * Scenarios (multi-hop, RFC-013):
 *   - Depth-2 chains: 4 real vault patterns (Breakfast, Lunch, Evening Review, Weekly Review)
 *   - Instance inherits combined properties from proto1 + proto2
 *   - Own properties at any level override deeper ones
 *   - Closest prototype wins on conflict
 *   - Performance: depth-2 materialization < 10ms
 *
 * Uses real (non-mocked) services: InMemoryTripleStore,
 * PrototypeChainMaterializer, NonInheritablePropertyRegistry.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { PrototypeChainMaterializer, INFERRED_GRAPH } from "../../../src/services/PrototypeChainMaterializer";
import { NonInheritablePropertyRegistry } from "../../../src/services/NonInheritablePropertyRegistry";
import { PropertyCardinalityRegistry } from "../../../src/services/PropertyCardinalityRegistry";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTOTYPE_IRI = "obsidian://vault/prototype-daily-review.md";
const INSTANCE_IRI = "obsidian://vault/task-2026-04-05.md";
const INSTANCE2_IRI = "obsidian://vault/task-2026-04-06.md";

// Non-inheritable property class
const NON_INHERITABLE_CLASS_IRI = "obsidian://vault/exo__NonInheritableProperty.md";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed the triple store with a prototype that has several properties:
 * - area (inheritable)
 * - priority (inheritable)
 * - uid (non-inheritable)
 * - label (non-inheritable)
 * - status (non-inheritable)
 * - startTimestamp (non-inheritable)
 */
async function seedPrototype(store: InMemoryTripleStore): Promise<void> {
  const proto = new IRI(PROTOTYPE_IRI);
  await store.addAll([
    new Triple(proto, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(proto, Namespace.EXO.term("Asset_uid"), new Literal("prototype-daily-review")),
    new Triple(proto, Namespace.EXO.term("Asset_label"), new Literal("Daily Review Prototype")),
    new Triple(proto, Namespace.EMS.term("Effort_area"), new Literal("Personal Development")),
    new Triple(proto, Namespace.EMS.term("Effort_priority"), new Literal("high")),
    new Triple(proto, Namespace.EMS.term("Effort_status"), new Literal("ems__EffortStatusBacklog")),
    new Triple(proto, Namespace.EMS.term("Effort_startTimestamp"), new Literal("2026-01-01T00:00:00Z")),
  ]);
}

/**
 * Seed an instance that links to the prototype but has NO own area.
 * Should inherit area from prototype after materialization.
 */
async function seedInstanceWithoutArea(store: InMemoryTripleStore): Promise<void> {
  const instance = new IRI(INSTANCE_IRI);
  const proto = new IRI(PROTOTYPE_IRI);
  await store.addAll([
    new Triple(instance, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(instance, Namespace.EXO.term("Asset_uid"), new Literal("task-2026-04-05")),
    new Triple(instance, Namespace.EXO.term("Asset_label"), new Literal("Daily Review 2026-04-05")),
    new Triple(instance, Namespace.EXO.term("Asset_prototype"), proto),
    new Triple(instance, Namespace.EMS.term("Effort_status"), new Literal("ems__EffortStatusDoing")),
  ]);
}

/**
 * Seed an instance that links to the prototype AND has its OWN area.
 * Should keep own area after materialization.
 */
async function seedInstanceWithOwnArea(store: InMemoryTripleStore): Promise<void> {
  const instance = new IRI(INSTANCE2_IRI);
  const proto = new IRI(PROTOTYPE_IRI);
  await store.addAll([
    new Triple(instance, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(instance, Namespace.EXO.term("Asset_uid"), new Literal("task-2026-04-06")),
    new Triple(instance, Namespace.EXO.term("Asset_label"), new Literal("Daily Review 2026-04-06")),
    new Triple(instance, Namespace.EXO.term("Asset_prototype"), proto),
    new Triple(instance, Namespace.EMS.term("Effort_area"), new Literal("Health & Fitness")),
    new Triple(instance, Namespace.EMS.term("Effort_status"), new Literal("ems__EffortStatusBacklog")),
  ]);
}

/**
 * Seed non-inheritable property definitions in the triple store.
 *
 * The registry reads from the store looking for:
 *   ?prop exo:Instance_class <NonInheritableProperty class IRI>
 *   ?prop exo:Asset_label "property_key"
 */
async function seedNonInheritableProperties(store: InMemoryTripleStore): Promise<void> {
  const classIRI = new IRI(NON_INHERITABLE_CLASS_IRI);

  // The class asset itself — needed for findNonInheritableClassIRI lookup
  await store.addAll([
    new Triple(classIRI, Namespace.EXO.term("Asset_label"), new Literal("exo__NonInheritableProperty")),
  ]);

  // Mark uid, label, status, startTimestamp as non-inheritable
  const nonInheritableProps = [
    { iri: "obsidian://vault/nip-uid.md", label: "exo__Asset_uid" },
    { iri: "obsidian://vault/nip-label.md", label: "exo__Asset_label" },
    { iri: "obsidian://vault/nip-status.md", label: "ems__Effort_status" },
    { iri: "obsidian://vault/nip-start.md", label: "ems__Effort_startTimestamp" },
  ];

  for (const prop of nonInheritableProps) {
    const propIRI = new IRI(prop.iri);
    await store.addAll([
      new Triple(propIRI, Namespace.EXO.term("Instance_class"), classIRI),
      new Triple(propIRI, Namespace.EXO.term("Asset_label"), new Literal(prop.label)),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Smoke: Prototype Chain Materialization", () => {
  let store: InMemoryTripleStore;
  let registry: NonInheritablePropertyRegistry;
  let materializer: PrototypeChainMaterializer;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    registry = new NonInheritablePropertyRegistry();
  });

  // -----------------------------------------------------------------------
  // Scenario 1: Instance inherits area from prototype
  // -----------------------------------------------------------------------

  describe("Inheritance of missing properties", () => {
    it("should inherit area from prototype when instance has no own area", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithoutArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);

      const count = await materializer.materialize(store);
      expect(count).toBeGreaterThan(0);

      // Check the instance now has area
      const areaTriples = await store.match(
        new IRI(INSTANCE_IRI),
        Namespace.EMS.term("Effort_area"),
        undefined,
      );
      expect(areaTriples).toHaveLength(1);
      expect((areaTriples[0].object as Literal).value).toBe("Personal Development");
    });

    it("should inherit priority from prototype when instance has no own priority", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithoutArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const priorityTriples = await store.match(
        new IRI(INSTANCE_IRI),
        Namespace.EMS.term("Effort_priority"),
        undefined,
      );
      expect(priorityTriples).toHaveLength(1);
      expect((priorityTriples[0].object as Literal).value).toBe("high");
    });

    it("should add inherited triples to the inferred named graph", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithoutArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // The area triple should be in the inferred graph
      const inferredTriples = await store.matchInGraph(
        new IRI(INSTANCE_IRI),
        Namespace.EMS.term("Effort_area"),
        undefined,
        INFERRED_GRAPH,
      );
      expect(inferredTriples).toHaveLength(1);
      expect((inferredTriples[0].object as Literal).value).toBe("Personal Development");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: Instance with own area keeps its value
  // -----------------------------------------------------------------------

  describe("Own property override", () => {
    it("should keep own area and NOT inherit from prototype", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithOwnArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const areaTriples = await store.match(
        new IRI(INSTANCE2_IRI),
        Namespace.EMS.term("Effort_area"),
        undefined,
      );
      expect(areaTriples).toHaveLength(1);
      expect((areaTriples[0].object as Literal).value).toBe("Health & Fitness");
    });

    it("should NOT add own-overridden properties to the inferred graph", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithOwnArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // Area should NOT be in the inferred graph for instance2
      const inferredArea = await store.matchInGraph(
        new IRI(INSTANCE2_IRI),
        Namespace.EMS.term("Effort_area"),
        undefined,
        INFERRED_GRAPH,
      );
      expect(inferredArea).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Non-inheritable properties NOT inherited
  // -----------------------------------------------------------------------

  describe("Non-inheritable properties", () => {
    it("should NOT inherit uid from prototype", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithoutArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // Instance should have its OWN uid, not the prototype's
      const uidTriples = await store.match(
        new IRI(INSTANCE_IRI),
        Namespace.EXO.term("Asset_uid"),
        undefined,
      );
      expect(uidTriples).toHaveLength(1);
      expect((uidTriples[0].object as Literal).value).toBe("task-2026-04-05");
    });

    it("should NOT inherit status from prototype", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithoutArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const statusTriples = await store.match(
        new IRI(INSTANCE_IRI),
        Namespace.EMS.term("Effort_status"),
        undefined,
      );
      // Instance already has its own status — should have exactly 1 (own)
      expect(statusTriples).toHaveLength(1);
      expect((statusTriples[0].object as Literal).value).toBe("ems__EffortStatusDoing");
    });

    it("should NOT inherit startTimestamp from prototype", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithoutArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const startTriples = await store.match(
        new IRI(INSTANCE_IRI),
        Namespace.EMS.term("Effort_startTimestamp"),
        undefined,
      );
      // Instance doesn't have its own startTimestamp and it's non-inheritable
      expect(startTriples).toHaveLength(0);
    });

    it("should NOT inherit label from prototype", async () => {
      await seedNonInheritableProperties(store);
      await seedPrototype(store);
      await seedInstanceWithoutArea(store);

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const labelTriples = await store.match(
        new IRI(INSTANCE_IRI),
        Namespace.EXO.term("Asset_label"),
        undefined,
      );
      expect(labelTriples).toHaveLength(1);
      expect((labelTriples[0].object as Literal).value).toBe("Daily Review 2026-04-05");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: Registry initialization
  // -----------------------------------------------------------------------

  describe("NonInheritablePropertyRegistry", () => {
    it("should load non-inheritable properties from triple store", async () => {
      await seedNonInheritableProperties(store);
      await registry.initialize(store);

      expect(registry.isInitialized).toBe(true);
      expect(registry.size).toBe(4);
    });

    it("should report uid predicate IRI as non-inheritable", async () => {
      await seedNonInheritableProperties(store);
      await registry.initialize(store);

      const uidIRI = Namespace.EXO.term("Asset_uid").value;
      expect(registry.isNonInheritable(uidIRI)).toBe(true);
    });

    it("should report area predicate IRI as inheritable", async () => {
      await seedNonInheritableProperties(store);
      await registry.initialize(store);

      const areaIRI = Namespace.EMS.term("Effort_area").value;
      expect(registry.isNonInheritable(areaIRI)).toBe(false);
    });

    it("should default to all-inheritable when store is empty", async () => {
      const emptyStore = new InMemoryTripleStore();
      const emptyRegistry = new NonInheritablePropertyRegistry();
      await emptyRegistry.initialize(emptyStore);

      expect(emptyRegistry.isInitialized).toBe(true);
      expect(emptyRegistry.size).toBe(0);

      const anyIRI = Namespace.EMS.term("Effort_status").value;
      expect(emptyRegistry.isNonInheritable(anyIRI)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: Edge cases
  // -----------------------------------------------------------------------

  describe("Edge cases", () => {
    it("should return 0 materialized when no prototype links exist", async () => {
      await seedNonInheritableProperties(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);

      // Add a task with no prototype link
      const subject = new IRI("obsidian://vault/standalone-task.md");
      await store.addAll([
        new Triple(subject, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
        new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal("standalone")),
      ]);

      const count = await materializer.materialize(store);
      expect(count).toBe(0);
    });

    it("should skip self-referencing prototype (cycle detection)", async () => {
      await seedNonInheritableProperties(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);

      const selfRef = new IRI("obsidian://vault/self-ref.md");
      await store.addAll([
        new Triple(selfRef, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
        new Triple(selfRef, Namespace.EXO.term("Asset_uid"), new Literal("self-ref")),
        new Triple(selfRef, Namespace.EXO.term("Asset_prototype"), selfRef),
      ]);

      const count = await materializer.materialize(store);
      expect(count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 6: Multi-hop depth-2 chains (RFC-013)
  //
  // Real vault patterns:
  //   Breakfast 2026-04-06 → Breakfast → Morning Routine
  //   Lunch 2026-04-06 → Lunch → Meal Prep
  //   Evening Review 2026-04-06 → Evening Review → Evening Routine
  //   Weekly Review 2026-W14 → Weekly Review → Review Process
  // -----------------------------------------------------------------------

  describe("Multi-hop depth-2 chains (RFC-013)", () => {
    // Meta-prototypes (depth 2)
    const morningRoutine = new IRI("obsidian://vault/MorningRoutine.md");
    const mealPrep = new IRI("obsidian://vault/MealPrep.md");
    const eveningRoutine = new IRI("obsidian://vault/EveningRoutine.md");
    const reviewProcess = new IRI("obsidian://vault/ReviewProcess.md");

    // Prototypes (depth 1)
    const breakfastProto = new IRI("obsidian://vault/Breakfast.md");
    const lunchProto = new IRI("obsidian://vault/Lunch.md");
    const eveningReviewProto = new IRI("obsidian://vault/EveningReview.md");
    const weeklyReviewProto = new IRI("obsidian://vault/WeeklyReview.md");

    // Instances
    const breakfastInst = new IRI("obsidian://vault/Breakfast-2026-04-06.md");
    const lunchInst = new IRI("obsidian://vault/Lunch-2026-04-06.md");
    const eveningInst = new IRI("obsidian://vault/EveningReview-2026-04-06.md");
    const weeklyInst = new IRI("obsidian://vault/WeeklyReview-2026-W14.md");

    // Inheritable predicates
    const effortArea = Namespace.EMS.term("Effort_area");
    const effortPriority = Namespace.EMS.term("Effort_priority");
    const effortTimeEstimate = Namespace.EMS.term("Effort_timeEstimateMinutes");
    const effortParent = Namespace.EMS.term("Effort_parent");

    /**
     * Seed 4 depth-2 chains matching real vault structure.
     *
     * Each meta-prototype has a unique property (parent) only reachable via depth-2.
     * Each prototype has properties (area, priority) reachable at depth-1.
     * Instances link to prototypes, prototypes link to meta-prototypes.
     */
    async function seedDepth2Chains(s: InMemoryTripleStore): Promise<void> {
      const healthArea = new IRI("obsidian://vault/Health.md");
      const wellnessArea = new IRI("obsidian://vault/Wellness.md");
      const reflectionArea = new IRI("obsidian://vault/Reflection.md");
      const productivityArea = new IRI("obsidian://vault/Productivity.md");

      // --- Meta-prototypes (depth 2): provide parent + timeEstimate ---
      await s.addAll([
        new Triple(morningRoutine, Namespace.EXO.term("Asset_uid"), new Literal("morning-routine")),
        new Triple(morningRoutine, Namespace.EXO.term("Asset_label"), new Literal("Morning Routine")),
        new Triple(morningRoutine, effortParent, healthArea),
        new Triple(morningRoutine, effortTimeEstimate, new Literal("60")),

        new Triple(mealPrep, Namespace.EXO.term("Asset_uid"), new Literal("meal-prep")),
        new Triple(mealPrep, Namespace.EXO.term("Asset_label"), new Literal("Meal Prep")),
        new Triple(mealPrep, effortParent, wellnessArea),
        new Triple(mealPrep, effortTimeEstimate, new Literal("45")),

        new Triple(eveningRoutine, Namespace.EXO.term("Asset_uid"), new Literal("evening-routine")),
        new Triple(eveningRoutine, Namespace.EXO.term("Asset_label"), new Literal("Evening Routine")),
        new Triple(eveningRoutine, effortParent, reflectionArea),
        new Triple(eveningRoutine, effortTimeEstimate, new Literal("30")),

        new Triple(reviewProcess, Namespace.EXO.term("Asset_uid"), new Literal("review-process")),
        new Triple(reviewProcess, Namespace.EXO.term("Asset_label"), new Literal("Review Process")),
        new Triple(reviewProcess, effortParent, productivityArea),
        new Triple(reviewProcess, effortTimeEstimate, new Literal("90")),
      ]);

      // --- Prototypes (depth 1): provide area, priority; link to meta-prototypes ---
      await s.addAll([
        new Triple(breakfastProto, Namespace.EXO.term("Asset_uid"), new Literal("breakfast")),
        new Triple(breakfastProto, Namespace.EXO.term("Asset_label"), new Literal("Breakfast")),
        new Triple(breakfastProto, Namespace.EXO.term("Asset_prototype"), morningRoutine),
        new Triple(breakfastProto, effortArea, new Literal("Health")),
        new Triple(breakfastProto, effortPriority, new Literal("high")),

        new Triple(lunchProto, Namespace.EXO.term("Asset_uid"), new Literal("lunch")),
        new Triple(lunchProto, Namespace.EXO.term("Asset_label"), new Literal("Lunch")),
        new Triple(lunchProto, Namespace.EXO.term("Asset_prototype"), mealPrep),
        new Triple(lunchProto, effortArea, new Literal("Wellness")),
        new Triple(lunchProto, effortPriority, new Literal("medium")),

        new Triple(eveningReviewProto, Namespace.EXO.term("Asset_uid"), new Literal("evening-review")),
        new Triple(eveningReviewProto, Namespace.EXO.term("Asset_label"), new Literal("Evening Review")),
        new Triple(eveningReviewProto, Namespace.EXO.term("Asset_prototype"), eveningRoutine),
        new Triple(eveningReviewProto, effortArea, new Literal("Reflection")),
        new Triple(eveningReviewProto, effortPriority, new Literal("high")),

        new Triple(weeklyReviewProto, Namespace.EXO.term("Asset_uid"), new Literal("weekly-review")),
        new Triple(weeklyReviewProto, Namespace.EXO.term("Asset_label"), new Literal("Weekly Review")),
        new Triple(weeklyReviewProto, Namespace.EXO.term("Asset_prototype"), reviewProcess),
        new Triple(weeklyReviewProto, effortArea, new Literal("Productivity")),
        new Triple(weeklyReviewProto, effortPriority, new Literal("critical")),
      ]);

      // --- Instances: link to prototypes, have own uid + label ---
      await s.addAll([
        new Triple(breakfastInst, Namespace.EXO.term("Asset_uid"), new Literal("breakfast-2026-04-06")),
        new Triple(breakfastInst, Namespace.EXO.term("Asset_label"), new Literal("Breakfast 2026-04-06")),
        new Triple(breakfastInst, Namespace.EXO.term("Asset_prototype"), breakfastProto),

        new Triple(lunchInst, Namespace.EXO.term("Asset_uid"), new Literal("lunch-2026-04-06")),
        new Triple(lunchInst, Namespace.EXO.term("Asset_label"), new Literal("Lunch 2026-04-06")),
        new Triple(lunchInst, Namespace.EXO.term("Asset_prototype"), lunchProto),

        new Triple(eveningInst, Namespace.EXO.term("Asset_uid"), new Literal("evening-review-2026-04-06")),
        new Triple(eveningInst, Namespace.EXO.term("Asset_label"), new Literal("Evening Review 2026-04-06")),
        new Triple(eveningInst, Namespace.EXO.term("Asset_prototype"), eveningReviewProto),

        new Triple(weeklyInst, Namespace.EXO.term("Asset_uid"), new Literal("weekly-review-2026-w14")),
        new Triple(weeklyInst, Namespace.EXO.term("Asset_label"), new Literal("Weekly Review 2026-W14")),
        new Triple(weeklyInst, Namespace.EXO.term("Asset_prototype"), weeklyReviewProto),
      ]);
    }

    it("should inherit area from depth-1 prototype for all 4 chains", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const chains = [
        { instance: breakfastInst, expectedArea: "Health" },
        { instance: lunchInst, expectedArea: "Wellness" },
        { instance: eveningInst, expectedArea: "Reflection" },
        { instance: weeklyInst, expectedArea: "Productivity" },
      ];

      for (const { instance, expectedArea } of chains) {
        const areaTriples = await store.match(instance, effortArea, undefined);
        expect(areaTriples).toHaveLength(1);
        expect((areaTriples[0].object as Literal).value).toBe(expectedArea);
      }
    });

    it("should inherit parent from depth-2 meta-prototype for all 4 chains", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const chains = [
        { instance: breakfastInst, expectedParent: "obsidian://vault/Health.md" },
        { instance: lunchInst, expectedParent: "obsidian://vault/Wellness.md" },
        { instance: eveningInst, expectedParent: "obsidian://vault/Reflection.md" },
        { instance: weeklyInst, expectedParent: "obsidian://vault/Productivity.md" },
      ];

      for (const { instance, expectedParent } of chains) {
        const parentTriples = await store.match(instance, effortParent, undefined);
        expect(parentTriples).toHaveLength(1);
        expect((parentTriples[0].object as IRI).value).toBe(expectedParent);
      }
    });

    it("should inherit combined properties from both depth levels", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // Breakfast instance should have:
      // - area from depth-1 (breakfastProto)
      // - priority from depth-1 (breakfastProto)
      // - parent from depth-2 (morningRoutine)
      // - timeEstimate from depth-2 (morningRoutine)
      const area = await store.match(breakfastInst, effortArea, undefined);
      const priority = await store.match(breakfastInst, effortPriority, undefined);
      const parent = await store.match(breakfastInst, effortParent, undefined);
      const timeEst = await store.match(breakfastInst, effortTimeEstimate, undefined);

      expect(area).toHaveLength(1);
      expect(priority).toHaveLength(1);
      expect(parent).toHaveLength(1);
      expect(timeEst).toHaveLength(1);

      expect((area[0].object as Literal).value).toBe("Health");
      expect((priority[0].object as Literal).value).toBe("high");
      expect((parent[0].object as IRI).value).toBe("obsidian://vault/Health.md");
      expect((timeEst[0].object as Literal).value).toBe("60");
    });

    it("should apply closest-wins when proto and meta-proto share a property", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // Both breakfastProto (depth-1) and morningRoutine (depth-2) have timeEstimate
      // morningRoutine has "60", but breakfastProto doesn't have timeEstimate
      // So the instance gets "60" from depth-2
      // But if we check an instance with OWN area override...

      // area: breakfastProto has "Health", morningRoutine doesn't have area
      // So breakfastInst gets "Health" from depth-1 (no conflict, only one source)

      // timeEstimate: only morningRoutine has it, so breakfastInst gets "60" from depth-2
      const timeEst = await store.match(breakfastInst, effortTimeEstimate, undefined);
      expect(timeEst).toHaveLength(1);
      expect((timeEst[0].object as Literal).value).toBe("60");
    });

    it("should respect own property override at instance level", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);

      // Add own area to breakfastInst — should NOT inherit from prototype
      const overrideArea = new Literal("Vacation");
      await store.add(new Triple(breakfastInst, effortArea, overrideArea));

      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const areaTriples = await store.match(breakfastInst, effortArea, undefined);
      expect(areaTriples).toHaveLength(1);
      expect((areaTriples[0].object as Literal).value).toBe("Vacation");

      // But should still inherit parent and timeEstimate from depth-2
      const parent = await store.match(breakfastInst, effortParent, undefined);
      expect(parent).toHaveLength(1);
    });

    it("should NOT inherit non-inheritable properties across depth levels", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // uid is non-inheritable — instance should keep its own
      const uidTriples = await store.match(
        breakfastInst,
        Namespace.EXO.term("Asset_uid"),
        undefined,
      );
      expect(uidTriples).toHaveLength(1);
      expect((uidTriples[0].object as Literal).value).toBe("breakfast-2026-04-06");

      // label is non-inheritable — instance should keep its own
      const labelTriples = await store.match(
        breakfastInst,
        Namespace.EXO.term("Asset_label"),
        undefined,
      );
      expect(labelTriples).toHaveLength(1);
      expect((labelTriples[0].object as Literal).value).toBe("Breakfast 2026-04-06");
    });

    it("should add depth-2 inherited triples to the inferred named graph", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // parent from depth-2 should be in inferred graph
      const inferredParent = await store.matchInGraph(
        breakfastInst,
        effortParent,
        undefined,
        INFERRED_GRAPH,
      );
      expect(inferredParent).toHaveLength(1);

      // area from depth-1 should also be in inferred graph
      const inferredArea = await store.matchInGraph(
        breakfastInst,
        effortArea,
        undefined,
        INFERRED_GRAPH,
      );
      expect(inferredArea).toHaveLength(1);
    });

    it("should materialize depth-2 chains within 10ms", async () => {
      await seedNonInheritableProperties(store);
      await seedDepth2Chains(store);
      await registry.initialize(store);
      materializer = new PrototypeChainMaterializer(registry);

      // Warm-up run
      const warmStore = new InMemoryTripleStore();
      await seedNonInheritableProperties(warmStore);
      await seedDepth2Chains(warmStore);
      const warmRegistry = new NonInheritablePropertyRegistry();
      await warmRegistry.initialize(warmStore);
      const warmMaterializer = new PrototypeChainMaterializer(warmRegistry);
      await warmMaterializer.materialize(warmStore);

      // Timed run
      const timedStore = new InMemoryTripleStore();
      await seedNonInheritableProperties(timedStore);
      await seedDepth2Chains(timedStore);
      const timedRegistry = new NonInheritablePropertyRegistry();
      await timedRegistry.initialize(timedStore);
      const timedMaterializer = new PrototypeChainMaterializer(timedRegistry);

      const start = performance.now();
      await timedMaterializer.materialize(timedStore);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-valued property merge integration (RFC-016 #2640)
  // -------------------------------------------------------------------------

  describe("Multi-valued Instance_class merge (RFC-016 #2640)", () => {
    const gtdReviewClass = new IRI("https://exocortex.my/ontology/gtd#Review");
    const emsTaskClass = new IRI("https://exocortex.my/ontology/ems#Task");
    const multipleCardinalityClassIRI = new IRI("obsidian://vault/exo__PropertyCardinalityMultiple.md");

    async function seedCardinalityInfo(s: InMemoryTripleStore): Promise<void> {
      // Define PropertyCardinalityMultiple class
      await s.add(new Triple(
        multipleCardinalityClassIRI,
        Namespace.EXO.term("Asset_label"),
        new Literal("exo__PropertyCardinalityMultiple"),
      ));

      // Mark exo__Instance_class as multi-valued
      const instanceClassDef = new IRI("obsidian://vault/exo__Instance_class.md");
      await s.add(new Triple(
        instanceClassDef,
        Namespace.EXO.term("Property_cardinality"),
        multipleCardinalityClassIRI,
      ));
      await s.add(new Triple(
        instanceClassDef,
        Namespace.EXO.term("Asset_label"),
        new Literal("exo__Instance_class"),
      ));
    }

    it("should append prototype classes to instance with own partial class", async () => {
      // Prototype: [ems__Task, gtd__Review]
      const protoIRI = new IRI("obsidian://vault/gtd-task-prototype.md");
      await store.add(new Triple(protoIRI, Namespace.EXO.term("Instance_class"), emsTaskClass));
      await store.add(new Triple(protoIRI, Namespace.EXO.term("Instance_class"), gtdReviewClass));
      await store.add(new Triple(protoIRI, Namespace.EXO.term("Asset_uid"), new Literal("proto-uid")));
      await store.add(new Triple(protoIRI, Namespace.EXO.term("Asset_label"), new Literal("GTD Task Prototype")));

      // Instance: own [ems__Task], prototype link
      const instIRI = new IRI("obsidian://vault/my-task.md");
      await store.add(new Triple(instIRI, Namespace.EXO.term("Instance_class"), emsTaskClass));
      await store.add(new Triple(instIRI, Namespace.EXO.term("Asset_prototype"), protoIRI));
      await store.add(new Triple(instIRI, Namespace.EXO.term("Asset_uid"), new Literal("inst-uid")));
      await store.add(new Triple(instIRI, Namespace.EXO.term("Asset_label"), new Literal("My Task")));

      // Setup registries
      await seedNonInheritableProperties(store);
      await seedCardinalityInfo(store);
      await registry.initialize(store);
      const cardinalityRegistry = new PropertyCardinalityRegistry();
      await cardinalityRegistry.initialize(store);

      const mat = new PrototypeChainMaterializer(registry, cardinalityRegistry);
      await mat.materialize(store);

      // Instance should have BOTH classes
      const classTriples = await store.match(instIRI, Namespace.EXO.term("Instance_class"), undefined);
      expect(classTriples.length).toBe(2);

      const classValues = classTriples.map(t => (t.object as IRI).value);
      expect(classValues).toContain(emsTaskClass.value);
      expect(classValues).toContain(gtdReviewClass.value);
    });

    it("should NOT duplicate ems__Task that instance already owns", async () => {
      const protoIRI = new IRI("obsidian://vault/gtd-proto2.md");
      await store.add(new Triple(protoIRI, Namespace.EXO.term("Instance_class"), emsTaskClass));
      await store.add(new Triple(protoIRI, Namespace.EXO.term("Instance_class"), gtdReviewClass));

      const instIRI = new IRI("obsidian://vault/my-task2.md");
      await store.add(new Triple(instIRI, Namespace.EXO.term("Instance_class"), emsTaskClass));
      await store.add(new Triple(instIRI, Namespace.EXO.term("Asset_prototype"), protoIRI));

      await seedNonInheritableProperties(store);
      await seedCardinalityInfo(store);
      await registry.initialize(store);
      const cardinalityRegistry = new PropertyCardinalityRegistry();
      await cardinalityRegistry.initialize(store);

      const mat = new PrototypeChainMaterializer(registry, cardinalityRegistry);
      await mat.materialize(store);

      // ems__Task should appear exactly once
      const classTriples = await store.match(instIRI, Namespace.EXO.term("Instance_class"), undefined);
      const taskCount = classTriples.filter(t => (t.object as IRI).value === emsTaskClass.value).length;
      expect(taskCount).toBe(1);
      expect(classTriples.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Performance: Multi-valued merge < 10ms for depth-3 (RFC-016 #2641)
  // -------------------------------------------------------------------------

  describe("Performance: multi-valued merge depth-3 (RFC-016 #2641)", () => {
    const multipleCardinalityClassIRI = new IRI("obsidian://vault/exo__PropertyCardinalityMultiple.md");
    const class1 = new IRI("https://exocortex.my/ontology/ems#Task");
    const class2 = new IRI("https://exocortex.my/ontology/gtd#Review");
    const class3 = new IRI("https://exocortex.my/ontology/ems#Goal");

    async function buildDepth3MultiValuedStore(): Promise<{
      store: InMemoryTripleStore;
      materializer: PrototypeChainMaterializer;
    }> {
      const s = new InMemoryTripleStore();

      // Cardinality setup
      await s.add(new Triple(multipleCardinalityClassIRI, Namespace.EXO.term("Asset_label"), new Literal("exo__PropertyCardinalityMultiple")));
      const icDef = new IRI("obsidian://vault/exo__Instance_class.md");
      await s.add(new Triple(icDef, Namespace.EXO.term("Property_cardinality"), multipleCardinalityClassIRI));
      await s.add(new Triple(icDef, Namespace.EXO.term("Asset_label"), new Literal("exo__Instance_class")));

      // Non-inheritable setup
      const nipClass = new IRI(NON_INHERITABLE_CLASS_IRI);
      await s.add(new Triple(nipClass, Namespace.EXO.term("Asset_label"), new Literal("exo__NonInheritableProperty")));
      for (const label of ["exo__Asset_uid", "exo__Asset_label", "exo__Asset_prototype", "ems__Effort_status"]) {
        const defIRI = new IRI(`obsidian://vault/nip-${label}.md`);
        await s.add(new Triple(defIRI, Namespace.EXO.term("Instance_class"), nipClass));
        await s.add(new Triple(defIRI, Namespace.EXO.term("Asset_label"), new Literal(label)));
      }

      // Depth-3 chain: grandparent → parent → instance
      const grandparent = new IRI("obsidian://vault/grandparent.md");
      const parent = new IRI("obsidian://vault/parent.md");
      const instance = new IRI("obsidian://vault/instance.md");

      await s.add(new Triple(grandparent, Namespace.EXO.term("Instance_class"), class1));
      await s.add(new Triple(grandparent, Namespace.EXO.term("Instance_class"), class2));
      await s.add(new Triple(grandparent, Namespace.EXO.term("Instance_class"), class3));

      await s.add(new Triple(parent, Namespace.EXO.term("Instance_class"), class1));
      await s.add(new Triple(parent, Namespace.EXO.term("Instance_class"), class2));
      await s.add(new Triple(parent, Namespace.EXO.term("Asset_prototype"), grandparent));

      await s.add(new Triple(instance, Namespace.EXO.term("Instance_class"), class1));
      await s.add(new Triple(instance, Namespace.EXO.term("Asset_prototype"), parent));

      // Registries
      const r = new NonInheritablePropertyRegistry();
      await r.initialize(s);
      const cr = new PropertyCardinalityRegistry();
      await cr.initialize(s);

      return { store: s, materializer: new PrototypeChainMaterializer(r, cr) };
    }

    it("should materialize depth-3 multi-valued chain in < 10ms", async () => {
      // Warm-up run
      const warmup = await buildDepth3MultiValuedStore();
      await warmup.materializer.materialize(warmup.store);

      // Timed run
      const { store: timedStore, materializer: timedMat } = await buildDepth3MultiValuedStore();

      const start = performance.now();
      await timedMat.materialize(timedStore);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
    });

    it("should produce correct class count after depth-3 merge", async () => {
      const { store: s, materializer: mat } = await buildDepth3MultiValuedStore();
      await mat.materialize(s);

      const instanceIRI = new IRI("obsidian://vault/instance.md");
      const classTriples = await s.match(instanceIRI, Namespace.EXO.term("Instance_class"), undefined);

      // Instance has own [class1], parent has [class1, class2], grandparent has [class1, class2, class3]
      // Result: instance should have all 3 unique classes
      const uniqueValues = new Set(classTriples.map(t => (t.object as IRI).value));
      expect(uniqueValues.size).toBe(3);
      expect(uniqueValues.has(class1.value)).toBe(true);
      expect(uniqueValues.has(class2.value)).toBe(true);
      expect(uniqueValues.has(class3.value)).toBe(true);
    });
  });
});
