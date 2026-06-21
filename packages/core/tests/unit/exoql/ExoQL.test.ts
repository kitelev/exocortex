import { ExoQL, ExoQLError } from "../../../src/exoql";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

describe("ExoQL", () => {
  let store: InMemoryTripleStore;

  const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const EX = (local: string) => new IRI(`http://example.org/${local}`);

  beforeEach(() => {
    store = new InMemoryTripleStore();
  });

  // ---------------------------------------------------------------
  // ExoQL.query  (SELECT)
  // ---------------------------------------------------------------
  describe("query()", () => {
    it("returns solution mappings for a basic SELECT", async () => {
      await store.add(new Triple(EX("task1"), RDF_TYPE, EX("Task")));
      await store.add(new Triple(EX("task2"), RDF_TYPE, EX("Task")));

      const results = await ExoQL.query(
        `SELECT ?s WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
        store,
      );

      expect(results).toHaveLength(2);
      const uris = results.map((r) => (r.get("s") as IRI).value).sort();
      expect(uris).toEqual([
        "http://example.org/task1",
        "http://example.org/task2",
      ]);
    });

    it("returns empty array when no matches", async () => {
      const results = await ExoQL.query(
        `SELECT ?s WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
        store,
      );
      expect(results).toEqual([]);
    });

    it("supports FILTER in SELECT queries", async () => {
      await store.add(
        new Triple(EX("task1"), EX("label"), new Literal("Alpha")),
      );
      await store.add(
        new Triple(EX("task2"), EX("label"), new Literal("Beta")),
      );

      const results = await ExoQL.query(
        `SELECT ?s ?label WHERE {
           ?s <${EX("label").value}> ?label .
           FILTER(?label = "Alpha")
         }`,
        store,
      );

      expect(results).toHaveLength(1);
      expect((results[0].get("s") as IRI).value).toBe(
        "http://example.org/task1",
      );
    });

    it("supports LIMIT and OFFSET", async () => {
      for (let i = 1; i <= 5; i++) {
        await store.add(new Triple(EX(`item${i}`), RDF_TYPE, EX("Item")));
      }

      const results = await ExoQL.query(
        `SELECT ?s WHERE { ?s <${RDF_TYPE.value}> <${EX("Item").value}> } LIMIT 2`,
        store,
      );

      expect(results).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------
  // ExoQL.ask  (ASK)
  // ---------------------------------------------------------------
  describe("ask()", () => {
    it("returns true when pattern matches", async () => {
      await store.add(new Triple(EX("task1"), RDF_TYPE, EX("Task")));

      const result = await ExoQL.ask(
        `ASK WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
        store,
      );

      expect(result).toBe(true);
    });

    it("returns false when pattern does not match", async () => {
      const result = await ExoQL.ask(
        `ASK WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
        store,
      );

      expect(result).toBe(false);
    });

    it("throws ExoQLError when called with a SELECT query", async () => {
      await expect(
        ExoQL.ask(
          `SELECT ?s WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
          store,
        ),
      ).rejects.toThrow(ExoQLError);
    });

    it("throws ExoQLError with descriptive message for wrong query type", async () => {
      await expect(
        ExoQL.ask(
          `SELECT ?s WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
          store,
        ),
      ).rejects.toThrow("ExoQL.ask() requires an ASK query");
    });
  });

  // ---------------------------------------------------------------
  // ExoQL.construct  (CONSTRUCT)
  // ---------------------------------------------------------------
  describe("construct()", () => {
    it("returns constructed triples", async () => {
      await store.add(new Triple(EX("task1"), RDF_TYPE, EX("Task")));
      await store.add(
        new Triple(EX("task1"), EX("label"), new Literal("My Task")),
      );

      const triples = await ExoQL.construct(
        `CONSTRUCT {
           ?s <${EX("type").value}> "task" .
         } WHERE {
           ?s <${RDF_TYPE.value}> <${EX("Task").value}> .
         }`,
        store,
      );

      expect(triples).toHaveLength(1);
      expect((triples[0].subject as IRI).value).toBe(
        "http://example.org/task1",
      );
      expect((triples[0].predicate as IRI).value).toBe(
        "http://example.org/type",
      );
    });

    it("returns empty array when WHERE clause has no matches", async () => {
      const triples = await ExoQL.construct(
        `CONSTRUCT {
           ?s <${EX("type").value}> "task" .
         } WHERE {
           ?s <${RDF_TYPE.value}> <${EX("Task").value}> .
         }`,
        store,
      );

      expect(triples).toEqual([]);
    });

    it("throws ExoQLError when called with a SELECT query", async () => {
      await expect(
        ExoQL.construct(
          `SELECT ?s WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
          store,
        ),
      ).rejects.toThrow(ExoQLError);
    });

    it("throws ExoQLError with descriptive message for wrong query type", async () => {
      await expect(
        ExoQL.construct(
          `SELECT ?s WHERE { ?s <${RDF_TYPE.value}> <${EX("Task").value}> }`,
          store,
        ),
      ).rejects.toThrow("ExoQL.construct() requires a CONSTRUCT query");
    });
  });

  // ---------------------------------------------------------------
  // Error class
  // ---------------------------------------------------------------
  describe("ExoQLError", () => {
    it("has correct name property", () => {
      const err = new ExoQLError("test");
      expect(err.name).toBe("ExoQLError");
    });

    it("is instanceof Error", () => {
      const err = new ExoQLError("test");
      expect(err).toBeInstanceOf(Error);
    });
  });

  // ---------------------------------------------------------------
  // Re-export verification
  // ---------------------------------------------------------------
  describe("re-exports from main index", () => {
    it("ExoQL is exported from @kitelev/exocortex-core index", async () => {
      const mod = await import("../../../src/index");
      expect(mod.ExoQL).toBe(ExoQL);
    });

    it("ExoQLError is exported from @kitelev/exocortex-core index", async () => {
      const mod = await import("../../../src/index");
      expect(mod.ExoQLError).toBe(ExoQLError);
    });
  });
});
