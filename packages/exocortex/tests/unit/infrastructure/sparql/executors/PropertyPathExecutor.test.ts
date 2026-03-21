import { PropertyPathExecutor } from "../../../../../src/infrastructure/sparql/executors/PropertyPathExecutor";
import type { ITripleStore } from "../../../../../src/interfaces/ITripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import type { TripleElement, PropertyPath, IRI as AlgebraIRI } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";

describe("PropertyPathExecutor", () => {
  let executor: PropertyPathExecutor;
  let mockTripleStore: jest.Mocked<ITripleStore>;
  let triples: Triple[];

  // Helper to create IRI
  const iri = (value: string): IRI => new IRI(value);

  // Helper to create algebra elements
  const algebraIri = (value: string): AlgebraIRI => ({ type: "iri", value });
  const algebraVar = (name: string): TripleElement => ({ type: "variable", value: name });

  beforeEach(() => {
    triples = [];
    mockTripleStore = {
      add: jest.fn(),
      addAll: jest.fn(),
      remove: jest.fn(),
      removeAll: jest.fn(),
      has: jest.fn(),
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
      count: jest.fn().mockImplementation(() => Promise.resolve(triples.length)),
      subjects: jest.fn(),
      predicates: jest.fn(),
      objects: jest.fn(),
      beginTransaction: jest.fn(),
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

  describe("Simple IRI path (single step)", () => {
    it("should match single predicate step", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/knows"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/knows"), iri("http://example.org/c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/knows")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(2);
      const targets = results.map((r) => r.get("target")?.toString());
      expect(targets).toContain("http://example.org/b");
      expect(targets).toContain("http://example.org/c");
    });
  });

  describe("OneOrMore path (+)", () => {
    it("should find transitive closure with depth 1", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/parent"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/parent")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("ancestor"));

      expect(results.length).toBe(1);
      expect(results[0].get("ancestor")?.toString()).toBe("http://example.org/b");
    });

    it("should find transitive closure with depth 3", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/parent"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/parent"), iri("http://example.org/c")),
        new Triple(iri("http://example.org/c"), iri("http://example.org/parent"), iri("http://example.org/d")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/parent")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("ancestor"));

      expect(results.length).toBe(3);
      const ancestors = results.map((r) => r.get("ancestor")?.toString());
      expect(ancestors).toContain("http://example.org/b");
      expect(ancestors).toContain("http://example.org/c");
      expect(ancestors).toContain("http://example.org/d");
    });

    it("should handle cycles without infinite loop", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/next"), iri("http://example.org/c")),
        new Triple(iri("http://example.org/c"), iri("http://example.org/next"), iri("http://example.org/a")), // Cycle back to a
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("node"));

      expect(results.length).toBe(3);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("http://example.org/a");
      expect(nodes).toContain("http://example.org/b");
      expect(nodes).toContain("http://example.org/c");
    });

    it("should not include start node (one or more steps required)", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("node"));

      expect(results.length).toBe(1);
      expect(results[0].get("node")?.toString()).toBe("http://example.org/b");
    });
  });

  describe("ZeroOrMore path (*)", () => {
    it("should include start node (zero steps)", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("node"));

      expect(results.length).toBe(2);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("http://example.org/a"); // Zero steps
      expect(nodes).toContain("http://example.org/b"); // One step
    });

    it("should return only start when no matching predicates", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/other"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("node"));

      expect(results.length).toBe(1);
      expect(results[0].get("node")?.toString()).toBe("http://example.org/a");
    });
  });

  describe("ZeroOrOne path (?)", () => {
    it("should include start node and one step", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "?",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("node"));

      expect(results.length).toBe(2);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("http://example.org/a"); // Zero steps
      expect(nodes).toContain("http://example.org/b"); // One step
    });

    it("should not include nodes at depth 2", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/next"), iri("http://example.org/c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "?",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("node"));

      expect(results.length).toBe(2);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("http://example.org/a");
      expect(nodes).toContain("http://example.org/b");
      expect(nodes).not.toContain("http://example.org/c"); // Too far
    });
  });

  describe("Inverse path (^)", () => {
    it("should traverse in reverse direction", async () => {
      triples = [
        new Triple(iri("http://example.org/child"), iri("http://example.org/parent"), iri("http://example.org/adult")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("http://example.org/parent")],
      };

      const results = await collectResults(algebraIri("http://example.org/adult"), path, algebraVar("child"));

      expect(results.length).toBe(1);
      expect(results[0].get("child")?.toString()).toBe("http://example.org/child");
    });

    it("should find multiple inverse matches", async () => {
      triples = [
        new Triple(iri("http://example.org/child1"), iri("http://example.org/parent"), iri("http://example.org/adult")),
        new Triple(iri("http://example.org/child2"), iri("http://example.org/parent"), iri("http://example.org/adult")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("http://example.org/parent")],
      };

      const results = await collectResults(algebraIri("http://example.org/adult"), path, algebraVar("child"));

      expect(results.length).toBe(2);
      const children = results.map((r) => r.get("child")?.toString());
      expect(children).toContain("http://example.org/child1");
      expect(children).toContain("http://example.org/child2");
    });
  });

  describe("Sequence path (/)", () => {
    it("should match two predicates in sequence", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/knows"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/likes"), iri("http://example.org/c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("http://example.org/knows"), algebraIri("http://example.org/likes")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("http://example.org/c");
    });

    it("should match three predicates in sequence", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/p2"), iri("http://example.org/c")),
        new Triple(iri("http://example.org/c"), iri("http://example.org/p3"), iri("http://example.org/d")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2"), algebraIri("http://example.org/p3")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("http://example.org/d");
    });

    it("should return empty when sequence breaks", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b")),
        // Missing: ex:b ex:p2 ?
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });
  });

  describe("Alternative path (|)", () => {
    it("should match either predicate", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/knows"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/a"), iri("http://example.org/likes"), iri("http://example.org/c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("http://example.org/knows"), algebraIri("http://example.org/likes")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(2);
      const targets = results.map((r) => r.get("target")?.toString());
      expect(targets).toContain("http://example.org/b");
      expect(targets).toContain("http://example.org/c");
    });

    it("should match only one when other has no results", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/knows"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("http://example.org/knows"), algebraIri("http://example.org/likes")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("http://example.org/b");
    });
  });

  describe("Nested paths", () => {
    it("should handle sequence inside oneOrMore", async () => {
      // Pattern: (ex:parent/ex:parent)+ - find ancestors at even depths
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/parent"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/parent"), iri("http://example.org/c")),
        new Triple(iri("http://example.org/c"), iri("http://example.org/parent"), iri("http://example.org/d")),
        new Triple(iri("http://example.org/d"), iri("http://example.org/parent"), iri("http://example.org/e")),
      ];

      const innerPath: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("http://example.org/parent"), algebraIri("http://example.org/parent")],
      };

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [innerPath],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("ancestor"));

      // Should reach c (2 steps) and e (4 steps)
      expect(results.length).toBe(2);
      const ancestors = results.map((r) => r.get("ancestor")?.toString());
      expect(ancestors).toContain("http://example.org/c");
      expect(ancestors).toContain("http://example.org/e");
    });

    it("should handle alternative inside zeroOrMore", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/knows"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/likes"), iri("http://example.org/c")),
      ];

      const innerPath: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("http://example.org/knows"), algebraIri("http://example.org/likes")],
      };

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [innerPath],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("node"));

      expect(results.length).toBe(3);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("http://example.org/a"); // Zero steps
      expect(nodes).toContain("http://example.org/b"); // One step via knows
      expect(nodes).toContain("http://example.org/c"); // Two steps via knows/likes
    });
  });

  describe("With bound target", () => {
    it("should filter results to match target", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/next"), iri("http://example.org/c")),
        new Triple(iri("http://example.org/c"), iri("http://example.org/next"), iri("http://example.org/d")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/next")],
      };

      // Look for path from a to c specifically
      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraIri("http://example.org/c"));

      expect(results.length).toBe(1);
    });

    it("should return empty when target not reachable", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraIri("http://example.org/c"));

      expect(results.length).toBe(0);
    });
  });

  describe("executeWithBindings", () => {
    it("should use existing bindings for subject", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b"))];

      const existingSolution = new SolutionMapping();
      existingSolution.set("start", iri("http://example.org/a"));

      const pattern = {
        subject: { type: "variable" as const, value: "start" },
        predicate: {
          type: "path" as const,
          pathType: "+" as const,
          items: [algebraIri("http://example.org/next")] as [AlgebraIRI],
        },
        object: { type: "variable" as const, value: "end" },
      };

      const results: SolutionMapping[] = [];
      for await (const mapping of executor.executeWithBindings(pattern, existingSolution)) {
        results.push(mapping);
      }

      expect(results.length).toBe(1);
      expect(results[0].get("start")?.toString()).toBe("http://example.org/a");
      expect(results[0].get("end")?.toString()).toBe("http://example.org/b");
    });
  });

  describe("Edge Cases", () => {
    it("should return empty for path with no matches", async () => {
      // No triples at all
      triples = [];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/nonexistent")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });

    it("should return only self for ZeroOrMore when no matches exist", async () => {
      triples = [];

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [algebraIri("http://example.org/nonexistent")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("http://example.org/a");
    });

    it("should respect MAX_DEPTH limit for very deep paths", async () => {
      // Create a chain of 150 nodes (exceeds MAX_DEPTH = 100)
      triples = [];
      for (let i = 0; i < 150; i++) {
        triples.push(new Triple(iri(`http://example.org/node${i}`), iri("http://example.org/next"), iri(`http://example.org/node${i + 1}`)));
      }

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("http://example.org/next")],
      };

      const results = await collectResults(algebraIri("http://example.org/node0"), path, algebraVar("target"));

      // Should stop at MAX_DEPTH (100) and not traverse all 150 nodes
      expect(results.length).toBeLessThanOrEqual(100);
      expect(results.length).toBeGreaterThan(50); // Should still find many nodes
    });

    it("should handle alternative path with both alternatives failing", async () => {
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/other"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("http://example.org/knows"), algebraIri("http://example.org/likes")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });

    it("should handle sequence path with missing intermediate nodes", async () => {
      // Only has first step, missing second step
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2"), algebraIri("http://example.org/p3")],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });

    it("should handle inverse path with no reverse matches", async () => {
      // Triple goes from a to b, inverse looks from b backwards
      triples = [new Triple(iri("http://example.org/a"), iri("http://example.org/knows"), iri("http://example.org/b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("http://example.org/knows")],
      };

      // Starting from 'a' with inverse - should find nothing since 'a' is not an object
      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("subject"));

      expect(results.length).toBe(0);
    });

    it("should handle deeply nested path expression", async () => {
      triples = [
        new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b")),
        new Triple(iri("http://example.org/a"), iri("http://example.org/p2"), iri("http://example.org/c")),
        new Triple(iri("http://example.org/b"), iri("http://example.org/p1"), iri("http://example.org/d")),
        new Triple(iri("http://example.org/c"), iri("http://example.org/p2"), iri("http://example.org/e")),
      ];

      // Complex: ((p1|p2)/p1)+ - alternative followed by p1, one or more times
      const innerAlt: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2")],
      };

      const sequence: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [innerAlt, algebraIri("http://example.org/p1")],
      };

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [sequence],
      };

      const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));

      // Should reach 'd' (via a->b->d)
      expect(results.length).toBeGreaterThanOrEqual(1);
      const targets = results.map((r) => r.get("target")?.toString());
      expect(targets).toContain("http://example.org/d");
    });
  });
});
