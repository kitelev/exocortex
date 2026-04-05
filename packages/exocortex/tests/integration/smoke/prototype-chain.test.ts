/**
 * Smoke test: Prototype Chain Materialization (RFC-011/012).
 *
 * Verifies that PrototypeChainMaterializer correctly inherits properties
 * from prototype to instance, respecting non-inheritable property rules.
 *
 * Scenarios:
 *   - Instance without own area -> inherits area from prototype
 *   - Instance with own area -> keeps own value (override)
 *   - Non-inheritable properties (uid, label, status, timestamps) NOT inherited
 *   - Label from prototype NOT inherited (instance has its own)
 *
 * Uses real (non-mocked) services: InMemoryTripleStore,
 * PrototypeChainMaterializer, NonInheritablePropertyRegistry.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { PrototypeChainMaterializer, INFERRED_GRAPH } from "../../../src/services/PrototypeChainMaterializer";
import { NonInheritablePropertyRegistry } from "../../../src/services/NonInheritablePropertyRegistry";
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
});
