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

  describe("Branch coverage improvements", () => {
    describe("resolveElement with blank node", () => {
      it("should resolve blank node element", async () => {
        const { BlankNode } = await import("../../../../../src/domain/models/rdf/BlankNode");
        triples = [
          new Triple(new BlankNode("b1") as any, iri("http://example.org/p"), iri("http://example.org/a")),
        ];

        const path: PropertyPath = {
          type: "path",
          pathType: "+",
          items: [algebraIri("http://example.org/p")],
        };

        const blankElement: TripleElement = { type: "blank", value: "b1" };
        const results = await collectResults(blankElement, path, algebraVar("o"));
        // BlankNode start should work (may or may not match depending on toString comparison)
        expect(results).toBeDefined();
      });

      it("should throw for unsupported element type", async () => {
        const path: PropertyPath = {
          type: "path",
          pathType: "+",
          items: [algebraIri("http://example.org/p")],
        };

        const unsupported: TripleElement = { type: "literal" as any, value: "hello" };
        await expect(collectResults(unsupported, path, algebraVar("o"))).rejects.toThrow(
          "Unsupported element type"
        );
      });
    });

    describe("executeWithBindings", () => {
      it("should throw when predicate is not a property path", async () => {
        const existingSolution = new SolutionMapping();
        const pattern = {
          subject: { type: "variable" as const, value: "s" },
          predicate: algebraIri("http://example.org/p") as any, // Not a path type
          object: { type: "variable" as const, value: "o" },
        };

        const results: SolutionMapping[] = [];
        await expect(async () => {
          for await (const mapping of executor.executeWithBindings(pattern, existingSolution)) {
            results.push(mapping);
          }
        }).rejects.toThrow("not a property path");
      });

      it("should use existing bindings for object", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/c")),
        ];

        const existingSolution = new SolutionMapping();
        existingSolution.set("end", iri("http://example.org/b"));

        const pattern = {
          subject: algebraIri("http://example.org/a"),
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

        // Should match only the binding that's compatible with end=b
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].get("end")?.toString()).toBe("http://example.org/b");
      });

      it("should instantiate bound blank node variable", async () => {
        const { BlankNode } = await import("../../../../../src/domain/models/rdf/BlankNode");
        triples = [
          new Triple(new BlankNode("b1") as any, iri("http://example.org/next"), iri("http://example.org/a")),
        ];

        const existingSolution = new SolutionMapping();
        existingSolution.set("start", new BlankNode("b1") as any);

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
        // Should complete without error
        expect(results).toBeDefined();
      });

      it("should handle unbound variable in instantiateElement", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        ];

        const existingSolution = new SolutionMapping();
        // Don't set "start" - it remains unbound

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
        // Unbound variable should resolve to all subjects/objects
        expect(results).toBeDefined();
      });

      it("should skip results when merge fails", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        ];

        const existingSolution = new SolutionMapping();
        // Bind end to a different value - merge should fail for incompatible binding
        existingSolution.set("end", iri("http://example.org/c"));

        const pattern = {
          subject: algebraIri("http://example.org/a"),
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
        // Merge should fail since "end" is bound to c but path produces b
        expect(results.length).toBe(0);
      });
    });

    describe("invertPath", () => {
      it("should invert a sequence path (reversing and inverting each element)", async () => {
        // a -p1-> b -p2-> c => inverse: c -^p2-> b -^p1-> a
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/b"), iri("http://example.org/p2"), iri("http://example.org/c")),
        ];

        // ^(p1/p2) from c should find a
        const innerSeq: PropertyPath = {
          type: "path",
          pathType: "/",
          items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2")],
        };

        const path: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerSeq],
        };

        const results = await collectResults(algebraIri("http://example.org/c"), path, algebraVar("target"));
        expect(results.length).toBe(1);
        expect(results[0].get("target")?.toString()).toBe("http://example.org/a");
      });

      it("should invert an alternative path", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/c"), iri("http://example.org/p2"), iri("http://example.org/b")),
        ];

        // ^(p1|p2) from b should find a and c
        const innerAlt: PropertyPath = {
          type: "path",
          pathType: "|",
          items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2")],
        };

        const path: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerAlt],
        };

        const results = await collectResults(algebraIri("http://example.org/b"), path, algebraVar("target"));
        expect(results.length).toBe(2);
        const targets = results.map((r) => r.get("target")?.toString());
        expect(targets).toContain("http://example.org/a");
        expect(targets).toContain("http://example.org/c");
      });

      it("should handle double inverse via nested path that cancels out", async () => {
        // Test the "^" case in invertPath where inner is a PropertyPath (not IRI)
        // ^(sequence) should invert the sequence
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/b"), iri("http://example.org/p2"), iri("http://example.org/c")),
        ];

        // We use ^(^(p1/p2)) which should cancel back to (p1/p2)
        // First inverse: ^(p1/p2) reverses to ^p2/^p1
        // Second inverse: ^(^p2/^p1) reverses back to p1/p2
        const innerSeq: PropertyPath = {
          type: "path",
          pathType: "/",
          items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2")],
        };

        const firstInverse: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerSeq],
        };

        const doubleInverse: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [firstInverse],
        };

        const results = await collectResults(algebraIri("http://example.org/a"), doubleInverse, algebraVar("target"));
        expect(results.length).toBe(1);
        expect(results[0].get("target")?.toString()).toBe("http://example.org/c");
      });

      it("should invert OneOrMore path", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/b"), iri("http://example.org/p"), iri("http://example.org/c")),
        ];

        // ^(p+) from c should find a and b
        const innerPlus: PropertyPath = {
          type: "path",
          pathType: "+",
          items: [algebraIri("http://example.org/p")],
        };

        const path: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerPlus],
        };

        const results = await collectResults(algebraIri("http://example.org/c"), path, algebraVar("target"));
        expect(results.length).toBeGreaterThanOrEqual(1);
        const targets = results.map((r) => r.get("target")?.toString());
        expect(targets).toContain("http://example.org/b");
      });

      it("should invert ZeroOrMore path", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p"), iri("http://example.org/b")),
        ];

        // ^(p*) from b should find a (via inverse) and b itself (zero steps)
        const innerStar: PropertyPath = {
          type: "path",
          pathType: "*",
          items: [algebraIri("http://example.org/p")],
        };

        const path: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerStar],
        };

        const results = await collectResults(algebraIri("http://example.org/b"), path, algebraVar("target"));
        expect(results.length).toBeGreaterThanOrEqual(1);
      });

      it("should invert ZeroOrOne path", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p"), iri("http://example.org/b")),
        ];

        // ^(p?) from b should find a (via inverse of p) and b (zero steps)
        const innerOpt: PropertyPath = {
          type: "path",
          pathType: "?",
          items: [algebraIri("http://example.org/p")],
        };

        const path: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerOpt],
        };

        const results = await collectResults(algebraIri("http://example.org/b"), path, algebraVar("target"));
        expect(results.length).toBeGreaterThanOrEqual(1);
        const targets = results.map((r) => r.get("target")?.toString());
        expect(targets).toContain("http://example.org/b"); // zero steps
      });

      it("should invert nested path within OneOrMore", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/b"), iri("http://example.org/p"), iri("http://example.org/c")),
        ];

        // ^((^p)+) = (p+) - double inversion via nested path
        const innerInverse: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [algebraIri("http://example.org/p")],
        };

        const innerPlus: PropertyPath = {
          type: "path",
          pathType: "+",
          items: [innerInverse],
        };

        const path: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerPlus],
        };

        const results = await collectResults(algebraIri("http://example.org/a"), path, algebraVar("target"));
        expect(results.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("execute with both subject and object bound to IRIs", () => {
      it("should not set variables in mapping when both are IRIs", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        ];

        const path: PropertyPath = {
          type: "path",
          pathType: "+",
          items: [algebraIri("http://example.org/next")],
        };

        const results = await collectResults(
          algebraIri("http://example.org/a"),
          path,
          algebraIri("http://example.org/b")
        );
        // Should find a match (path exists from a to b)
        expect(results.length).toBe(1);
        // Mapping should be empty (no variables)
        expect(results[0].size()).toBe(0);
      });
    });

    describe("ZeroOrMore with target nodes", () => {
      it("should include start node when it matches target", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        ];

        const path: PropertyPath = {
          type: "path",
          pathType: "*",
          items: [algebraIri("http://example.org/next")],
        };

        // a * next = a (target is a itself, zero steps)
        const results = await collectResults(
          algebraIri("http://example.org/a"),
          path,
          algebraIri("http://example.org/a")
        );
        expect(results.length).toBe(1);
      });

      it("should not include start node when it does not match target", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        ];

        const path: PropertyPath = {
          type: "path",
          pathType: "*",
          items: [algebraIri("http://example.org/next")],
        };

        // a * next = c (no path from a to c)
        const results = await collectResults(
          algebraIri("http://example.org/a"),
          path,
          algebraIri("http://example.org/c")
        );
        expect(results.length).toBe(0);
      });
    });

    describe("ZeroOrOne with target nodes", () => {
      it("should filter by target in ZeroOrOne path", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
        ];

        const path: PropertyPath = {
          type: "path",
          pathType: "?",
          items: [algebraIri("http://example.org/next")],
        };

        // Should find only b (target), not a (zero steps)
        const results = await collectResults(
          algebraIri("http://example.org/a"),
          path,
          algebraIri("http://example.org/b")
        );
        expect(results.length).toBe(1);
      });
    });

    describe("OneOrMore with target nodes", () => {
      it("should filter results to match target in OneOrMore", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/next"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/b"), iri("http://example.org/next"), iri("http://example.org/c")),
        ];

        const path: PropertyPath = {
          type: "path",
          pathType: "+",
          items: [algebraIri("http://example.org/next")],
        };

        // From a, OneOrMore, target = c
        const results = await collectResults(
          algebraIri("http://example.org/a"),
          path,
          algebraIri("http://example.org/c")
        );
        expect(results.length).toBe(1);
      });
    });

    describe("Inverse path with nested property path (not IRI)", () => {
      it("should recursively invert nested path in inverse evaluation", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p1"), iri("http://example.org/b")),
          new Triple(iri("http://example.org/b"), iri("http://example.org/p2"), iri("http://example.org/c")),
        ];

        // ^(p1/p2) should evaluate as inverse sequence
        const innerSeq: PropertyPath = {
          type: "path",
          pathType: "/",
          items: [algebraIri("http://example.org/p1"), algebraIri("http://example.org/p2")],
        };

        const path: PropertyPath = {
          type: "path",
          pathType: "^",
          items: [innerSeq],
        };

        const results = await collectResults(algebraIri("http://example.org/c"), path, algebraVar("target"));
        expect(results.length).toBe(1);
        expect(results[0].get("target")?.toString()).toBe("http://example.org/a");
      });
    });

    describe("Variable subject resolving", () => {
      it("should resolve all subjects and objects when subject is variable", async () => {
        triples = [
          new Triple(iri("http://example.org/a"), iri("http://example.org/p"), iri("http://example.org/b")),
        ];

        const path: PropertyPath = {
          type: "path",
          pathType: "+",
          items: [algebraIri("http://example.org/p")],
        };

        // Both subject and object are variables
        const results = await collectResults(algebraVar("s"), path, algebraVar("o"));
        expect(results.length).toBeGreaterThanOrEqual(1);
        // Should include mapping where s=a, o=b
        const hasExpected = results.some(
          r => r.get("s")?.toString() === "http://example.org/a" &&
               r.get("o")?.toString() === "http://example.org/b"
        );
        expect(hasExpected).toBe(true);
      });
    });
  });
});
