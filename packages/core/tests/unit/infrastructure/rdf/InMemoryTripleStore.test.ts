import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../src/domain/models/rdf/BlankNode";

describe("InMemoryTripleStore", () => {
  let store: InMemoryTripleStore;
  let alice: IRI;
  let bob: IRI;
  let charlie: IRI;
  let knows: IRI;
  let name: IRI;
  let age: IRI;
  let triple1: Triple;
  let triple2: Triple;
  let triple3: Triple;

  beforeEach(async () => {
    store = new InMemoryTripleStore();

    alice = new IRI("http://example.com/Alice");
    bob = new IRI("http://example.com/Bob");
    charlie = new IRI("http://example.com/Charlie");
    knows = new IRI("http://example.com/knows");
    name = new IRI("http://example.com/name");
    age = new IRI("http://example.com/age");

    triple1 = new Triple(alice, knows, bob);
    triple2 = new Triple(alice, name, new Literal("Alice"));
    triple3 = new Triple(bob, name, new Literal("Bob"));
  });

  describe("add", () => {
    it("should add triple to store", async () => {
      await store.add(triple1);

      const has = await store.has(triple1);
      expect(has).toBe(true);
    });

    it("should be idempotent", async () => {
      await store.add(triple1);
      await store.add(triple1);

      const count = await store.count();
      expect(count).toBe(1);
    });

    it("should update all 6 indexes", async () => {
      await store.add(triple1);

      const bySubject = await store.match(alice);
      expect(bySubject).toContainEqual(triple1);

      const byPredicate = await store.match(undefined, knows);
      expect(byPredicate).toContainEqual(triple1);

      const byObject = await store.match(undefined, undefined, bob);
      expect(byObject).toContainEqual(triple1);
    });
  });

  describe("remove", () => {
    it("should remove existing triple", async () => {
      await store.add(triple1);

      const removed = await store.remove(triple1);
      expect(removed).toBe(true);

      const has = await store.has(triple1);
      expect(has).toBe(false);
    });

    it("should return false for non-existent triple", async () => {
      const removed = await store.remove(triple1);
      expect(removed).toBe(false);
    });

    it("should update all indexes", async () => {
      await store.add(triple1);
      await store.remove(triple1);

      const bySubject = await store.match(alice);
      expect(bySubject).toEqual([]);

      const byPredicate = await store.match(undefined, knows);
      expect(byPredicate).toEqual([]);
    });
  });

  describe("has", () => {
    it("should return true for existing triple", async () => {
      await store.add(triple1);

      const has = await store.has(triple1);
      expect(has).toBe(true);
    });

    it("should return false for non-existent triple", async () => {
      const has = await store.has(triple1);
      expect(has).toBe(false);
    });
  });

  describe("match", () => {
    beforeEach(async () => {
      await store.addAll([triple1, triple2, triple3]);
    });

    it("should return all triples when no pattern specified", async () => {
      const results = await store.match();
      expect(results.length).toBe(3);
    });

    it("should match by subject only (using SPO index)", async () => {
      const results = await store.match(alice);

      expect(results.length).toBe(2);
      expect(results).toContainEqual(triple1);
      expect(results).toContainEqual(triple2);
    });

    it("should match by predicate only (using PSO index)", async () => {
      const results = await store.match(undefined, name);

      expect(results.length).toBe(2);
      expect(results).toContainEqual(triple2);
      expect(results).toContainEqual(triple3);
    });

    it("should match by object only (using OSP index)", async () => {
      const results = await store.match(undefined, undefined, bob);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple1);
    });

    it("should match by subject and predicate (using SPO index)", async () => {
      const results = await store.match(alice, name);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple2);
    });

    it("should match by subject and object (using SOP index)", async () => {
      const results = await store.match(alice, undefined, bob);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple1);
    });

    it("should match by predicate and object (using POS index)", async () => {
      const bobLiteral = new Literal("Bob");
      const results = await store.match(undefined, name, bobLiteral);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple3);
    });

    it("should match exact triple (using SPO index)", async () => {
      const results = await store.match(alice, knows, bob);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple1);
    });

    it("should return empty array when no matches", async () => {
      const results = await store.match(charlie);

      expect(results).toEqual([]);
    });

    it("should handle Literal objects correctly", async () => {
      const aliceLiteral = new Literal("Alice");
      const results = await store.match(undefined, undefined, aliceLiteral);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple2);
    });

    it("should handle BlankNode subjects", async () => {
      const blank = BlankNode.create();
      const triple4 = new Triple(blank, name, new Literal("Anonymous"));
      await store.add(triple4);

      const results = await store.match(blank);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple4);
    });
  });

  describe("addAll", () => {
    it("should add multiple triples", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const count = await store.count();
      expect(count).toBe(3);
    });

    it("should handle empty array", async () => {
      await store.addAll([]);

      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should deduplicate identical triples", async () => {
      await store.addAll([triple1, triple1, triple2]);

      const count = await store.count();
      expect(count).toBe(2);
    });
  });

  describe("removeAll", () => {
    it("should remove multiple triples and return count", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const removed = await store.removeAll([triple1, triple2]);
      expect(removed).toBe(2);

      const count = await store.count();
      expect(count).toBe(1);
    });

    it("should return 0 for non-existent triples", async () => {
      const removed = await store.removeAll([triple1, triple2]);
      expect(removed).toBe(0);
    });

    it("should handle partial removal", async () => {
      await store.addAll([triple1, triple2]);

      const removed = await store.removeAll([triple1, triple3]);
      expect(removed).toBe(1);

      const count = await store.count();
      expect(count).toBe(1);
    });
  });

  describe("clear", () => {
    it("should remove all triples", async () => {
      await store.addAll([triple1, triple2, triple3]);

      await store.clear();

      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should clear all indexes", async () => {
      await store.addAll([triple1, triple2, triple3]);
      await store.clear();

      const bySubject = await store.match(alice);
      expect(bySubject).toEqual([]);

      const byPredicate = await store.match(undefined, name);
      expect(byPredicate).toEqual([]);
    });

    it("should work on empty store", async () => {
      await store.clear();

      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe("count", () => {
    it("should return 0 for empty store", async () => {
      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should return correct count", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const count = await store.count();
      expect(count).toBe(3);
    });

    it("should update after add/remove", async () => {
      await store.add(triple1);
      expect(await store.count()).toBe(1);

      await store.add(triple2);
      expect(await store.count()).toBe(2);

      await store.remove(triple1);
      expect(await store.count()).toBe(1);
    });
  });

  describe("subjects", () => {
    it("should return unique subjects", async () => {
      await store.addAll([triple1, triple2]);

      const subjects = await store.subjects();
      expect(subjects.length).toBe(1);
      expect(subjects[0]).toBeInstanceOf(IRI);
      expect((subjects[0] as IRI).value).toBe("http://example.com/Alice");
    });

    it("should return multiple unique subjects", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const subjects = await store.subjects();
      expect(subjects.length).toBe(2);
    });

    it("should return empty array for empty store", async () => {
      const subjects = await store.subjects();
      expect(subjects).toEqual([]);
    });
  });

  describe("predicates", () => {
    it("should return unique predicates", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const predicates = await store.predicates();
      expect(predicates.length).toBe(2);
    });

    it("should return empty array for empty store", async () => {
      const predicates = await store.predicates();
      expect(predicates).toEqual([]);
    });
  });

  describe("objects", () => {
    it("should return unique objects", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const objects = await store.objects();
      expect(objects.length).toBe(3);
    });

    it("should handle different object types", async () => {
      const blank = BlankNode.create();
      const triple4 = new Triple(alice, knows, blank);
      await store.addAll([triple1, triple2, triple4]);

      const objects = await store.objects();
      expect(objects.length).toBe(3);

      const types = objects.map((o) => o.constructor.name);
      expect(types).toContain("IRI");
      expect(types).toContain("Literal");
      expect(types).toContain("BlankNode");
    });

    it("should return empty array for empty store", async () => {
      const objects = await store.objects();
      expect(objects).toEqual([]);
    });
  });

  describe("transactions", () => {
    it("should create transaction", async () => {
      const tx = await store.beginTransaction();
      expect(tx).toBeDefined();
    });

    it("should commit transaction", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);
      await tx.add(triple2);
      await tx.commit();

      const count = await store.count();
      expect(count).toBe(2);
    });

    it("should rollback transaction", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);
      await tx.add(triple2);
      await tx.rollback();

      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should not apply changes until commit", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);

      const count = await store.count();
      expect(count).toBe(0);

      await tx.commit();

      const countAfter = await store.count();
      expect(countAfter).toBe(1);
    });

    it("should throw on double commit", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);
      await tx.commit();

      await expect(tx.commit()).rejects.toThrow("Transaction already committed");
    });

    it("should throw on commit after rollback", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);
      await tx.rollback();

      await expect(tx.commit()).rejects.toThrow("Transaction already rolled back");
    });

    it("should throw on rollback after commit", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);
      await tx.commit();

      await expect(tx.rollback()).rejects.toThrow("Transaction already committed");
    });

    it("should throw on add after commit", async () => {
      const tx = await store.beginTransaction();
      await tx.commit();

      await expect(tx.add(triple1)).rejects.toThrow("Transaction already committed");
    });

    it("should support remove in transaction", async () => {
      await store.add(triple1);

      const tx = await store.beginTransaction();
      await tx.remove(triple1);
      await tx.commit();

      const has = await store.has(triple1);
      expect(has).toBe(false);
    });
  });

  describe("query cache", () => {
    it("should cache query results", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const results1 = await store.match(alice);
      const results2 = await store.match(alice);

      expect(results1).toEqual(results2);
      expect(results1.length).toBe(2);
    });

    it("should invalidate cache on add", async () => {
      await store.add(triple1);

      const results1 = await store.match(alice);
      expect(results1.length).toBe(1);

      await store.add(triple2);

      const results2 = await store.match(alice);
      expect(results2.length).toBe(2);
    });

    it("should invalidate cache on remove", async () => {
      await store.addAll([triple1, triple2]);

      const results1 = await store.match(alice);
      expect(results1.length).toBe(2);

      await store.remove(triple1);

      const results2 = await store.match(alice);
      expect(results2.length).toBe(1);
    });

    it("should invalidate cache on clear", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const results1 = await store.match();
      expect(results1.length).toBe(3);

      await store.clear();

      const results2 = await store.match();
      expect(results2).toEqual([]);
    });
  });

  describe("index efficiency", () => {
    it("should use SPO index for (s,p,o) pattern", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const results = await store.match(alice, knows, bob);
      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple1);
    });

    it("should use SOP index for (s,?,o) pattern", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const results = await store.match(alice, undefined, bob);
      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple1);
    });

    it("should use POS index for (?,p,o) pattern", async () => {
      const bobLiteral = new Literal("Bob");
      await store.addAll([triple1, triple2, triple3]);

      const results = await store.match(undefined, name, bobLiteral);
      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple3);
    });

    it("should use SPO index for (s,p,?) pattern", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const results = await store.match(alice, name);
      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple2);
    });

    it("should use OSP index for (?,?,o) pattern", async () => {
      const aliceLiteral = new Literal("Alice");
      await store.addAll([triple1, triple2, triple3]);

      const results = await store.match(undefined, undefined, aliceLiteral);
      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple2);
    });
  });

  describe("complex scenarios", () => {
    it("should handle 100 triples efficiently", async () => {
      const triples: Triple[] = [];
      for (let i = 0; i < 100; i++) {
        const subject = new IRI(`http://example.com/Person${i}`);
        const triple = new Triple(subject, name, new Literal(`Person ${i}`));
        triples.push(triple);
      }

      await store.addAll(triples);

      const count = await store.count();
      expect(count).toBe(100);

      const byPredicate = await store.match(undefined, name);
      expect(byPredicate.length).toBe(100);
    });

    it("should handle mixed node types", async () => {
      const blank1 = BlankNode.create();
      const blank2 = BlankNode.create();
      const triple4 = new Triple(blank1, knows, blank2);
      const triple5 = new Triple(alice, knows, blank1);

      await store.addAll([triple1, triple4, triple5]);

      const byPredicate = await store.match(undefined, knows);
      expect(byPredicate.length).toBe(3);
    });

    it("should handle Literals with datatypes", async () => {
      const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const literal = new Literal("42", xsdInteger);
      const triple4 = new Triple(alice, age, literal);

      await store.add(triple4);

      const results = await store.match(undefined, undefined, literal);
      expect(results.length).toBe(1);
    });

    // RDF 1.1 semantics: plain literals and xsd:string literals are equivalent
    // https://www.w3.org/TR/rdf11-concepts/#section-Graph-Literal
    it("should match plain literal when querying with xsd:string literal (RDF 1.1)", async () => {
      // Store with plain literal (no datatype)
      const plainLiteral = new Literal("[[ems__Task]]");
      const instanceClass = new IRI("https://exocortex.my/ontology/exo#Instance_class");
      const tripleWithPlain = new Triple(alice, instanceClass, plainLiteral);
      await store.add(tripleWithPlain);

      // Query with xsd:string typed literal (how SPARQL parser creates it)
      const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
      const typedLiteral = new Literal("[[ems__Task]]", xsdString);

      const results = await store.match(undefined, instanceClass, typedLiteral);
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(tripleWithPlain);
    });

    it("should match xsd:string literal when querying with plain literal (RDF 1.1)", async () => {
      // Store with xsd:string typed literal
      const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
      const typedLiteral = new Literal("[[ems__Task]]", xsdString);
      const instanceClass = new IRI("https://exocortex.my/ontology/exo#Instance_class");
      const tripleWithTyped = new Triple(alice, instanceClass, typedLiteral);
      await store.add(tripleWithTyped);

      // Query with plain literal (no datatype)
      const plainLiteral = new Literal("[[ems__Task]]");

      const results = await store.match(undefined, instanceClass, plainLiteral);
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(tripleWithTyped);
    });

    it("should NOT match plain literal with other datatype literals", async () => {
      // Store with plain literal
      const plainLiteral = new Literal("42");
      const triple4 = new Triple(alice, age, plainLiteral);
      await store.add(triple4);

      // Query with xsd:integer (should NOT match)
      const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const typedLiteral = new Literal("42", xsdInteger);

      const results = await store.match(undefined, age, typedLiteral);
      expect(results.length).toBe(0);
    });

    it("should handle Literals with language tags", async () => {
      const literal = new Literal("Alicia", undefined, "es");
      const triple4 = new Triple(alice, name, literal);

      await store.add(triple4);

      const results = await store.match(alice, name, literal);
      expect(results.length).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty store queries", async () => {
      const results = await store.match(alice);
      expect(results).toEqual([]);
    });

    it("should handle repeated add/remove cycles", async () => {
      for (let i = 0; i < 10; i++) {
        await store.add(triple1);
        await store.remove(triple1);
      }

      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should maintain index consistency after bulk operations", async () => {
      await store.addAll([triple1, triple2, triple3]);
      await store.removeAll([triple1, triple2]);

      const bySubject = await store.match(alice);
      expect(bySubject).toEqual([]);

      const byBob = await store.match(bob);
      expect(byBob.length).toBe(1);
      expect(byBob).toContainEqual(triple3);
    });
  });
});
