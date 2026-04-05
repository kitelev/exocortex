/**
 * Smoke test: ExoQL Public API (RFC-011/012).
 *
 * Verifies the ExoQL public facade:
 *   - ExoQL.query() returns results from store
 *   - ExoQL.ask() returns boolean
 *   - ExoQL.queryOwn() filters out inherited properties
 *   - Source annotation: own vs inherited `_source` binding
 *
 * Uses real (non-mocked) services: InMemoryTripleStore,
 * PrototypeChainMaterializer, NonInheritablePropertyRegistry, ExoQL.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { PrototypeChainMaterializer } from "../../../src/services/PrototypeChainMaterializer";
import { NonInheritablePropertyRegistry } from "../../../src/services/NonInheritablePropertyRegistry";
import { ExoQL } from "../../../src/exoql";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { SOURCE_VARIABLE } from "../../../src/services/SourceAnnotator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTOTYPE_IRI = "obsidian://vault/proto-weekly-review.md";
const INSTANCE_IRI = "obsidian://vault/task-week-15.md";
const STANDALONE_IRI = "obsidian://vault/task-standalone.md";

// Non-inheritable property class
const NON_INHERITABLE_CLASS_IRI = "obsidian://vault/exo__NonInheritableProperty.md";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedNonInheritableProperties(store: InMemoryTripleStore): Promise<void> {
  const classIRI = new IRI(NON_INHERITABLE_CLASS_IRI);
  await store.addAll([
    new Triple(classIRI, Namespace.EXO.term("Asset_label"), new Literal("exo__NonInheritableProperty")),
  ]);

  const nonInheritableProps = [
    { iri: "obsidian://vault/nip-uid.md", label: "exo__Asset_uid" },
    { iri: "obsidian://vault/nip-label.md", label: "exo__Asset_label" },
    { iri: "obsidian://vault/nip-status.md", label: "ems__Effort_status" },
  ];

  for (const prop of nonInheritableProps) {
    const propIRI = new IRI(prop.iri);
    await store.addAll([
      new Triple(propIRI, Namespace.EXO.term("Instance_class"), classIRI),
      new Triple(propIRI, Namespace.EXO.term("Asset_label"), new Literal(prop.label)),
    ]);
  }
}

async function seedPrototype(store: InMemoryTripleStore): Promise<void> {
  const proto = new IRI(PROTOTYPE_IRI);
  await store.addAll([
    new Triple(proto, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(proto, Namespace.EXO.term("Asset_uid"), new Literal("proto-weekly-review")),
    new Triple(proto, Namespace.EXO.term("Asset_label"), new Literal("Weekly Review Prototype")),
    new Triple(proto, Namespace.EMS.term("Effort_area"), new Literal("Productivity")),
    new Triple(proto, Namespace.EMS.term("Effort_priority"), new Literal("high")),
    new Triple(proto, Namespace.EMS.term("Effort_status"), new Literal("ems__EffortStatusBacklog")),
  ]);
}

async function seedInstance(store: InMemoryTripleStore): Promise<void> {
  const instance = new IRI(INSTANCE_IRI);
  const proto = new IRI(PROTOTYPE_IRI);
  await store.addAll([
    new Triple(instance, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(instance, Namespace.EXO.term("Asset_uid"), new Literal("task-week-15")),
    new Triple(instance, Namespace.EXO.term("Asset_label"), new Literal("Weekly Review Week 15")),
    new Triple(instance, Namespace.EXO.term("Asset_prototype"), proto),
    new Triple(instance, Namespace.EMS.term("Effort_status"), new Literal("ems__EffortStatusDoing")),
  ]);
}

async function seedStandaloneTask(store: InMemoryTripleStore): Promise<void> {
  const standalone = new IRI(STANDALONE_IRI);
  await store.addAll([
    new Triple(standalone, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(standalone, Namespace.EXO.term("Asset_uid"), new Literal("task-standalone")),
    new Triple(standalone, Namespace.EXO.term("Asset_label"), new Literal("Standalone Task")),
    new Triple(standalone, Namespace.EMS.term("Effort_area"), new Literal("Work")),
    new Triple(standalone, Namespace.EMS.term("Effort_status"), new Literal("ems__EffortStatusBacklog")),
  ]);
}

/**
 * Full setup: seed prototype + instance + non-inheritable props + materialize.
 */
