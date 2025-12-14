/**
 * ITripleStore Contract Tests
 *
 * Consumer-driven contract tests for the RDF triple store interface.
 * Tests InMemoryTripleStore as the reference implementation.
 * These tests verify the behavioral guarantees that consumers depend on.
 *
 * @see packages/core/contracts/TripleStore.contract.ts
 */

import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { TripleStoreContract } from "../../contracts/TripleStore.contract";
import type { ITripleStore } from "../../src/interfaces/ITripleStore";

describe("ITripleStore Contract Tests", () => {
  let store: ITripleStore;

  // Test data factory
  const createTriple = (s: string, p: string, o: string | number): Triple => {
    const subject = new IRI(s);
    const predicate = new IRI(p);
    const object = typeof o === "number"
      ? new Literal(o.toString(), new IRI("http://www.w3.org/2001/XMLSchema#integer"))
      : new Literal(o);
    return new Triple(subject, predicate, object);
  };

  const createIRITriple = (s: string, p: string, o: string): Triple => {
    return new Triple(new IRI(s), new IRI(p), new IRI(o));
  };

  beforeEach(() => {
    store = new InMemoryTripleStore();
  });

  describe(`Contract: ${TripleStoreContract.name} v${TripleStoreContract.version}`, () => {
    describe("add() method", () => {
      it("adds a valid triple to the store", async () => {
        const triple = createTriple(
          "http://example.org/s",
          "http://example.org/p",
          "value"
        );

        await store.add(triple);
        const count = await store.count();
        expect(count).toBe(1);
      });

      it("is idempotent (adding same triple twice has no effect)", async () => {
        const triple = createTriple(
          "http://example.org/s",
          "http://example.org/p",
          "value"
        );

        await store.add(triple);
        await store.add(triple);
        const count = await store.count();
        expect(count).toBe(1);
      });
    });

    describe("remove() method", () => {
      it("returns true when triple was removed", async () => {
        const triple = createTriple(
          "http://example.org/s",
          "http://example.org/p",
          "value"
        );

        await store.add(triple);
        const removed = await store.remove(triple);
        expect(removed).toBe(true);
      });

      it("returns false when triple was not found", async () => {
        const triple = createTriple(
          "http://example.org/s",
          "http://example.org/p",
          "value"
        );

        const removed = await store.remove(triple);
        expect(removed).toBe(false);
      });
    });

    describe("has() method", () => {
      it("returns true for exact triple match", async () => {
        const triple = createTriple(
          "http://example.org/s",
          "http://example.org/p",
          "value"
        );

        await store.add(triple);
        const exists = await store.has(triple);
        expect(exists).toBe(true);
      });

      it("returns false for non-existent triple", async () => {
        const triple = createTriple(
          "http://example.org/s",
          "http://example.org/p",
          "value"
        );

        const exists = await store.has(triple);
        expect(exists).toBe(false);
      });
    });

    describe("match() method", () => {
      beforeEach(async () => {
        // Add test triples
        await store.addAll([
          createIRITriple(
            "http://example.org/s1",
            "http://example.org/type",
            "http://example.org/Task"
          ),
          createIRITriple(
            "http://example.org/s2",
            "http://example.org/type",
            "http://example.org/Project"
          ),
          createTriple(
            "http://example.org/s1",
            "http://example.org/name",
            "Task 1"
          ),
          createTriple(
            "http://example.org/s2",
            "http://example.org/name",
            "Project 1"
          ),
        ]);
      });

      it("returns all triples when no filters specified", async () => {
        const results = await store.match();
        expect(results.length).toBe(4);
      });

      it("filters by subject only", async () => {
        const subject = new IRI("http://example.org/s1");
        const results = await store.match(subject);
        expect(results.length).toBe(2);
        results.forEach((t) => {
          expect((t.subject as IRI).value).toBe("http://example.org/s1");
        });
      });

      it("filters by predicate only", async () => {
        const predicate = new IRI("http://example.org/type");
        const results = await store.match(undefined, predicate);
        expect(results.length).toBe(2);
        results.forEach((t) => {
          expect((t.predicate as IRI).value).toBe("http://example.org/type");
        });
      });

      it("filters by object only", async () => {
        const object = new IRI("http://example.org/Task");
        const results = await store.match(undefined, undefined, object);
        expect(results.length).toBe(1);
      });

      it("combines all filters with AND logic", async () => {
        const subject = new IRI("http://example.org/s1");
        const predicate = new IRI("http://example.org/type");
        const results = await store.match(subject, predicate);
        expect(results.length).toBe(1);
      });

      it("returns empty array when no matches", async () => {
        const subject = new IRI("http://example.org/nonexistent");
        const results = await store.match(subject);
        expect(results).toEqual([]);
      });
    });

    describe("addAll() method", () => {
      it("adds multiple triples atomically", async () => {
        const triples = [
          createTriple("http://example.org/s1", "http://example.org/p", "v1"),
          createTriple("http://example.org/s2", "http://example.org/p", "v2"),
          createTriple("http://example.org/s3", "http://example.org/p", "v3"),
        ];

        await store.addAll(triples);
        const count = await store.count();
        expect(count).toBe(3);
      });

      it("handles empty array without error", async () => {
        await expect(store.addAll([])).resolves.not.toThrow();
        const count = await store.count();
        expect(count).toBe(0);
      });
    });

    describe("removeAll() method", () => {
      it("removes multiple triples and returns count", async () => {
        const triples = [
          createTriple("http://example.org/s1", "http://example.org/p", "v1"),
          createTriple("http://example.org/s2", "http://example.org/p", "v2"),
        ];

        await store.addAll(triples);
        const removed = await store.removeAll(triples);
        expect(removed).toBe(2);
        const count = await store.count();
        expect(count).toBe(0);
      });

      it("handles non-existent triples gracefully", async () => {
        const triple = createTriple("http://example.org/s1", "http://example.org/p", "v1");
        const removed = await store.removeAll([triple]);
        expect(removed).toBe(0);
      });
    });

    describe("clear() method", () => {
      it("removes all triples from store", async () => {
        await store.addAll([
          createTriple("http://example.org/s1", "http://example.org/p", "v1"),
          createTriple("http://example.org/s2", "http://example.org/p", "v2"),
        ]);

        await store.clear();
        const count = await store.count();
        expect(count).toBe(0);
      });

      it("succeeds on empty store", async () => {
        await expect(store.clear()).resolves.not.toThrow();
      });
    });

    describe("count() method", () => {
      it("returns 0 for empty store", async () => {
        const count = await store.count();
        expect(count).toBe(0);
      });

      it("accurately reflects number of unique triples", async () => {
        const triple1 = createTriple("http://example.org/s1", "http://example.org/p", "v1");
        const triple2 = createTriple("http://example.org/s2", "http://example.org/p", "v2");

        await store.add(triple1);
        expect(await store.count()).toBe(1);

        await store.add(triple2);
        expect(await store.count()).toBe(2);

        // Adding duplicate shouldn't increase count
        await store.add(triple1);
        expect(await store.count()).toBe(2);
      });
    });

    describe("subjects() method", () => {
      it("returns subjects from stored triples", async () => {
        await store.addAll([
          createTriple("http://example.org/s1", "http://example.org/p1", "v1"),
          createTriple("http://example.org/s1", "http://example.org/p2", "v2"),
          createTriple("http://example.org/s2", "http://example.org/p1", "v3"),
        ]);

        const subjects = await store.subjects();
        // Should return subjects from each triple
        expect(subjects.length).toBeGreaterThanOrEqual(2);

        // Verify subject values
        const subjectValues = subjects.map(s => (s as IRI).value);
        expect(subjectValues).toContain("http://example.org/s1");
        expect(subjectValues).toContain("http://example.org/s2");
      });

      it("returns empty array for empty store", async () => {
        const subjects = await store.subjects();
        expect(subjects).toEqual([]);
      });
    });

    describe("predicates() method", () => {
      it("returns predicates from stored triples", async () => {
        await store.addAll([
          createTriple("http://example.org/s1", "http://example.org/p1", "v1"),
          createTriple("http://example.org/s2", "http://example.org/p1", "v2"),
          createTriple("http://example.org/s1", "http://example.org/p2", "v3"),
        ]);

        const predicates = await store.predicates();
        // Should return predicates from each triple
        expect(predicates.length).toBeGreaterThanOrEqual(2);

        // Verify predicate values
        const predicateValues = predicates.map(p => (p as IRI).value);
        expect(predicateValues).toContain("http://example.org/p1");
        expect(predicateValues).toContain("http://example.org/p2");
      });
    });

    describe("objects() method", () => {
      it("returns objects from stored triples", async () => {
        await store.addAll([
          createTriple("http://example.org/s1", "http://example.org/p", "v1"),
          createTriple("http://example.org/s2", "http://example.org/p", "v1"),
          createTriple("http://example.org/s3", "http://example.org/p", "v2"),
        ]);

        const objects = await store.objects();
        // Should return objects from stored triples
        expect(objects.length).toBeGreaterThanOrEqual(2);

        // Verify object values
        const objectValues = objects.map(o => (o as Literal).value);
        expect(objectValues).toContain("v1");
        expect(objectValues).toContain("v2");
      });
    });

    describe("Transaction support", () => {
      it("beginTransaction returns a transaction object", async () => {
        const tx = await store.beginTransaction();
        expect(tx).toBeDefined();
        expect(typeof tx.add).toBe("function");
        expect(typeof tx.remove).toBe("function");
        expect(typeof tx.commit).toBe("function");
        expect(typeof tx.rollback).toBe("function");
      });

      it("commit() persists all changes atomically", async () => {
        const tx = await store.beginTransaction();
        const triple = createTriple("http://example.org/s", "http://example.org/p", "v");

        await tx.add(triple);
        await tx.commit();

        const count = await store.count();
        expect(count).toBe(1);
      });

      it("rollback() discards all changes", async () => {
        const tx = await store.beginTransaction();
        const triple = createTriple("http://example.org/s", "http://example.org/p", "v");

        await tx.add(triple);
        await tx.rollback();

        const count = await store.count();
        expect(count).toBe(0);
      });
    });

    describe("Optional: UUID search support", () => {
      it("findSubjectsByUUID finds subjects containing UUID", async () => {
        if (!store.findSubjectsByUUID) {
          return; // Skip if not implemented
        }

        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        await store.add(createTriple(
          `http://example.org/asset-${uuid}.md`,
          "http://example.org/type",
          "http://example.org/Task"
        ));

        const subjects = await store.findSubjectsByUUID(uuid);
        expect(subjects.length).toBe(1);
      });

      it("findSubjectsByUUID is case-insensitive", async () => {
        if (!store.findSubjectsByUUID) {
          return; // Skip if not implemented
        }

        const uuid = "550E8400-E29B-41D4-A716-446655440000"; // uppercase
        await store.add(createTriple(
          "http://example.org/asset-550e8400-e29b-41d4-a716-446655440000.md", // lowercase
          "http://example.org/type",
          "http://example.org/Task"
        ));

        const subjects = await store.findSubjectsByUUID(uuid);
        expect(subjects.length).toBe(1);
      });
    });

    describe("Behavioral guarantees", () => {
      it("stores triples with IRI subjects, predicates, and literal objects", async () => {
        const triple = new Triple(
          new IRI("http://example.org/subject"),
          new IRI("http://example.org/predicate"),
          new Literal("literal value")
        );

        await store.add(triple);
        const results = await store.match();
        expect(results.length).toBe(1);
      });

      it("stores triples with typed literal objects", async () => {
        const triple = new Triple(
          new IRI("http://example.org/subject"),
          new IRI("http://example.org/value"),
          new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
        );

        await store.add(triple);
        const results = await store.match();
        expect(results.length).toBe(1);
      });

      it("stores triples with IRI objects", async () => {
        const triple = createIRITriple(
          "http://example.org/subject",
          "http://example.org/type",
          "http://example.org/Task"
        );

        await store.add(triple);
        const results = await store.match();
        expect(results.length).toBe(1);
      });
    });
  });
});
