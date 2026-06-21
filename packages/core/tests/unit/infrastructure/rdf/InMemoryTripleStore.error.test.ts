/**
 * InMemoryTripleStore Error Scenario and Edge Case Tests
 *
 * Tests error handling for:
 * - Edge cases in index operations
 * - Large graph handling
 * - Concurrent operations
 * - Invalid triple handling
 *
 * Issue: #758 - Add Error Scenario and Edge Case Test Suite
 */

import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../src/domain/models/rdf/BlankNode";

describe("InMemoryTripleStore Edge Cases", () => {
  let store: InMemoryTripleStore;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
  });

  describe("Empty Store Operations", () => {
    it("should return empty array for match on empty store", async () => {
      const results = await store.match();
      expect(results).toEqual([]);
    });

    it("should return 0 for count on empty store", async () => {
      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should return false for has on empty store", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o")
      );
      const has = await store.has(triple);
      expect(has).toBe(false);
    });

    it("should return false for remove on empty store", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o")
      );
      const removed = await store.remove(triple);
      expect(removed).toBe(false);
    });

    it("should handle clear on empty store", async () => {
      await store.clear();
      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe("Large Graph Handling", () => {
    it("should handle adding many triples efficiently", async () => {
      const triples: Triple[] = [];
      const p = new IRI("http://example.org/predicate");

      for (let i = 0; i < 1000; i++) {
        triples.push(
          new Triple(
            new IRI(`http://example.org/subject${i}`),
            p,
            new Literal(`value${i}`)
          )
        );
      }

      const start = Date.now();
      await store.addAll(triples);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
      const count = await store.count();
      expect(count).toBe(1000);
    });

    it("should handle many unique predicates", async () => {
      const triples: Triple[] = [];
      const s = new IRI("http://example.org/subject");

      for (let i = 0; i < 100; i++) {
        triples.push(
          new Triple(
            s,
            new IRI(`http://example.org/predicate${i}`),
            new Literal(`value${i}`)
          )
        );
      }

      await store.addAll(triples);

      // Should be able to match by subject
      const results = await store.match(s);
      expect(results.length).toBe(100);
    });

    it("should handle many unique objects", async () => {
      const triples: Triple[] = [];
      const s = new IRI("http://example.org/subject");
      const p = new IRI("http://example.org/predicate");

      for (let i = 0; i < 100; i++) {
        triples.push(new Triple(s, p, new Literal(`value${i}`)));
      }

      await store.addAll(triples);

      const results = await store.match(s, p);
      expect(results.length).toBe(100);
    });
  });

  describe("Duplicate Handling", () => {
    it("should not duplicate identical triples", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o")
      );

      await store.add(triple);
      await store.add(triple);
      await store.add(triple);

      const count = await store.count();
      expect(count).toBe(1);
    });

    it("should distinguish triples differing only in object", async () => {
      const s = new IRI("http://example.org/s");
      const p = new IRI("http://example.org/p");

      await store.add(new Triple(s, p, new Literal("value1")));
      await store.add(new Triple(s, p, new Literal("value2")));

      const count = await store.count();
      expect(count).toBe(2);
    });

    it("should distinguish triples differing only in predicate", async () => {
      const s = new IRI("http://example.org/s");
      const o = new IRI("http://example.org/o");

      await store.add(new Triple(s, new IRI("http://example.org/p1"), o));
      await store.add(new Triple(s, new IRI("http://example.org/p2"), o));

      const count = await store.count();
      expect(count).toBe(2);
    });

    it("should distinguish triples differing only in subject", async () => {
      const p = new IRI("http://example.org/p");
      const o = new IRI("http://example.org/o");

      await store.add(new Triple(new IRI("http://example.org/s1"), p, o));
      await store.add(new Triple(new IRI("http://example.org/s2"), p, o));

      const count = await store.count();
      expect(count).toBe(2);
    });
  });

  describe("Literal Edge Cases", () => {
    it("should distinguish literals with different datatypes", async () => {
      const s = new IRI("http://example.org/s");
      const p = new IRI("http://example.org/p");
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");

      await store.add(new Triple(s, p, new Literal("42", xsdInt)));
      await store.add(new Triple(s, p, new Literal("42", xsdString)));

      const count = await store.count();
      expect(count).toBe(2);
    });

    it("should distinguish literals with different language tags", async () => {
      const s = new IRI("http://example.org/s");
      const p = new IRI("http://example.org/p");

      await store.add(new Triple(s, p, new Literal("hello", undefined, "en")));
      await store.add(new Triple(s, p, new Literal("hello", undefined, "de")));

      const count = await store.count();
      expect(count).toBe(2);
    });

    it("should handle whitespace-only string literals", async () => {
      const s = new IRI("http://example.org/s");
      const p = new IRI("http://example.org/p");

      await store.add(new Triple(s, p, new Literal(" ")));

      const results = await store.match(s, p);
      expect(results.length).toBe(1);
      expect((results[0].object as Literal).value).toBe(" ");
    });

    it("should handle very long string literals", async () => {
      const s = new IRI("http://example.org/s");
      const p = new IRI("http://example.org/p");
      const longValue = "x".repeat(10000);

      await store.add(new Triple(s, p, new Literal(longValue)));

      const results = await store.match(s, p);
      expect(results.length).toBe(1);
      expect((results[0].object as Literal).value.length).toBe(10000);
    });

    it("should handle Unicode literals", async () => {
      const s = new IRI("http://example.org/s");
      const p = new IRI("http://example.org/p");

      await store.add(new Triple(s, p, new Literal("日本語テスト🎉")));

      const results = await store.match(s, p);
      expect(results.length).toBe(1);
      expect((results[0].object as Literal).value).toBe("日本語テスト🎉");
    });

    it("should handle newlines in literals", async () => {
      const s = new IRI("http://example.org/s");
      const p = new IRI("http://example.org/p");

      await store.add(new Triple(s, p, new Literal("line1\nline2\nline3")));

      const results = await store.match(s, p);
      expect(results.length).toBe(1);
      expect((results[0].object as Literal).value).toContain("\n");
    });
  });

  describe("IRI Edge Cases", () => {
    it("should handle IRIs with special characters", async () => {
      const s = new IRI("http://example.org/path%20with%20spaces");
      const p = new IRI("http://example.org/predicate");
      const o = new IRI("http://example.org/object");

      await store.add(new Triple(s, p, o));

      const results = await store.match(s);
      expect(results.length).toBe(1);
    });

    it("should handle very long IRIs", async () => {
      const longPath = "segment/".repeat(100);
      const s = new IRI(`http://example.org/${longPath}`);
      const p = new IRI("http://example.org/predicate");
      const o = new IRI("http://example.org/object");

      await store.add(new Triple(s, p, o));

      const results = await store.match(s);
      expect(results.length).toBe(1);
    });

    it("should handle Unicode in IRIs", async () => {
      const s = new IRI("http://example.org/资源");
      const p = new IRI("http://example.org/predicate");
      const o = new IRI("http://example.org/object");

      await store.add(new Triple(s, p, o));

      const results = await store.match(s);
      expect(results.length).toBe(1);
    });
  });

  describe("BlankNode Edge Cases", () => {
    it("should handle blank node subjects", async () => {
      const blank = BlankNode.create();
      const p = new IRI("http://example.org/predicate");
      const o = new Literal("value");

      await store.add(new Triple(blank, p, o));

      const results = await store.match(blank);
      expect(results.length).toBe(1);
    });

    it("should handle blank node objects", async () => {
      const s = new IRI("http://example.org/subject");
      const p = new IRI("http://example.org/predicate");
      const blank = BlankNode.create();

      await store.add(new Triple(s, p, blank));

      const results = await store.match(undefined, undefined, blank);
      expect(results.length).toBe(1);
    });

    it("should distinguish different blank nodes", async () => {
      const blank1 = BlankNode.create();
      const blank2 = BlankNode.create();
      const p = new IRI("http://example.org/predicate");
      const o = new Literal("value");

      await store.add(new Triple(blank1, p, o));
      await store.add(new Triple(blank2, p, o));

      const count = await store.count();
      expect(count).toBe(2);
    });
  });

  describe("Index Consistency", () => {
    it("should maintain index consistency after add/remove cycles", async () => {
      const s = new IRI("http://example.org/subject");
      const p = new IRI("http://example.org/predicate");
      const o1 = new Literal("value1");
      const o2 = new Literal("value2");

      const triple1 = new Triple(s, p, o1);
      const triple2 = new Triple(s, p, o2);

      // Add and remove multiple times
      await store.add(triple1);
      await store.add(triple2);
      await store.remove(triple1);
      await store.add(triple1);
      await store.remove(triple2);

      const results = await store.match(s, p);
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(triple1);
    });

    it("should maintain consistency after clear", async () => {
      const s = new IRI("http://example.org/subject");
      const p = new IRI("http://example.org/predicate");

      // Add triples
      for (let i = 0; i < 10; i++) {
        await store.add(new Triple(s, p, new Literal(`value${i}`)));
      }

      // Clear
      await store.clear();

      // Add new triples
      await store.add(new Triple(s, p, new Literal("new")));

      const results = await store.match(s, p);
      expect(results.length).toBe(1);
      expect((results[0].object as Literal).value).toBe("new");
    });
  });

  describe("Match Pattern Edge Cases", () => {
    it("should handle match with all undefined (wildcard)", async () => {
      const triples = [
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/p1"),
          new Literal("o1")
        ),
        new Triple(
          new IRI("http://example.org/s2"),
          new IRI("http://example.org/p2"),
          new Literal("o2")
        ),
      ];

      await store.addAll(triples);

      const results = await store.match(undefined, undefined, undefined);
      expect(results.length).toBe(2);
    });

    it("should return empty for non-existent subject pattern", async () => {
      const s = new IRI("http://example.org/subject");
      const p = new IRI("http://example.org/predicate");
      const o = new Literal("value");

      await store.add(new Triple(s, p, o));

      const results = await store.match(new IRI("http://example.org/nonexistent"));
      expect(results.length).toBe(0);
    });

    it("should handle match with only predicate specified", async () => {
      const p = new IRI("http://example.org/predicate");

      await store.add(
        new Triple(new IRI("http://example.org/s1"), p, new Literal("v1"))
      );
      await store.add(
        new Triple(new IRI("http://example.org/s2"), p, new Literal("v2"))
      );
      await store.add(
        new Triple(
          new IRI("http://example.org/s3"),
          new IRI("http://example.org/other"),
          new Literal("v3")
        )
      );

      const results = await store.match(undefined, p, undefined);
      expect(results.length).toBe(2);
    });

    it("should handle match with only object specified", async () => {
      const o = new Literal("commonValue");

      await store.add(
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/p1"),
          o
        )
      );
      await store.add(
        new Triple(
          new IRI("http://example.org/s2"),
          new IRI("http://example.org/p2"),
          o
        )
      );

      const results = await store.match(undefined, undefined, o);
      expect(results.length).toBe(2);
    });
  });

  describe("Concurrent-like Operations", () => {
    it("should handle rapid sequential adds", async () => {
      const promises: Promise<void>[] = [];
      const p = new IRI("http://example.org/predicate");

      for (let i = 0; i < 100; i++) {
        promises.push(
          store.add(
            new Triple(
              new IRI(`http://example.org/s${i}`),
              p,
              new Literal(`v${i}`)
            )
          )
        );
      }

      await Promise.all(promises);

      const count = await store.count();
      expect(count).toBe(100);
    });

    it("should handle interleaved add/remove operations", async () => {
      const s = new IRI("http://example.org/subject");
      const p = new IRI("http://example.org/predicate");

      const operations: Promise<void | boolean>[] = [];

      for (let i = 0; i < 50; i++) {
        const triple = new Triple(s, p, new Literal(`value${i}`));
        operations.push(store.add(triple));
        if (i % 2 === 0) {
          operations.push(store.remove(triple));
        }
      }

      await Promise.all(operations);

      // Some triples should remain
      const count = await store.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("addAll() Edge Cases", () => {
    it("should handle empty array", async () => {
      await store.addAll([]);
      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should handle array with duplicates", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o")
      );

      await store.addAll([triple, triple, triple]);

      const count = await store.count();
      expect(count).toBe(1);
    });
  });
});