async function setupWithMaterialization(store: InMemoryTripleStore): Promise<void> {
  await seedNonInheritableProperties(store);
  await seedPrototype(store);
  await seedInstance(store);

  const registry = new NonInheritablePropertyRegistry();
  await registry.initialize(store);
  const materializer = new PrototypeChainMaterializer(registry);
  await materializer.materialize(store);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Smoke: ExoQL Public API", () => {
  let store: InMemoryTripleStore;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
  });

  // -----------------------------------------------------------------------
  // ExoQL.query()
  // -----------------------------------------------------------------------

  describe("ExoQL.query()", () => {
    it("should return results from the triple store", async () => {
      await seedStandaloneTask(store);

      const results = await ExoQL.query(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         PREFIX exo: <https://exocortex.my/ontology/exo#>
         SELECT ?s ?label WHERE {
           ?s a ems:Task .
           ?s exo:Asset_label ?label .
         }`,
        store,
      );

      expect(results).toHaveLength(1);
      const label = results[0].get("label");
      expect(label).toBeInstanceOf(Literal);
      expect((label as Literal).value).toBe("Standalone Task");
    });

    it("should return empty array when no matches", async () => {
      const results = await ExoQL.query(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         SELECT ?s WHERE { ?s a ems:Project . }`,
        store,
      );
      expect(results).toHaveLength(0);
    });

    it("should return multiple results", async () => {
      await seedStandaloneTask(store);
      // Add another standalone
      const extra = new IRI("obsidian://vault/task-extra.md");
      await store.addAll([
        new Triple(extra, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
        new Triple(extra, Namespace.EXO.term("Asset_label"), new Literal("Extra Task")),
      ]);

      const results = await ExoQL.query(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         SELECT ?s WHERE { ?s a ems:Task . }`,
        store,
      );
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // ExoQL.ask()
  // -----------------------------------------------------------------------

  describe("ExoQL.ask()", () => {
    it("should return true when pattern matches", async () => {
      await seedStandaloneTask(store);

      const result = await ExoQL.ask(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         ASK { ?s a ems:Task }`,
        store,
      );
      expect(result).toBe(true);
    });

    it("should return false when pattern does not match", async () => {
      const result = await ExoQL.ask(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         ASK { ?s a ems:Project }`,
        store,
      );
      expect(result).toBe(false);
    });

    it("should support $target-style queries with explicit IRI", async () => {
      await seedStandaloneTask(store);

      const result = await ExoQL.ask(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         ASK { <${STANDALONE_IRI}> a ems:Task }`,
        store,
      );
      expect(result).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // ExoQL.queryOwn() — filters inherited properties
  // -----------------------------------------------------------------------

  describe("ExoQL.queryOwn()", () => {
    it("should return only own triples, filtering out inherited ones", async () => {
      await setupWithMaterialization(store);

      // Query all properties of the instance using ?s ?p ?o triple pattern
      // (SourceAnnotator requires all three variables bound via triple patterns)
      const allResults = await ExoQL.query(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         PREFIX exo: <https://exocortex.my/ontology/exo#>
         SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      const ownResults = await ExoQL.queryOwn(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         PREFIX exo: <https://exocortex.my/ontology/exo#>
         SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      // Filter to instance triples only
      const instanceOwn = ownResults.filter((r) => {
        const s = r.get("s");
        return s instanceof IRI && s.value === INSTANCE_IRI;
      });

      // Own properties: rdf:type, Asset_uid, Asset_label, Asset_prototype, Effort_status
      // Inherited properties: Effort_area, Effort_priority (should be filtered out)
      const ownPredicates = instanceOwn.map((r) => {
        const p = r.get("p");
        return p instanceof IRI ? p.value : String(p);
      });

      // Own properties SHOULD be present
      expect(ownPredicates).toContain(Namespace.EXO.term("Asset_uid").value);
      expect(ownPredicates).toContain(Namespace.EXO.term("Asset_label").value);
      expect(ownPredicates).toContain(Namespace.EMS.term("Effort_status").value);

      // Inherited properties SHOULD NOT be present
      expect(ownPredicates).not.toContain(Namespace.EMS.term("Effort_area").value);
      expect(ownPredicates).not.toContain(Namespace.EMS.term("Effort_priority").value);

      // Total results should be more than own results (inherited filtered out)
      const instanceAll = allResults.filter((r) => {
        const s = r.get("s");
        return s instanceof IRI && s.value === INSTANCE_IRI;
      });
      expect(instanceAll.length).toBeGreaterThan(instanceOwn.length);
    });

    it("should return all properties for assets without prototypes", async () => {
      await seedStandaloneTask(store);

      const ownResults = await ExoQL.queryOwn(
        `PREFIX ems: <https://exocortex.my/ontology/ems#>
         PREFIX exo: <https://exocortex.my/ontology/exo#>
         SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      // Filter to standalone task only
      const standaloneOwn = ownResults.filter((r) => {
        const s = r.get("s");
        return s instanceof IRI && s.value === STANDALONE_IRI;
      });

      // All properties are own (no prototype chain)
      const predicates = standaloneOwn.map((r) => {
        const p = r.get("p");
        return p instanceof IRI ? p.value : String(p);
      });

      expect(predicates).toContain(Namespace.EMS.term("Effort_area").value);
      expect(predicates).toContain(Namespace.EXO.term("Asset_label").value);
    });
  });

  // -----------------------------------------------------------------------
  // Source annotation: _source binding
  // -----------------------------------------------------------------------

  describe("Source annotation (_source binding)", () => {
    it("should annotate own triples with _source = 'own'", async () => {
      await setupWithMaterialization(store);

      const sparql = `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`;

      // Query all results
      const allResults = await ExoQL.query(sparql, store);
      const allInstance = allResults.filter((r) => {
        const s = r.get("s");
        return s instanceof IRI && s.value === INSTANCE_IRI;
      });

      // Query own results
      const ownResults = await ExoQL.queryOwn(sparql, store);
      const ownInstance = ownResults.filter((r) => {
        const s = r.get("s");
        return s instanceof IRI && s.value === INSTANCE_IRI;
      });

      // queryOwn results should have _source = "own"
      for (const sol of ownInstance) {
        const source = sol.get(SOURCE_VARIABLE);
        expect(source).toBeDefined();
        expect(source).toBeInstanceOf(Literal);
        expect((source as Literal).value).toBe("own");
      }

      // All results should be more than own results (inherited filtered out)
      expect(allInstance.length).toBeGreaterThan(ownInstance.length);
    });

    it("should correctly identify inherited triples via ExoQL.isOwn()", async () => {
      await setupWithMaterialization(store);

      // Area was inherited from prototype
      const isAreaOwn = await ExoQL.isOwn(
        new IRI(INSTANCE_IRI),
        Namespace.EMS.term("Effort_area"),
        new Literal("Productivity"),
        store,
      );
      expect(isAreaOwn).toBe(false);

      // Status was own (defined on instance)
      const isStatusOwn = await ExoQL.isOwn(
        new IRI(INSTANCE_IRI),
        Namespace.EMS.term("Effort_status"),
        new Literal("ems__EffortStatusDoing"),
        store,
      );
      expect(isStatusOwn).toBe(true);
    });

    it("should report all properties as own for standalone assets", async () => {
      await seedStandaloneTask(store);

      const isAreaOwn = await ExoQL.isOwn(
        new IRI(STANDALONE_IRI),
        Namespace.EMS.term("Effort_area"),
        new Literal("Work"),
        store,
      );
      expect(isAreaOwn).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // ExoQL.queryOwn() with custom variable names
  // -----------------------------------------------------------------------

  describe("ExoQL.queryOwn() with custom variables", () => {
    it("should support custom variable names via OwnFilterConfig", async () => {
      await setupWithMaterialization(store);

      const ownResults = await ExoQL.queryOwn(
        `SELECT ?subject ?predicate ?value WHERE {
           ?subject ?predicate ?value .
         }`,
        store,
        { subjectVar: "subject", predicateVar: "predicate", objectVar: "value" },
      );

      // Filter to instance triples
      const instanceOwn = ownResults.filter((r) => {
        const s = r.get("subject");
        return s instanceof IRI && s.value === INSTANCE_IRI;
      });

      const ownPredicates = instanceOwn.map((r) => {
        const p = r.get("predicate");
        return p instanceof IRI ? p.value : String(p);
      });

      // Inherited area should be filtered out
      expect(ownPredicates).not.toContain(Namespace.EMS.term("Effort_area").value);
      // Own label should be present
      expect(ownPredicates).toContain(Namespace.EXO.term("Asset_label").value);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("Edge cases", () => {
    it("should throw ExoQLError when ask() is called with SELECT query", async () => {
      await expect(
        ExoQL.ask(
          `PREFIX ems: <https://exocortex.my/ontology/ems#>
           SELECT ?s WHERE { ?s a ems:Task }`,
          store,
        ),
      ).rejects.toThrow("ExoQL.ask() requires an ASK query");
    });

    it("should return empty results for queryOwn on empty store", async () => {
      const results = await ExoQL.queryOwn(
        `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );
      expect(results).toHaveLength(0);
    });
  });
});
