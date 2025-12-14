/**
 * PropertyPathExecutor Error Scenario and Edge Case Tests
 *
 * Tests error handling for:
 * - Infinite loops in recursive paths
 * - Empty graph handling
 * - Invalid path operations
 * - Depth limits
 *
 * Issue: #758 - Add Error Scenario and Edge Case Test Suite
 */

import {
  PropertyPathExecutor,
  PropertyPathExecutorError,
} from "../../../../../src/infrastructure/sparql/executors/PropertyPathExecutor";
import type { ITripleStore } from "../../../../../src/interfaces/ITripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import type {
  TripleElement,
  PropertyPath,
  IRI as AlgebraIRI,
} from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

// Helper functions (same pattern as PropertyPathExecutor.test.ts)
const iri = (value: string): IRI => new IRI(value);
const literal = (value: string): Literal => new Literal(value);
const algebraIri = (value: string): AlgebraIRI => ({ type: "iri", value });
const algebraVar = (name: string): TripleElement => ({ type: "variable", value: name });

describe("PropertyPathExecutor Error Scenarios", () => {
  let executor: PropertyPathExecutor;
  let mockTripleStore: jest.Mocked<ITripleStore>;
  let triples: Triple[];

  beforeEach(() => {
    triples = [];
    mockTripleStore = {
      add: jest.fn().mockImplementation((triple: Triple) => {
        triples.push(triple);
        return Promise.resolve();
      }),
      match: jest.fn().mockImplementation((s, p, o) => {
        return Promise.resolve(
          triples.filter((t) => {
            if (s !== undefined && t.subject.toString() !== s.toString()) return false;
            if (p !== undefined && t.predicate.toString() !== p.toString()) return false;
            if (o !== undefined && t.object.toString() !== o.toString()) return false;
            return true;
          })
        );
      }),
      clear: jest.fn(),
      size: jest.fn().mockReturnValue(triples.length),
      getTriples: jest.fn().mockReturnValue(triples),
    } as unknown as jest.Mocked<ITripleStore>;

    executor = new PropertyPathExecutor(mockTripleStore);
  });

  // Helper to collect results
  async function collectResults(
    subject: TripleElement,
    path: PropertyPath,
    object: TripleElement
  ): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];
    for await (const mapping of executor.execute(subject, path, object)) {
      results.push(mapping);
    }
    return results;
  }

  describe("Empty Graph Handling", () => {
    it("should return empty results for path query on empty graph", async () => {
      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/knows")],
      };

      const results = await collectResults(algebraVar("s"), path, algebraVar("o"));
      expect(results).toEqual([]);
    });

    it("should handle OneOrMore path on empty graph", async () => {
      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/p")],
      };

      const results = await collectResults(algebraVar("s"), path, algebraVar("o"));
      expect(results.length).toBe(0);
    });

    it("should handle ZeroOrMore path on empty graph", async () => {
      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [algebraIri("http://example.org/p")],
      };

      const results = await collectResults(algebraVar("s"), path, algebraVar("o"));
      // ZeroOrMore on empty graph returns nothing (no start nodes)
      expect(results.length).toBe(0);
    });
  });

  describe("Cyclic Graph Handling", () => {
    it("should handle simple cycle without infinite loop", async () => {
      // Create A -> B -> C -> A cycle
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/knows"), iri("http://example.org/B")),
        new Triple(iri("http://example.org/B"), iri("http://example.org/knows"), iri("http://example.org/C")),
        new Triple(iri("http://example.org/C"), iri("http://example.org/knows"), iri("http://example.org/A")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/knows")],
      };

      const results: SolutionMapping[] = [];
      // Should complete without hanging
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000)
      );

      const executePromise = (async () => {
        for await (const mapping of executor.execute(
          algebraIri("http://example.org/A"),
          path,
          algebraVar("o")
        )) {
          results.push(mapping);
        }
      })();

      await Promise.race([executePromise, timeoutPromise]);

      // Should find B, C, and eventually A again (transitive closure stops at visited)
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should handle self-loop without infinite loop", async () => {
      // A -> A (self-loop)
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/self"), iri("http://example.org/A")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/self")],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      // Should find A (via self-loop) exactly once
      expect(results.length).toBe(1);
    });
  });

  describe("Path Not Found", () => {
    it("should return empty for non-matching predicate", async () => {
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/knows"), iri("http://example.org/B")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/nonexistent")],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      expect(results.length).toBe(0);
    });

    it("should return empty when target not reachable", async () => {
      // A -> B (no path to C)
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/knows"), iri("http://example.org/B")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/knows")],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraIri("http://example.org/C")
      );

      expect(results.length).toBe(0);
    });
  });

  describe("Inverse Path Edge Cases", () => {
    it("should handle inverse path correctly", async () => {
      // A -> B
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/knows"), iri("http://example.org/B")),
      ];

      // Query: B ^knows ?o (who knows B? -> A)
      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("http://example.org/knows")],
      };

      const results = await collectResults(
        algebraIri("http://example.org/B"),
        path,
        algebraVar("o")
      );

      expect(results.length).toBe(1);
      expect((results[0].get("o") as IRI).value).toBe("http://example.org/A");
    });

    it("should handle inverse path with no matches", async () => {
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/knows"), iri("http://example.org/B")),
      ];

      // Query: A ^knows ?o (who knows A? -> nobody)
      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("http://example.org/knows")],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      expect(results.length).toBe(0);
    });
  });

  describe("Sequence Path Edge Cases", () => {
    it("should handle sequence path with missing intermediate", async () => {
      // A -p1-> B but no p2 from B
      // C has p2 but not connected to A
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/p1"), iri("http://example.org/B")),
        new Triple(iri("http://example.org/C"), iri("http://example.org/p2"), literal("value")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [
          algebraIri("http://example.org/p1"),
          algebraIri("http://example.org/p2"),
        ],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      // No complete path A -p1-> ? -p2-> ?
      expect(results.length).toBe(0);
    });

    it("should handle long sequence path", async () => {
      // Create chain: N0 -> N1 -> N2 -> ... -> N9
      triples = [];
      for (let i = 0; i < 9; i++) {
        triples.push(
          new Triple(
            iri(`http://example.org/N${i}`),
            iri("http://example.org/p"),
            iri(`http://example.org/N${i + 1}`)
          )
        );
      }

      // Path: p/p/p (3 hops)
      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [
          algebraIri("http://example.org/p"),
          algebraIri("http://example.org/p"),
          algebraIri("http://example.org/p"),
        ],
      };

      const results = await collectResults(
        algebraIri("http://example.org/N0"),
        path,
        algebraVar("o")
      );

      // Should find N3 (3 hops from N0)
      expect(results.length).toBe(1);
      expect((results[0].get("o") as IRI).value).toBe("http://example.org/N3");
    });
  });

  describe("Alternative Path Edge Cases", () => {
    it("should handle alternative path where only one matches", async () => {
      // Only p1 exists
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/p1"), iri("http://example.org/B")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [
          algebraIri("http://example.org/p1"),
          algebraIri("http://example.org/p2"),
        ],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      expect(results.length).toBe(1);
    });

    it("should handle alternative path where neither matches", async () => {
      // Different predicate
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/p3"), iri("http://example.org/B")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [
          algebraIri("http://example.org/p1"),
          algebraIri("http://example.org/p2"),
        ],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      expect(results.length).toBe(0);
    });

    it("should handle alternative path where both match same target", async () => {
      // Both predicates lead to B
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/p1"), iri("http://example.org/B")),
        new Triple(iri("http://example.org/A"), iri("http://example.org/p2"), iri("http://example.org/B")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [
          algebraIri("http://example.org/p1"),
          algebraIri("http://example.org/p2"),
        ],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      // Should deduplicate if both paths lead to same target
      // Or return both depending on implementation
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ZeroOrOne Path Edge Cases", () => {
    it("should include start node for ZeroOrOne path", async () => {
      triples = [
        new Triple(iri("http://example.org/A"), iri("http://example.org/p"), iri("http://example.org/B")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "?",
        items: [algebraIri("http://example.org/p")],
      };

      const results = await collectResults(
        algebraIri("http://example.org/A"),
        path,
        algebraVar("o")
      );

      // Should include both A (zero steps) and B (one step)
      expect(results.length).toBe(2);
      const values = results.map((r) => (r.get("o") as IRI).value);
      expect(values).toContain("http://example.org/A");
      expect(values).toContain("http://example.org/B");
    });
  });

  describe("Large Graph Performance", () => {
    it("should handle moderately deep path traversal", async () => {
      // Create a chain of 20 nodes
      triples = [];
      for (let i = 0; i < 19; i++) {
        triples.push(
          new Triple(
            iri(`http://example.org/node${i}`),
            iri("http://example.org/next"),
            iri(`http://example.org/node${i + 1}`)
          )
        );
      }

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/next")],
      };

      const startTime = Date.now();
      const results = await collectResults(
        algebraIri("http://example.org/node0"),
        path,
        algebraVar("o")
      );
      const duration = Date.now() - startTime;

      // Should find all 19 reachable nodes
      expect(results.length).toBe(19);
      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });
});
