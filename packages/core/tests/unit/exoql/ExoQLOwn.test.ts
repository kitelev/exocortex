import { ExoQL } from "../../../src/exoql";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { INFERRED_GRAPH } from "../../../src/services/PrototypeChainMaterializer";

describe("ExoQL OWN() filter", () => {
  let store: InMemoryTripleStore;

  const EX = (local: string) => new IRI(`http://example.org/${local}`);
  const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");

  beforeEach(() => {
    store = new InMemoryTripleStore();
  });

  // ---------------------------------------------------------------
  // ExoQL.queryOwn()
  // ---------------------------------------------------------------
  describe("queryOwn()", () => {
    it("returns only own triples, filtering out inherited ones", async () => {
      // Own triple: directly asserted in default graph
      const ownTriple = new Triple(EX("task1"), EX("name"), new Literal("My Task"));
      await store.add(ownTriple);

      // Inherited triple: exists in both default and inferred graph
      const inheritedTriple = new Triple(EX("task1"), EX("status"), EX("Active"));
      await store.add(inheritedTriple);
      await store.addToGraph!(inheritedTriple, INFERRED_GRAPH);

      const results = await ExoQL.queryOwn(
        `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      // Only the own triple should be returned
      expect(results).toHaveLength(1);
      expect((results[0].get("p") as IRI).value).toBe("http://example.org/name");
    });

    it("returns all triples when none are inherited", async () => {
      await store.add(new Triple(EX("task1"), EX("name"), new Literal("Task 1")));
      await store.add(new Triple(EX("task2"), EX("name"), new Literal("Task 2")));

      const results = await ExoQL.queryOwn(
        `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      expect(results).toHaveLength(2);
    });

    it("returns empty array when all triples are inherited", async () => {
      const triple1 = new Triple(EX("task1"), EX("status"), EX("Active"));
      const triple2 = new Triple(EX("task1"), EX("priority"), new Literal("High"));

      await store.add(triple1);
      await store.addToGraph!(triple1, INFERRED_GRAPH);
      await store.add(triple2);
      await store.addToGraph!(triple2, INFERRED_GRAPH);

      const results = await ExoQL.queryOwn(
        `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      expect(results).toHaveLength(0);
    });

    it("returns empty array when store is empty", async () => {
      const results = await ExoQL.queryOwn(
        `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      expect(results).toEqual([]);
    });

    it("supports custom variable names via OwnFilterConfig", async () => {
      const ownTriple = new Triple(EX("task1"), EX("name"), new Literal("Own"));
      await store.add(ownTriple);

      const inheritedTriple = new Triple(EX("task1"), EX("status"), EX("Inherited"));
      await store.add(inheritedTriple);
      await store.addToGraph!(inheritedTriple, INFERRED_GRAPH);

      const results = await ExoQL.queryOwn(
        `SELECT ?subject ?predicate ?object WHERE { ?subject ?predicate ?object }`,
        store,
        { subjectVar: "subject", predicateVar: "predicate", objectVar: "object" },
      );

      expect(results).toHaveLength(1);
      expect((results[0].get("predicate") as IRI).value).toBe("http://example.org/name");
    });

    it("works with FILTER in the underlying query", async () => {
      const ownTriple = new Triple(EX("task1"), RDF_TYPE, EX("Task"));
      await store.add(ownTriple);

      const inheritedTriple = new Triple(EX("task1"), EX("status"), EX("Active"));
      await store.add(inheritedTriple);
      await store.addToGraph!(inheritedTriple, INFERRED_GRAPH);

      // Also add another own triple that doesn't match the filter
      await store.add(new Triple(EX("task1"), EX("label"), new Literal("Label")));

      const results = await ExoQL.queryOwn(
        `SELECT ?s ?p ?o WHERE {
           ?s ?p ?o .
           FILTER(?p = <${RDF_TYPE.value}>)
         }`,
        store,
      );

      // Only the rdf:type triple is own AND matches the filter
      expect(results).toHaveLength(1);
      expect((results[0].get("p") as IRI).value).toBe(RDF_TYPE.value);
    });

    it("handles mixed own and inherited triples for multiple subjects", async () => {
      // task1: has own name, inherited status
      const t1Own = new Triple(EX("task1"), EX("name"), new Literal("Task 1"));
      await store.add(t1Own);

      const t1Inherited = new Triple(EX("task1"), EX("status"), EX("Active"));
      await store.add(t1Inherited);
      await store.addToGraph!(t1Inherited, INFERRED_GRAPH);

      // task2: has own name, own priority
      await store.add(new Triple(EX("task2"), EX("name"), new Literal("Task 2")));
      await store.add(new Triple(EX("task2"), EX("priority"), new Literal("High")));

      const results = await ExoQL.queryOwn(
        `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
        store,
      );

      // task1: 1 own, task2: 2 own = 3 total
      expect(results).toHaveLength(3);
      const predicates = results.map((r) => (r.get("p") as IRI).value).sort();
      expect(predicates).toEqual([
        "http://example.org/name",
        "http://example.org/name",
        "http://example.org/priority",
      ]);
    });
  });

  // ---------------------------------------------------------------
  // ExoQL.isOwn()
  // ---------------------------------------------------------------
  describe("isOwn()", () => {
    it("returns true for a directly asserted triple", async () => {
      const triple = new Triple(EX("task1"), EX("name"), new Literal("My Task"));
      await store.add(triple);

      const result = await ExoQL.isOwn(
        EX("task1"),
        EX("name"),
        new Literal("My Task"),
        store,
      );

      expect(result).toBe(true);
    });

    it("returns false for an inherited triple", async () => {
      const triple = new Triple(EX("task1"), EX("status"), EX("Active"));
      await store.add(triple);
      await store.addToGraph!(triple, INFERRED_GRAPH);

      const result = await ExoQL.isOwn(
        EX("task1"),
        EX("status"),
        EX("Active"),
        store,
      );

      expect(result).toBe(false);
    });

    it("returns true when store does not support named graphs", async () => {
      // Create a minimal store without matchInGraph
      const basicStore = {
        add: store.add.bind(store),
        remove: store.remove.bind(store),
        has: store.has.bind(store),
        match: store.match.bind(store),
        addAll: store.addAll.bind(store),
        removeAll: store.removeAll.bind(store),
        clear: store.clear.bind(store),
        count: store.count.bind(store),
        subjects: store.subjects.bind(store),
        predicates: store.predicates.bind(store),
        objects: store.objects.bind(store),
        beginTransaction: store.beginTransaction.bind(store),
        // matchInGraph intentionally omitted
      };

      await basicStore.add(new Triple(EX("task1"), EX("name"), new Literal("Task")));

      const result = await ExoQL.isOwn(
        EX("task1"),
        EX("name"),
        new Literal("Task"),
        basicStore,
      );

      expect(result).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Re-export verification
  // ---------------------------------------------------------------
  describe("re-exports from main index", () => {
    it("OwnFilterConfig type is exported from @kitelev/exocortex-core index", async () => {
      // Type-only exports cannot be verified at runtime,
      // but we can verify the module compiles with the import
      const mod = await import("../../../src/index");
      expect(mod.ExoQL.queryOwn).toBeDefined();
      expect(mod.ExoQL.isOwn).toBeDefined();
    });
  });
});
